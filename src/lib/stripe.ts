import Stripe from "stripe";
import { env } from "../config";

export const stripe = new Stripe(env.stripeSecretKey, {
  apiVersion: "2024-06-20",
  typescript: true
});

