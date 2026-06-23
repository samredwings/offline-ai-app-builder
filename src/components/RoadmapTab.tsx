import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import {
  getRoadmap,
  updateRequirement,
  addRequirement,
  deleteRequirement,
  runStaticTests,
} from "@/lib/roadmap.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";

type Req = {
  id: string;
  text: string;
  source: "original" | "added" | "changed" | "manual";
  status: "planned" | "done" | "changed" | "removed";
  position: number;
  version_first_seen: number | null;
};

type TestRow = {
  id: string;
  kind: "static" | "behavioral";
  passed: boolean;
  issue_count: number;
  issues: Array<{ tab: string; severity: "error" | "warning"; message: string }>;
  created_at: string;
};

const SOURCE_LABEL: Record<Req["source"], string> = {
  original: "Original",
  added: "Added",
  changed: "Changed",
  manual: "Manual",
};

const SOURCE_COLOR: Record<Req["source"], string> = {
  original: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  added: "bg-violet-500/10 text-violet-700 dark:text-violet-400",
  changed: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  manual: "bg-muted text-muted-foreground",
};

export function RoadmapTab({ projectId }: { projectId: string }) {
  const { data, refetch, isLoading } = useQuery({
    queryKey: ["roadmap", projectId],
    queryFn: () => getRoadmap({ data: { projectId } }),
    refetchInterval: 5000,
  });

  const [newText, setNewText] = useState("");

  const updateMut = useMutation({
    mutationFn: (input: { id: string; text?: string; status?: Req["status"] }) =>
      updateRequirement({ data: input }),
    onSuccess: () => refetch(),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const addMut = useMutation({
    mutationFn: (text: string) => addRequirement({ data: { projectId, text } }),
    onSuccess: () => {
      setNewText("");
      refetch();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const delMut = useMutation({
    mutationFn: (id: string) => deleteRequirement({ data: { id } }),
    onSuccess: () => refetch(),
  });
  const testMut = useMutation({
    mutationFn: () => runStaticTests({ data: { projectId } }),
    onSuccess: (res) => {
      toast.success(
        res.passed
          ? `Tests passed${res.issues.length > 0 ? ` (${res.issues.length} warnings)` : ""}`
          : `${res.issues.length} issue(s) found`,
      );
      refetch();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  if (isLoading || !data) {
    return <div className="text-xs text-muted-foreground">Loading roadmap…</div>;
  }

  const reqs = (data.requirements as Req[]).filter((r) => r.status !== "removed");
  const total = reqs.length;
  const done = reqs.filter((r) => r.status === "done").length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);

  const tests = data.tests as unknown as TestRow[];
  const latestStatic = tests.find((t) => t.kind === "static") ?? null;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-card/30 p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold">Build Progress</span>
          <span className="text-xs text-muted-foreground">{done}/{total} ({pct}%)</span>
        </div>
        <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
          <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold">Requirements (BRD)</span>
          <span className="text-[10px] text-muted-foreground">Auto-extracted, editable</span>
        </div>
        {reqs.length === 0 ? (
          <p className="text-xs text-muted-foreground italic px-1">
            Requirements appear here after your first refine.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {reqs.map((r) => (
              <li key={r.id} className="group flex items-start gap-2 rounded-md border bg-background/30 p-2 text-xs">
                <Checkbox
                  className="mt-0.5 shrink-0"
                  checked={r.status === "done"}
                  onCheckedChange={(v) => updateMut.mutate({ id: r.id, status: v ? "done" : "planned" })}
                />
                <div className="min-w-0 flex-1">
                  <input
                    className={`w-full bg-transparent outline-none ${r.status === "done" ? "line-through text-muted-foreground" : ""}`}
                    defaultValue={r.text}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v && v !== r.text) updateMut.mutate({ id: r.id, text: v });
                    }}
                  />
                  <div className="mt-0.5 flex items-center gap-1.5">
                    <span className={`rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide ${SOURCE_COLOR[r.source]}`}>
                      {SOURCE_LABEL[r.source]}
                    </span>
                    {r.version_first_seen && (
                      <span className="text-[9px] text-muted-foreground">v{r.version_first_seen}</span>
                    )}
                    {r.status === "changed" && <span className="text-[9px] text-amber-600">scope changed</span>}
                  </div>
                </div>
                <button
                  onClick={() => delMut.mutate(r.id)}
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity text-[10px] shrink-0"
                  title="Delete"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex gap-2 pt-1">
          <Input
            placeholder="Add a requirement…"
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newText.trim()) addMut.mutate(newText.trim());
            }}
            className="h-7 text-xs"
          />
          <Button
            size="sm"
            className="h-7 text-xs px-2.5"
            disabled={!newText.trim() || addMut.isPending}
            onClick={() => addMut.mutate(newText.trim())}
          >
            Add
          </Button>
        </div>
      </div>

      <div className="space-y-2 pt-3 border-t">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold">Static Tests</span>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs px-2.5"
            onClick={() => testMut.mutate()}
            disabled={testMut.isPending}
          >
            {testMut.isPending ? "Running…" : "Run now"}
          </Button>
        </div>

        {latestStatic ? (
          <div className="rounded-lg border bg-background/30 p-2.5 text-xs space-y-2">
            <div className="flex items-center justify-between">
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                latestStatic.passed
                  ? "bg-green-500/10 text-green-700 dark:text-green-400"
                  : "bg-red-500/10 text-red-700 dark:text-red-400"
              }`}>
                <span className={`h-1.5 w-1.5 rounded-full ${latestStatic.passed ? "bg-green-500" : "bg-red-500"}`} />
                {latestStatic.passed ? "Passing" : "Failing"}
              </span>
              <span className="text-[10px] text-muted-foreground">
                {new Date(latestStatic.created_at).toLocaleString()}
              </span>
            </div>
            {latestStatic.issues.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">No issues detected.</p>
            ) : (
              <ul className="space-y-1">
                {latestStatic.issues.map((iss, i) => (
                  <li key={i} className="flex gap-1.5 text-[11px]">
                    <span className={`shrink-0 font-mono ${iss.severity === "error" ? "text-red-600" : "text-amber-600"}`}>
                      {iss.severity === "error" ? "✗" : "!"}
                    </span>
                    <span className="text-muted-foreground">
                      <span className="font-medium text-foreground">[{iss.tab}]</span> {iss.message}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground italic px-1">
            No tests have run yet. Click "Run now" or refine the app.
          </p>
        )}
      </div>
    </div>
  );
}
