/**
 * DeepSeek adapter.
 *
 * DeepSeek exposes an OpenAI-compatible Chat Completions API, so this file is
 * intentionally a thin copy of the OpenAI provider with a different base URL
 * and model list. Keeping it separate means the two providers can hold
 * different API keys in the session cookie.
 *
 * Only chat models are listed — DeepSeek has no video/image generation, which
 * is fine for this project's script/storyboard MVP.
 */

const BASE = "https://api.deepseek.com/v1";

export const DEEPSEEK_CHAT_MODELS = [
  { name: "deepseek-chat", displayName: "DeepSeek Chat", provider: "deepseek" as const },
] as const;

export async function validateApiKey(apiKey: string): Promise<void> {
  const res = await fetch(`${BASE}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`DeepSeek API key invalid (${res.status}): ${text.slice(0, 200)}`);
  }
}

export interface DeepSeekMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export async function generateContent(args: {
  apiKey: string;
  model: string;
  system?: string;
  messages: DeepSeekMessage[];
  jsonMode?: boolean;
  signal?: AbortSignal;
}): Promise<string> {
  const msgs: DeepSeekMessage[] = [
    ...(args.system ? [{ role: "system" as const, content: args.system }] : []),
    ...args.messages,
  ];
  const body: Record<string, unknown> = {
    model: args.model,
    messages: msgs,
    temperature: 0.7,
  };
  if (args.jsonMode) {
    body.response_format = { type: "json_object" };
  }
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${args.apiKey}`,
    },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: args.signal,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`DeepSeek generateContent ${res.status}: ${text.slice(0, 400)}`);
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return data.choices?.[0]?.message?.content ?? "";
}
