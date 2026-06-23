import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { getSettings, saveSettings, type LocalSettings } from "@/lib/local-settings";
import { clearPIN, hasPIN, setPIN } from "@/lib/local-auth";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Settings — App Forge" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const [s, setS] = useState<LocalSettings | null>(null);
  const [pinSet, setPinSet] = useState(false);
  const [newPin, setNewPin] = useState("");

  useEffect(() => {
    getSettings().then(setS);
    hasPIN().then(setPinSet);
  }, []);

  if (!s) return <div className="p-8 text-center text-sm">Loading…</div>;

  async function save(patch: Partial<LocalSettings>) {
    const next = await saveSettings(patch);
    setS(next);
    toast.success("Saved");
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 space-y-8">
      <div>
        <Link to="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">
          ← Dashboard
        </Link>
        <h1 className="mt-4 text-3xl font-bold">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          All settings are stored locally in your browser. No cloud sync.
        </p>
      </div>

      <section className="space-y-4 rounded-lg border p-5">
        <div>
          <h2 className="font-semibold">AI provider</h2>
          <p className="text-xs text-muted-foreground">
            Bring your own OpenAI-compatible key (OpenRouter, Together, OpenAI, Ollama, etc.).
          </p>
        </div>
        <div className="space-y-2">
          <Label>Base URL</Label>
          <Input
            defaultValue={s.ai.baseUrl}
            onBlur={(e) => save({ ai: { ...s.ai, baseUrl: e.target.value.trim() } })}
            placeholder="https://openrouter.ai/api/v1"
          />
        </div>
        <div className="space-y-2">
          <Label>API key</Label>
          <Input
            type="password"
            defaultValue={s.ai.apiKey}
            onBlur={(e) => save({ ai: { ...s.ai, apiKey: e.target.value.trim() } })}
            placeholder="sk-…"
          />
          <p className="text-[11px] text-muted-foreground">
            Stored only in this browser's IndexedDB. Never leaves your device except in the call to {s.ai.baseUrl || "your endpoint"}.
          </p>
        </div>
        <div className="space-y-2">
          <Label>Chat model</Label>
          <Input
            defaultValue={s.ai.model}
            onBlur={(e) => save({ ai: { ...s.ai, model: e.target.value.trim() } })}
            placeholder="meta-llama/llama-3.3-70b-instruct"
          />
        </div>
        <div className="space-y-2">
          <Label>Image model (optional)</Label>
          <Input
            defaultValue={s.ai.imageModel ?? ""}
            onBlur={(e) => save({ ai: { ...s.ai, imageModel: e.target.value.trim() } })}
            placeholder="black-forest-labs/flux-schnell"
          />
          <p className="text-[11px] text-muted-foreground">
            Leave blank to skip app-icon generation.
          </p>
        </div>
      </section>

      <section className="space-y-4 rounded-lg border p-5">
        <div>
          <h2 className="font-semibold">PIN lock</h2>
          <p className="text-xs text-muted-foreground">
            {pinSet ? "A PIN is set on this device." : "No PIN — the builder opens without unlock."}
          </p>
        </div>
        <div className="flex gap-2">
          <Input
            placeholder="New PIN (4–8 digits)"
            inputMode="numeric"
            value={newPin}
            onChange={(e) => setNewPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
          />
          <Button
            onClick={async () => {
              try {
                await setPIN(newPin);
                setNewPin("");
                setPinSet(true);
                toast.success("PIN updated");
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Failed");
              }
            }}
            disabled={newPin.length < 4}
          >
            {pinSet ? "Change PIN" : "Set PIN"}
          </Button>
        </div>
        {pinSet && (
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              if (!confirm("Remove the PIN? Anyone with this browser will be able to access your apps.")) return;
              await clearPIN();
              setPinSet(false);
              toast.success("PIN removed");
            }}
            className="text-destructive hover:text-destructive"
          >
            Remove PIN
          </Button>
        )}
      </section>
    </div>
  );
}
