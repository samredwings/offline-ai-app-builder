// Local IndexedDB store for the builder. No cloud, no auth.
// Backed by idb-keyval; everything is stored client-side.
import { get, set, del } from "idb-keyval";
import type { Tab, Theme } from "./types";

export type LocalProject = {
  id: string;
  slug: string;
  title: string;
  prompt: string;
  template_family: string;
  theme: Theme;
  icon_url: string | null;
  is_published: boolean;
  current_version_id: string | null;
  created_at: string;
  updated_at: string;
};

export type LocalVersion = {
  id: string;
  project_id: string;
  version_num: number;
  tabs: Tab[];
  created_by_message: string | null;
  created_at: string;
};

export type LocalMessage = {
  id: string;
  project_id: string;
  role: "user" | "assistant";
  content: string;
  version_id_after?: string | null;
  created_at: string;
};

export type LocalRequirement = {
  id: string;
  project_id: string;
  text: string;
  source: "original" | "added" | "changed" | "manual";
  status: "planned" | "done" | "changed" | "removed";
  position: number;
  version_first_seen: number | null;
  created_at: string;
  updated_at: string;
};

export type LocalTestResult = {
  id: string;
  project_id: string;
  version_id: string | null;
  kind: "static" | "behavioral";
  passed: boolean;
  issue_count: number;
  issues: Array<{ tab: string; severity: "error" | "warning"; message: string }>;
  created_at: string;
};

const K = {
  projects: "lf:projects",
  versions: (pid: string) => `lf:versions:${pid}`,
  messages: (pid: string) => `lf:messages:${pid}`,
  reqs: (pid: string) => `lf:reqs:${pid}`,
  tests: (pid: string) => `lf:tests:${pid}`,
};

function nowISO() {
  return new Date().toISOString();
}
export function newId() {
  return crypto.randomUUID();
}

async function readArr<T>(key: string): Promise<T[]> {
  return ((await get(key)) as T[] | undefined) ?? [];
}

// -------- Projects --------
export async function listProjects(): Promise<LocalProject[]> {
  const arr = await readArr<LocalProject>(K.projects);
  return [...arr].sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
}
export async function getProjectRow(id: string): Promise<LocalProject | null> {
  const arr = await readArr<LocalProject>(K.projects);
  return arr.find((p) => p.id === id) ?? null;
}
export async function insertProject(p: Omit<LocalProject, "created_at" | "updated_at">) {
  const arr = await readArr<LocalProject>(K.projects);
  const row: LocalProject = { ...p, created_at: nowISO(), updated_at: nowISO() };
  arr.push(row);
  await set(K.projects, arr);
  return row;
}
export async function updateProjectRow(id: string, patch: Partial<LocalProject>) {
  const arr = await readArr<LocalProject>(K.projects);
  const i = arr.findIndex((p) => p.id === id);
  if (i === -1) throw new Error("Not found");
  arr[i] = { ...arr[i], ...patch, updated_at: nowISO() };
  await set(K.projects, arr);
  return arr[i];
}
export async function deleteProjectRow(id: string) {
  const arr = await readArr<LocalProject>(K.projects);
  await set(
    K.projects,
    arr.filter((p) => p.id !== id),
  );
  await Promise.all([del(K.versions(id)), del(K.messages(id)), del(K.reqs(id)), del(K.tests(id))]);
}

// -------- Versions --------
export async function listVersions(pid: string): Promise<LocalVersion[]> {
  const arr = await readArr<LocalVersion>(K.versions(pid));
  return [...arr].sort((a, b) => b.version_num - a.version_num);
}
export async function getVersion(pid: string, vid: string): Promise<LocalVersion | null> {
  const arr = await readArr<LocalVersion>(K.versions(pid));
  return arr.find((v) => v.id === vid) ?? null;
}
export async function insertVersion(v: Omit<LocalVersion, "created_at">) {
  const arr = await readArr<LocalVersion>(K.versions(v.project_id));
  const row: LocalVersion = { ...v, created_at: nowISO() };
  arr.push(row);
  await set(K.versions(v.project_id), arr);
  return row;
}

// -------- Messages --------
export async function listMessages(pid: string): Promise<LocalMessage[]> {
  const arr = await readArr<LocalMessage>(K.messages(pid));
  return [...arr].sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
}
export async function insertMessages(pid: string, msgs: Omit<LocalMessage, "id" | "created_at">[]) {
  const arr = await readArr<LocalMessage>(K.messages(pid));
  for (const m of msgs) {
    arr.push({ ...m, id: newId(), created_at: nowISO() });
  }
  await set(K.messages(pid), arr);
}

// -------- Requirements --------
export async function listReqs(pid: string): Promise<LocalRequirement[]> {
  const arr = await readArr<LocalRequirement>(K.reqs(pid));
  return [...arr].sort((a, b) => a.position - b.position);
}
export async function insertReqs(
  pid: string,
  rows: Omit<LocalRequirement, "id" | "project_id" | "created_at" | "updated_at">[],
) {
  const arr = await readArr<LocalRequirement>(K.reqs(pid));
  for (const r of rows) {
    arr.push({
      ...r,
      id: newId(),
      project_id: pid,
      created_at: nowISO(),
      updated_at: nowISO(),
    });
  }
  await set(K.reqs(pid), arr);
}
export async function updateReqRow(id: string, patch: Partial<LocalRequirement>) {
  // We don't index by project, so scan all known project ids by listing projects.
  const projects = await readArr<LocalProject>(K.projects);
  for (const p of projects) {
    const arr = await readArr<LocalRequirement>(K.reqs(p.id));
    const i = arr.findIndex((r) => r.id === id);
    if (i !== -1) {
      arr[i] = { ...arr[i], ...patch, updated_at: nowISO() };
      await set(K.reqs(p.id), arr);
      return arr[i];
    }
  }
  throw new Error("Not found");
}
export async function updateReqsBulk(ids: string[], patch: Partial<LocalRequirement>) {
  const idSet = new Set(ids);
  const projects = await readArr<LocalProject>(K.projects);
  for (const p of projects) {
    const arr = await readArr<LocalRequirement>(K.reqs(p.id));
    let changed = false;
    for (let i = 0; i < arr.length; i++) {
      if (idSet.has(arr[i].id)) {
        arr[i] = { ...arr[i], ...patch, updated_at: nowISO() };
        changed = true;
      }
    }
    if (changed) await set(K.reqs(p.id), arr);
  }
}
export async function deleteReqRow(id: string) {
  const projects = await readArr<LocalProject>(K.projects);
  for (const p of projects) {
    const arr = await readArr<LocalRequirement>(K.reqs(p.id));
    const next = arr.filter((r) => r.id !== id);
    if (next.length !== arr.length) {
      await set(K.reqs(p.id), next);
      return;
    }
  }
}

// -------- Tests --------
export async function listTests(pid: string, limit = 10): Promise<LocalTestResult[]> {
  const arr = await readArr<LocalTestResult>(K.tests(pid));
  return [...arr].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, limit);
}
export async function insertTest(t: Omit<LocalTestResult, "id" | "created_at">) {
  const arr = await readArr<LocalTestResult>(K.tests(t.project_id));
  const row: LocalTestResult = { ...t, id: newId(), created_at: nowISO() };
  arr.push(row);
  // Keep last 50 to bound storage.
  const trimmed = arr.slice(-50);
  await set(K.tests(t.project_id), trimmed);
  return row;
}
