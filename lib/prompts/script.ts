export interface ScriptBrief {
  theme: string;
  platform: string;
  audience: string;
  durationSec: number;
  style: string;
}

export interface OralScript {
  title: string;
  hook: string;
  body: string;
  cta: string;
  fullScript: string;
}

export const SCRIPT_SYSTEM_PROMPT = `你是一名资深中文短视频口播编剧，擅长为探店、种草、知识分享、带货类视频写可以直接照着念的口播文案。

## 任务
根据用户给出的主题、平台、目标受众、视频时长和口播风格，写一条完整的口播文案。

## 写作规则
- 全中文，口语化，多用短句；不要书面语、长难句和空泛形容词。
- 开头 3 秒必须有钩子：痛点、反差、利益点或提问，让人愿意继续看。
- 正文讲清 1–3 个具体卖点，用可感知的细节（口感、场景、使用感受），不要堆砌“超好吃”“绝绝子”这类空话。
- 结尾必须有明确的行动引导：到店、点左下角、评论区留言、关注等。
- 按每秒约 4 个汉字控制长度：15 秒约 60–80 字，30 秒约 120–160 字，60 秒约 250–320 字。
- 平台语气：抖音快节奏、口语化；小红书像朋友分享、有种草感；视频号稳重、信息清楚；快手接地气。
- 风格按要求执行：亲切种草 / 专业讲解 / 探店体验 / 搞笑反转。
- 不要编造主题中没有的具体事实（价格、地址、销量、年限、功效承诺）。用户给了才写。
- 不要写镜头、分镜、字幕、BGM 提示，也不要写 emoji 和话题标签。
- 只输出严格 JSON，不要 markdown，不要解释。

## 输出 JSON
{
  "title": "15 字以内的标题",
  "hook": "开头钩子",
  "body": "正文",
  "cta": "结尾行动引导",
  "fullScript": "完整口播文案，按 hook、body、cta 顺序拼接，可直接朗读"
}`;

export function buildScriptUserPrompt(brief: ScriptBrief): string {
  const lengthTarget =
    brief.durationSec <= 15
      ? "60–80 字"
      : brief.durationSec <= 30
        ? "120–160 字"
        : "250–320 字";
  return [
    `主题：${brief.theme}`,
    `发布平台：${brief.platform}`,
    `目标受众：${brief.audience || "普通短视频用户"}`,
    `视频时长：约 ${brief.durationSec} 秒`,
    `口播风格：${brief.style}`,
    `建议正文长度：${lengthTarget}（按每秒约 4 个汉字估算）。`,
  ].join("\n");
}

export function parseOralScript(raw: string): OralScript {
  const cleaned = raw.trim().replace(/^```json\s*|\s*```$/g, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  const jsonText = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
  const data = JSON.parse(jsonText) as Partial<OralScript>;
  const hook = typeof data.hook === "string" ? data.hook.trim() : "";
  const body = typeof data.body === "string" ? data.body.trim() : "";
  const cta = typeof data.cta === "string" ? data.cta.trim() : "";
  const fullScript =
    typeof data.fullScript === "string" && data.fullScript.trim()
      ? data.fullScript.trim()
      : [hook, body, cta].filter(Boolean).join("\n");
  return {
    title: typeof data.title === "string" ? data.title.trim() : "",
    hook,
    body,
    cta,
    fullScript,
  };
}
