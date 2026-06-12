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
  uploadCustomIcon,
} from "@/lib/generate.functions";
import { updateAIRuntime, exportAPKBundle } from "@/lib/export.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { PreviewIframe } from "@/components/PreviewIframe";
import { ThemeEditor } from "@/components/theme-editor";
import { IconUploader } from "@/components/icon-uploader";
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

  const uploadIcon = useServerFn(uploadCustomIcon);
  const uploadIconMut = useMutation({
    mutationFn: async (blob: Blob) => {
      const buf = await blob.arrayBuffer();
      let binary = "";
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      const base64 = btoa(binary);
      return uploadIcon({
        data: { projectId: id, base64, contentType: (blob.type || "image/png") as "image/png" },
      });
    },
    onSuccess: () => {
      toast.success("Icon updated");
      refetch();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Upload failed"),
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
    <div className="flex flex-col h-screen md:grid md:grid-cols-[420px,1fr] overflow-hidden bg-background">
      {/* LEFT SIDEBAR: Interactive Hub */}
      <aside className="border-r bg-muted/10 flex flex-col h-full overflow-hidden">
        {/* Header bar */}
        <div className="p-4 border-b space-y-3 bg-card/30">
          <div className="flex items-center gap-3 justify-between">
            <div className="flex items-center gap-2 min-w-0">
              {project.icon_url && (
                <img src={project.icon_url} alt="" className="h-8 w-8 rounded-lg shrink-0 object-cover" />
              )}
              <Input
                value={project.title}
                onChange={(e) =>
                  metaMut.mutate({ title: e.target.value.slice(0, 60) })
                }
                className="h-8 text-sm font-semibold max-w-[180px]"
              />
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Link to="/dashboard">
                <Button size="xs" variant="ghost" className="h-8 px-2 text-xs">
                  Dashboard
                </Button>
              </Link>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 pt-1">
            <div className="flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${project.is_published ? "bg-green-500 animate-pulse" : "bg-muted"}`} />
              <span className="text-xs text-muted-foreground font-medium">
                {project.is_published ? "Published" : "Draft"}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              {project.is_published && (
                <a
                  href={publishedUrl}
                  target="_blank"
                  rel="noopener"
                  className="text-xs text-primary hover:underline font-mono mr-1"
                >
                  open ↗
                </a>
              )}
              <Button
                variant={project.is_published ? "outline" : "default"}
                size="xs"
                className="h-7 text-xs px-2.5"
                onClick={() => metaMut.mutate({ is_published: !project.is_published })}
              >
                {project.is_published ? "Unpublish" : "Publish App"}
              </Button>
            </div>
          </div>
        </div>

        {/* Tabs Interface */}
        <Tabs defaultValue="chat" className="flex-1 flex flex-col overflow-hidden p-4">
          <TabsList className="grid w-full grid-cols-5 shrink-0 h-9">
            <TabsTrigger value="chat" className="text-xs">Chat</TabsTrigger>
            <TabsTrigger value="design" className="text-xs">Design</TabsTrigger>
            <TabsTrigger value="ai" className="text-xs">AI</TabsTrigger>
            <TabsTrigger value="versions" className="text-xs">History</TabsTrigger>
            <TabsTrigger value="export" className="text-xs">Export</TabsTrigger>
          </TabsList>

          {/* CHAT TAB - Extended for Code and Instructions */}
          <TabsContent value="chat" className="flex-1 flex flex-col min-h-0 mt-3 overflow-hidden">
            <div
              ref={chatScrollRef}
              className="flex-1 overflow-y-auto rounded-lg border bg-background/50 p-3 space-y-3 min-h-0"
            >
              {data.messages.length === 0 ? (
                <div className="text-xs text-muted-foreground space-y-2 p-1">
                  <p className="font-semibold text-foreground">Co-builder Chat</p>
                  <p>Paste entire code files, describe UI components, or request features like:</p>
                  <ul className="list-disc pl-4 space-y-1">
                    <li>"Add an entries log and persist it with appStorage"</li>
                    <li>"Create a beautiful dashboard tab for tracking goals"</li>
                    <li>"Make a clean, modern catalog tab for our items"</li>
                  </ul>
                </div>
              ) : (
                data.messages.map((m) => (
                  <div
                    key={m.id}
                    className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words ${
                      m.role === "user"
                        ? "ml-auto bg-primary text-primary-foreground"
                        : "mr-auto bg-muted"
                    }`}
                  >
                    {m.content}
                  </div>
                ))
              )}
              {refineMut.isPending && (
                <div className="mr-auto rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground animate-pulse">
                  Processing instructions and rebuilding app spec…
                </div>
              )}
            </div>

            <div className="mt-3 shrink-0 space-y-2">
              <Textarea
                rows={4}
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Paste code or type development instructions here..."
                className="resize-none text-sm font-sans"
                disabled={refineMut.isPending}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    const v = chatInput.trim();
                    if (v && !refineMut.isPending) refineMut.mutate(v);
                  }
                }}
              />
              <Button
                className="w-full"
                disabled={refineMut.isPending || chatInput.trim().length < 1}
                onClick={() => refineMut.mutate(chatInput.trim())}
              >
                {refineMut.isPending ? "Refining App..." : "Refine App"}
              </Button>
            </div>
          </TabsContent>

          {/* DESIGN TAB - Theme & Custom Icon */}
          <TabsContent value="design" className="flex-1 overflow-y-auto space-y-5 mt-3 pr-1">
            <ThemeEditor
              theme={project.theme}
              onChange={(newTheme) => metaMut.mutate({ theme: newTheme })}
            />

            <div className="space-y-3 pt-3 border-t">
              <div>
                <Label className="text-xs font-semibold">Generate App Icon</Label>
                <p className="text-xs text-muted-foreground">Describe what you want, then re-roll.</p>
              </div>
              <div className="flex gap-2">
                <Input
                  placeholder="Re-roll icon prompt..."
                  className="h-8 text-xs"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const v = (e.target as HTMLInputElement).value;
                      if (v.trim()) regenMut.mutate(v.trim());
                    }
                  }}
                />
                <Button
                  size="sm"
                  className="h-8 px-3 text-xs"
                  disabled={regenMut.isPending}
                  onClick={() => regenMut.mutate(project.title)}
                >
                  {regenMut.isPending ? "…" : "Re-roll"}
                </Button>
              </div>
            </div>

            <div className="space-y-2 pt-3 border-t">
              <Label className="text-xs font-semibold">Upload Custom Icon</Label>
              <IconUploader
                saving={uploadIconMut.isPending}
                onSave={(blob) => uploadIconMut.mutate(blob)}
              />
            </div>
          </TabsContent>

          {/* AI TAB - Runtime Configurations */}
          <TabsContent value="ai" className="flex-1 overflow-y-auto space-y-4 mt-3 pr-1">
            <div className="space-y-2">
              <Label className="text-xs font-semibold">AI Runtime Mode</Label>
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
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="lovable" className="text-xs">Lovable AI (default, safe)</SelectItem>
                  <SelectItem value="remote" className="text-xs">Remote endpoint (OpenAI-compatible)</SelectItem>
                  <SelectItem value="on-device" className="text-xs">On-device (offline APK only)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {project.ai_runtime === "lovable" &&
                  "Routed through this site. Content moderated."}
                {project.ai_runtime === "remote" &&
                  "App calls your endpoint. Users paste their own API key inside the app. You bring the rules."}
                {project.ai_runtime === "on-device" &&
                  "App loads a local .gguf model. Only works inside the APK built from the Export bundle."}
              </p>
            </div>

            {project.ai_runtime === "remote" && (
              <div className="space-y-3 pt-2 border-t">
                <div className="space-y-1">
                  <Label className="text-xs">Endpoint Base URL</Label>
                  <Input
                    defaultValue={project.ai_remote_endpoint ?? ""}
                    placeholder="https://openrouter.ai/api/v1"
                    className="h-8 text-xs"
                    onBlur={(e) =>
                      aiMut.mutate({
                        runtime: "remote",
                        remoteEndpoint: e.target.value.trim() || null,
                        remoteModel: project.ai_remote_model,
                        ondeviceModel: project.ai_ondevice_model,
                      })
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Default Model</Label>
                  <Input
                    defaultValue={project.ai_remote_model ?? ""}
                    placeholder="e.g. meta-llama/llama-3.1-8b-instruct"
                    className="h-8 text-xs"
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
              </div>
            )}

            {project.ai_runtime === "on-device" && (
              <div className="space-y-2 pt-2 border-t">
                <Label className="text-xs">Expected Model Filename</Label>
                <Input
                  defaultValue={project.ai_ondevice_model ?? "model.gguf"}
                  placeholder="model.gguf"
                  className="h-8 text-xs"
                  onBlur={(e) =>
                    aiMut.mutate({
                      runtime: "on-device",
                      remoteEndpoint: project.ai_remote_endpoint,
                      remoteModel: project.ai_remote_model,
                      ondeviceModel: e.target.value.trim() || null,
                    })
                  }
                />
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Use the "Export APK bundle" button under the Export tab. Drop your .gguf
                  into <code>android/app/src/main/assets/models/</code> and build in
                  Android Studio.
                </p>
              </div>
            )}
          </TabsContent>

          {/* HISTORY TAB - Previous Versions */}
          <TabsContent value="versions" className="flex-1 overflow-y-auto space-y-2 mt-3 pr-1">
            <div className="text-xs font-semibold text-muted-foreground px-1 pb-1">Restore Previous Versions</div>
            {data.versions.map((v) => (
              <div
                key={v.id}
                className="flex items-center justify-between rounded-lg border bg-background/30 p-2.5 text-xs"
              >
                <div className="min-w-0 flex-1 pr-2">
                  <div className="font-semibold">v{v.version_num}</div>
                  <div className="text-[11px] text-muted-foreground truncate">
                    {v.created_by_message ?? "Initial generation"}
                  </div>
                </div>
                <Button size="xs" variant="outline" className="h-7 text-xs px-2.5 shrink-0" onClick={() => revertMut.mutate(v.id)}>
                  Revert
                </Button>
              </div>
            ))}
          </TabsContent>

          {/* EXPORT TAB - Production & APK Pipelines */}
          <TabsContent value="export" className="flex-1 overflow-y-auto space-y-4 mt-3 pr-1">
            <div className="p-4 border rounded-lg bg-card/50 space-y-3">
              <div>
                <h3 className="font-semibold text-sm">APK Distribution</h3>
                <p className="text-xs text-muted-foreground leading-relaxed mt-1">
                  Download a full offline Capacitor Android build. Includes standard integration setup.
                </p>
              </div>
              <Button
                className="w-full h-9 text-xs"
                disabled={exportMut.isPending}
                onClick={() => exportMut.mutate()}
              >
                {exportMut.isPending ? "Generating APK Bundle…" : "Generate APK Bundle"}
              </Button>
            </div>

            {project.is_published && (
              <div className="p-4 border rounded-lg bg-card/50 space-y-3">
                <div>
                  <h3 className="font-semibold text-sm">PWA Builder Engine</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed mt-1">
                    Convert your live web application link into an immediate Google Play Store app bundle automatically.
                  </p>
                </div>
                <a
                  href={`https://www.pwabuilder.com/reportcard?site=${encodeURIComponent(publishedUrl)}`}
                  target="_blank"
                  rel="noopener"
                  className="block w-full"
                >
                  <Button className="w-full h-9 text-xs" variant="outline">
                    PWA APK Generator ↗
                  </Button>
                </a>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </aside>

      {/* RIGHT SIDE: Preview (The "Source of Truth") */}
      <main className="flex-1 flex flex-col bg-muted/20 overflow-auto justify-center items-center p-4">
        <div
          className="overflow-hidden rounded-[2.25rem] border-8 border-foreground/90 shadow-2xl relative"
          style={{ width: 360, height: 720, background: "#000" }}
        >
          {/* Audio receiver hole */}
          <div className="absolute top-3 left-1/2 transform -translate-x-1/2 w-20 h-4 bg-foreground/90 rounded-full z-10" />
          <PreviewIframe
            key={`${project.id}-${data.tabs.length}-${JSON.stringify(project.theme)}`}
            srcDoc={previewHtml}
            className="h-full w-full border-0 bg-white pt-6"
          />
        </div>
      </main>
    </div>
  );
}
