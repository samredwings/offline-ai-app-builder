// Project CRUD — now fully local (IndexedDB).
// API shape kept compatible with the old server-fn callers: fn({ data: {...} }).
import {
  deleteProjectRow,
  getProjectRow,
  listProjects,
  listMessages,
  listReqs,
  listTests,
  listVersions,
  getVersion,
} from "./local-db";

export async function listMyProjects() {
  const projects = await listProjects();
  if (projects.length === 0) return [];
  const out = [];
  for (const p of projects) {
    const reqs = await listReqs(p.id);
    const total = reqs.filter((r) => r.status !== "removed").length;
    const done = reqs.filter((r) => r.status === "done").length;
    const tests = await listTests(p.id, 5);
    const latest = tests.find((t) => t.kind === "static") ?? null;
    out.push({
      id: p.id,
      slug: p.slug,
      title: p.title,
      icon_url: p.icon_url,
      theme: p.theme,
      is_published: p.is_published,
      updated_at: p.updated_at,
      created_at: p.created_at,
      progress: { total, done, pct: total === 0 ? 0 : Math.round((done / total) * 100) },
      lastStatic: latest ? { passed: latest.passed, issueCount: latest.issue_count } : null,
    });
  }
  return out;
}

export async function getProject({ data }: { data: { projectId: string } }) {
  const project = await getProjectRow(data.projectId);
  if (!project) throw new Error("Not found");
  const [versionsAll, messages] = await Promise.all([
    listVersions(data.projectId),
    listMessages(data.projectId),
  ]);
  const versions = versionsAll.map((v) => ({
    id: v.id,
    version_num: v.version_num,
    created_by_message: v.created_by_message,
    created_at: v.created_at,
  }));
  let tabs: { name: string; icon: string; html: string }[] = [];
  if (project.current_version_id) {
    const cur = await getVersion(data.projectId, project.current_version_id);
    if (cur) tabs = cur.tabs;
  }
  return { project, versions, messages, tabs };
}

export async function deleteProject({ data }: { data: { projectId: string } }) {
  await deleteProjectRow(data.projectId);
  return { ok: true };
}
