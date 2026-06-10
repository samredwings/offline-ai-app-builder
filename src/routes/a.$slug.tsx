import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { renderAppHTML } from "@/lib/app-runtime";
import type { Tab, Theme, AIRuntime } from "@/lib/types";

const loadApp = createServerFn({ method: "GET" })
  .inputValidator((input) => z.object({ slug: z.string().min(1).max(80) }).parse(input))
  .handler(async ({ data }) => {
    const { data: project } = await supabaseAdmin
      .from("projects")
      .select(
        "id, slug, title, theme, icon_url, is_published, current_version_id, ai_runtime, ai_remote_endpoint, ai_remote_model, ai_ondevice_model"
      )
      .eq("slug", data.slug)
      .maybeSingle();
    if (!project || !project.is_published || !project.current_version_id) return null;

    const { data: version } = await supabaseAdmin
      .from("project_versions")
      .select("tabs")
      .eq("id", project.current_version_id)
      .eq("project_id", project.id)
      .maybeSingle();

    const tabs = (version?.tabs ?? []) as Tab[];
    return {
      slug: project.slug,
      title: project.title,
      theme: project.theme as unknown as Theme,
      iconUrl: project.icon_url,
      tabs,
      ai: {
        runtime: project.ai_runtime as AIRuntime,
        remoteEndpoint: project.ai_remote_endpoint,
        remoteModel: project.ai_remote_model,
        ondeviceModel: project.ai_ondevice_model,
      },
    };
  });

export const Route = createFileRoute("/a/$slug")({
  loader: async ({ params }) => {
    const app = await loadApp({ data: { slug: params.slug } });
    if (!app) throw notFound();
    return { app };
  },
  head: ({ loaderData }) =>
    loaderData
      ? {
          meta: [
            { title: loaderData.app.title },
            { name: "description", content: loaderData.app.title },
            { name: "theme-color", content: loaderData.app.theme.primary },
          ],
          links: [
            { rel: "manifest", href: `/api/public/manifest/${loaderData.app.slug}` },
            ...(loaderData.app.iconUrl
              ? [{ rel: "apple-touch-icon", href: loaderData.app.iconUrl }]
              : []),
          ],
        }
      : { meta: [{ title: "App not found" }] },
  component: PublicApp,
  notFoundComponent: () => (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <p className="text-muted-foreground">App not found or not published.</p>
    </div>
  ),
});

function PublicApp() {
  const { app } = Route.useLoaderData();
  const html = renderAppHTML({
    slug: app.slug,
    title: app.title,
    theme: app.theme,
    iconUrl: app.iconUrl,
    tabs: app.tabs,
    manifestUrl: `/api/public/manifest/${app.slug}`,
    appDataEndpoint: `/api/public/app-data/${app.slug}`,
    ai: app.ai,
  });
  return (
    <iframe
      title={app.title}
      srcDoc={html}
      sandbox="allow-scripts"
      style={{ position: "fixed", inset: 0, width: "100%", height: "100%", border: 0 }}
    />
  );
}
