import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useIsMutating, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { getProject } from "@/lib/projects.functions";
import {
  refineProject,
  revertToVersion,
  updateProjectMeta,
  regenerateIcon,
  uploadCustomIcon,
} from "@/lib/generate.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { PreviewIframe } from "@/components/PreviewIframe";
import { ThemeEditor } from "@/components/theme-editor";
import { IconUploader } from "@/components/icon-uploader";
import { ChatTab } from "@/components/chat/ChatTab";
import { ExportTab } from "@/components/export/ExportTab";
import { RoadmapTab } from "@/components/RoadmapTab";
import { renderAppHTML } from "@/lib/app-runtime";
import type { Theme, Message } from "@/lib/types";

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
};

function Editor() {
  const { id } = Route.useParams();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["project", id],
    queryFn: () => getProject({ data: { projectId: id } }),
  });

  const queryClient = useQueryClient();
  const refineMutationKey = useMemo(() => ["refine", id] as const, [id]);

  const refineMut = useMutation({
    mutationKey: refineMutationKey,
    mutationFn: (message: string) => refineProject({ data: { projectId: id, message } }),
    onMutate: (message: string) => {
      const prev = queryClient.getQueryData(["project", id]) as
        | { messages?: Message[] }
        | undefined;
      const optimistic: Message = {
        id: `optimistic-${Date.now()}`,
        role: "user",
        content: message,
        created_at: new Date().toISOString(),
      };
      queryClient.setQueryData(["project", id], {
        ...(prev ?? {}),
        messages: [...((prev?.messages as Message[]) ?? []), optimistic],
      });
      return { prev };
    },
    onSuccess: async (res) => {
      const oldTabs = (data?.tabs ?? []) as { name: string }[];
      const refreshed = await refetch();
      if (res?.mode === "edit") {
        const newTabs = (refreshed.data?.tabs ?? []) as { name: string }[];
        const added = newTabs.filter((n) => !oldTabs.some((t) => t.name === n.name));
        const removed = oldTabs.filter((t) => !newTabs.some((n) => n.name === t.name));
        if (added.length) toast.success(`Added tab: ${added.map((t) => t.name).join(", ")}`);
        if (removed.length) toast.success(`Removed: ${removed.map((t) => t.name).join(", ")}`);
        if (!added.length && !removed.length) toast.success("App updated");
      }
    },
    onError: (e, _msg, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(["project", id], ctx.prev);
      toast.error(e instanceof Error ? e.message : "Failed");
    },
  });

  const isRefining = useIsMutating({ mutationKey: refineMutationKey }) > 0;

  const revertMut = useMutation({
    mutationFn: (versionId: string) => revertToVersion({ data: { projectId: id, versionId } }),
    onSuccess: () => refetch(),
  });

  const metaMut = useMutation({
    mutationFn: (patch: { title?: string; theme?: Theme }) =>
      updateProjectMeta({ data: { projectId: id, ...patch } }),
    onSuccess: () => refetch(),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const regenMut = useMutation({
    mutationFn: (prompt: string) => regenerateIcon({ data: { projectId: id, prompt } }),
    onSuccess: () => {
      toast.success("Icon updated");
      refetch();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const uploadIconMut = useMutation({
    mutationFn: async (blob: Blob) => {
      const buf = await blob.arrayBuffer();
      let binary = "";
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      const base64 = btoa(binary);
      return uploadCustomIcon({
        data: { projectId: id, base64, contentType: blob.type || "image/png" },
      });
    },
    onSuccess: () => {
      toast.success("Icon updated");
      refetch();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Upload failed"),
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
    });
  }, [data]);

  if (isLoading || !data) {
    return <div className="p-8 text-center text-sm text-muted-foreground">Loading…</div>;
  }

  const project = data.project as unknown as ProjectRow;

  return (
    <div className="flex flex-col h-screen md:grid md:grid-cols-[420px,1fr] overflow-hidden bg-background">
      <aside className="border-r bg-muted/10 flex flex-col h-full overflow-hidden">
        <div className="p-4 border-b space-y-3 bg-card/30">
          <div className="flex items-center gap-3 justify-between">
            <Link to="/dashboard" className="shrink-0">
              <Button size="sm" variant="ghost" className="h-8 px-2 text-xs gap-1" title="Back to dashboard">
                <span aria-hidden>←</span> Dashboard
              </Button>
            </Link>
            <div className="flex items-center gap-2 min-w-0 flex-1 justify-end">
              {project.icon_url && (
                <img src={project.icon_url} alt="" className="h-8 w-8 rounded-lg shrink-0 object-cover" />
              )}
              <Input
                value={project.title}
                onChange={(e) => metaMut.mutate({ title: e.target.value.slice(0, 60) })}
                className="h-8 text-sm font-semibold max-w-[180px]"
              />
            </div>
          </div>

          {isRefining && (
            <div className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-2 py-1.5 text-[11px] text-primary">
              <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
              Refining in background — you can switch tabs or projects, it won't be cancelled.
            </div>
          )}

          <div className="flex items-center justify-between gap-2 pt-1">
            <span className="text-[11px] text-muted-foreground">
              Local-only • saved on this device
            </span>
            <Link to="/settings">
              <Button variant="outline" size="sm" className="h-7 text-xs px-2.5">
                AI Settings
              </Button>
            </Link>
          </div>
        </div>

        <Tabs defaultValue="chat" className="flex-1 flex flex-col overflow-hidden p-4">
          <TabsList className="grid w-full grid-cols-5 shrink-0 h-9">
            <TabsTrigger value="chat" className="text-xs">Chat</TabsTrigger>
            <TabsTrigger value="roadmap" className="text-xs">Plan</TabsTrigger>
            <TabsTrigger value="design" className="text-xs">Design</TabsTrigger>
            <TabsTrigger value="versions" className="text-xs">History</TabsTrigger>
            <TabsTrigger value="export" className="text-xs">Export</TabsTrigger>
          </TabsList>

          <TabsContent value="chat" className="flex-1 flex flex-col min-h-0 mt-3 overflow-hidden">
            <ChatTab
              messages={data.messages as Message[]}
              isPending={isRefining}
              onSend={(msg) => refineMut.mutate(msg)}
            />
          </TabsContent>

          <TabsContent value="roadmap" className="flex-1 overflow-y-auto mt-3 pr-1">
            <RoadmapTab projectId={project.id} />
          </TabsContent>

          <TabsContent value="design" className="flex-1 overflow-y-auto space-y-5 mt-3 pr-1">
            <ThemeEditor
              theme={project.theme}
              onChange={(newTheme) => metaMut.mutate({ theme: newTheme })}
            />

            <div className="space-y-3 pt-3 border-t">
              <div>
                <Label className="text-xs font-semibold">Generate App Icon</Label>
                <p className="text-xs text-muted-foreground">Requires an image model in Settings.</p>
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
                <Button size="sm" variant="outline" className="h-7 text-xs px-2.5 shrink-0" onClick={() => revertMut.mutate(v.id)}>
                  Revert
                </Button>
              </div>
            ))}
          </TabsContent>

          <TabsContent value="export" className="flex-1 flex flex-col min-h-0 mt-3 overflow-hidden">
            <ExportTab projectId={project.id} />
          </TabsContent>
        </Tabs>
      </aside>

      <main className="flex-1 flex flex-col bg-muted/20 overflow-auto justify-center items-center p-4">
        <div
          className="overflow-hidden rounded-[2.25rem] border-8 border-foreground/90 shadow-2xl relative"
          style={{ width: 360, height: 720, background: "#000" }}
        >
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
