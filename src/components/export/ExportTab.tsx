import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { exportAPKBundle } from "@/lib/export.functions";
import { BuildStep } from "./BuildStep";
import { Download, Package, Smartphone, Archive } from "lucide-react";

interface ExportTabProps {
  projectId: string;
}

const BUILD_STEPS = [
  { id: "assets", label: "Copy static assets", icon: Archive, duration: 400 },
  { id: "web-build", label: "Build web app bundle", icon: Package, duration: 800 },
  { id: "capacitor-sync", label: "Sync Capacitor config", icon: Smartphone, duration: 600 },
  { id: "zip", label: "Compress bundle", icon: Download, duration: 400 },
];

type StepStatus = "pending" | "running" | "done" | "error";

export function ExportTab({ projectId }: ExportTabProps) {
  const [stepStatuses, setStepStatuses] = useState<Record<string, StepStatus>>(
    Object.fromEntries(BUILD_STEPS.map((s) => [s.id, "pending" as StepStatus])),
  );
  const [buildComplete, setBuildComplete] = useState(false);

  const exportMut = useMutation({
    mutationFn: async () => {
      setBuildComplete(false);
      setStepStatuses(Object.fromEntries(BUILD_STEPS.map((s) => [s.id, "pending" as StepStatus])));
      for (const step of BUILD_STEPS) {
        setStepStatuses((prev) => ({ ...prev, [step.id]: "running" }));
        await new Promise((r) => setTimeout(r, step.duration));
        setStepStatuses((prev) => ({ ...prev, [step.id]: "done" }));
      }
      return exportAPKBundle({ data: { projectId, origin: window.location.origin } });
    },
    onSuccess: (res) => {
      const blob = new Blob(
        [Uint8Array.from(atob(res.base64), (c) => c.charCodeAt(0))],
        { type: "application/zip" },
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.filename;
      a.click();
      URL.revokeObjectURL(url);
      setBuildComplete(true);
      toast.success("APK bundle downloaded");
    },
    onError: (e) => {
      setStepStatuses((prev) => {
        const next = { ...prev };
        for (const s of BUILD_STEPS) {
          if (next[s.id] !== "done") {
            next[s.id] = "error";
            break;
          }
        }
        return next;
      });
      toast.error(e instanceof Error ? e.message : "Export failed");
    },
  });

  return (
    <div className="flex-1 overflow-y-auto space-y-4 mt-3 pr-1">
      <div className="p-4 border rounded-lg bg-card/50 space-y-4">
        <div>
          <h3 className="font-semibold text-sm">APK / Web bundle</h3>
          <p className="text-xs text-muted-foreground leading-relaxed mt-1">
            Download a self-contained zip with a static web build and a Capacitor Android shell.
            Works fully offline.
          </p>
        </div>

        <div className="space-y-2">
          {BUILD_STEPS.map((step, idx) => (
            <BuildStep
              key={step.id}
              {...step}
              status={stepStatuses[step.id]}
              isLast={idx === BUILD_STEPS.length - 1}
            />
          ))}
        </div>

        <Button
          className="w-full h-10 text-sm font-medium"
          disabled={exportMut.isPending}
          onClick={() => exportMut.mutate()}
        >
          {exportMut.isPending ? (
            <span className="flex items-center gap-2">
              <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
              Building bundle...
            </span>
          ) : buildComplete ? (
            <span className="flex items-center gap-2">
              <Download className="w-4 h-4" />
              Download again
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <Smartphone className="w-4 h-4" />
              Generate bundle
            </span>
          )}
        </Button>

        {buildComplete && (
          <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3 text-xs text-green-700 dark:text-green-400 space-y-1">
            <p className="font-semibold">✓ Build complete</p>
            <p>Extract the zip; open <code>www/index.html</code> directly, or run it through Android Studio for an APK.</p>
          </div>
        )}

        {exportMut.isError && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-xs text-red-600 dark:text-red-400">
            <p className="font-semibold">Build failed</p>
            <p className="mt-0.5">{exportMut.error instanceof Error ? exportMut.error.message : "Unknown error"}</p>
          </div>
        )}
      </div>
    </div>
  );
}
