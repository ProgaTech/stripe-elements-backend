import Stripe from "stripe";
import { stripe } from "../lib/stripe";
import { inferTimezoneFromAddress } from "../utils/timezone";
import {
  getCouponIdForCode,
  CREDIT_CARD_FEE_PRODUCT_ID,
  BASE_CURRENCY,
  CREDIT_CARD_FEE_PERCENT,
} from "../config";

export interface ClinicMetadata {
  clinicName: string;
  clinicTimezone: string;
  buyingGroupMember: boolean;
  buyingGroupName?: string | null;
  desiredStartDate?: string | null;
  termsAcceptedAt: string;
}

const couponCache = new Map<string, Stripe.Coupon>();

export const retrievePaymentMethod = async (
  paymentMethodId: string,
): Promise<Stripe.PaymentMethod> => {
  return stripe.paymentMethods.retrieve(paymentMethodId);
};

export const isCreditFunding = (paymentMethod: Stripe.PaymentMethod): boolean => {
  if (paymentMethod.type !== "card") {
    return false;
  }
  const funding = paymentMethod.card?.funding ?? "unknown";
  return funding === "credit" || funding === "unknown";
};

export const getOrCreateCustomer = async (
  email: string,
  clinicMetadata: ClinicMetadata,
  shipping?: Stripe.CustomerCreateParams.Shipping,
): Promise<Stripe.Customer> => {
  const existing = await stripe.customers.list({ email, limit: 1 });
  const metadata: Stripe.MetadataParam = {
    clinic_name: clinicMetadata.clinicName,
    clinic_timezone: clinicMetadata.clinicTimezone,
    buying_group_member: String(clinicMetadata.buyingGroupMember),
    buying_group_name: clinicMetadata.buyingGroupName ?? "",
    desired_start_date: clinicMetadata.desiredStartDate ?? "",
    terms_accepted_at: clinicMetadata.termsAcceptedAt,
  };

  if (existing.data.length > 0) {
    const [customer] = existing.data;
    await stripe.customers.update(customer.id, {
      name: clinicMetadata.clinicName,
      metadata: {
        ...customer.metadata,
        ...metadata,
      },
    });
    return customer;
  }

  return stripe.customers.create({
    email,
    name: clinicMetadata.clinicName,
    metadata,
    // NOTE: Depends on whether purchases are often shipped to the same address,
    // it may be useful to store the shipping address in the customer object.
    // Could remove this if not needed, as it provided for each payment/subscription separately as well.
    shipping: shipping,
  });
};

export const findCustomerByEmail = async (email: string): Promise<Stripe.Customer> => {
  const customers = await stripe.customers.list({ email, limit: 1 });
  if (customers.data.length === 0) {
    throw new Error(`Customer with email ${email} not found. Please set up your account first.`);
  }
  return customers.data[0];
};

export const ensureDefaultPaymentMethodSet = async (
  customerId: string,
  paymentMethod: Stripe.PaymentMethod,
): Promise<void> => {
  if (paymentMethod.customer === customerId) {
    return;
  }
  if (paymentMethod.customer && paymentMethod.customer !== customerId) {
    await stripe.paymentMethods.detach(paymentMethod.id);
  }
  await stripe.paymentMethods.attach(paymentMethod.id, { customer: customerId });
  await stripe.customers.update(customerId, {
    invoice_settings: {
      default_payment_method: paymentMethod.id,
    },
  });
};

export interface CouponDetails {
  couponId: string;
  percentOff?: number | null;
  amountOff?: number | null;
  currency?: string | null;
}

export const findCouponDetails = async (
  couponCode?: string | null,
): Promise<CouponDetails | null> => {
  if (!couponCode) {
    return null;
  }

  const couponId = getCouponIdForCode(couponCode);
  if (!couponId) {
    return null;
  }

  if (couponCache.has(couponId)) {
    const cached = couponCache.get(couponId)!;
    return {
      couponId,
      percentOff: cached.percent_off,
      amountOff: cached.amount_off,
      currency: cached.currency,
    };
  }

  const coupon = await stripe.coupons.retrieve(couponId);
  couponCache.set(couponId, coupon);

  return {
    couponId,
    percentOff: coupon.percent_off,
    amountOff: coupon.amount_off,
    currency: coupon.currency,
  };
};

export interface ClinicAddress {
  line1: string;
  line2?: string;
  city: string;
  state?: string;
  postalCode: string;
  country: string;
}

export const buildClinicMetadata = (
  clinicName: string,
  address: ClinicAddress,
  options: {
    buyingGroupMember: boolean;
    buyingGroupName?: string | null;
    desiredStartDate?: string | null;
  },
): ClinicMetadata => {
  const timezone = inferTimezoneFromAddress({
    country: address.country,
    state: address.state,
    city: address.city,
  });

  return {
    clinicName,
    clinicTimezone: timezone,
    buyingGroupMember: options.buyingGroupMember,
    buyingGroupName: options.buyingGroupName,
    desiredStartDate: options.desiredStartDate,
    termsAcceptedAt: new Date().toISOString(),
  };
};

/**
 * Gets or creates a credit card fee price for the given amount and recurring interval.
 * Checks if a price with the same amount already exists for the credit card fee product
 * before creating a new one.
 */
export const getOrCreateCreditCardFeePrice = async (
  feeAmountCents: number,
  recurring: {
    interval: Stripe.Price.Recurring.Interval;
    intervalCount?: number;
  },
): Promise<string> => {
  if (feeAmountCents <= 0) {
    throw new Error("Fee amount must be greater than 0");
  }

  // Search for existing prices for the credit card fee product
  const existingPrices = await stripe.prices.list({
    product: CREDIT_CARD_FEE_PRODUCT_ID,
    active: true,
    limit: 100,
  });

  // Check if a price with the same amount and recurring interval already exists
  const matchingPrice = existingPrices.data.find((price) => {
    if (price.currency !== BASE_CURRENCY) {
      return false;
    }
    if (price.unit_amount !== feeAmountCents) {
      return false;
    }
    if (!price.recurring) {
      return false;
    }
    if (price.recurring.interval !== recurring.interval) {
      return false;
    }
    if (price.recurring.interval_count !== (recurring.intervalCount ?? 1)) {
      return false;
    }
    return true;
  });

  if (matchingPrice) {
    return matchingPrice.id;
  }

  // Create a new price if no matching price exists
  const newPrice = await stripe.prices.create({
    currency: BASE_CURRENCY,
    unit_amount: feeAmountCents,
    recurring: {
      interval: recurring.interval,
      interval_count: recurring.intervalCount ?? 1,
    },
    product: CREDIT_CARD_FEE_PRODUCT_ID,
    metadata: {
      fee_percent: CREDIT_CARD_FEE_PERCENT.toString(),
    },
  });

  return newPrice.id;
};

/**
 * Gets or creates a one-time credit card fee price for the given amount.
 * Checks if a price with the same amount already exists for the credit card fee product
 * before creating a new one.
 */
export const getOrCreateOneTimeCreditCardFeePrice = async (
  feeAmountCents: number,
): Promise<string> => {
  if (feeAmountCents <= 0) {
    throw new Error("Fee amount must be greater than 0");
  }

  // Search for existing prices for the credit card fee product
  const existingPrices = await stripe.prices.list({
    product: CREDIT_CARD_FEE_PRODUCT_ID,
    active: true,
    limit: 100,
    currency: BASE_CURRENCY,
  });

  // Check if a one-time price with the same amount already exists
  const matchingPrice = existingPrices.data.find((price) => {
    if (price.currency !== BASE_CURRENCY) {
      return false;
    }
    if (price.unit_amount !== feeAmountCents) {
      return false;
    }
    // Must be a one-time price (not recurring)
    if (price.recurring) {
      return false;
    }
    return true;
  });

  if (matchingPrice) {
    return matchingPrice.id;
  }

  // Create a new one-time price if no matching price exists
  const newPrice = await stripe.prices.create({
    currency: BASE_CURRENCY,
    unit_amount: feeAmountCents,
    product: CREDIT_CARD_FEE_PRODUCT_ID,
    metadata: {
      fee_percent: CREDIT_CARD_FEE_PERCENT.toString(),
    },
  });

  return newPrice.id;
};
