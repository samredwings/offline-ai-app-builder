// App generation + refinement — runs entirely in the browser using the user's AI key.
import { callAIWithTool, generateImageDataUrl } from "./ai-client";
import {
  getProjectRow,
  getVersion,
  insertMessages,
  insertProject,
  insertVersion,
  listMessages,
  newId,
  updateProjectRow,
} from "./local-db";
import { slugify } from "./slug";
import { extractRequirementsForTurn, runStaticTestsForCurrentVersion } from "./roadmap.functions";
import type { AppSpec, Theme } from "./types";

const SYSTEM_GENERATE = `You design small, polished, multi-page mobile web apps for non-technical creators.

Output a single tool call producing an app spec. Rules:
- 2 to 5 tabs, each tab is a single HTML body fragment (NO <html>, <head>, <body>, no <script src=...>).
- Inline <script> blocks are allowed and execute on tab show; keep them short, vanilla JS only.
- Use Tailwind utility classes freely (Tailwind CDN is already loaded). Use the CSS vars --primary, --background, --foreground, --accent for theme colors.
- Use window.appStorage.get(key, fallback) / appStorage.set(key, value) for per-device persistence. Do NOT use any external SDKs, APIs, or imports.
- Never include login/signup, payment forms, fake premium toggles, ads, or analytics.
- Tab icons must be a single emoji.
- Theme colors must be valid hex.
- Each tab should be visually rich, with real interactive content—not placeholders.`;

const TOOL_GENERATE = {
  type: "function" as const,
  function: {
    name: "emit_app_spec",
    description: "Emit the generated multi-page app spec.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        template_family: {
          type: "string",
          enum: ["tracker", "list", "planner", "catalog", "utility", "social-lite"],
        },
        tabs: {
          type: "array",
          minItems: 2,
          maxItems: 5,
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              icon: { type: "string" },
              html: { type: "string" },
            },
            required: ["name", "icon", "html"],
          },
        },
        theme: {
          type: "object",
          properties: {
            primary: { type: "string" },
            background: { type: "string" },
            foreground: { type: "string" },
            accent: { type: "string" },
          },
          required: ["primary", "background", "foreground", "accent"],
        },
        icon_prompt: { type: "string" },
        persistence: { type: "string", enum: ["local", "synced"] },
      },
      required: ["title", "template_family", "tabs", "theme", "icon_prompt", "persistence"],
    },
  },
};

function validateSpec(spec: AppSpec): string[] {
  const errs: string[] = [];
  if (!spec.title || spec.title.length > 60) errs.push("title missing or too long");
  if (!Array.isArray(spec.tabs) || spec.tabs.length < 2 || spec.tabs.length > 5)
    errs.push("must have 2–5 tabs");
  for (const t of spec.tabs ?? []) {
    if (!t.html || t.html.length < 30) errs.push(`tab "${t.name}" html too short`);
    if (/<\s*(html|head|body)\b/i.test(t.html ?? ""))
      errs.push(`tab "${t.name}" must not include html/head/body`);
    if (/<script[^>]*src=/i.test(t.html ?? ""))
      errs.push(`tab "${t.name}" must not load external scripts`);
  }
  for (const k of ["primary", "background", "foreground", "accent"] as (keyof Theme)[]) {
    const v = spec.theme?.[k];
    if (!v || !/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) errs.push(`theme.${k} invalid hex`);
  }
  return errs;
}

async function generateSpec(prompt: string): Promise<AppSpec> {
  const messages = [
    { role: "system" as const, content: SYSTEM_GENERATE },
    { role: "user" as const, content: `App idea: ${prompt}` },
  ];
  let spec = await callAIWithTool<AppSpec>({ messages, tool: TOOL_GENERATE });
  const errs = validateSpec(spec);
  if (errs.length > 0) {
    const retry = await callAIWithTool<AppSpec>({
      messages: [
        ...messages,
        {
          role: "user",
          content: `Your previous output failed validation:\n${errs.join("\n")}\nProduce a corrected spec.`,
        },
      ],
      tool: TOOL_GENERATE,
    });
    if (validateSpec(retry).length === 0) spec = retry;
  }
  return spec;
}

export async function classifyAndGenerate({ data }: { data: { prompt: string } }) {
  const spec = await generateSpec(data.prompt);
  const slug = slugify(spec.title);
  const projectId = newId();
  const versionId = newId();

  await insertProject({
    id: projectId,
    slug,
    title: spec.title,
    prompt: data.prompt,
    template_family: spec.template_family,
    theme: spec.theme,
    icon_url: null,
    is_published: false,
    current_version_id: versionId,
  });
  await insertVersion({
    id: versionId,
    project_id: projectId,
    version_num: 1,
    tabs: spec.tabs,
    created_by_message: data.prompt,
  });

  // Try image gen but don't fail the whole flow.
  let iconUrl: string | null = null;
  try {
    iconUrl = await generateImageDataUrl(
      `App icon: ${spec.icon_prompt}. Flat, modern, vibrant, single subject centered, no text, square.`,
    );
  } catch {
    iconUrl = null;
  }
  if (iconUrl) await updateProjectRow(projectId, { icon_url: iconUrl });

  const firstAssistantReply = `Generated ${spec.title} with ${spec.tabs.length} tabs.`;
  await insertMessages(projectId, [
    { project_id: projectId, role: "user", content: data.prompt },
    { project_id: projectId, role: "assistant", content: firstAssistantReply, version_id_after: versionId },
  ]);

  // Fire-and-forget extras.
  void extractRequirementsForTurn({
    projectId,
    versionNum: 1,
    userMessage: data.prompt,
    assistantReply: firstAssistantReply,
    isFirstTurn: true,
  }).catch(() => {});
  void runStaticTestsForCurrentVersion(projectId).catch(() => {});

  return { projectId, slug };
}

const SYSTEM_CHAT = `You are the AI co-builder of a small mobile web app. You converse naturally with the creator AND can rebuild the app when they ask for changes.

For every user message, return ONE tool call deciding what to do:
- mode="chat": questions, brainstorming, status, clarifications. Write a short, friendly reply (1–4 sentences). Do NOT change the app.
- mode="edit": user is asking for an actual change to the app. Write a short reply describing what you're going to change and put the actionable instruction in edit_instruction.`;

const TOOL_CHAT_ROUTE = {
  type: "function" as const,
  function: {
    name: "emit_response",
    description: "Decide whether to chat or edit the app, and write the assistant reply.",
    parameters: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["chat", "edit"] },
        reply: { type: "string" },
        edit_instruction: { type: "string" },
      },
      required: ["mode", "reply"],
    },
  },
};

export async function refineProject({
  data,
}: {
  data: { projectId: string; message: string };
}) {
  const project = await getProjectRow(data.projectId);
  if (!project) throw new Error("Not found");
  if (!project.current_version_id) throw new Error("No current version");

  const current = await getVersion(data.projectId, project.current_version_id);
  if (!current) throw new Error("No current version");

  const history = (await listMessages(data.projectId)).slice(-20);

  const appSummary = `Current app: "${project.title}" with ${current.tabs.length} tab(s): ${current.tabs
    .map((t) => t.name)
    .join(", ")}.`;

  const routeMessages = [
    { role: "system" as const, content: `${SYSTEM_CHAT}\n\n${appSummary}` },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user" as const, content: data.message },
  ];

  const decision = await callAIWithTool<{
    mode: "chat" | "edit";
    reply: string;
    edit_instruction?: string;
  }>({ messages: routeMessages, tool: TOOL_CHAT_ROUTE });

  if (decision.mode === "chat" || !decision.edit_instruction) {
    await insertMessages(data.projectId, [
      { project_id: data.projectId, role: "user", content: data.message },
      { project_id: data.projectId, role: "assistant", content: decision.reply },
    ]);
    return { mode: "chat" as const };
  }

  const editMessages = [
    { role: "system" as const, content: SYSTEM_GENERATE },
    {
      role: "user" as const,
      content: `Existing app spec:\n${JSON.stringify({
        title: project.title,
        theme: project.theme,
        tabs: current.tabs,
      })}\n\nRecent conversation:\n${history
        .slice(-8)
        .map((m) => `${m.role}: ${m.content}`)
        .join("\n")}\n\nUser refinement: ${decision.edit_instruction}\n\nReturn a complete new app spec applying the refinement. Keep prior content unless the user asked to change it.`,
    },
  ];
  let spec = await callAIWithTool<AppSpec>({ messages: editMessages, tool: TOOL_GENERATE });
  if (validateSpec(spec).length > 0) {
    spec = await callAIWithTool<AppSpec>({
      messages: [
        ...editMessages,
        { role: "user", content: `Validation failed. Fix and return again.` },
      ],
      tool: TOOL_GENERATE,
    });
  }

  const newVersionNum = current.version_num + 1;
  const versionId = newId();
  await insertVersion({
    id: versionId,
    project_id: data.projectId,
    version_num: newVersionNum,
    tabs: spec.tabs,
    created_by_message: data.message,
  });
  await updateProjectRow(data.projectId, {
    current_version_id: versionId,
    title: spec.title,
    theme: spec.theme,
  });
  await insertMessages(data.projectId, [
    { project_id: data.projectId, role: "user", content: data.message },
    { project_id: data.projectId, role: "assistant", content: decision.reply, version_id_after: versionId },
  ]);

  void extractRequirementsForTurn({
    projectId: data.projectId,
    versionNum: newVersionNum,
    userMessage: data.message,
    assistantReply: decision.reply,
    isFirstTurn: false,
  }).catch(() => {});
  void runStaticTestsForCurrentVersion(data.projectId).catch(() => {});

  return { mode: "edit" as const, versionId };
}

export async function revertToVersion({
  data,
}: {
  data: { projectId: string; versionId: string };
}) {
  const v = await getVersion(data.projectId, data.versionId);
  if (!v) throw new Error("Version not found");
  await updateProjectRow(data.projectId, { current_version_id: data.versionId });
  return { ok: true };
}

export async function updateProjectMeta({
  data,
}: {
  data: { projectId: string; title?: string; theme?: Theme; is_published?: boolean };
}) {
  if (data.is_published === true) {
    throw new Error("Publishing is disabled in local-only mode.");
  }
  const patch: Partial<{ title: string; theme: Theme; is_published: boolean }> = {};
  if (data.title !== undefined) patch.title = data.title;
  if (data.theme !== undefined) patch.theme = data.theme;
  if (data.is_published !== undefined) patch.is_published = data.is_published;
  await updateProjectRow(data.projectId, patch);
  return { ok: true };
}

export async function regenerateIcon({
  data,
}: {
  data: { projectId: string; prompt: string };
}) {
  const url = await generateImageDataUrl(
    `App icon: ${data.prompt}. Flat, modern, vibrant, single subject centered, no text, square.`,
  );
  if (!url) {
    throw new Error("Image gen unavailable. Set an image model in Settings.");
  }
  await updateProjectRow(data.projectId, { icon_url: url });
  return { iconUrl: url };
}

export async function uploadCustomIcon({
  data,
}: {
  data: { projectId: string; base64: string; contentType: string };
}) {
  const url = `data:${data.contentType};base64,${data.base64}`;
  await updateProjectRow(data.projectId, { icon_url: url });
  return { iconUrl: url };
}
