import app from "./app";
import { env } from "./config";

const port = env.port;

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Backend listening on port ${port}`);
});

