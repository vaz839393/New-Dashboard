import { Router, type IRouter } from "express";
import {
  getBotStatus,
  restartBot,
  sendMessage,
  startAutoSend,
  stopAutoSend,
  getAutoSendStatus,
  updateAutoSendInterval,
} from "../lib/bot.js";
import { loadConfig, updateConfig, setRuntimeToken, getDiscordToken } from "../lib/config.js";

const router: IRouter = Router();

router.get("/status", (_req, res) => {
  const bot = getBotStatus();
  const config = loadConfig();
  const autoSend = getAutoSendStatus();
  res.json({
    bot,
    autoSend,
    config: {
      autoReact: config.autoReact,
      clipboardMessenger: config.clipboardMessenger,
      hasToken: !!getDiscordToken(),
    },
  });
});

router.post("/auto-react", (req, res) => {
  const { enabled, emoji } = req.body as { enabled?: boolean; emoji?: string };
  const updated = updateConfig({
    autoReact: {
      enabled: enabled ?? loadConfig().autoReact.enabled,
      emoji: emoji ?? loadConfig().autoReact.emoji,
    },
  });
  res.json({ success: true, autoReact: updated.autoReact });
});

router.post("/clipboard-messenger", (req, res) => {
  const { enabled, channelId } = req.body as { enabled?: boolean; channelId?: string };
  const current = loadConfig();
  const updated = updateConfig({
    clipboardMessenger: {
      enabled: enabled ?? current.clipboardMessenger.enabled,
      channelId: channelId ?? current.clipboardMessenger.channelId,
    },
  });
  res.json({ success: true, clipboardMessenger: updated.clipboardMessenger });
});

router.post("/send-message", async (req, res) => {
  const config = loadConfig();
  const { message, channelId } = req.body as { message?: string; channelId?: string };
  const targetChannel = channelId || config.clipboardMessenger.channelId;
  if (!message || !targetChannel) {
    res.status(400).json({ success: false, error: "Missing message or channelId" });
    return;
  }
  const result = await sendMessage(targetChannel, message);
  if (result.success) {
    res.json({ success: true });
  } else {
    res.status(500).json({ success: false, error: result.error });
  }
});

router.post("/auto-send/start", (req, res) => {
  const { message, channelId, intervalMs } = req.body as {
    message?: string;
    channelId?: string;
    intervalMs?: number;
  };
  if (!message || !channelId) {
    res.status(400).json({ success: false, error: "Missing message or channelId" });
    return;
  }
  const result = startAutoSend(message, channelId, intervalMs ?? 300);
  if (result.success) {
    res.json({ success: true, autoSend: getAutoSendStatus() });
  } else {
    res.status(400).json({ success: false, error: result.error });
  }
});

router.post("/auto-send/stop", (_req, res) => {
  stopAutoSend();
  res.json({ success: true, autoSend: getAutoSendStatus() });
});

router.post("/auto-send/interval", (req, res) => {
  const { intervalMs } = req.body as { intervalMs?: number };
  if (typeof intervalMs !== "number") {
    res.status(400).json({ success: false, error: "intervalMs must be a number" });
    return;
  }
  updateAutoSendInterval(intervalMs);
  res.json({ success: true, autoSend: getAutoSendStatus() });
});

// Fire-and-forget: update in-memory token and kick off reconnect immediately.
// The token is NEVER written to disk — set DISCORD_TOKEN in your environment
// (Replit Secret / Render env var) for persistence across restarts.
router.post("/change-token", (req, res) => {
  const { token } = req.body as { token?: string };
  if (!token || token.trim() === "") {
    res.status(400).json({ success: false, error: "Token cannot be empty" });
    return;
  }
  const trimmed = token.trim();
  setRuntimeToken(trimmed);

  // Start bot in background — do NOT await
  restartBot(trimmed).catch((e) => {
    console.error("Background restartBot error:", e);
  });

  res.json({ success: true, message: "Token updated. Reconnecting in background…" });
});

// Fire-and-forget restart
router.post("/restart-bot", (_req, res) => {
  if (!getDiscordToken()) {
    res.status(400).json({ success: false, error: "No token configured — set DISCORD_TOKEN secret first" });
    return;
  }

  restartBot().catch((e) => {
    console.error("Background restartBot error:", e);
  });

  res.json({ success: true, message: "Bot restart initiated…" });
});

export default router;
