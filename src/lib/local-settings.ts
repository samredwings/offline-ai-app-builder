// User preferences stored locally: PIN hash + AI provider config.
import { get, set } from "idb-keyval";

export type AISettings = {
  baseUrl: string; // OpenAI-compatible base URL, e.g. https://openrouter.ai/api/v1
  apiKey: string;
  model: string; // chat model
  imageModel?: string; // optional image model
};

export type LocalSettings = {
  pinHash: string | null; // null = no PIN set, app open access
  pinSalt: string | null;
  ai: AISettings;
};

const KEY = "lf:settings";

const DEFAULT_AI: AISettings = {
  baseUrl: "https://openrouter.ai/api/v1",
  apiKey: "",
  model: "meta-llama/llama-3.3-70b-instruct",
  imageModel: "",
};

export async function getSettings(): Promise<LocalSettings> {
  const raw = (await get(KEY)) as Partial<LocalSettings> | undefined;
  return {
    pinHash: raw?.pinHash ?? null,
    pinSalt: raw?.pinSalt ?? null,
    ai: { ...DEFAULT_AI, ...(raw?.ai ?? {}) },
  };
}

export async function saveSettings(patch: Partial<LocalSettings>) {
  const cur = await getSettings();
  const next: LocalSettings = {
    pinHash: patch.pinHash !== undefined ? patch.pinHash : cur.pinHash,
    pinSalt: patch.pinSalt !== undefined ? patch.pinSalt : cur.pinSalt,
    ai: { ...cur.ai, ...(patch.ai ?? {}) },
  };
  await set(KEY, next);
  return next;
}
