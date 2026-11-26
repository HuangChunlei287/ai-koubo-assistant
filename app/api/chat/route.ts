import { NextResponse } from "next/server";
import { requireSession, requireApiKey } from "@/lib/server/session";
import { generateContent as geminiGenerateContent } from "@/lib/providers/gemini";
import { generateContent as openaiGenerateContent } from "@/lib/providers/openai";
import { generateContent as anthropicGenerateContent } from "@/lib/providers/anthropic";
import { generateContent as deepseekGenerateContent } from "@/lib/providers/deepseek";
import {
  STORYBOARD_SYSTEM_PROMPT,
  STORYBOARD_RESPONSE_SCHEMA,
  buildStoryboardUserPrompt,
  parseStoryboard,
  languageName,
} from "@/lib/prompts/storyboard";
import type { Shot, Storyboard } from "@/lib/types";
import { inferProvider } from "@/lib/types";

interface RefImage {
  name: string;
  mimeType: string;
  bytesBase64Encoded: string;
}

interface ChatBody {
  model: string;
  script: string;
  /** Max duration of a single shot. */
  durationSec: number;
  /** Target total duration of the whole video. */
  targetDurationSec?: number;
  allowedDurations: number[];
  aspectRatio: "16:9" | "9:16";
  withSubtitle: boolean;
  language?: string;
  platform?: string;
  audience?: string;
  style?: string;
  history?: { role: "user" | "assistant"; content: string }[];
  referenceImages?: RefImage[];
}

const MAX_REFERENCE_IMAGES = 3;

/** Call the appropriate chat provider and return raw JSON text. */
async function callChatModel(args: {
  model: string;
  apiKey: string;
  systemPrompt: string;
  userText: string;
  history: { role: "user" | "assistant"; content: string }[];
  refs: RefImage[];
  signal?: AbortSignal;
}): Promise<string> {
  const provider = inferProvider(args.model);

  if (provider === "gemini") {
    const userParts: Array<
      { text: string } | { inlineData: { mimeType: string; data: string } }
    > = [{ text: args.userText }];
    for (const r of args.refs) {
      userParts.push({ inlineData: { mimeType: r.mimeType, data: r.bytesBase64Encoded } });
    }
    const contents = [
      ...args.history.map((h) => ({
        role: h.role === "assistant" ? "model" : "user",
        parts: [{ text: h.content }],
      })),
      { role: "user", parts: userParts },
    ];
    const raw = (await geminiGenerateContent({
      apiKey: args.apiKey,
      model: args.model,
      contents,
      systemInstruction: { parts: [{ text: args.systemPrompt }] },
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: STORYBOARD_RESPONSE_SCHEMA,
        temperature: 0.7,
      },
      signal: args.signal,
    })) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    return raw.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ?? "";
  }

  // For OpenAI and Anthropic, build a plain text conversation (no multimodal refs)
  const historyMsgs = args.history.map((h) => ({
    role: h.role as "user" | "assistant",
    content: h.content,
  }));
  const userMsg = { role: "user" as const, content: args.userText };

  if (provider === "openai" || provider === "deepseek") {
    const generate =
      provider === "openai" ? openaiGenerateContent : deepseekGenerateContent;
    return generate({
      apiKey: args.apiKey,
      model: args.model,
      system: args.systemPrompt,
      messages: [...historyMsgs, userMsg],
      jsonMode: true,
      signal: args.signal,
    });
  }

  if (provider === "anthropic") {
    return anthropicGenerateContent({
      apiKey: args.apiKey,
      model: args.model,
      system: args.systemPrompt,
      messages: [...historyMsgs, userMsg],
      signal: args.signal,
    });
  }

  throw new Error(`Provider "${provider}" does not support chat`);
}

export async function POST(req: Request) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "not configured" }, { status: 401 });
  }
  const body = (await req.json()) as ChatBody;
  if (!body.model || !body.script?.trim()) {
    return NextResponse.json({ error: "missing model or script" }, { status: 400 });
  }

  const provider = inferProvider(body.model);
  let apiKey: string;
  try {
    apiKey = requireApiKey(session, provider);
  } catch {
    return NextResponse.json(
      { error: `Provider "${provider}" is not configured. Please add an API key in Settings.` },
      { status: 401 }
    );
  }

  const refs = (body.referenceImages ?? []).slice(0, MAX_REFERENCE_IMAGES);
  const allowedDurations = body.allowedDurations?.length ? body.allowedDurations : [4, 6, 8];
  const target = Number(body.targetDurationSec);
  const targetDurationSec = Number.isFinite(target) && target > 0 ? target : undefined;

  const userText = buildStoryboardUserPrompt({
    script: body.script,
    durationSec: body.durationSec,
    targetDurationSec,
    allowedDurations,
    aspectRatio: body.aspectRatio,
    withSubtitle: body.withSubtitle,
    language: body.language,
    platform: body.platform,
    audience: body.audience,
    style: body.style,
    referenceImageNames: refs.map((r) => r.name),
  });

  try {
    const text = await callChatModel({
      model: body.model,
      apiKey,
      systemPrompt: STORYBOARD_SYSTEM_PROMPT,
      userText,
      history: body.history ?? [],
      refs,
      signal: req.signal,
    });
    if (!text) {
      return NextResponse.json({ error: "empty response from model" }, { status: 502 });
    }
    let storyboard = parseStoryboard(text);

    if (process.env.NODE_ENV !== "production") {
      console.log("[storyboard] first-pass raw:", text.slice(0, 4000));
    }

    // MVP uses a single generation pass: cheaper, and the old review pass was
    // tuned for the film/Veo prompt. Revisit once the oral-broadcast prompt
    // has been validated with real users.

    storyboard = normalizeStoryboard(storyboard, {
      language: body.language,
      withSubtitle: body.withSubtitle,
      allowedDurations,
      maxDurationSec: body.durationSec,
      targetDurationSec,
    });

    if (process.env.NODE_ENV !== "production") {
      console.log("[storyboard] normalized:", JSON.stringify(storyboard).slice(0, 4000));
    }

    return NextResponse.json({ storyboard, rawText: text });
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message) }, { status: 500 });
  }
}

interface RawDialogue {
  speaker?: unknown;
  line?: unknown;
  text?: unknown;
}

/**
 * DeepSeek sometimes returns dialogue as a plain string or an array of strings
 * instead of [{ speaker, line }]. Accept all three shapes so a minor schema
 * drift does not wipe the script from the UI.
 */
function coerceDialogue(raw: unknown): { speaker: string; line: string }[] {
  const parseOne = (item: unknown): { speaker: string; line: string } | null => {
    if (typeof item === "string") {
      const line = item.trim();
      return line ? { speaker: "主持人", line } : null;
    }
    if (item && typeof item === "object") {
      const o = item as RawDialogue;
      const line = typeof o.line === "string" ? o.line : typeof o.text === "string" ? o.text : "";
      if (!line.trim()) return null;
      const speaker =
        typeof o.speaker === "string" && o.speaker.trim() ? o.speaker.trim() : "主持人";
      return { speaker, line: line.trim() };
    }
    return null;
  };

  if (typeof raw === "string") {
    const line = raw.trim();
    return line ? [{ speaker: "主持人", line }] : [];
  }
  if (Array.isArray(raw)) {
    return raw
      .map(parseOne)
      .filter((d): d is { speaker: string; line: string } => d !== null);
  }
  return [];
}

function coerceStringArray(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw
      .filter((x): x is string => typeof x === "string")
      .map((x) => x.trim())
      .filter(Boolean);
  }
  if (typeof raw === "string") {
    return raw
      .split(/[,，、/|]/)
      .map((x) => x.trim())
      .filter(Boolean);
  }
  return [];
}

/**
 * Nudge shot durations until their sum is close to the user's target total.
 * The model is asked to do this, but JSON-mode models often ignore the total
 * and just assign each shot a duration. We adjust the shots that can afford
 * it (short dialogue shrinks first, long dialogue grows first) without
 * changing the dialogue or the shot order.
 */
function fitDurations(
  shots: Shot[],
  allowedDurations: number[],
  maxDurationSec: number,
  targetDurationSec?: number
): Shot[] {
  if (!targetDurationSec || targetDurationSec <= 0) return shots;

  const allowed = [...new Set(allowedDurations)]
    .filter((d) => d > 0 && d <= maxDurationSec)
    .sort((a, b) => a - b);
  if (allowed.length === 0) return shots;

  const tolerance = targetDurationSec >= 60 ? 4 : 2;
  const out = shots.map((s) => ({ ...s }));
  const dialogueLength = (s: Shot) =>
    s.dialogue.reduce((n, d) => n + d.line.length, 0);
  const total = () => out.reduce((sum, s) => sum + s.durationSec, 0);

  for (let guard = 0; guard < 100; guard++) {
    const sum = total();
    if (sum > targetDurationSec + tolerance) {
      const candidates = out
        .filter((s) => allowed.indexOf(s.durationSec) > 0)
        .sort((a, b) => {
          const da = dialogueLength(a);
          const db = dialogueLength(b);
          if (da !== db) return da - db;
          return b.durationSec - a.durationSec;
        });
      if (candidates.length === 0) break;
      const s = candidates[0];
      s.durationSec = allowed[allowed.indexOf(s.durationSec) - 1];
      continue;
    }
    if (sum < targetDurationSec - tolerance) {
      const candidates = out
        .filter((s) => {
          const i = allowed.indexOf(s.durationSec);
          return i >= 0 && i < allowed.length - 1;
        })
        .sort((a, b) => {
          const da = dialogueLength(a);
          const db = dialogueLength(b);
          if (da !== db) return db - da;
          return a.durationSec - b.durationSec;
        });
      if (candidates.length === 0) break;
      const s = candidates[0];
      s.durationSec = allowed[allowed.indexOf(s.durationSec) + 1];
      continue;
    }
    break;
  }

  return out;
}

/**
 * Deterministic post-processing. LLMs (especially in plain JSON mode) may omit
 * keys, use 0-based indexes, or drop top-level metadata, so repair everything
 * here instead of trusting the model's output shape. Also guarantees that
 *  - subtitle == verbatim join of dialogue lines (when subtitles enabled)
 *  - veoPrompt ends with `The {speaker} says in {LanguageName}: "<verbatim line>"`
 *    appended for every dialogue line that isn't already present verbatim.
 */
function normalizeStoryboard(
  sb: Storyboard,
  opts: {
    language?: string;
    withSubtitle: boolean;
    allowedDurations: number[];
    maxDurationSec: number;
    targetDurationSec?: number;
  }
): Storyboard {
  const langName = languageName(opts.language);
  const fallbackDuration =
    opts.allowedDurations.find((d) => d <= opts.maxDurationSec) ??
    opts.allowedDurations[0] ??
    4;

  const rawShots = Array.isArray(sb?.shots) ? sb.shots : [];
  const shots: Shot[] = rawShots.map((shot, i) => {
    const dialogues = coerceDialogue(shot.dialogue);

    const duration = Number(shot.durationSec);
    const durationSec = opts.allowedDurations.includes(duration)
      ? duration
      : fallbackDuration;

    let veoPrompt = typeof shot.veoPrompt === "string" ? shot.veoPrompt : "";
    const missing: string[] = [];
    for (const d of dialogues) {
      if (!veoPrompt.includes(d.line)) {
        missing.push(`The ${d.speaker} says in ${langName}: "${d.line}"`);
      }
    }
    if (missing.length > 0) {
      veoPrompt = veoPrompt.replace(/\s+$/, "");
      const sep = veoPrompt && !/[.!?]$/.test(veoPrompt) ? ". " : " ";
      veoPrompt = `${veoPrompt}${veoPrompt ? sep : ""}${missing.join(" Then ")}.`;
    }

    return {
      ...shot,
      index: i + 1,
      durationSec,
      summary: typeof shot.summary === "string" ? shot.summary : "",
      camera: typeof shot.camera === "string" ? shot.camera : "",
      composition: typeof shot.composition === "string" ? shot.composition : "",
      ambiance: typeof shot.ambiance === "string" ? shot.ambiance : "",
      sfx: coerceStringArray(shot.sfx),
      dialogue: dialogues,
      veoPrompt,
      subtitle: opts.withSubtitle ? dialogues.map((d) => d.line).join(" ") : "",
      keywords: coerceStringArray(shot.keywords).slice(0, 3),
    };
  });

  const fittedShots = fitDurations(
    shots,
    opts.allowedDurations,
    opts.maxDurationSec,
    opts.targetDurationSec
  );
  const totalDurationSec = fittedShots.reduce((sum, s) => sum + s.durationSec, 0);

  if (process.env.NODE_ENV !== "production" && opts.targetDurationSec) {
    console.log(
      "[storyboard] duration target/actual:",
      opts.targetDurationSec,
      totalDurationSec
    );
  }

  return {
    detectedStyle:
      typeof sb?.detectedStyle === "string" && sb.detectedStyle.trim()
        ? sb.detectedStyle
        : "口播",
    language:
      typeof sb?.language === "string" && sb.language.trim()
        ? sb.language
        : opts.language || "zh-CN",
    totalDurationSec,
    shots: fittedShots,
  };
}
