import { Router } from "express";
import { z } from "zod";
import { stripe } from "../lib/stripe";
import { findCustomerByEmail } from "../services/stripeHelpers";

const router = Router();

const customerPortalSchema = z.object({
  email: z.string().email(),
  returnUrl: z.string().url().optional(),
});

router.post("/", async (req, res, next) => {
  try {
    const payload = customerPortalSchema.parse(req.body);

    const customer = await findCustomerByEmail(payload.email);

    // Create a billing portal session
    const session = await stripe.billingPortal.sessions.create({
      customer: customer.id,
      return_url: payload.returnUrl || req.headers.referer || undefined,
    });

    res.json({
      url: session.url,
    });
  } catch (error) {
    next(error);
  }
});

export default router;


