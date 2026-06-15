import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { callAIWithTool, generateImage } from "./ai.server";
import { slugify } from "./slug";
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
- Each tab should be visually rich, with real interactive content—not placeholders.
- Use semantic, attractive layouts: cards, lists, inputs, buttons styled with .gen-btn-primary and .gen-card.`;

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
        icon_prompt: { type: "string", description: "Prompt for an app icon image, square, flat, modern." },
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
    if (/<\s*(html|head|body)\b/i.test(t.html ?? "")) errs.push(`tab "${t.name}" must not include html/head/body`);
    if (/<script[^>]*src=/i.test(t.html ?? "")) errs.push(`tab "${t.name}" must not load external scripts`);
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
  let spec = await callAIWithTool<AppSpec>({
    model: "google/gemini-3-flash-preview",
    messages,
    tool: TOOL_GENERATE,
  });
  let errs = validateSpec(spec);
  if (errs.length > 0) {
    const retry = await callAIWithTool<AppSpec>({
      model: "google/gemini-3-flash-preview",
      messages: [
        ...messages,
        {
          role: "user",
          content: `Your previous output failed validation:\n${errs.join("\n")}\nProduce a corrected spec.`,
        },
      ],
      tool: TOOL_GENERATE,
    });
    const retryErrs = validateSpec(retry);
    if (retryErrs.length === 0) spec = retry;
  }
  return spec;
}

async function uploadIcon(ownerId: string, projectId: string, prompt: string): Promise<string | null> {
  try {
    const img = await generateImage({
      prompt: `App icon: ${prompt}. Flat, modern, vibrant, single subject centered, no text, square, suitable for mobile home screen.`,
    });
    const path = `${ownerId}/${projectId}.png`;
    const buf = Uint8Array.from(atob(img.base64), (c) => c.charCodeAt(0));
    const { error } = await supabaseAdmin.storage
      .from("app-icons")
      .upload(path, buf, { contentType: img.mimeType, upsert: true });
    if (error) {
      console.error("icon upload", error);
      return null;
    }
    const { data } = supabaseAdmin.storage.from("app-icons").getPublicUrl(path);
    return data.publicUrl;
  } catch (e) {
    console.error("icon gen failed", e);
    return null;
  }
}

export const classifyAndGenerate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ prompt: z.string().min(3).max(100000) }).parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context;

    const spec = await generateSpec(data.prompt);

    const slug = slugify(spec.title);
    const projectId = crypto.randomUUID();

    // Insert project first so we can use id in storage path.
    const { error: projErr } = await supabaseAdmin.from("projects").insert({
      id: projectId,
      owner_id: userId,
      slug,
      title: spec.title,
      prompt: data.prompt,
      template_family: spec.template_family,
      theme: spec.theme,
    });
    if (projErr) throw new Error(projErr.message);

    const { data: versionRow, error: vErr } = await supabaseAdmin
      .from("project_versions")
      .insert({
        project_id: projectId,
        version_num: 1,
        tabs: spec.tabs,
        created_by_message: data.prompt,
      })
      .select("id")
      .single();
    if (vErr) throw new Error(vErr.message);

    const iconUrl = await uploadIcon(userId, projectId, spec.icon_prompt);

    await supabaseAdmin
      .from("projects")
      .update({ current_version_id: versionRow.id, icon_url: iconUrl })
      .eq("id", projectId);

    await supabaseAdmin.from("project_messages").insert([
      { project_id: projectId, role: "user", content: data.prompt },
      {
        project_id: projectId,
        role: "assistant",
        content: `Generated ${spec.title} with ${spec.tabs.length} tabs.`,
        version_id_after: versionRow.id,
      },
    ]);

    return { projectId, slug };
  });

const SYSTEM_CHAT = `You are the AI co-builder of a small mobile web app. You converse naturally with the creator AND can rebuild the app when they ask for changes.

For every user message, return ONE tool call deciding what to do:
- mode="chat": questions, brainstorming, status, clarifications. Write a short, friendly reply (1–4 sentences). Do NOT change the app.
- mode="edit": user is asking for an actual change to the app (add/remove/rename tabs, change behavior, content, theme, etc.). Write a short reply describing what you're going to change (1–3 sentences) and put the actionable instruction in edit_instruction.

Use the conversation history for context. Be concise and friendly. Reference the user's prior messages when helpful.`;

const TOOL_CHAT_ROUTE = {
  type: "function" as const,
  function: {
    name: "emit_response",
    description: "Decide whether to chat or edit the app, and write the assistant reply.",
    parameters: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["chat", "edit"] },
        reply: { type: "string", description: "Assistant message to show in chat (1–4 sentences)." },
        edit_instruction: {
          type: "string",
          description: "Required when mode='edit'. Self-contained instruction to apply to the app spec.",
        },
      },
      required: ["mode", "reply"],
    },
  },
};

export const refineProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ projectId: z.string().uuid(), message: z.string().min(1).max(100000) }).parse(input)
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;

    const { data: project } = await supabaseAdmin
      .from("projects")
      .select("id, owner_id, title, prompt, theme, current_version_id")
      .eq("id", data.projectId)
      .single();
    if (!project || project.owner_id !== userId) throw new Error("Not found");
    if (!project.current_version_id) throw new Error("No current version");

    const { data: current } = await supabaseAdmin
      .from("project_versions")
      .select("tabs, version_num")
      .eq("id", project.current_version_id)
      .single();
    if (!current) throw new Error("No current version");

    // Load recent conversation for context.
    const { data: history } = await supabaseAdmin
      .from("project_messages")
      .select("role, content")
      .eq("project_id", data.projectId)
      .order("created_at", { ascending: true })
      .limit(20);

    const appSummary = `Current app: "${project.title}" with ${(current.tabs as { name: string }[]).length} tab(s): ${
      (current.tabs as { name: string }[]).map((t) => t.name).join(", ")
    }.`;

    const routeMessages = [
      { role: "system" as const, content: `${SYSTEM_CHAT}\n\n${appSummary}` },
      ...((history ?? []).map((m) => ({
        role: (m.role === "assistant" ? "assistant" : "user") as "user" | "assistant",
        content: m.content,
      }))),
      { role: "user" as const, content: data.message },
    ];

    const decision = await callAIWithTool<{
      mode: "chat" | "edit";
      reply: string;
      edit_instruction?: string;
    }>({
      model: "google/gemini-3-flash-preview",
      messages: routeMessages,
      tool: TOOL_CHAT_ROUTE,
    });

    // CHAT mode: just store the exchange and return.
    if (decision.mode === "chat" || !decision.edit_instruction) {
      await supabaseAdmin.from("project_messages").insert([
        { project_id: data.projectId, role: "user", content: data.message },
        { project_id: data.projectId, role: "assistant", content: decision.reply },
      ]);
      return { mode: "chat" as const };
    }

    // EDIT mode: regenerate spec using the instruction + conversation context.
    const editMessages = [
      { role: "system" as const, content: SYSTEM_GENERATE },
      {
        role: "user" as const,
        content: `Existing app spec:\n${JSON.stringify({
          title: project.title,
          theme: project.theme,
          tabs: current.tabs,
        })}\n\nRecent conversation:\n${(history ?? [])
          .slice(-8)
          .map((m) => `${m.role}: ${m.content}`)
          .join("\n")}\n\nUser refinement: ${decision.edit_instruction}\n\nReturn a complete new app spec applying the refinement. Keep prior content unless the user asked to change it.`,
      },
    ];
    let spec = await callAIWithTool<AppSpec>({
      model: "google/gemini-3-flash-preview",
      messages: editMessages,
      tool: TOOL_GENERATE,
    });
    const errs = validateSpec(spec);
    if (errs.length > 0) {
      spec = await callAIWithTool<AppSpec>({
        model: "google/gemini-3-flash-preview",
        messages: [
          ...editMessages,
          { role: "user", content: `Validation failed:\n${errs.join("\n")}\nFix and return again.` },
        ],
        tool: TOOL_GENERATE,
      });
    }

    const newVersionNum = (current.version_num ?? 1) + 1;
    const { data: v, error } = await supabaseAdmin
      .from("project_versions")
      .insert({
        project_id: data.projectId,
        version_num: newVersionNum,
        tabs: spec.tabs,
        created_by_message: data.message,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    await supabaseAdmin
      .from("projects")
      .update({
        current_version_id: v.id,
        title: spec.title,
        theme: spec.theme,
      })
      .eq("id", data.projectId);

    await supabaseAdmin.from("project_messages").insert([
      { project_id: data.projectId, role: "user", content: data.message },
      {
        project_id: data.projectId,
        role: "assistant",
        content: decision.reply,
        version_id_after: v.id,
      },
    ]);

    return { mode: "edit" as const, versionId: v.id };
  });


export const revertToVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ projectId: z.string().uuid(), versionId: z.string().uuid() }).parse(input)
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { data: project } = await supabaseAdmin
      .from("projects")
      .select("owner_id")
      .eq("id", data.projectId)
      .single();
    if (!project || project.owner_id !== userId) throw new Error("Not found");
    const { data: ver } = await supabaseAdmin
      .from("project_versions")
      .select("id")
      .eq("id", data.versionId)
      .eq("project_id", data.projectId)
      .maybeSingle();
    if (!ver) throw new Error("Version not found");
    await supabaseAdmin
      .from("projects")
      .update({ current_version_id: data.versionId })
      .eq("id", data.projectId);
    return { ok: true };
  });

export const updateProjectMeta = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        projectId: z.string().uuid(),
        title: z.string().min(1).max(60).optional(),
        theme: z
          .object({
            primary: z.string().regex(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i),
            background: z.string().regex(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i),
            foreground: z.string().regex(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i),
            accent: z.string().regex(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i),
          })
          .optional(),

        is_published: z.boolean().optional(),
      })
      .parse(input)
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const patch: {
      title?: string;
      theme?: { primary: string; background: string; foreground: string; accent: string };
      is_published?: boolean;
    } = {};
    if (data.title !== undefined) patch.title = data.title;
    if (data.theme !== undefined) patch.theme = data.theme;
    if (data.is_published !== undefined) patch.is_published = data.is_published;

    const { error } = await supabaseAdmin
      .from("projects")
      .update(patch)
      .eq("id", data.projectId)
      .eq("owner_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const regenerateIcon = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ projectId: z.string().uuid(), prompt: z.string().min(3).max(500) }).parse(input)
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { data: project } = await supabaseAdmin
      .from("projects")
      .select("owner_id")
      .eq("id", data.projectId)
      .single();
    if (!project || project.owner_id !== userId) throw new Error("Not found");
    const url = await uploadIcon(userId, data.projectId, data.prompt);
    if (!url) throw new Error("Image generation failed");
    await supabaseAdmin.from("projects").update({ icon_url: url }).eq("id", data.projectId);
    return { iconUrl: url };
  });

export const uploadCustomIcon = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        projectId: z.string().uuid(),
        base64: z.string().min(10).max(10_000_000),
        contentType: z.string().regex(/^image\/(png|jpeg|webp)$/).default("image/png"),
      })
      .parse(input)
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { data: project } = await supabaseAdmin
      .from("projects")
      .select("owner_id")
      .eq("id", data.projectId)
      .single();
    if (!project || project.owner_id !== userId) throw new Error("Not found");

    const ext = data.contentType === "image/jpeg" ? "jpg" : data.contentType === "image/webp" ? "webp" : "png";
    const path = `${userId}/${data.projectId}/${Date.now()}.${ext}`;
    const bytes = Uint8Array.from(atob(data.base64), (c) => c.charCodeAt(0));

    const { error: upErr } = await supabaseAdmin.storage
      .from("app-icons")
      .upload(path, bytes, { contentType: data.contentType, upsert: false });
    if (upErr) throw new Error(upErr.message);

    const { data: pub } = supabaseAdmin.storage.from("app-icons").getPublicUrl(path);
    const iconUrl = pub.publicUrl;

    const { error: updErr } = await supabaseAdmin
      .from("projects")
      .update({ icon_url: iconUrl })
      .eq("id", data.projectId);
    if (updErr) throw new Error(updErr.message);

    return { iconUrl };
  });
