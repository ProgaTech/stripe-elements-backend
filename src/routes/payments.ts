import { Router } from "express";
import { z } from "zod";
import { stripe } from "../lib/stripe";
import {
  PlanType,
  SHIPPING_COST_CENTS,
  CREDIT_CARD_FEE_PERCENT,
  ONE_TIME_PRODUCT_ID,
  SHIPPING_LINE_ITEM_DESCRIPTION,
  BASE_CURRENCY,
} from "../config";
import {
  buildClinicMetadata,
  findCouponDetails,
  findCustomerByEmail,
  isCreditFunding,
  retrievePaymentMethod,
  getOrCreateOneTimeCreditCardFeePrice,
} from "../services/stripeHelpers";
import { computeOneTimeBreakdown } from "../utils/amounts";
import { isDateWithinNextTwoMonths } from "../utils/dates";

const router = Router();

const clinicAddressSchema = z.object({
  line1: z.string().min(1),
  line2: z.string().optional(),
  city: z.string().min(1),
  state: z.string().optional(),
  postalCode: z.string().min(1),
  country: z.string().min(2).max(2),
});

const paymentIntentSchema = z.object({
  email: z.string().email(),
  clinicName: z.string().min(1),
  clinicAddress: clinicAddressSchema,
  couponCode: z.string().trim().optional(),
  planType: z.literal(PlanType.OneTime),
  desiredStartDate: z.string().optional(),
  buyingGroupMember: z.boolean(),
  buyingGroupName: z.string().optional(),
  acceptTerms: z.literal(true),
});

router.post("/", async (req, res, next) => {
  try {
    const payload = paymentIntentSchema.parse(req.body);

    if (payload.desiredStartDate && !isDateWithinNextTwoMonths(payload.desiredStartDate)) {
      return res.status(400).json({
        error: "Desired start date must be within the next two months.",
      });
    }

    // TODO: Retrieve customer with payment method from database first, fallback to Stripe if not found

    const customer = await findCustomerByEmail(payload.email);

    const paymentMethodId =
      typeof customer.invoice_settings.default_payment_method === "string"
        ? customer.invoice_settings.default_payment_method
        : customer.invoice_settings.default_payment_method?.id;

    if (!paymentMethodId) {
      return res.status(400).json({
        error:
          "Customer does not have a default payment method. Please set up your payment method first.",
      });
    }

    const paymentMethod = await retrievePaymentMethod(paymentMethodId);
    if (paymentMethod.type !== "card") {
      return res.status(400).json({ error: "Only card payment methods are supported." });
    }

    const cardFundingIsCredit = isCreditFunding(paymentMethod);
    const couponDetails = await findCouponDetails(payload.couponCode);

    const couponPercent = couponDetails?.percentOff ?? undefined;
    const couponAmountOff =
      couponDetails?.amountOff && couponDetails.currency === BASE_CURRENCY
        ? couponDetails.amountOff
        : undefined;

    const clinicMetadata = buildClinicMetadata(payload.clinicName, payload.clinicAddress, {
      buyingGroupMember: payload.buyingGroupMember,
      buyingGroupName: payload.buyingGroupName,
      desiredStartDate: payload.desiredStartDate,
    });

    // Retrieve the one-time product price
    const oneTimeProduct = await stripe.products.retrieve(ONE_TIME_PRODUCT_ID);
    const oneTimePrice = await stripe.prices.retrieve(oneTimeProduct.default_price as string);

    if (oneTimePrice.currency !== BASE_CURRENCY) {
      throw new Error(
        `Price currency ${oneTimePrice.currency} does not match expected ${BASE_CURRENCY}`,
      );
    }

    if (!oneTimePrice.unit_amount) {
      throw new Error("One-time price must have a unit amount.");
    }

    if (oneTimePrice.recurring) {
      throw new Error("One-time price must not be recurring.");
    }

    const baseAmount = oneTimePrice.unit_amount;
    const breakdown = computeOneTimeBreakdown({
      couponPercent: couponPercent ?? undefined,
      couponAmountOff: couponDetails?.amountOff ?? undefined,
      appliesCreditCardFee: cardFundingIsCredit,
      baseAmount,
    });

    // Create invoice
    const invoice = await stripe.invoices.create({
      customer: customer.id,
      default_payment_method: paymentMethod.id,
      collection_method: "charge_automatically",
      currency: BASE_CURRENCY,
      shipping_details: {
        name: payload.clinicName,
        address: {
          line1: payload.clinicAddress.line1,
          line2: payload.clinicAddress.line2,
          city: payload.clinicAddress.city,
          state: payload.clinicAddress.state,
          postal_code: payload.clinicAddress.postalCode,
          country: payload.clinicAddress.country,
        },
      },
      metadata: {
        plan_type: PlanType.OneTime,
        clinic_name: payload.clinicName,
        clinic_timezone: clinicMetadata.clinicTimezone,
        coupon_code: payload.couponCode ?? "",
        coupon_percent_off: couponPercent?.toString() ?? "",
        coupon_amount_off: couponDetails?.amountOff?.toString() ?? "",
        shipping_amount_cents: breakdown.shippingAmount.toString(),
        credit_card_fee_cents: breakdown.creditCardFeeAmount.toString(),
        fee_percent_applied: cardFundingIsCredit ? CREDIT_CARD_FEE_PERCENT.toString() : "0",
        base_amount_cents: breakdown.baseAmount.toString(),
        discount_amount_cents: breakdown.discountAmount.toString(),
        payment_method_funding: paymentMethod.card?.funding ?? "unknown",
        buying_group_member: String(payload.buyingGroupMember),
        buying_group_name: payload.buyingGroupName ?? "",
        desired_start_date: payload.desiredStartDate ?? "",
        terms_accepted_at: clinicMetadata.termsAcceptedAt,
      },
    });
    console.log("one time price invoice item created", invoice.id);

    // Add main product line item
    await stripe.invoiceItems.create({
      customer: customer.id,
      invoice: invoice.id,
      price: oneTimePrice.id,
      currency: BASE_CURRENCY,
      quantity: 1,
    });

    console.log("one time price invoice item created", invoice.id);

    // Add shipping as invoice item if applicable
    if (SHIPPING_COST_CENTS > 0) {
      await stripe.invoiceItems.create({
        customer: customer.id,
        invoice: invoice.id,
        amount: SHIPPING_COST_CENTS,
        currency: BASE_CURRENCY,
        description: SHIPPING_LINE_ITEM_DESCRIPTION,
      });
      console.log("shipping invoice item created", invoice.id);
    }

    // Add credit card fee as invoice item if applicable
    if (breakdown.creditCardFeeAmount > 0) {
      const feePriceId = await getOrCreateOneTimeCreditCardFeePrice(breakdown.creditCardFeeAmount);
      await stripe.invoiceItems.create({
        customer: customer.id,
        invoice: invoice.id,
        price: feePriceId,
        currency: BASE_CURRENCY,
        quantity: 1,
      });
      console.log("credit card fee invoice item created", invoice.id);
    }

    // Apply coupon if provided
    if (couponDetails?.couponId) {
      await stripe.invoices.update(invoice.id, {
        discounts: [
          {
            coupon: couponDetails.couponId,
          },
        ],
      });
    }

    // Finalize and pay the invoice
    const finalizedInvoice = await stripe.invoices.finalizeInvoice(invoice.id, {
      auto_advance: true,
    });

    // Pay the invoice (this will charge the default payment method)
    const paidInvoice = await stripe.invoices.pay(finalizedInvoice.id, {
      payment_method: paymentMethod.id,
    });

    // Get the payment intent status from the invoice
    let status = "succeeded";
    if (paidInvoice.payment_intent) {
      const paymentIntentId =
        typeof paidInvoice.payment_intent === "string"
          ? paidInvoice.payment_intent
          : paidInvoice.payment_intent.id;
      const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
      status = paymentIntent.status;
    } else if (paidInvoice.status === "paid") {
      status = "succeeded";
    } else if (paidInvoice.status === "open") {
      status = "processing";
    } else {
      status = "failed";
    }

    res.json({
      amount: breakdown.totalAmount,
      currency: BASE_CURRENCY,
      shippingAmount: breakdown.shippingAmount,
      creditCardFeeAmount: breakdown.creditCardFeeAmount,
      coupon: {
        percentOff: couponPercent ?? null,
        amountOff: couponAmountOff ?? null,
      },
      clinicTimezone: clinicMetadata.clinicTimezone,
      cardFunding: paymentMethod.card?.funding ?? "unknown",
      status,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
