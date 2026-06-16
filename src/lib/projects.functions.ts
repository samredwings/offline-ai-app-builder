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
    const projects = data ?? [];
    if (projects.length === 0) return [];

    const ids = projects.map((p) => p.id);
    const [{ data: reqs }, { data: tests }] = await Promise.all([
      supabaseAdmin
        .from("requirements")
        .select("project_id, status")
        .in("project_id", ids),
      supabaseAdmin
        .from("test_results")
        .select("project_id, kind, passed, issue_count, created_at")
        .in("project_id", ids)
        .order("created_at", { ascending: false }),
    ]);

    const reqStats = new Map<string, { total: number; done: number }>();
    for (const r of reqs ?? []) {
      const s = reqStats.get(r.project_id) ?? { total: 0, done: 0 };
      if (r.status !== "removed") s.total += 1;
      if (r.status === "done") s.done += 1;
      reqStats.set(r.project_id, s);
    }
    const latestStatic = new Map<string, { passed: boolean; issueCount: number }>();
    for (const t of tests ?? []) {
      if (t.kind !== "static") continue;
      if (latestStatic.has(t.project_id)) continue;
      latestStatic.set(t.project_id, { passed: t.passed, issueCount: t.issue_count });
    }
    return projects.map((p) => {
      const s = reqStats.get(p.id) ?? { total: 0, done: 0 };
      return {
        ...p,
        progress: { total: s.total, done: s.done, pct: s.total === 0 ? 0 : Math.round((s.done / s.total) * 100) },
        lastStatic: latestStatic.get(p.id) ?? null,
      };
    });
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
