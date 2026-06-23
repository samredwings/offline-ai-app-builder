// Backward-compat shim. Old call sites imported getStableSession() from here.
// In local mode we don't have a remote session — we just return whether the local gate is open.
import { canEnter } from "./local-auth";

export async function getStableSession() {
  return (await canEnter()) ? { ok: true } : null;
}
