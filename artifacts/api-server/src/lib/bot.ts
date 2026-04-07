import { Client } from "discord.js-selfbot-v13";
import https from "https";
import { loadConfig, getDiscordToken } from "./config.js";
import { logger } from "./logger.js";

const FALLBACK_BUILD_NUMBER = 523061;
const BUILD_NUMBER_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

let cachedBuildNumber: number | null = null;
let buildNumberFetchedAt = 0;
let buildNumberFetching = false;

async function httpsGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.get(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
          "Accept-Encoding": "identity",
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (d: Buffer) => chunks.push(d));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      }
    );
    req.setTimeout(8_000, () => {
      req.destroy();
      reject(new Error("Request timed out"));
    });
    req.on("error", reject);
  });
}

async function fetchDiscordBuildNumber(): Promise<number> {
  const now = Date.now();
  if (cachedBuildNumber && now - buildNumberFetchedAt < BUILD_NUMBER_TTL_MS) {
    return cachedBuildNumber;
  }
  if (buildNumberFetching) {
    return cachedBuildNumber ?? FALLBACK_BUILD_NUMBER;
  }
  buildNumberFetching = true;
  try {
    const html = await httpsGet("https://discord.com/login");
    const srcMatch = html.match(/src="(\/assets\/[^"]+\.js)"/g);
    if (!srcMatch || srcMatch.length === 0) throw new Error("No JS assets found");

    const jsFiles = srcMatch.map((m) => m.replace(/src="|"/g, ""));
    for (const file of jsFiles.slice(0, 10)) {
      try {
        const js = await httpsGet(`https://discord.com${file}`);
        const m = js.match(/buildNumber[^0-9]*([0-9]{5,7})/);
        if (m) {
          const num = parseInt(m[1], 10);
          cachedBuildNumber = num;
          buildNumberFetchedAt = Date.now();
          logger.info({ buildNumber: num, file }, "Fetched Discord build number");
          buildNumberFetching = false;
          return num;
        }
      } catch {
        continue;
      }
    }
    throw new Error("build number not found in any JS file");
  } catch (e: any) {
    logger.warn(
      { err: e?.message, fallback: cachedBuildNumber ?? FALLBACK_BUILD_NUMBER },
      "Could not fetch Discord build number, using fallback"
    );
    buildNumberFetching = false;
    return cachedBuildNumber ?? FALLBACK_BUILD_NUMBER;
  }
}

let client: Client | null = null;
let botStatus: "online" | "offline" | "connecting" | "error" = "offline";
let botError: string | null = null;
let botUsername: string | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

// --- Auto-send state (server-side loop) ---
let autoSendTimer: ReturnType<typeof setTimeout> | null = null;
let autoSendActive = false;
let autoSendCount = 0;
let autoSendMessage = "";
let autoSendChannelId = "";
let autoSendIntervalMs = 300;

export function getAutoSendStatus() {
  return {
    active: autoSendActive,
    count: autoSendCount,
    message: autoSendMessage,
    channelId: autoSendChannelId,
    intervalMs: autoSendIntervalMs,
  };
}

export function startAutoSend(
  message: string,
  channelId: string,
  intervalMs: number
): { success: boolean; error?: string } {
  if (botStatus !== "online") return { success: false, error: "Bot is not online" };
  if (!message) return { success: false, error: "Message cannot be empty" };
  if (!channelId) return { success: false, error: "Channel ID cannot be empty" };

  stopAutoSend(true);

  autoSendActive = true;
  autoSendCount = 0;
  autoSendMessage = message;
  autoSendChannelId = channelId;
  autoSendIntervalMs = Math.max(300, Math.min(2000, intervalMs));

  logger.info({ channelId, intervalMs: autoSendIntervalMs }, "Auto-send started");

  const tick = async () => {
    if (!autoSendActive) return;
    const result = await sendMessage(autoSendChannelId, autoSendMessage);
    if (result.success) {
      autoSendCount++;
    } else {
      logger.warn({ error: result.error }, "Auto-send failed, stopping");
      stopAutoSend(true);
      return;
    }
    if (autoSendActive) {
      autoSendTimer = setTimeout(tick, autoSendIntervalMs);
    }
  };

  autoSendTimer = setTimeout(tick, 0);
  return { success: true };
}

export function stopAutoSend(silent = false): void {
  if (autoSendTimer) {
    clearTimeout(autoSendTimer);
    autoSendTimer = null;
  }
  autoSendActive = false;
  if (!silent) {
    logger.info({ count: autoSendCount }, "Auto-send stopped");
  }
}

export function updateAutoSendInterval(intervalMs: number): void {
  autoSendIntervalMs = Math.max(300, Math.min(2000, intervalMs));
}

// --- Bot lifecycle ---

export function getBotStatus() {
  return {
    status: botStatus,
    error: botError,
    username: botUsername,
  };
}

function scheduleReconnect(delayMs = 30_000) {
  if (reconnectTimer) return;
  logger.info({ delayMs }, "Scheduling reconnect");
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    if (getDiscordToken()) {
      logger.info("Attempting auto-reconnect");
      await startBot();
    }
  }, delayMs);
}

export async function startBot(token?: string): Promise<void> {
  const useToken = token ?? getDiscordToken();

  if (!useToken) {
    botStatus = "error";
    botError = "No Discord token configured";
    logger.warn("No Discord token configured, bot will not start");
    return;
  }

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (client) {
    logger.info("Destroying existing bot client before restart");
    stopAutoSend(true);
    try {
      client.removeAllListeners();
      await client.destroy();
    } catch (e) {
      logger.warn({ err: e }, "Error destroying client");
    }
    client = null;
  }

  botStatus = "connecting";
  botError = null;
  botUsername = null;

  const buildNumber = await fetchDiscordBuildNumber();

  client = new Client({
    checkUpdate: false,
    ws: {
      properties: {
        client_build_number: buildNumber,
      },
    },
  } as any);

  client.on("ready", () => {
    const tag = client?.user?.tag ?? "unknown";
    botUsername = tag;
    botStatus = "online";
    botError = null;
    logger.info({ tag }, "Selfbot connected");
  });

  client.on("messageCreate", async (message) => {
    const cfg = loadConfig();
    if (!cfg.autoReact.enabled) return;
    if (message.author.id !== client?.user?.id) return;
    try {
      await message.react(cfg.autoReact.emoji);
    } catch (e) {
      logger.warn({ err: e }, "Failed to auto-react to message");
    }
  });

  client.on("error", (err) => {
    botStatus = "error";
    botError = err.message;
    logger.error({ err }, "Discord client error");
    scheduleReconnect(60_000);
  });

  client.on("disconnect" as any, () => {
    botStatus = "offline";
    stopAutoSend(true);
    logger.info("Discord client disconnected");
    scheduleReconnect(30_000);
  });

  try {
    await client.login(useToken);
  } catch (e: any) {
    botStatus = "error";
    botError = e?.message ?? "Login failed";
    logger.error({ err: e }, "Failed to login to Discord");
    client = null;
    // Only auto-reconnect for non-auth errors
    if (!botError.toLowerCase().includes("invalid token") && !botError.toLowerCase().includes("token")) {
      scheduleReconnect(60_000);
    }
  }
}

// Periodic build number refresh — invalidates the cache so the next startBot picks it up
setInterval(
  () => {
    buildNumberFetchedAt = 0;
    logger.info("Build number cache invalidated for next reconnect");
  },
  BUILD_NUMBER_TTL_MS
);

export async function restartBot(newToken?: string): Promise<void> {
  await startBot(newToken);
}

export async function sendMessage(
  channelId: string,
  content: string
): Promise<{ success: boolean; error?: string }> {
  if (!client || botStatus !== "online") {
    return { success: false, error: "Bot is not online" };
  }
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isText()) {
      return { success: false, error: "Channel not found or is not a text channel" };
    }
    await (channel as any).send(content);
    return { success: true };
  } catch (e: any) {
    logger.warn({ err: e }, "Failed to send message");
    return { success: false, error: e?.message ?? "Failed to send message" };
  }
}

export function getClient() {
  return client;
}
