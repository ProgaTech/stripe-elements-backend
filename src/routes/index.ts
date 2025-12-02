import { Router } from "express";
import paymentsRouter from "./payments";
import subscriptionsRouter from "./subscriptions";
import setupIntentsRouter from "./setup-intents";
import customerPortalRouter from "./customer-portal";

const router = Router();

router.use("/payments", paymentsRouter);
router.use("/subscriptions", subscriptionsRouter);
router.use("/setup-intents", setupIntentsRouter);
router.use("/customer-portal", customerPortalRouter);

export default router;
