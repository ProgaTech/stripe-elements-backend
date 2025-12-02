import { env } from "./env";

export const TRIAL_PERIOD_DAYS = 14;

export const SHIPPING_LINE_ITEM_DESCRIPTION = "Shipping";
export const CREDIT_CARD_FEE_DESCRIPTION = "Credit card processing fee";

export type SubscriptionDurationYears = 1 | 2 | 3;
export type SubscriptionBillingCadence = "monthly" | "annual";

export enum PlanType {
  OneTime = "one_time",
  Subscription = "subscription",
}

export interface SubscriptionPlanConfig {
  durationYears: SubscriptionDurationYears;
  cadence: SubscriptionBillingCadence;
  priceId?: string;
}

const subscriptionPlans: SubscriptionPlanConfig[] = [
  { durationYears: 1, cadence: "annual", priceId: env.subscriptionPriceIds.yearly[1] ?? undefined },
  { durationYears: 2, cadence: "annual", priceId: env.subscriptionPriceIds.yearly[2] ?? undefined },
  { durationYears: 3, cadence: "annual", priceId: env.subscriptionPriceIds.yearly[3] ?? undefined },
  {
    durationYears: 1,
    cadence: "monthly",
    priceId: env.subscriptionPriceIds.monthly[1] ?? undefined,
  },
  {
    durationYears: 2,
    cadence: "monthly",
    priceId: env.subscriptionPriceIds.monthly[2] ?? undefined,
  },
  {
    durationYears: 3,
    cadence: "monthly",
    priceId: env.subscriptionPriceIds.monthly[3] ?? undefined,
  },
];

export const getSubscriptionPlan = (
  durationYears: SubscriptionDurationYears,
  cadence: SubscriptionBillingCadence,
): SubscriptionPlanConfig => {
  const plan = subscriptionPlans.find(
    (entry) => entry.durationYears === durationYears && entry.cadence === cadence,
  );
  if (!plan) {
    throw new Error(`Unsupported subscription plan: ${durationYears} years, ${cadence}`);
  }

  if (!plan.priceId) {
    throw new Error(
      `Missing Stripe price ID for subscription plan: ${durationYears}-year ${cadence}`,
    );
  }

  return plan;
};

export const SHIPPING_COST_CENTS = env.shippingCost;
export const CREDIT_CARD_FEE_PERCENT = env.creditCardFeePercent;
export const BASE_CURRENCY = env.currency;
export const ONE_TIME_BASE_AMOUNT_CENTS = env.oneTimeBaseAmount;
export const ONE_TIME_PRODUCT_ID = env.oneTimeProductId;
export const CREDIT_CARD_FEE_PRODUCT_ID = env.creditCardFeeProductId;

export const getCouponIdForCode = (code: string | null | undefined): string | null => {
  if (!code) {
    return null;
  }
  const normalized = code.trim().toLowerCase();
  if (normalized.length === 0) {
    return null;
  }
  return env.couponMappings[normalized] ?? null;
};
