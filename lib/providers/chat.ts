import { inferProvider } from "@/lib/types";
import { generateContent as geminiGenerateContent } from "@/lib/providers/gemini";
import { generateContent as openaiGenerateContent } from "@/lib/providers/openai";
import { generateContent as anthropicGenerateContent } from "@/lib/providers/anthropic";
import { generateContent as deepseekGenerateContent } from "@/lib/providers/deepseek";

/**
 * Generic single-turn chat helper for features other than storyboard splitting
 * (e.g. theme → oral script). The storyboard route keeps its own dispatcher
 * because it needs Gemini's responseSchema.
 */
export async function generateChatText(args: {
  model: string;
  apiKey: string;
  system: string;
  user: string;
  jsonMode?: boolean;
  signal?: AbortSignal;
}): Promise<string> {
  const provider = inferProvider(args.model);

  if (provider === "gemini") {
    const raw = (await geminiGenerateContent({
      apiKey: args.apiKey,
      model: args.model,
      contents: [{ role: "user", parts: [{ text: args.user }] }],
      systemInstruction: { parts: [{ text: args.system }] },
      generationConfig: {
        temperature: 0.8,
        responseMimeType: args.jsonMode ? "application/json" : "text/plain",
      },
      signal: args.signal,
    })) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    return raw.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  }

  if (provider === "openai" || provider === "deepseek") {
    const generate =
      provider === "openai" ? openaiGenerateContent : deepseekGenerateContent;
    return generate({
      apiKey: args.apiKey,
      model: args.model,
      system: args.system,
      messages: [{ role: "user", content: args.user }],
      jsonMode: args.jsonMode,
      signal: args.signal,
    });
  }

  if (provider === "anthropic") {
    return anthropicGenerateContent({
      apiKey: args.apiKey,
      model: args.model,
      system: args.system,
      messages: [{ role: "user", content: args.user }],
      signal: args.signal,
    });
  }

  throw new Error(`Provider "${provider}" does not support chat`);
}
