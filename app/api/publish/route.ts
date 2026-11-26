import { NextResponse } from "next/server";
import { requireSession, requireApiKey } from "@/lib/server/session";
import { inferProvider } from "@/lib/types";
import { generateChatText } from "@/lib/providers/chat";
import {
  PUBLISH_SYSTEM_PROMPT,
  buildPublishUserPrompt,
  parsePublishCopy,
} from "@/lib/prompts/publish";

interface PublishBody {
  model?: string;
  theme?: string;
  platform?: string;
  audience?: string;
  script?: string;
}

export async function POST(req: Request) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "not configured" }, { status: 401 });
  }

  const body = (await req.json()) as PublishBody;
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

  const brief = {
    theme: body.theme?.trim() || "口播视频",
    platform: body.platform?.trim() || "抖音",
    audience: body.audience?.trim() || "",
    script: body.script.trim(),
  };

  try {
    const text = await generateChatText({
      model: body.model,
      apiKey,
      system: PUBLISH_SYSTEM_PROMPT,
      user: buildPublishUserPrompt(brief),
      jsonMode: true,
      signal: req.signal,
    });
    if (!text) {
      return NextResponse.json({ error: "empty response from model" }, { status: 502 });
    }
    const publish = parsePublishCopy(text);
    if (publish.titles.length === 0 && publish.coverTexts.length === 0 && !publish.description) {
      return NextResponse.json({ error: "model returned empty publish copy" }, { status: 502 });
    }
    return NextResponse.json({ publish });
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message) }, { status: 500 });
  }
}
