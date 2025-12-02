import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import apiRouter from "./routes";
import webhookRouter from "./routes/webhooks";
import { env } from "./config";

const app = express();

app.use(
  cors({
    origin: env.frontendUrl,
    credentials: true
  })
);
app.use(helmet());
app.use(morgan("dev"));

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/webhooks", webhookRouter);
app.use(express.json());
app.use("/api", apiRouter);

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  // eslint-disable-next-line no-console
  console.error(err);
  res.status(500).json({
    error: err.message ?? "Internal server error"
  });
});

export default app;

