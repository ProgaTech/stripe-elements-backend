import { CREDIT_CARD_FEE_PERCENT, SHIPPING_COST_CENTS, ONE_TIME_BASE_AMOUNT_CENTS } from "../config";

export interface AmountBreakdown {
  baseAmount: number;
  discountAmount: number;
  subtotalAfterDiscount: number;
  shippingAmount: number;
  creditCardFeeAmount: number;
  totalAmount: number;
}

export const percentageToAmount = (amountCents: number, percent: number): number => {
  return Math.round((amountCents * percent) / 100);
};

export const computeOneTimeBreakdown = (options: {
  couponPercent?: number;
  couponAmountOff?: number;
  appliesCreditCardFee: boolean;
  shippingAmount?: number;
  baseAmount?: number;
}): AmountBreakdown => {
  const baseAmount = options.baseAmount ?? ONE_TIME_BASE_AMOUNT_CENTS;
  const shippingAmount = options.shippingAmount ?? SHIPPING_COST_CENTS;

  let discountFromPercent = 0;
  if (options.couponPercent) {
    discountFromPercent = percentageToAmount(baseAmount, options.couponPercent);
  }

  const discountAmount =
    options.couponAmountOff !== undefined
      ? Math.min(options.couponAmountOff, baseAmount)
      : discountFromPercent;

  const subtotalAfterDiscount = Math.max(baseAmount - discountAmount, 0);

  const feeBase = subtotalAfterDiscount;
  const creditCardFeeAmount = options.appliesCreditCardFee
    ? percentageToAmount(feeBase, CREDIT_CARD_FEE_PERCENT)
    : 0;

  const totalAmount = subtotalAfterDiscount + shippingAmount + creditCardFeeAmount;

  return {
    baseAmount,
    discountAmount,
    subtotalAfterDiscount,
    shippingAmount,
    creditCardFeeAmount,
    totalAmount
  };
};

