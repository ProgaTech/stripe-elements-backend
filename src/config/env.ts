import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(5000),
  STRIPE_SECRET_KEY: z.string().min(1, "STRIPE_SECRET_KEY is required"),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  FRONTEND_URL: z.string().url().default("http://localhost:5173"),
  SHIPPING_COST: z.coerce.number().int().nonnegative().default(0),
  CURRENCY: z.string().default("usd"),
  CREDIT_CARD_FEE_PERCENT: z.coerce.number().nonnegative().default(3),
  ONE_TIME_BASE_AMOUNT: z.coerce.number().int().nonnegative().default(5000),
  COUPON_CODES: z.string().optional(),
  CREDIT_CARD_FEE_PRODUCT_ID: z.string().min(1, "CREDIT_CARD_FEE_PRODUCT_ID is required"),
  ONE_TIME_PRODUCT_ID: z.string().min(1, "ONE_TIME_PRODUCT_ID is required"),
  SUBSCRIPTION_PRICE_ID_YEARLY_1: z.string().optional(),
  SUBSCRIPTION_PRICE_ID_YEARLY_2: z.string().optional(),
  SUBSCRIPTION_PRICE_ID_YEARLY_3: z.string().optional(),
  SUBSCRIPTION_PRICE_ID_MONTHLY_1: z.string().optional(),
  SUBSCRIPTION_PRICE_ID_MONTHLY_2: z.string().optional(),
  SUBSCRIPTION_PRICE_ID_MONTHLY_3: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error("Invalid environment configuration", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const couponCodes = (parsed.data.COUPON_CODES ?? "")
  .split("|")
  .map((entry) => entry.trim())
  .filter((entry) => entry.length > 0)
  .reduce<Record<string, string>>((acc, entry) => {
    const [code, value] = entry.split(":");
    if (!code || !value) {
      return acc;
    }
    acc[code.toLowerCase()] = value;
    return acc;
  }, {});

export const env = {
  port: parsed.data.PORT,
  stripeSecretKey: parsed.data.STRIPE_SECRET_KEY,
  stripeWebhookSecret: parsed.data.STRIPE_WEBHOOK_SECRET,
  frontendUrl: parsed.data.FRONTEND_URL,
  shippingCost: parsed.data.SHIPPING_COST,
  currency: parsed.data.CURRENCY,
  creditCardFeePercent: parsed.data.CREDIT_CARD_FEE_PERCENT,
  oneTimeBaseAmount: parsed.data.ONE_TIME_BASE_AMOUNT,
  oneTimeProductId: parsed.data.ONE_TIME_PRODUCT_ID,
  creditCardFeeProductId: parsed.data.CREDIT_CARD_FEE_PRODUCT_ID,
  couponMappings: couponCodes,
  subscriptionPriceIds: {
    yearly: {
      1: parsed.data.SUBSCRIPTION_PRICE_ID_YEARLY_1,
      2: parsed.data.SUBSCRIPTION_PRICE_ID_YEARLY_2,
      3: parsed.data.SUBSCRIPTION_PRICE_ID_YEARLY_3,
    },
    monthly: {
      1: parsed.data.SUBSCRIPTION_PRICE_ID_MONTHLY_1,
      2: parsed.data.SUBSCRIPTION_PRICE_ID_MONTHLY_2,
      3: parsed.data.SUBSCRIPTION_PRICE_ID_MONTHLY_3,
    },
  },
} as const;
