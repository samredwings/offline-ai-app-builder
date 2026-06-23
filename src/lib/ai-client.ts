// Browser-side OpenAI-compatible AI client. Reads the user-provided API key from local settings.
// Supports text + tool calls. No server involved.
import { getSettings } from "./local-settings";

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
};

export type ToolDef = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

function buildUrl(base: string, path: string) {
  return base.replace(/\/+$/, "") + path;
}

export async function callAIWithTool<T>(opts: {
  messages: ChatMessage[];
  tool: ToolDef;
  model?: string;
}): Promise<T> {
  const s = await getSettings();
  if (!s.ai.apiKey) {
    throw new Error("AI API key not set. Open Settings and add your OpenAI-compatible key.");
  }
  const model = opts.model || s.ai.model;
  const res = await fetch(buildUrl(s.ai.baseUrl, "/chat/completions"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${s.ai.apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: opts.messages,
      tools: [opts.tool],
      tool_choice: { type: "function", function: { name: opts.tool.function.name } },
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (res.status === 401) throw new Error("AI: invalid API key. Check Settings.");
    if (res.status === 402) throw new Error("AI: provider says no credits.");
    if (res.status === 429) throw new Error("AI: rate limited. Try again.");
    throw new Error(`AI error ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  const call = data?.choices?.[0]?.message?.tool_calls?.[0];
  if (!call?.function?.arguments) {
    // Some providers return JSON in content instead — try that as a fallback.
    const raw = data?.choices?.[0]?.message?.content;
    if (typeof raw === "string") {
      const match = raw.match(/\{[\s\S]*\}$/);
      if (match) {
        try {
          return JSON.parse(match[0]) as T;
        } catch {
          /* fall through */
        }
      }
    }
    throw new Error("AI did not return a tool call.");
  }
  try {
    return JSON.parse(call.function.arguments) as T;
  } catch {
    throw new Error("AI returned invalid JSON in tool call.");
  }
}

// Returns a data: URL for the generated image, or null if the provider can't do images.
export async function generateImageDataUrl(prompt: string): Promise<string | null> {
  const s = await getSettings();
  if (!s.ai.apiKey || !s.ai.imageModel) return null;
  // OpenAI-style /images/generations.
  const res = await fetch(buildUrl(s.ai.baseUrl, "/images/generations"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${s.ai.apiKey}`,
    },
    body: JSON.stringify({
      model: s.ai.imageModel,
      prompt,
      size: "512x512",
      n: 1,
      response_format: "b64_json",
    }),
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  const b64 = data?.data?.[0]?.b64_json;
  if (b64) return `data:image/png;base64,${b64}`;
  const url = data?.data?.[0]?.url;
  if (typeof url === "string") return url;
  return null;
}
