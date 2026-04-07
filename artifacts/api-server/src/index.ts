import app from "./app";
import { logger } from "./lib/logger";
import { bot1, bot2 } from "./lib/bot";

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

  // Start both accounts in parallel
  await Promise.all([
    bot1.startBot(),
    bot2.startBot(),
  ]);
});
