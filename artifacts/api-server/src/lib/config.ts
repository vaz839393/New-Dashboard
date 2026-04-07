import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "..", "data");
const CONFIG_PATH = join(DATA_DIR, "config.json");

// Tokens live in DISCORD_TOKEN / DISCORD_TOKEN_2 env vars (Replit Secrets / Render env vars).
// They are never written to disk. Runtime overrides last only for the current process.
let runtimeToken1: string | null = null;
let runtimeToken2: string | null = null;

export function getDiscordToken(): string {
  return runtimeToken1 ?? process.env["DISCORD_TOKEN"] ?? "";
}
export function setRuntimeToken(token: string): void {
  runtimeToken1 = token.trim() || null;
}

export function getDiscordToken2(): string {
  return runtimeToken2 ?? process.env["DISCORD_TOKEN_2"] ?? "";
}
export function setRuntimeToken2(token: string): void {
  runtimeToken2 = token.trim() || null;
}

export interface Config {
  autoReact: { enabled: boolean; emoji: string };
  autoReact2: { enabled: boolean; emoji: string };
  clipboardMessenger: { enabled: boolean; channelId: string };
  clipboardMessenger2: { enabled: boolean; channelId: string };
}

const DEFAULT_CONFIG: Config = {
  autoReact: { enabled: false, emoji: "👍" },
  autoReact2: { enabled: false, emoji: "👍" },
  clipboardMessenger: { enabled: false, channelId: "" },
  clipboardMessenger2: { enabled: false, channelId: "" },
};

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

export function loadConfig(): Config {
  ensureDataDir();
  if (!existsSync(CONFIG_PATH)) {
    writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2));
    return { ...DEFAULT_CONFIG };
  }
  try {
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    const p = JSON.parse(raw) as Partial<Config>;
    return {
      autoReact: {
        enabled: p.autoReact?.enabled ?? DEFAULT_CONFIG.autoReact.enabled,
        emoji: p.autoReact?.emoji ?? DEFAULT_CONFIG.autoReact.emoji,
      },
      autoReact2: {
        enabled: p.autoReact2?.enabled ?? DEFAULT_CONFIG.autoReact2.enabled,
        emoji: p.autoReact2?.emoji ?? DEFAULT_CONFIG.autoReact2.emoji,
      },
      clipboardMessenger: {
        enabled: p.clipboardMessenger?.enabled ?? DEFAULT_CONFIG.clipboardMessenger.enabled,
        channelId: p.clipboardMessenger?.channelId ?? DEFAULT_CONFIG.clipboardMessenger.channelId,
      },
      clipboardMessenger2: {
        enabled: p.clipboardMessenger2?.enabled ?? DEFAULT_CONFIG.clipboardMessenger2.enabled,
        channelId: p.clipboardMessenger2?.channelId ?? DEFAULT_CONFIG.clipboardMessenger2.channelId,
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
    autoReact2: { ...current.autoReact2, ...(partial.autoReact2 ?? {}) },
    clipboardMessenger: { ...current.clipboardMessenger, ...(partial.clipboardMessenger ?? {}) },
    clipboardMessenger2: { ...current.clipboardMessenger2, ...(partial.clipboardMessenger2 ?? {}) },
  };
  saveConfig(updated);
  return updated;
}
