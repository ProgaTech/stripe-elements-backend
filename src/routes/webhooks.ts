import express, { Router } from "express";
import Stripe from "stripe";
import { stripe } from "../lib/stripe";
import { env } from "../config";

const router = Router();

router.post("/stripe", express.raw({ type: "application/json" }), (req, res: express.Response) => {
  const signature = req.headers["stripe-signature"];
  if (!signature || !env.stripeWebhookSecret) {
    return res.status(400).send("Missing Stripe signature or webhook secret.");
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.body, signature, env.stripeWebhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(400).send(`Webhook signature verification failed: ${message}`);
  }

  switch (event.type) {
    case "invoice.payment_succeeded":
    case "invoice.payment_failed":
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      // TODO: Handle payment success/failure and subscription created/updated/deleted events accordingly to your needs
      console.log(`Stripe event received: ${event.type}`, event.id);
      break;
    default:
      console.log(`Unhandled Stripe event type: ${event.type}`);
  }

  res.json({ received: true });
});

export default router;
