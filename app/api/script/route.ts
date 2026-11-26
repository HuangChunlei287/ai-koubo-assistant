import { NextResponse } from "next/server";
import { requireSession, requireApiKey } from "@/lib/server/session";
import { inferProvider } from "@/lib/types";
import { generateChatText } from "@/lib/providers/chat";
import {
  SCRIPT_SYSTEM_PROMPT,
  buildScriptUserPrompt,
  parseOralScript,
} from "@/lib/prompts/script";

interface ScriptBody {
  model?: string;
  theme?: string;
  platform?: string;
  audience?: string;
  durationSec?: number;
  style?: string;
}

export async function POST(req: Request) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "not configured" }, { status: 401 });
  }

  const body = (await req.json()) as ScriptBody;
  if (!body.model || !body.theme?.trim()) {
    return NextResponse.json({ error: "missing model or theme" }, { status: 400 });
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

  const brief = {
    theme: body.theme.trim(),
    platform: body.platform?.trim() || "抖音",
    audience: body.audience?.trim() || "",
    durationSec: Number(body.durationSec) || 30,
    style: body.style?.trim() || "亲切种草",
  };

  try {
    const text = await generateChatText({
      model: body.model,
      apiKey,
      system: SCRIPT_SYSTEM_PROMPT,
      user: buildScriptUserPrompt(brief),
      jsonMode: true,
      signal: req.signal,
    });
    if (!text) {
      return NextResponse.json({ error: "empty response from model" }, { status: 502 });
    }
    const script = parseOralScript(text);
    if (!script.fullScript) {
      return NextResponse.json({ error: "model returned an empty script" }, { status: 502 });
    }
    return NextResponse.json({ script });
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message) }, { status: 500 });
  }
}
