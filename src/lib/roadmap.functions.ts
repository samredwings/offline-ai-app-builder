// Roadmap (BRD) + static tests — local only.
import { callAIWithTool } from "./ai-client";
import {
  deleteReqRow,
  getProjectRow,
  getVersion,
  insertReqs,
  insertTest,
  listReqs,
  listTests,
  updateReqRow,
  updateReqsBulk,
} from "./local-db";

type Tab = { name: string; icon: string; html: string };

export type StaticIssue = {
  tab: string;
  severity: "error" | "warning";
  message: string;
};

export function runStaticChecks(tabs: Tab[]): StaticIssue[] {
  const issues: StaticIssue[] = [];
  for (const tab of tabs) {
    const html = tab.html ?? "";
    if (/<\s*(html|head|body)\b/i.test(html))
      issues.push({ tab: tab.name, severity: "error", message: "Contains forbidden <html>/<head>/<body> tag" });
    if (/<script[^>]*\bsrc=/i.test(html))
      issues.push({ tab: tab.name, severity: "error", message: "External <script src> is not allowed" });
    if (html.length < 30)
      issues.push({ tab: tab.name, severity: "warning", message: "Tab content is suspiciously short" });

    const scripts: string[] = [];
    const scriptRe = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
    let m: RegExpExecArray | null;
    while ((m = scriptRe.exec(html))) scripts.push(m[1]);
    const declaredFns = new Set<string>();
    for (const code of scripts) {
      try {
        new Function(code);
      } catch (e) {
        issues.push({
          tab: tab.name,
          severity: "error",
          message: `Script syntax error: ${(e as Error).message.slice(0, 100)}`,
        });
      }
      for (const fm of code.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)) declaredFns.add(fm[1]);
      for (const fm of code.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:function|\()/g))
        declaredFns.add(fm[1]);
      for (const fm of code.matchAll(/window\.([A-Za-z_$][\w$]*)\s*=/g)) declaredFns.add(fm[1]);
    }
    const inlineHandlerRe = /\son(?:click|change|input|submit|blur|focus|keyup|keydown)\s*=\s*["']\s*([A-Za-z_$][\w$.]*)\s*\(/gi;
    const referencedFns = new Set<string>();
    let h: RegExpExecArray | null;
    while ((h = inlineHandlerRe.exec(html))) {
      const name = h[1].split(".")[0];
      if (["return", "alert", "console", "window", "document", "appStorage", "appAI", "event"].includes(name))
        continue;
      referencedFns.add(name);
    }
    for (const fn of referencedFns) {
      if (!declaredFns.has(fn))
        issues.push({
          tab: tab.name,
          severity: "warning",
          message: `Inline handler references undefined function: ${fn}()`,
        });
    }
    const ids = new Set<string>();
    for (const im of html.matchAll(/\bid=["']([^"']+)["']/g)) ids.add(im[1]);
    for (const gm of html.matchAll(/getElementById\(\s*["']([^"']+)["']\s*\)/g)) {
      if (!ids.has(gm[1]))
        issues.push({
          tab: tab.name,
          severity: "warning",
          message: `getElementById("${gm[1]}") targets an id that doesn't exist in this tab`,
        });
    }
  }
  return issues;
}

export async function runStaticTestsForCurrentVersion(projectId: string) {
  const project = await getProjectRow(projectId);
  if (!project?.current_version_id) return { passed: true, issues: [] as StaticIssue[] };
  const ver = await getVersion(projectId, project.current_version_id);
  const tabs = ver?.tabs ?? [];
  const issues = runStaticChecks(tabs);
  const hasError = issues.some((i) => i.severity === "error");
  await insertTest({
    project_id: projectId,
    version_id: project.current_version_id,
    kind: "static",
    passed: !hasError,
    issue_count: issues.length,
    issues,
  });
  return { passed: !hasError, issues };
}

export async function runStaticTests({ data }: { data: { projectId: string } }) {
  return runStaticTestsForCurrentVersion(data.projectId);
}

// ---------- BRD ----------

const EXTRACT_TOOL = {
  type: "function" as const,
  function: {
    name: "update_brd",
    description: "Update the living BRD for this app based on the latest user request and assistant reply.",
    parameters: {
      type: "object",
      properties: {
        add: {
          type: "array",
          items: {
            type: "object",
            properties: {
              text: { type: "string" },
              source: { type: "string", enum: ["original", "added", "changed"] },
            },
            required: ["text", "source"],
          },
        },
        mark_done: { type: "array", items: { type: "string" } },
        mark_changed: { type: "array", items: { type: "string" } },
        remove: { type: "array", items: { type: "string" } },
      },
      required: [],
    },
  },
};

export async function extractRequirementsForTurn(opts: {
  projectId: string;
  versionNum: number;
  userMessage: string;
  assistantReply: string;
  isFirstTurn: boolean;
}) {
  const list = await listReqs(opts.projectId);

  const systemPrompt = `You maintain a living Business Requirements Document (BRD) for a mobile web app.
Given the user's latest request and the current requirement list, decide:
- Which NEW requirements to add (source="original" only on the first turn, otherwise "added" for new asks or "changed" for scope changes).
- Which existing requirements (by id) are now fully done.
- Which existing requirements changed in scope.
- Which existing requirements the user explicitly asked to remove.
Keep each requirement short (max 100 chars), user-visible, outcome-oriented. If nothing changed, return empty arrays.`;

  const userPrompt = `First turn: ${opts.isFirstTurn}
Current requirements (id | status | text):
${list.length === 0 ? "(none)" : list.map((r) => `${r.id} | ${r.status} | ${r.text}`).join("\n")}

User message:
${opts.userMessage}

Assistant reply:
${opts.assistantReply}`;

  let decision: {
    add?: { text: string; source: "original" | "added" | "changed" }[];
    mark_done?: string[];
    mark_changed?: string[];
    remove?: string[];
  };
  try {
    decision = await callAIWithTool({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      tool: EXTRACT_TOOL,
    });
  } catch (e) {
    console.error("[brd] extract failed:", e);
    return;
  }

  const existingIds = new Set(list.map((r) => r.id));
  const maxPos = list.reduce((m, r) => Math.max(m, r.position), -1);

  if (decision.add?.length) {
    const rows = decision.add
      .filter((r) => r.text && r.text.trim().length > 0)
      .map((r, i) => ({
        text: r.text.trim().slice(0, 200),
        source: r.source,
        status: "planned" as const,
        position: maxPos + 1 + i,
        version_first_seen: opts.versionNum,
      }));
    if (rows.length) await insertReqs(opts.projectId, rows);
  }
  if (decision.mark_done?.length) {
    const ids = decision.mark_done.filter((id) => existingIds.has(id));
    if (ids.length) await updateReqsBulk(ids, { status: "done" });
  }
  if (decision.mark_changed?.length) {
    const ids = decision.mark_changed.filter((id) => existingIds.has(id));
    if (ids.length) await updateReqsBulk(ids, { status: "changed" });
  }
  if (decision.remove?.length) {
    const ids = decision.remove.filter((id) => existingIds.has(id));
    if (ids.length) await updateReqsBulk(ids, { status: "removed" });
  }
}

export async function getRoadmap({ data }: { data: { projectId: string } }) {
  const [requirements, tests] = await Promise.all([
    listReqs(data.projectId),
    listTests(data.projectId, 10),
  ]);
  return { requirements, tests };
}

export async function updateRequirement({
  data,
}: {
  data: { id: string; text?: string; status?: "planned" | "done" | "changed" | "removed" };
}) {
  const patch: Record<string, unknown> = {};
  if (data.text !== undefined) patch.text = data.text;
  if (data.status !== undefined) patch.status = data.status;
  await updateReqRow(data.id, patch);
  return { ok: true };
}

export async function addRequirement({
  data,
}: {
  data: { projectId: string; text: string };
}) {
  const list = await listReqs(data.projectId);
  const maxPos = list.reduce((m, r) => Math.max(m, r.position), -1);
  await insertReqs(data.projectId, [
    {
      text: data.text,
      source: "manual",
      status: "planned",
      position: maxPos + 1,
      version_first_seen: null,
    },
  ]);
  return { ok: true };
}

export async function deleteRequirement({ data }: { data: { id: string } }) {
  await deleteReqRow(data.id);
  return { ok: true };
}
