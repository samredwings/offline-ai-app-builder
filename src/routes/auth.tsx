import { createFileRoute, Link, useNavigate, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { canEnter, hasPIN, setPIN, unlock, verifyPIN } from "@/lib/local-auth";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Unlock — App Forge" },
      { name: "description", content: "Local PIN to access your builder." },
    ],
  }),
  beforeLoad: async () => {
    if (await canEnter()) throw redirect({ to: "/dashboard" });
  },
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [mode, setMode] = useState<"set" | "enter">("enter");

  useEffect(() => {
    hasPIN().then((has) => setMode(has ? "enter" : "set"));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "set") {
        if (pin !== confirm) throw new Error("PINs do not match");
        await setPIN(pin);
        toast.success("PIN set. You're in.");
      } else {
        const ok = await verifyPIN(pin);
        if (!ok) throw new Error("Wrong PIN");
        unlock();
      }
      navigate({ to: "/dashboard" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function skip() {
    // No PIN — open access.
    unlock();
    navigate({ to: "/dashboard" });
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
          ← Back
        </Link>
        <h1 className="mt-6 text-3xl font-bold">
          {mode === "set" ? "Set a local PIN" : "Enter your PIN"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {mode === "set"
            ? "All data stays on this device. A PIN gates casual access — it's not bank-grade security."
            : "Unlock your local workspace."}
        </p>

        <form onSubmit={submit} className="mt-8 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="pin">PIN (4–8 digits)</Label>
            <Input
              id="pin"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              required
              minLength={4}
              maxLength={8}
              pattern="\d{4,8}"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              autoFocus
            />
          </div>
          {mode === "set" && (
            <div className="space-y-2">
              <Label htmlFor="confirm">Confirm PIN</Label>
              <Input
                id="confirm"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                required
                minLength={4}
                maxLength={8}
                pattern="\d{4,8}"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value.replace(/\D/g, ""))}
              />
            </div>
          )}
          <Button type="submit" disabled={busy} className="w-full">
            {mode === "set" ? "Set PIN & continue" : "Unlock"}
          </Button>
        </form>

        {mode === "set" && (
          <button
            type="button"
            onClick={skip}
            className="mt-4 w-full text-center text-sm text-muted-foreground hover:text-foreground"
          >
            Skip — no PIN
          </button>
        )}
      </div>
    </div>
  );
}
