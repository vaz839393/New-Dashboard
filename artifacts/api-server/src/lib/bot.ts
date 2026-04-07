import { Client } from "discord.js-selfbot-v13";
import https from "https";
import { loadConfig, getDiscordToken, getDiscordToken2 } from "./config.js";
import { logger } from "./logger.js";

const FALLBACK_BUILD_NUMBER = 523061;
const BUILD_NUMBER_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

// Shared build-number cache across both instances
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
  if (buildNumberFetching) return cachedBuildNumber ?? FALLBACK_BUILD_NUMBER;
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

// Invalidate build number cache every 6 hours so next reconnect picks up a fresh one
setInterval(() => { buildNumberFetchedAt = 0; }, BUILD_NUMBER_TTL_MS);

// ---------------------------------------------------------------------------
// Bot instance factory — creates a fully independent bot instance
// ---------------------------------------------------------------------------
export function createBotInstance(label: string, tokenGetter: () => string) {
  let client: Client | null = null;
  let botStatus: "online" | "offline" | "connecting" | "error" = "offline";
  let botError: string | null = null;
  let botUsername: string | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // Auto-send state
  let autoSendTimer: ReturnType<typeof setTimeout> | null = null;
  let autoSendActive = false;
  let autoSendCount = 0;
  let autoSendMessage = "";
  let autoSendChannelId = "";
  let autoSendIntervalMs = 300;

  function getAutoSendStatus() {
    return { active: autoSendActive, count: autoSendCount, message: autoSendMessage, channelId: autoSendChannelId, intervalMs: autoSendIntervalMs };
  }

  function stopAutoSend(silent = false): void {
    if (autoSendTimer) { clearTimeout(autoSendTimer); autoSendTimer = null; }
    autoSendActive = false;
    if (!silent) logger.info({ label, count: autoSendCount }, "Auto-send stopped");
  }

  function updateAutoSendInterval(ms: number): void {
    autoSendIntervalMs = Math.max(50, Math.min(5000, ms));
  }

  async function sendMessage(channelId: string, content: string): Promise<{ success: boolean; error?: string }> {
    if (!client || botStatus !== "online") return { success: false, error: "Bot is not online" };
    try {
      // Use cache first — avoids a REST round-trip on every send (this is the speed fix)
      let channel = client.channels.cache.get(channelId) as any;
      if (!channel) {
        channel = await client.channels.fetch(channelId);
      }
      if (!channel || !channel.isText()) return { success: false, error: "Channel not found or is not a text channel" };
      await channel.send(content);
      return { success: true };
    } catch (e: any) {
      logger.warn({ label, err: e }, "Failed to send message");
      return { success: false, error: e?.message ?? "Failed to send message" };
    }
  }

  function startAutoSend(message: string, channelId: string, intervalMs: number): { success: boolean; error?: string } {
    if (botStatus !== "online") return { success: false, error: "Bot is not online" };
    if (!message) return { success: false, error: "Message cannot be empty" };
    if (!channelId) return { success: false, error: "Channel ID cannot be empty" };

    stopAutoSend(true);
    autoSendActive = true;
    autoSendCount = 0;
    autoSendMessage = message;
    autoSendChannelId = channelId;
    autoSendIntervalMs = Math.max(50, Math.min(5000, intervalMs));
    logger.info({ label, channelId, intervalMs: autoSendIntervalMs }, "Auto-send started");

    // Pre-warm the channel cache so first send is immediate
    if (client) {
      client.channels.fetch(channelId).catch(() => {});
    }

    const tick = async () => {
      if (!autoSendActive) return;
      const started = Date.now();
      const result = await sendMessage(autoSendChannelId, autoSendMessage);
      if (result.success) {
        autoSendCount++;
      } else {
        logger.warn({ label, error: result.error }, "Auto-send failed, stopping");
        stopAutoSend(true);
        return;
      }
      if (autoSendActive) {
        // Subtract time already spent so the interval is wall-clock accurate
        const elapsed = Date.now() - started;
        const delay = Math.max(0, autoSendIntervalMs - elapsed);
        autoSendTimer = setTimeout(tick, delay);
      }
    };

    autoSendTimer = setTimeout(tick, 0);
    return { success: true };
  }

  function scheduleReconnect(delayMs = 30_000) {
    if (reconnectTimer) return;
    logger.info({ label, delayMs }, "Scheduling reconnect");
    reconnectTimer = setTimeout(async () => {
      reconnectTimer = null;
      if (tokenGetter()) {
        logger.info({ label }, "Attempting auto-reconnect");
        await startBot();
      }
    }, delayMs);
  }

  async function startBot(token?: string): Promise<void> {
    const useToken = token ?? tokenGetter();
    if (!useToken) {
      botStatus = "error";
      botError = "No Discord token configured";
      logger.warn({ label }, "No Discord token configured, bot will not start");
      return;
    }

    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }

    if (client) {
      logger.info({ label }, "Destroying existing bot client before restart");
      stopAutoSend(true);
      try { client.removeAllListeners(); await client.destroy(); } catch (e) { logger.warn({ label, err: e }, "Error destroying client"); }
      client = null;
    }

    botStatus = "connecting";
    botError = null;
    botUsername = null;

    const buildNumber = await fetchDiscordBuildNumber();

    client = new Client({ checkUpdate: false, ws: { properties: { client_build_number: buildNumber } } } as any);

    client.on("ready", () => {
      const tag = client?.user?.tag ?? "unknown";
      botUsername = tag;
      botStatus = "online";
      botError = null;
      logger.info({ label, tag }, "Selfbot connected");
    });

    client.on("messageCreate", async (message) => {
      const cfg = loadConfig();
      const ar = label === "account2" ? cfg.autoReact2 : cfg.autoReact;
      if (!ar.enabled) return;
      if (message.author.id !== client?.user?.id) return;
      try { await message.react(ar.emoji); } catch (e) { logger.warn({ label, err: e }, "Failed to auto-react"); }
    });

    client.on("error", (err) => {
      botStatus = "error";
      botError = err.message;
      logger.error({ label, err }, "Discord client error");
      scheduleReconnect(60_000);
    });

    client.on("disconnect" as any, () => {
      botStatus = "offline";
      stopAutoSend(true);
      logger.info({ label }, "Discord client disconnected");
      scheduleReconnect(30_000);
    });

    try {
      await client.login(useToken);
    } catch (e: any) {
      botStatus = "error";
      botError = e?.message ?? "Login failed";
      logger.error({ label, err: e }, "Failed to login to Discord");
      client = null;
      if (!botError.toLowerCase().includes("invalid token") && !botError.toLowerCase().includes("token")) {
        scheduleReconnect(60_000);
      }
    }
  }

  async function restartBot(newToken?: string): Promise<void> {
    await startBot(newToken);
  }

  function getBotStatus() {
    return { status: botStatus, error: botError, username: botUsername };
  }

  function getClient() { return client; }

  return { getBotStatus, startBot, restartBot, sendMessage, startAutoSend, stopAutoSend, getAutoSendStatus, updateAutoSendInterval, getClient };
}

// Two independent bot instances
export const bot1 = createBotInstance("account1", getDiscordToken);
export const bot2 = createBotInstance("account2", getDiscordToken2);

// Backward-compat named exports (used by existing index.ts → startBot)
export const { getBotStatus, startBot, restartBot, sendMessage, startAutoSend, stopAutoSend, getAutoSendStatus, updateAutoSendInterval, getClient } = bot1;
