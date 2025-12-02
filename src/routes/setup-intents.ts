import { Router } from "express";
import { z } from "zod";
import { stripe } from "../lib/stripe";
import {
  buildClinicMetadata,
  ensureDefaultPaymentMethodSet,
  getOrCreateCustomer,
  retrievePaymentMethod,
} from "../services/stripeHelpers";
import type { ClinicAddress } from "../services/stripeHelpers";

const router = Router();

const clinicAddressSchema = z.object({
  line1: z.string().min(1),
  line2: z.string().optional(),
  city: z.string().min(1),
  state: z.string().optional(),
  postalCode: z.string().min(1),
  country: z.string().min(2).max(2),
});

const createSetupIntentSchema = z.object({
  email: z.string().email(),
  clinicName: z.string().min(1),
  clinicAddress: clinicAddressSchema,
  paymentMethodId: z.string().min(1),
  buyingGroupMember: z.boolean(),
  buyingGroupName: z.string().optional(),
  desiredStartDate: z.string().optional(),
});

router.post("/", async (req, res, next) => {
  try {
    const payload = createSetupIntentSchema.parse(req.body);

    const clinicMetadata = buildClinicMetadata(payload.clinicName, payload.clinicAddress as ClinicAddress, {
      buyingGroupMember: payload.buyingGroupMember,
      buyingGroupName: payload.buyingGroupName,
      desiredStartDate: payload.desiredStartDate,
    });

    const customer = await getOrCreateCustomer(payload.email, clinicMetadata, {
      name: payload.clinicName,
      address: {
        line1: payload.clinicAddress.line1,
        line2: payload.clinicAddress.line2 ?? undefined,
        city: payload.clinicAddress.city,
        state: payload.clinicAddress.state,
        postal_code: payload.clinicAddress.postalCode,
        country: payload.clinicAddress.country,
      },
    });

    const paymentMethod = await retrievePaymentMethod(payload.paymentMethodId);

    // Update customer with payment method to be used for future payments
    await ensureDefaultPaymentMethodSet(customer.id, paymentMethod);

    // Create Setup Intent for collecting payment method
    const setupIntent = await stripe.setupIntents.create({
      customer: customer.id,
      payment_method_types: ["card"],
      payment_method: payload.paymentMethodId,
      metadata: {
        email: payload.email,
        clinic_name: payload.clinicName,
      },
    });

    res.json({
      clientSecret: setupIntent.client_secret,
      customerId: customer.id,
    });
  } catch (error) {
    next(error as Error);
  }
});

export default router;
