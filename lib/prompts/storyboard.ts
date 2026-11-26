import type { Storyboard } from "@/lib/types";

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  "en-US": "English",
  "en-GB": "English",
  zh: "简体中文",
  "zh-CN": "简体中文",
  "zh-TW": "繁體中文",
  ja: "日本語",
  ko: "한국어",
  fr: "Français",
  de: "Deutsch",
  es: "Español",
};

export function languageName(tag?: string): string {
  if (!tag) return "脚本原文语言";
  return LANGUAGE_NAMES[tag] ?? tag;
}

export const STORYBOARD_SYSTEM_PROMPT = `你是一名资深短视频口播导演和拍摄指导，负责把一段口播文案拆解成真人可以照着拍的分镜脚本。

## 输出语言（critical）
- 除 dialogue 和 subtitle 外，所有字段必须使用简体中文：summary、camera、composition、ambiance、sfx、continuityHint、veoPrompt、keywords、detectedStyle。
- dialogue 和 subtitle 必须逐字保留原文，不得改写、翻译、增删或润色。
- 如果用户指定了台词语言，dialogue/subtitle 使用该语言；其余描述字段仍用简体中文。

## 分镜规则
- index 从 1 开始连续编号（1, 2, 3…），绝不能出现 0。
- 每个镜头 2–8 秒；durationSec 只能从 allowedDurations 里选，且不超过单镜头最大时长。
- 按用户给出的“目标视频总时长”规划镜头数量：所有 durationSec 之和应接近目标（±2 秒；60 秒允许 ±4 秒），不要只按单镜头最大值分配。
- 不要所有镜头同一时长，按台词长度自然分配。
- 按语义断句：一个镜头讲 1–2 句，不要从句子中间硬切。
- 镜头要交替：出镜口播、产品/菜品特写、使用演示、环境空镜、字幕卡。不要连续 3 个以上纯出镜镜头。
- 第一个镜头要有钩子：近景或特写 + 直接抛问题/利益点。最后一个镜头要有行动引导（到店、点左下角、评论区留言等）。
- 9:16 竖屏：主体居中偏上，下方留出字幕和贴纸空间；16:9 横屏：注意左右构图。

## 每个字段怎么写
- summary：一句话说明这个镜头拍什么（中文）。
- camera：景别 + 机位/运镜，例如“中景，固定机位，轻微推近”“特写，手持跟拍”。
- composition：主体位置、前景、背景，例如“人物居中，背景是沸腾的火锅，前景有毛肚”。
- ambiance：场景、光线、氛围，例如“暖色灯光，店内烟火气”。
- dialogue：必须是数组，格式为 [{"speaker":"主持人","line":"台词原文"}]，每个镜头至少一条；绝不能写成一个字符串。台词逐字保留。
- subtitle：与台词逐字一致；如果字幕关闭则留空字符串。
- keywords：从本镜头台词中挑 1–3 个需要字幕强调的原词（价格、数字、卖点、行动词），不要造词。
- sfx：环境音/音效建议（中文），没有就返回空数组。
- continuityHint：与前后镜头的衔接提示（服装、道具、位置、光线保持一致）。
- veoPrompt：给拍摄者的中文执行提示，写清动作、道具、机位、字幕/贴纸建议；不要写英文，不要提 Veo。

## OUTPUT CONTRACT (critical)
- 每个 shot 必须包含全部字段，即使为空也要保留：index、durationSec、summary、veoPrompt、dialogue、sfx、camera、composition、ambiance、subtitle、keywords。缺字段视为错误。
- dialogue 必须是数组：[{"speaker":"主持人","line":"台词原文"}]，不能是字符串。
- 顶层必须包含：detectedStyle、language、totalDurationSec、shots。
- 只输出严格 JSON，不要 markdown，不要解释。`;

export interface BuildPromptArgs {
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
  history?: { role: "user" | "assistant"; text: string }[];
  referenceImageNames?: string[];
}

export function buildStoryboardUserPrompt(args: BuildPromptArgs): string {
  const refLine =
    args.referenceImageNames && args.referenceImageNames.length > 0
      ? `参考图（1-based）：${args.referenceImageNames
          .map((n, i) => `${i + 1}. ${n}`)
          .join(" | ")}。若某个镜头需要参考图，设置 referenceImageIndex；不需要则省略。`
      : ``;
  return [
    `允许的单镜头时长：[${args.allowedDurations.join(", ")}]。单镜头最长 ${args.durationSec} 秒。`,
    args.targetDurationSec
      ? `目标视频总时长：约 ${args.targetDurationSec} 秒。建议镜头数量约 ${Math.max(3, Math.round(args.targetDurationSec / 6))} 个；请让所有镜头 durationSec 之和接近该值（±2 秒；60 秒允许 ±4 秒）。`
      : ``,
    `画幅：${args.aspectRatio}。`,
    args.platform
      ? `发布平台：${args.platform}；目标受众：${args.audience || "普通短视频用户"}；口播风格：${args.style || "亲切种草"}。`
      : ``,
    `字幕：${args.withSubtitle ? "开启 — 每个镜头都要填写 subtitle。" : "关闭 — subtitle 留空字符串。"}`,
    args.language
      ? `台词/字幕语言：${args.language}（${languageName(args.language)}）。dialogue 和 subtitle 必须逐字保留该语言原文，不得翻译；其余描述字段一律用简体中文。`
      : `台词/字幕语言：保持脚本文案原文，不得翻译；其余描述字段一律用简体中文。`,
    refLine,
    ``,
    `=== 口播文案 ===`,
    args.script,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Gemini responseSchema (subset of OpenAPI). Gemini does not support full JSON Schema. */
export const STORYBOARD_RESPONSE_SCHEMA = {
  type: "object",
  required: ["detectedStyle", "language", "totalDurationSec", "shots"],
  properties: {
    detectedStyle: { type: "string" },
    language: { type: "string" },
    totalDurationSec: { type: "integer" },
    shots: {
      type: "array",
      items: {
        type: "object",
        required: [
          "index",
          "durationSec",
          "summary",
          "veoPrompt",
          "dialogue",
          "sfx",
          "camera",
          "composition",
          "ambiance",
          "keywords",
        ],
        properties: {
          index: { type: "integer" },
          durationSec: { type: "integer" },
          summary: { type: "string" },
          veoPrompt: { type: "string" },
          dialogue: {
            type: "array",
            items: {
              type: "object",
              required: ["speaker", "line"],
              properties: {
                speaker: { type: "string" },
                line: { type: "string" },
              },
            },
          },
          sfx: { type: "array", items: { type: "string" } },
          camera: { type: "string" },
          composition: { type: "string" },
          ambiance: { type: "string" },
          subtitle: { type: "string" },
          keywords: { type: "array", items: { type: "string" } },
          continuityHint: { type: "string" },
          referenceImageIndex: { type: "integer" },
        },
      },
    },
  },
} as const;

export function parseStoryboard(raw: string): Storyboard {
  const cleaned = raw.trim().replace(/^```json\s*|\s*```$/g, "");
  return JSON.parse(cleaned) as Storyboard;
}
