import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { getProject } from "@/lib/projects.functions";
import {
  refineProject,
  revertToVersion,
  updateProjectMeta,
  regenerateIcon,
} from "@/lib/generate.functions";
import { updateAIRuntime, exportAPKBundle } from "@/lib/export.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { renderAppHTML } from "@/lib/app-runtime";
import type { Theme, AIRuntime } from "@/lib/types";

export const Route = createFileRoute("/_authenticated/editor/$id")({
  head: () => ({ meta: [{ title: "Editor — App Forge" }] }),
  component: Editor,
});

type ProjectRow = {
  id: string;
  slug: string;
  title: string;
  theme: Theme;
  icon_url: string | null;
  is_published: boolean;
  ai_runtime: AIRuntime;
  ai_remote_endpoint: string | null;
  ai_remote_model: string | null;
  ai_ondevice_model: string | null;
};

function Editor() {
  const { id } = Route.useParams();
  const get = useServerFn(getProject);
  const refine = useServerFn(refineProject);
  const revert = useServerFn(revertToVersion);
  const meta = useServerFn(updateProjectMeta);
  const regen = useServerFn(regenerateIcon);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["project", id],
    queryFn: () => get({ data: { projectId: id } }),
  });

  const [chatInput, setChatInput] = useState("");
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = chatScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  });

  const refineMut = useMutation({
    mutationFn: (message: string) => refine({ data: { projectId: id, message } }),
    onSuccess: (res) => {
      if (res?.mode === "edit") toast.success("App updated");
      setChatInput("");
      refetch();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const revertMut = useMutation({
    mutationFn: (versionId: string) => revert({ data: { projectId: id, versionId } }),
    onSuccess: () => refetch(),
  });

  const metaMut = useMutation({
    mutationFn: (patch: { title?: string; theme?: Theme; is_published?: boolean }) =>
      meta({ data: { projectId: id, ...patch } }),
    onSuccess: () => refetch(),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const regenMut = useMutation({
    mutationFn: (prompt: string) => regen({ data: { projectId: id, prompt } }),
    onSuccess: () => {
      toast.success("Icon updated");
      refetch();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const updateAI = useServerFn(updateAIRuntime);
  const exportBundle = useServerFn(exportAPKBundle);

  const aiMut = useMutation({
    mutationFn: (patch: {
      runtime: AIRuntime;
      remoteEndpoint?: string | null;
      remoteModel?: string | null;
      ondeviceModel?: string | null;
    }) => updateAI({ data: { projectId: id, ...patch } }),
    onSuccess: () => {
      toast.success("AI runtime updated");
      refetch();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const exportMut = useMutation({
    mutationFn: () =>
      exportBundle({ data: { projectId: id, origin: window.location.origin } }),
    onSuccess: (res) => {
      const blob = new Blob(
        [Uint8Array.from(atob(res.base64), (c) => c.charCodeAt(0))],
        { type: "application/zip" }
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.filename;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("APK bundle downloaded");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Export failed"),
  });

  const previewHtml = useMemo(() => {
    if (!data) return "";
    const p = data.project as unknown as ProjectRow;
    return renderAppHTML({
      slug: p.slug,
      title: p.title,
      theme: p.theme,
      iconUrl: p.icon_url,
      tabs: data.tabs,
      manifestUrl: `/api/public/manifest/${p.slug}`,
      appDataEndpoint: `/api/public/app-data/${p.slug}`,
      ai: {
        runtime: p.ai_runtime,
        remoteEndpoint: p.ai_remote_endpoint,
        remoteModel: p.ai_remote_model,
        ondeviceModel: p.ai_ondevice_model,
      },
    });
  }, [data]);

  if (isLoading || !data) {
    return <div className="p-8 text-center text-sm text-muted-foreground">Loading…</div>;
  }

  const project = data.project as unknown as ProjectRow;
  const publishedUrl =
    typeof window !== "undefined" ? `${window.location.origin}/a/${project.slug}` : "";

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {project.icon_url && (
            <img src={project.icon_url} alt="" className="h-10 w-10 rounded-lg" />
          )}
          <Input
            value={project.title}
            onChange={(e) =>
              metaMut.mutate({ title: e.target.value.slice(0, 60) })
            }
            className="max-w-xs"
          />
        </div>
        <div className="flex items-center gap-2">
          {project.is_published && (
            <a
              href={publishedUrl}
              target="_blank"
              rel="noopener"
              className="text-xs text-muted-foreground hover:underline"
            >
              {publishedUrl.replace(/^https?:\/\//, "")}
            </a>
          )}
          <Button
            variant={project.is_published ? "outline" : "default"}
            size="sm"
            onClick={() => metaMut.mutate({ is_published: !project.is_published })}
          >
            {project.is_published ? "Unpublish" : "Publish"}
          </Button>
          {project.is_published && (
            <Button
              size="sm"
              variant="secondary"
              disabled={exportMut.isPending}
              onClick={() => exportMut.mutate()}
              title="Download a ready-to-build Capacitor project (APK + optional offline AI)"
            >
              {exportMut.isPending ? "Packaging…" : "Export APK bundle"}
            </Button>
          )}
          {project.is_published && (
            <a
              href={`https://www.pwabuilder.com/reportcard?site=${encodeURIComponent(publishedUrl)}`}
              target="_blank"
              rel="noopener"
            >
              <Button size="sm" variant="ghost">
                PWA APK ↗
              </Button>
            </a>
          )}
          <Link to="/dashboard">
            <Button size="sm" variant="ghost">
              Back
            </Button>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[420px_1fr]">
        {/* Side panel */}
        <div className="space-y-4">
          <Tabs defaultValue="chat">
            <TabsList className="w-full">
              <TabsTrigger value="chat" className="flex-1">
                Chat
              </TabsTrigger>
              <TabsTrigger value="design" className="flex-1">
                Design
              </TabsTrigger>
              <TabsTrigger value="ai" className="flex-1">
                AI
              </TabsTrigger>
              <TabsTrigger value="versions" className="flex-1">
                Versions
              </TabsTrigger>
            </TabsList>

            <TabsContent value="chat" className="space-y-3">
              <div
                ref={chatScrollRef}
                className="h-[420px] overflow-y-auto rounded-lg border p-3 space-y-2"
              >
                {data.messages.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Chat with the AI. Ask questions, brainstorm, or request changes like
                    "add a stats tab", "use a darker theme", or "remember entries between sessions".
                  </p>
                ) : (
                  data.messages.map((m) => (
                    <div
                      key={m.id}
                      className={
                        m.role === "user"
                          ? "ml-8 whitespace-pre-wrap rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground"
                          : "mr-8 whitespace-pre-wrap rounded-lg bg-muted px-3 py-2 text-sm"
                      }
                    >
                      {m.content}
                    </div>
                  ))
                )}
                {refineMut.isPending && (
                  <div className="mr-8 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
                    Thinking…
                  </div>
                )}
              </div>
              <Textarea
                rows={3}
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    const v = chatInput.trim();
                    if (v && !refineMut.isPending) refineMut.mutate(v);
                  }
                }}
                placeholder="Ask a question or describe a change… (Enter to send, Shift+Enter for newline)"
                disabled={refineMut.isPending}
              />
              <Button
                className="w-full"
                disabled={refineMut.isPending || chatInput.trim().length < 1}
                onClick={() => refineMut.mutate(chatInput.trim())}
              >
                {refineMut.isPending ? "Working…" : "Send"}
              </Button>
            </TabsContent>


            <TabsContent value="design" className="space-y-4">
              {(["primary", "background", "foreground", "accent"] as const).map((k) => (
                <div key={k} className="flex items-center justify-between gap-3">
                  <Label className="capitalize">{k}</Label>
                  <input
                    type="color"
                    value={project.theme[k]}
                    onChange={(e) =>
                      metaMut.mutate({ theme: { ...project.theme, [k]: e.target.value } })
                    }
                    className="h-9 w-16 cursor-pointer rounded border bg-transparent"
                  />
                </div>
              ))}
              <div className="space-y-2 pt-2 border-t">
                <Label>App icon</Label>
                <div className="flex gap-2">
                  <Input
                    placeholder="Re-roll icon prompt"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        const v = (e.target as HTMLInputElement).value;
                        if (v.trim()) regenMut.mutate(v.trim());
                      }
                    }}
                  />
                  <Button
                    size="sm"
                    disabled={regenMut.isPending}
                    onClick={() => regenMut.mutate(project.title)}
                  >
                    {regenMut.isPending ? "…" : "Re-roll"}
                  </Button>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="ai" className="space-y-4">
              <div className="space-y-2">
                <Label>AI runtime</Label>
                <Select
                  value={project.ai_runtime}
                  onValueChange={(v) =>
                    aiMut.mutate({
                      runtime: v as AIRuntime,
                      remoteEndpoint: project.ai_remote_endpoint,
                      remoteModel: project.ai_remote_model,
                      ondeviceModel: project.ai_ondevice_model,
                    })
                  }
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="lovable">Lovable AI (default, safe)</SelectItem>
                    <SelectItem value="remote">Remote endpoint (OpenAI-compatible)</SelectItem>
                    <SelectItem value="on-device">On-device (offline APK only)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {project.ai_runtime === "lovable" &&
                    "Routed through this site. Content moderated."}
                  {project.ai_runtime === "remote" &&
                    "App calls your endpoint. Users paste their own API key inside the app. You bring the rules."}
                  {project.ai_runtime === "on-device" &&
                    "App loads a local .gguf model. Only works inside the APK built from the Export bundle."}
                </p>
              </div>

              {project.ai_runtime === "remote" && (
                <div className="space-y-2">
                  <Label>Endpoint base URL</Label>
                  <Input
                    defaultValue={project.ai_remote_endpoint ?? ""}
                    placeholder="https://openrouter.ai/api/v1"
                    onBlur={(e) =>
                      aiMut.mutate({
                        runtime: "remote",
                        remoteEndpoint: e.target.value.trim() || null,
                        remoteModel: project.ai_remote_model,
                        ondeviceModel: project.ai_ondevice_model,
                      })
                    }
                  />
                  <Label>Default model</Label>
                  <Input
                    defaultValue={project.ai_remote_model ?? ""}
                    placeholder="e.g. meta-llama/llama-3.1-8b-instruct"
                    onBlur={(e) =>
                      aiMut.mutate({
                        runtime: "remote",
                        remoteEndpoint: project.ai_remote_endpoint,
                        remoteModel: e.target.value.trim() || null,
                        ondeviceModel: project.ai_ondevice_model,
                      })
                    }
                  />
                </div>
              )}

              {project.ai_runtime === "on-device" && (
                <div className="space-y-2">
                  <Label>Expected model filename</Label>
                  <Input
                    defaultValue={project.ai_ondevice_model ?? "model.gguf"}
                    placeholder="model.gguf"
                    onBlur={(e) =>
                      aiMut.mutate({
                        runtime: "on-device",
                        remoteEndpoint: project.ai_remote_endpoint,
                        remoteModel: project.ai_remote_model,
                        ondeviceModel: e.target.value.trim() || null,
                      })
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    Use the "Export APK bundle" button after publishing. Drop your .gguf
                    into <code>android/app/src/main/assets/models/</code> and build in
                    Android Studio. The app falls back to remote/Lovable when opened in a
                    plain browser.
                  </p>
                </div>
              )}
            </TabsContent>

            <TabsContent value="versions" className="space-y-2">
              {data.versions.map((v) => (
                <div
                  key={v.id}
                  className="flex items-center justify-between rounded-lg border p-3 text-sm"
                >
                  <div>
                    <div className="font-medium">v{v.version_num}</div>
                    <div className="text-xs text-muted-foreground line-clamp-1">
                      {v.created_by_message ?? "Initial generation"}
                    </div>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => revertMut.mutate(v.id)}>
                    Use
                  </Button>
                </div>
              ))}
            </TabsContent>
          </Tabs>
        </div>

        {/* Phone preview */}
        <div className="flex justify-center">
          <div
            className="overflow-hidden rounded-[2.25rem] border-8 border-foreground/80 shadow-2xl"
            style={{ width: 360, height: 720, background: "#000" }}
          >
            <iframe
              key={`${project.id}-${data.tabs.length}-${JSON.stringify(project.theme)}`}
              title="App preview"
              srcDoc={previewHtml}
              sandbox="allow-scripts"
              className="h-full w-full border-0 bg-white"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
