# AI 口播创作助手

面向短视频口播创作者的轻量级网页 Demo：从主题输入开始，生成口播脚本、拍摄分镜、字幕重点词和发布文案。

> 本项目基于开源项目 [reaink/script2video](https://github.com/reaink/script2video)（MIT License）二次开发，原项目版权归原作者所有。改造说明见下方「与原项目的关系」。

---

## 功能

| 模块 | 输入 | 输出 |
|------|------|------|
| 创作需求 | 主题、平台、目标受众、视频时长、口播风格 | 结构化创作需求 |
| 口播脚本 | 创作需求 | 钩子、正文、行动引导，可直接编辑后提交 |
| 拍摄分镜 | 口播脚本 | 镜头序号、时长、画面建议、构图、氛围、台词、字幕、重点词、拍摄提示 |
| 发布文案 | 脚本 + 平台 | 3 个标题候选、3 个封面短句、1 段平台描述 |
| 剪辑衔接 | 分镜 | 导出 SRT 字幕、CSV 拍摄清单（可导入剪映 / 开拍） |
| 复制 | 分镜 / 发布文案 | 一键复制为纯文本 |

MVP **不做**真实视频剪辑、数字人、自动配音、素材库、账号发布。原项目的视频生成代码保留但不在界面暴露。

---

## 技术栈

- **框架**：Next.js 16（App Router）+ TypeScript
- **UI**：HeroUI v3 + Tailwind CSS v4
- **状态 / 存储**：Zustand + IndexedDB（本地会话）
- **模型**：DeepSeek（OpenAI 兼容接口）；同时保留 Gemini / OpenAI / Anthropic 适配
- **密钥**：服务端 AES-256-GCM 加密后写入 HttpOnly cookie，不落浏览器存储

---

## 本地运行

### 1. 环境要求

- Node.js 20+
- 一个模型 API Key（推荐 DeepSeek，国内直连）

### 2. 安装

```bash
npm install
```

### 3. 配置会话密钥

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

把输出写入项目根目录的 `.env.local`：

```
SESSION_SECRET=你的64位十六进制字符串
```

### 4. 启动

```bash
npm run dev
```

浏览器打开 [http://localhost:3000](http://localhost:3000)。

### 5. 配置模型 Key

打开 [http://localhost:3000/settings](http://localhost:3000/settings)，在 **DeepSeek** 卡片填入 API Key，点「保存并验证」。

DeepSeek Key 申请地址：[platform.deepseek.com/api_keys](https://platform.deepseek.com/api_keys)

---

## 使用流程

1. 首页左侧「① 创作需求」填写主题、平台、受众、时长、风格
2. 点「生成口播脚本」，脚本会出现在下方输入框，可先修改
3. 点「提交」，生成拍摄分镜
4. 在分镜卡片底部点「生成发布文案」，获得标题、封面短句和平台描述
5. 点「导出 SRT 字幕」和「导出拍摄清单」，导入剪映 / 开拍或发给拍摄者
6. 用「复制全部分镜」「复制发布文案」交给拍摄或运营

---

## 项目结构

```
app/
  api/
    script/route.ts        # 主题 → 口播脚本
    chat/route.ts          # 脚本 → 拍摄分镜（含字段规范化）
    publish/route.ts       # 脚本 → 发布文案
    settings/route.ts      # 多提供商 API Key 保存 / 校验
    models/route.ts        # 聚合可用模型
components/
  ChatWorkspace.tsx        # 主界面：创作需求、参数、对话、分镜
  SessionsPanel.tsx        # 本地会话
  Navbar.tsx
lib/
  prompts/
    script.ts              # 口播脚本提示词
    storyboard.ts          # 中文口播分镜提示词 + 输出 schema
    publish.ts             # 发布文案提示词
  providers/
    chat.ts                # 通用单轮对话分发
    deepseek.ts            # DeepSeek 适配（OpenAI 兼容）
    gemini.ts / openai.ts / anthropic.ts
  server/session.ts        # 加密 cookie 会话
  utils/vtt.ts             # SRT / WebVTT 字幕工具
  utils/exportPlan.ts      # 拍摄清单 CSV / 文本下载
  types.ts                 # 核心类型
```

---

## 与原项目的关系

原项目 **Script2Video** 是一个英文优先的「剧本 → AI 视频分镜」工具，核心提示词面向 Gemini 强 schema 和 Veo 视频生成。本项目在其基础上做了以下改造：

1. **新增「主题 → 口播脚本」**：原项目只接受现成剧本，本版本新增创作需求表单和脚本生成接口
2. **重写分镜提示词**：从英文电影/Veo 分镜改为中文口播拍摄指导，输出镜头、构图、氛围、台词、字幕、重点词、拍摄提示
3. **新增字幕重点词**：每个镜头从台词中提取 1–3 个强调词
4. **新增发布文案**：标题候选、封面短句、平台描述
5. **新增 DeepSeek 供应商适配**：原项目只支持 Gemini / OpenAI / Anthropic；DeepSeek 使用 OpenAI 兼容接口，代码见 `lib/providers/deepseek.ts`
6. **增加服务端字段规范化**：DeepSeek 的 JSON 模式不保证嵌套结构完整，服务端会修复序号、缺字段、字符串型 dialogue 等问题
7. **隐藏视频渲染入口**：保留原代码，MVP 不暴露视频生成、参考图、首帧合成等功能
8. **UI 中文化与产品改名**

> 原项目 MIT License，Copyright (c) 2026 reaink。本项目保留原 LICENSE 文件，并在本 README 中说明来源。

---

## 已知限制

- 依赖第三方模型 API，生成速度和质量受模型影响
- DeepSeek 的 JSON 模式偶尔不遵守嵌套结构，服务端已做兼容，但仍可能出现字段缺失
- 发布文案为实验功能，没有接入任何平台发布 API
- 目前只支持本地单用户，无账号体系、无云端存储
- 视频生成代码保留但未在 UI 暴露
- **真实用户访谈、8 条测试用例执行、3 名用户反馈尚未完成**，相关文档见 `docs/`

---

## 开发命令

```bash
npm run dev      # 开发服务器
npm run build    # 生产构建
npm run lint     # ESLint
npx tsc --noEmit # 类型检查
```

---

## License

MIT License. 原项目 Copyright (c) 2026 reaink；本项目的修改部分同样以 MIT License 发布。详见 [LICENSE](LICENSE)。
