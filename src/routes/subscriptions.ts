import { Router } from "express";
import { z } from "zod";
import Stripe from "stripe";
import { stripe } from "../lib/stripe";
import {
  BASE_CURRENCY,
  PlanType,
  SHIPPING_COST_CENTS,
  CREDIT_CARD_FEE_PERCENT,
  TRIAL_PERIOD_DAYS,
  SHIPPING_LINE_ITEM_DESCRIPTION,
  getSubscriptionPlan,
} from "../config";
import {
  buildClinicMetadata,
  findCouponDetails,
  findCustomerByEmail,
  isCreditFunding,
  retrievePaymentMethod,
  getOrCreateCreditCardFeePrice,
} from "../services/stripeHelpers";
import type { ClinicAddress } from "../services/stripeHelpers";
import { percentageToAmount } from "../utils/amounts";
import { isDateWithinNextTwoMonths } from "../utils/dates";

const router = Router();

const clinicAddressSchema = z.object({
  line1: z.string().optional(),
  line2: z.string().optional(),
  city: z.string().min(1),
  state: z.string().optional(),
  postalCode: z.string().min(1),
  country: z.string().min(2).max(2),
});

const subscriptionSchema = z.object({
  email: z.string().email(),
  clinicName: z.string().min(1),
  clinicAddress: clinicAddressSchema,
  couponCode: z.string().optional(),
  planType: z.literal(PlanType.Subscription),
  durationYears: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  billingCadence: z.enum(["monthly", "annual"]),
  desiredStartDate: z.string().optional(),
  buyingGroupMember: z.boolean(),
  buyingGroupName: z.string().optional(),
  acceptTerms: z.literal(true),
});

const ensureCurrencyMatches = (price: Stripe.Price): void => {
  if (price.currency !== BASE_CURRENCY) {
    throw new Error(`Price currency ${price.currency} does not match expected ${BASE_CURRENCY}`);
  }
};

router.post("/", async (req, res, next) => {
  try {
    const payload = subscriptionSchema.parse(req.body);

    if (payload.desiredStartDate && !isDateWithinNextTwoMonths(payload.desiredStartDate)) {
      return res.status(400).json({
        error: "Desired start date must be within the next two months.",
      });
    }

    const customer = await findCustomerByEmail(payload.email);

    if (!customer.invoice_settings.default_payment_method) {
      return res.status(400).json({
        error: "Customer does not have a default payment method. Please set up your payment method first.",
      });
    }

    const paymentMethodId =
      typeof customer.invoice_settings.default_payment_method === "string"
        ? customer.invoice_settings.default_payment_method
        : customer.invoice_settings.default_payment_method.id;

    const paymentMethod = await retrievePaymentMethod(paymentMethodId);
    if (paymentMethod.type !== "card") {
      return res.status(400).json({ error: "Only card payment methods are supported." });
    }

    const plan = getSubscriptionPlan(payload.durationYears, payload.billingCadence);
    const price = await stripe.prices.retrieve(plan.priceId!);
    ensureCurrencyMatches(price);

    if (!price.unit_amount || !price.recurring) {
      throw new Error("Subscription price must have a recurring unit amount.");
    }

    const planUnitAmount = price.unit_amount;
    const creditFunding = isCreditFunding(paymentMethod);
    const couponDetails = await findCouponDetails(payload.couponCode);

    let discountedPlanAmount = planUnitAmount;
    const effectiveCouponPercent = couponDetails?.percentOff ?? null;
    let effectiveCouponAmount = 0;

    if (couponDetails?.percentOff) {
      effectiveCouponAmount = percentageToAmount(planUnitAmount, couponDetails.percentOff);
      discountedPlanAmount = Math.max(planUnitAmount - effectiveCouponAmount, 0);
    } else if (couponDetails?.amountOff && couponDetails.currency === BASE_CURRENCY) {
      effectiveCouponAmount = Math.min(couponDetails.amountOff, planUnitAmount);
      discountedPlanAmount = Math.max(planUnitAmount - effectiveCouponAmount, 0);
    }

    const creditCardFeeAmount = creditFunding ? percentageToAmount(discountedPlanAmount, CREDIT_CARD_FEE_PERCENT) : 0;

    const clinicMetadata = buildClinicMetadata(payload.clinicName, payload.clinicAddress as ClinicAddress, {
      buyingGroupMember: payload.buyingGroupMember,
      buyingGroupName: payload.buyingGroupName,
      desiredStartDate: payload.desiredStartDate,
    });

    let feePriceId: string | undefined;
    if (creditCardFeeAmount > 0) {
      feePriceId = await getOrCreateCreditCardFeePrice(creditCardFeeAmount, {
        interval: price.recurring.interval,
        intervalCount: price.recurring.interval_count ?? 1,
      });
    }

    const subscriptionParams: Stripe.SubscriptionCreateParams = {
      customer: customer.id,
      default_payment_method: paymentMethod.id,
      items: [
        {
          price: plan.priceId!,
        },
      ],
      trial_period_days: TRIAL_PERIOD_DAYS,
      payment_behavior: "default_incomplete",
      metadata: {
        plan_type: PlanType.Subscription,
        duration_years: payload.durationYears.toString(),
        billing_cadence: payload.billingCadence,
        clinic_name: payload.clinicName,
        clinic_timezone: clinicMetadata.clinicTimezone,
        coupon_code: payload.couponCode ?? "",
        coupon_percent_off: effectiveCouponPercent?.toString() ?? "",
        coupon_discount_amount_cents: effectiveCouponAmount.toString(),
        credit_card_fee_cents: creditCardFeeAmount.toString(),
        fee_percent_applied: creditFunding ? CREDIT_CARD_FEE_PERCENT.toString() : "0",
        shipping_amount_cents: SHIPPING_COST_CENTS.toString(),
        buying_group_member: String(payload.buyingGroupMember),
        buying_group_name: payload.buyingGroupName ?? "",
        desired_start_date: payload.desiredStartDate ?? "",
        terms_accepted_at: clinicMetadata.termsAcceptedAt,
      },
      discounts: couponDetails?.couponId
        ? [
            {
              coupon: couponDetails.couponId,
            },
          ]
        : undefined,
      payment_settings: {
        save_default_payment_method: "on_subscription",
        payment_method_types: ["card"],
      },
      expand: ["latest_invoice.payment_intent"],
    };

    if (feePriceId) {
      subscriptionParams.items?.push({
        price: feePriceId,
      });
    }

    const subscription = await stripe.subscriptions.create(subscriptionParams);

    if (SHIPPING_COST_CENTS > 0) {
      await stripe.invoiceItems.create({
        customer: customer.id,
        subscription: subscription.id,
        amount: SHIPPING_COST_CENTS,
        currency: BASE_CURRENCY,
        description: SHIPPING_LINE_ITEM_DESCRIPTION,
      });
    }
    const latestInvoice = subscription.latest_invoice;

    let paymentIntent: Stripe.PaymentIntent | null = null;
    if (latestInvoice && typeof latestInvoice !== "string") {
      if (latestInvoice.payment_intent && typeof latestInvoice.payment_intent !== "string") {
        paymentIntent = latestInvoice.payment_intent;
      } else if (typeof latestInvoice.payment_intent === "string") {
        paymentIntent = await stripe.paymentIntents.retrieve(latestInvoice.payment_intent);
      }
    }

    // Confirm the payment intent immediately, as the payment method should be already set and confirmed in the `setup-intents` request
    if (paymentIntent && paymentIntent.status === "requires_confirmation") {
      paymentIntent = await stripe.paymentIntents.confirm(paymentIntent.id);
    }

    res.json({
      subscriptionId: subscription.id,
      amountDue: paymentIntent?.amount ?? null,
      currency: paymentIntent?.currency ?? BASE_CURRENCY,
      creditCardFeeAmount,
      shippingAmount: SHIPPING_COST_CENTS,
      clinicTimezone: clinicMetadata.clinicTimezone,
      status: paymentIntent?.status ?? null,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
