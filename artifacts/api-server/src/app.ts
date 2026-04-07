import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import router from "./routes";
import { logger } from "./lib/logger";

const __dirname = dirname(fileURLToPath(import.meta.url));

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const publicDir = join(__dirname, "..", "public");
app.use(express.static(publicDir));

app.use("/api", router);

app.get("/", (_req, res) => {
  res.sendFile(join(publicDir, "index.html"));
});

export default app;
