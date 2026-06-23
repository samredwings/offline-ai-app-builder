// Local PIN gate. PIN is hashed with SHA-256 + per-device salt and stored in IndexedDB.
// This is *not* real security — the data lives in the browser. It only gates casual access.
import { getSettings, saveSettings } from "./local-settings";

const SESSION_KEY = "lf:unlocked";

async function sha256(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function randomSalt(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function hasPIN(): Promise<boolean> {
  const s = await getSettings();
  return !!s.pinHash;
}

export async function setPIN(pin: string) {
  if (!/^\d{4,8}$/.test(pin)) throw new Error("PIN must be 4–8 digits");
  const salt = randomSalt();
  const hash = await sha256(salt + ":" + pin);
  await saveSettings({ pinHash: hash, pinSalt: salt });
  unlock();
}

export async function clearPIN() {
  await saveSettings({ pinHash: null, pinSalt: null });
  lock();
}

export async function verifyPIN(pin: string): Promise<boolean> {
  const s = await getSettings();
  if (!s.pinHash || !s.pinSalt) return true; // no PIN = always unlocked
  const hash = await sha256(s.pinSalt + ":" + pin);
  return hash === s.pinHash;
}

export function isUnlocked(): boolean {
  if (typeof window === "undefined") return false;
  return sessionStorage.getItem(SESSION_KEY) === "1";
}
export function unlock() {
  if (typeof window !== "undefined") sessionStorage.setItem(SESSION_KEY, "1");
}
export function lock() {
  if (typeof window !== "undefined") sessionStorage.removeItem(SESSION_KEY);
}

// Returns true if the user can pass the gate right now (no PIN set, or already unlocked).
export async function canEnter(): Promise<boolean> {
  if (isUnlocked()) return true;
  return !(await hasPIN());
}
