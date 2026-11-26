import type { PublishCopy } from "@/lib/types";

export interface PublishBrief {
  theme: string;
  platform: string;
  audience: string;
  script: string;
}

export const PUBLISH_SYSTEM_PROMPT = `你是一名资深中文短视频运营和文案策划，负责为一条已经写好的口播视频配发布文案。

## 任务
根据主题、平台、目标受众和口播脚本，生成：
1. 3 个标题候选
2. 3 个封面短句
3. 1 段平台发布描述

## 规则
- 全中文，符合平台语气：抖音口语直接、小红书像朋友分享、视频号稳重、快手接地气。
- 标题：每条不超过 20 个字，突出利益点或好奇心，但不得夸大、不得虚构脚本里没有的事实。
- 封面短句：每条不超过 10 个字，适合压在封面上，短、狠、看得懂。
- 发布描述：50–120 字，概括内容 + 引导行动，结尾附 3–5 个相关话题标签（用 # 开头）。
- 不要编造脚本中没有的价格、地址、销量、年限、功效承诺。
- 不要 emoji。
- 只输出严格 JSON，不要 markdown，不要解释。

## 输出 JSON
{
  "titles": ["标题1", "标题2", "标题3"],
  "coverTexts": ["封面1", "封面2", "封面3"],
  "description": "发布描述 #话题1 #话题2 #话题3"
}`;

export function buildPublishUserPrompt(brief: PublishBrief): string {
  return [
    `主题：${brief.theme}`,
    `发布平台：${brief.platform}`,
    `目标受众：${brief.audience || "普通短视频用户"}`,
    `口播脚本：`,
    brief.script,
  ].join("\n");
}

export function parsePublishCopy(raw: string): PublishCopy {
  const cleaned = raw.trim().replace(/^```json\s*|\s*```$/g, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  const jsonText = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
  const data = JSON.parse(jsonText) as Partial<PublishCopy>;

  const toStrings = (value: unknown, limit: number): string[] => {
    if (!Array.isArray(value)) return [];
    return value
      .filter((x): x is string => typeof x === "string")
      .map((x) => x.trim())
      .filter(Boolean)
      .slice(0, limit);
  };

  return {
    titles: toStrings(data.titles, 3),
    coverTexts: toStrings(data.coverTexts, 3),
    description: typeof data.description === "string" ? data.description.trim() : "",
  };
}
