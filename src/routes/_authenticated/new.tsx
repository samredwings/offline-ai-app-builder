import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { classifyAndGenerate } from "@/lib/generate.functions";
import { getSettings } from "@/lib/local-settings";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/new")({
  head: () => ({ meta: [{ title: "New app — App Forge" }] }),
  component: NewPage,
});

const EXAMPLES = [
  "A water-tracker app with daily goal, history, and reminders.",
  "A plant-care app: my plants, watering schedule, plant tips.",
  "A workout logger with exercises, today's session, and stats.",
  "A recipe box: my recipes, favorites, and a random picker.",
  "A pomodoro timer with task list and daily focus stats.",
];

function NewPage() {
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState("");
  const [hasKey, setHasKey] = useState<boolean | null>(null);

  useEffect(() => {
    getSettings().then((s) => setHasKey(!!s.ai.apiKey));
  }, []);

  const mut = useMutation({
    mutationFn: () => classifyAndGenerate({ data: { prompt } }),
    onSuccess: (res) => navigate({ to: "/editor/$id", params: { id: res.projectId } }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="text-3xl font-bold">Describe your app</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        One sentence is enough. You'll refine it with chat after.
      </p>

      {hasKey === false && (
        <div className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          No AI key set yet. <Link to="/settings" className="underline">Open Settings</Link> to add an OpenAI-compatible API key.
        </div>
      )}

      <Textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="e.g. A simple habit tracker with daily streaks and a list of habits."
        rows={5}
        className="mt-6"
      />

      <div className="mt-3 flex flex-wrap gap-2">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => setPrompt(ex)}
            className="rounded-full border px-3 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          >
            {ex.split(":")[0]}
          </button>
        ))}
      </div>

      <Button
        className="mt-6 w-full"
        size="lg"
        disabled={mut.isPending || prompt.trim().length < 5 || hasKey === false}
        onClick={() => mut.mutate()}
      >
        {mut.isPending ? "Building your app… (~30s)" : "Build it"}
      </Button>
    </div>
  );
}
