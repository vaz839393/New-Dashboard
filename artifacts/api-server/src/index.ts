import app from "./app";
import { logger } from "./lib/logger";
import { startBot } from "./lib/bot";

// Default to 10000 for Render deployments; Replit injects its own PORT at runtime.
const port = Number(process.env["PORT"] ?? 10000);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${process.env["PORT"]}"`);
}

app.listen(port, async (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening — dashboard at http://localhost:" + port);
  await startBot();
});
