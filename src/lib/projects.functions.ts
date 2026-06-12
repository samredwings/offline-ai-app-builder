import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const listMyProjects = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await supabaseAdmin
      .from("projects")
      .select("id, slug, title, icon_url, theme, is_published, updated_at, created_at")
      .eq("owner_id", context.userId)
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const getProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ projectId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: project, error } = await supabaseAdmin
      .from("projects")
      .select("*")
      .eq("id", data.projectId)
      .eq("owner_id", context.userId)
      .single();
    if (error || !project) throw new Error("Not found");

    const [{ data: versions }, { data: messages }, { data: current }] = await Promise.all([
      supabaseAdmin
        .from("project_versions")
        .select("id, version_num, created_by_message, created_at")
        .eq("project_id", project.id)
        .order("version_num", { ascending: false }),
      supabaseAdmin
        .from("project_messages")
        .select("id, role, content, created_at")
        .eq("project_id", project.id)
        .order("created_at", { ascending: true }),
      project.current_version_id
        ? supabaseAdmin
            .from("project_versions")
            .select("tabs")
            .eq("id", project.current_version_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    const tabs = (current?.tabs ?? []) as Array<{ name: string; icon: string; html: string }>;
    return {
      project,
      versions: versions ?? [],
      messages: messages ?? [],
      tabs,
    };
  });

export const deleteProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])

  .inputValidator((input) => z.object({ projectId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await supabaseAdmin
      .from("projects")
      .delete()
      .eq("id", data.projectId)
      .eq("owner_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
