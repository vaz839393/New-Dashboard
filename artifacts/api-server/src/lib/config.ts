import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "..", "data");
const CONFIG_PATH = join(DATA_DIR, "config.json");

// The token is NEVER written to disk — it lives only in the DISCORD_TOKEN
// environment variable (Replit Secret / Render env var) or in an in-memory
// override set at runtime via the dashboard "Change Token" endpoint.
let runtimeTokenOverride: string | null = null;

export function getDiscordToken(): string {
  return runtimeTokenOverride ?? process.env["DISCORD_TOKEN"] ?? "";
}

export function setRuntimeToken(token: string): void {
  runtimeTokenOverride = token.trim() || null;
}

export interface Config {
  autoReact: {
    enabled: boolean;
    emoji: string;
  };
  clipboardMessenger: {
    enabled: boolean;
    channelId: string;
  };
}

const DEFAULT_CONFIG: Config = {
  autoReact: {
    enabled: false,
    emoji: "👍",
  },
  clipboardMessenger: {
    enabled: false,
    channelId: "",
  },
};

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function loadConfig(): Config {
  ensureDataDir();
  if (!existsSync(CONFIG_PATH)) {
    writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2));
    return { ...DEFAULT_CONFIG };
  }
  try {
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw) as Partial<Config>;
    return {
      autoReact: {
        enabled: parsed.autoReact?.enabled ?? DEFAULT_CONFIG.autoReact.enabled,
        emoji: parsed.autoReact?.emoji ?? DEFAULT_CONFIG.autoReact.emoji,
      },
      clipboardMessenger: {
        enabled:
          parsed.clipboardMessenger?.enabled ??
          DEFAULT_CONFIG.clipboardMessenger.enabled,
        channelId:
          parsed.clipboardMessenger?.channelId ??
          DEFAULT_CONFIG.clipboardMessenger.channelId,
      },
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(config: Config): void {
  ensureDataDir();
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

export function updateConfig(partial: Partial<Config>): Config {
  const current = loadConfig();
  const updated: Config = {
    autoReact: { ...current.autoReact, ...(partial.autoReact ?? {}) },
    clipboardMessenger: {
      ...current.clipboardMessenger,
      ...(partial.clipboardMessenger ?? {}),
    },
  };
  saveConfig(updated);
  return updated;
}
