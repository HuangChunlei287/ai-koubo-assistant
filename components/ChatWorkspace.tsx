"use client";

import {
  Button,
  Card,
  Chip,
  Input,
  Label,
  ListBox,
  Select,
  Spinner,
  Switch,
  TextArea,
  toast,
} from "@heroui/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Key } from "react";
import { useSessionsStore } from "@/lib/stores/sessions";
import { SessionsPanel } from "@/components/SessionsPanel";
import type { CreativeBrief, GeminiModel, PublishCopy, Storyboard } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
import { buildFullSrt } from "@/lib/utils/vtt";
import {
  buildShotListCsv,
  downloadTextFile,
  safeFileName,
} from "@/lib/utils/exportPlan";
import {
  Check,
  Copy,
  Download,
  FileSpreadsheet,
  RefreshCw,
  RotateCcw,
  Send,
} from "lucide-react";

type Models = { chat: GeminiModel[]; video: GeminiModel[]; image: GeminiModel[] };

interface UiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  storyboard?: Storyboard;
  /** The user script this storyboard was generated from (for publish copy). */
  sourceScript?: string;
  /** The creative brief used for this storyboard (target duration / platform). */
  sourceBrief?: CreativeBrief;
}

type Brief = CreativeBrief;

const SETTINGS_KEY = "s2v_ui_settings_v2";
interface UiSettings {
  chatModel?: string;
  videoModel?: string;
  imageModel?: string;
  aspectRatio: "16:9" | "9:16";
  durationSec: number;
  withSubtitle: boolean;
  withReferenceFrames: boolean;
  /** Sequential mode: chain previous shot's last frame as next shot's first frame. */
  chainFrames: boolean;
  concurrency: number;
  autoContinue: boolean;
  language: string;
}
const DEFAULT_SETTINGS: UiSettings = {
  aspectRatio: "9:16",
  durationSec: 8,
  withSubtitle: true,
  withReferenceFrames: true,
  chainFrames: true,
  concurrency: 1,
  autoContinue: true,
  language: "zh-CN",
};

function loadUiSettings(): UiSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function deriveSessionTitle(messages: UiMessage[], defaultTitle: string): string {
  const first = messages.find((m) => m.role === "user");
  if (!first) return defaultTitle;
  const t = first.content.trim().split(/\s+/).slice(0, 6).join(" ");
  return t.length > 40 ? `${t.slice(0, 40)}…` : t || defaultTitle;
}

function pickPreferred(list: GeminiModel[], preferred: string[]): string | undefined {
  for (const p of preferred) {
    if (list.some((m) => m.name === p)) return p;
  }
  return undefined;
}

export function ChatWorkspace() {
  const [models, setModels] = useState<Models | null>(null);
  const [loadingModels, setLoadingModels] = useState(true);
  // Always start with DEFAULT_SETTINGS so server and client render identically.
  // useEffect below patches in the persisted values after hydration.
  const [settings, setSettings] = useState<UiSettings>(DEFAULT_SETTINGS);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [brief, setBrief] = useState<Brief>({
    theme: "",
    platform: "抖音",
    audience: "",
    durationSec: 30,
    style: "亲切种草",
  });
  const [generatingScript, setGeneratingScript] = useState(false);
  const themeRef = useRef<HTMLTextAreaElement | null>(null);
  const { t } = useI18n();

  const sessionsLoaded = useSessionsStore((s) => s.loaded);
  const sessionsList = useSessionsStore((s) => s.sessions);
  const activeId = useSessionsStore((s) => s.activeId);
  const loadSessions = useSessionsStore((s) => s.load);
  const newSession = useSessionsStore((s) => s.newSession);
  const saveActive = useSessionsStore((s) => s.saveActive);
  /** Tracks the id we last hydrated from to avoid clobbering pending edits. */
  const hydratedIdRef = useRef<string | null>(null);

  // Boot sessions: load IDB, ensure there is at least one active session.
  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    if (!sessionsLoaded) return;
    if (!activeId) {
      // Will trigger the hydrate effect below on the next tick.
      newSession();
    }
  }, [sessionsLoaded, activeId, newSession]);

  // Core fetch logic — extracted so both submit() and auto-resubmit can call it.
  const doFetchStoryboard = useCallback(async (script: string, historyMessages: UiMessage[]) => {
    if (!settings.chatModel) {
      toast.warning(t.toastNoChatModel);
      return;
    }
    const m = settings.videoModel ?? "";
    const durations: number[] = m.includes("lite") ? [5, 6, 8] : m.includes("veo-3.0") ? [8] : [4, 6, 8];
    setSubmitting(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: settings.chatModel,
          script,
          durationSec: settings.durationSec,
          targetDurationSec: brief.durationSec,
          allowedDurations: durations,
          aspectRatio: settings.aspectRatio,
          withSubtitle: settings.withSubtitle,
          language: settings.language,
          platform: brief.platform,
          audience: brief.audience,
          style: brief.style,
          history: historyMessages.map((h) => ({ role: h.role, content: h.content })),
          referenceImages: [],
        }),
      });
      const d = await res.json();
      if (!res.ok) {
        toast.danger(t.toastSplitFailed, { description: d.error });
        setMessages((prev) => [
          ...prev,
          { id: crypto.randomUUID(), role: "assistant", content: `❌ ${d.error}` },
        ]);
        return;
      }
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: t.chatGenSuccess(d.storyboard.shots.length),
          storyboard: d.storyboard as Storyboard,
          sourceScript: script,
          sourceBrief: brief,
        },
      ]);
    } catch (e) {
      toast.danger(t.toastNetworkError, { description: String(e) });
    } finally {
      setSubmitting(false);
    }
  }, [
    settings.chatModel,
    settings.videoModel,
    settings.durationSec,
    settings.aspectRatio,
    settings.withSubtitle,
    settings.language,
    brief,
    t,
  ]);

  // Hydrate UI when the active session id flips (e.g. user picks from sidebar).
  useEffect(() => {
    if (!activeId || hydratedIdRef.current === activeId) return;
    const rec = sessionsList.find((s) => s.id === activeId);
    if (!rec) return;
    hydratedIdRef.current = activeId;
    const hydratedMessages = rec.messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      storyboard: m.storyboard,
      sourceScript: m.sourceScript,
      sourceBrief: m.sourceBrief,
    }));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMessages(hydratedMessages);
  }, [activeId, sessionsList]);

  // Persist edits back to IDB. Debounced via a microtask-batched effect.
  useEffect(() => {
    if (!activeId || hydratedIdRef.current !== activeId) return;
    const handle = window.setTimeout(() => {
      void saveActive({
        title: deriveSessionTitle(messages, t.newSessionTitle),
        messages: messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          storyboard: m.storyboard,
          sourceScript: m.sourceScript,
          sourceBrief: m.sourceBrief,
        })),
        refImages: [],
      });
    }, 400);
    return () => window.clearTimeout(handle);
  }, [messages, activeId, saveActive, t.newSessionTitle]);

  // Restore persisted settings after hydration (client-only).
  useEffect(() => {
    const loaded = loadUiSettings();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSettings(loaded);
  }, []);

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [settings]);

  const refreshModels = useCallback(async () => {
    setLoadingModels(true);
    try {
      const res = await fetch("/api/models");
      if (!res.ok) {
        toast.danger(t.toastNoModels);
        return;
      }
      const d = (await res.json()) as Models;
      setModels(d);
      setSettings((s) => ({
        ...s,
        chatModel: s.chatModel ?? pickPreferred(d.chat, [
          "models/gemini-3.1-pro-preview",
          "models/gemini-3-pro-preview",
          "models/gemini-2.5-pro",
        ]) ?? d.chat[0]?.name,
        videoModel: s.videoModel ?? pickPreferred(d.video, [
          "models/veo-3.1-fast-generate-preview",
          "models/veo-3.1-generate-preview",
          "models/veo-3.0-fast-generate-001",
        ]) ?? d.video[0]?.name,
        imageModel: s.imageModel ?? pickPreferred(d.image, [
          "models/gemini-3.1-flash-image-preview",
          "models/gemini-3-pro-image-preview",
        ]) ?? d.image.find((x) => /(image-preview|nano-banana)/.test(x.name))?.name,
      }));
    } finally {
      setLoadingModels(false);
    }
  }, [t.toastNoModels]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshModels();
  }, [refreshModels]);

  const generateScript = useCallback(async () => {
    if (generatingScript) return;
    if (!brief.theme.trim()) {
      toast.warning("请先填写主题", {
        description: "例如：冬天火锅店双人餐 199 元",
      });
      themeRef.current?.focus();
      return;
    }
    if (!settings.chatModel) {
      toast.warning(t.toastNoChatModel);
      return;
    }
    setGeneratingScript(true);
    try {
      const res = await fetch("/api/script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: settings.chatModel,
          theme: brief.theme,
          platform: brief.platform,
          audience: brief.audience,
          durationSec: brief.durationSec,
          style: brief.style,
        }),
      });
      const d = await res.json();
      if (!res.ok) {
        toast.danger("脚本生成失败", { description: d.error });
        return;
      }
      setInput(d.script.fullScript);
      toast.success("口播脚本已生成", {
        description: "可在下方输入框修改，确认后点提交生成分镜。",
      });
    } catch (e) {
      toast.danger("网络错误", { description: String(e) });
    } finally {
      setGeneratingScript(false);
    }
  }, [brief, generatingScript, settings.chatModel, t.toastNoChatModel]);

  const updatePlatform = useCallback((platform: string) => {
    setBrief((b) => ({ ...b, platform }));
    setSettings((s) => ({
      ...s,
      aspectRatio: platform === "视频号" ? "16:9" : "9:16",
    }));
  }, []);

  const allowedDurations = useMemo<number[]>(() => {
    const m = settings.videoModel ?? "";
    if (/^gen[0-9]/.test(m) || m === "act_two") return [5, 10]; // Runway
    if (m.startsWith("MiniMax-")) return [6, 10]; // MiniMax
    if (m.startsWith("ray-")) return [5, 9]; // Luma (range 1-9, show endpoints)
    if (m.includes("lite")) return [5, 6, 8];
    if (m.includes("veo-3.0")) return [8];
    return [4, 6, 8]; // Gemini default
  }, [settings.videoModel]);

  const submit = async () => {
    const script = input.trim();
    if (!script) return;
    if (!settings.chatModel) {
      toast.warning(t.toastNoChatModel);
      return;
    }
    const userMsg: UiMessage = { id: crypto.randomUUID(), role: "user", content: script };
    const historyForApi = [...messages];
    setMessages((m) => [...m, userMsg]);
    setInput("");
    // Flush user message to IDB immediately so it survives a page refresh mid-generation.
    await saveActive({
      title: deriveSessionTitle([...messages, userMsg], t.newSessionTitle),
      messages: [...messages, userMsg].map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        storyboard: m.storyboard,
        sourceScript: m.sourceScript,
        sourceBrief: m.sourceBrief,
      })),
      refImages: [],
    });
    await doFetchStoryboard(script, historyForApi);
  };

  const setSelected = <K extends keyof UiSettings>(key: K) =>
    (k: Key | Key[] | null) => {
      if (k == null || Array.isArray(k)) return;
      setSettings((s) => ({ ...s, [key]: k as UiSettings[K] }));
    };

  return (
    <div className="mx-auto grid max-w-7xl grid-cols-1 gap-4 px-4 py-6 lg:grid-cols-[320px_1fr]">
      {/* 左：创作需求 + 参数面板 */}
      <div className="flex flex-col gap-4 lg:sticky lg:top-20 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto lg:pr-1">
        <Card variant="secondary">
          <Card.Content className="flex flex-col gap-3">
            <div>
              <h2 className="text-base font-semibold">① 创作需求</h2>
              <p className="mt-1 text-xs text-default-500">
                没写脚本？填个主题，AI 先帮你写一版可直接拍的口播文案。
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label className="text-sm">主题（必填）</Label>
              <TextArea
                ref={themeRef}
                value={brief.theme}
                onChange={(e) => {
                  const value = e.currentTarget.value;
                  setBrief((b) => ({ ...b, theme: value }));
                }}
                placeholder="点击输入主题，例如：冬天火锅店双人餐 199 元"
                aria-label="主题"
                rows={2}
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1.5">
                <Label className="text-sm">平台</Label>
                <Select
                  value={brief.platform}
                  aria-label="平台"
                  onChange={(k) => k && !Array.isArray(k) && updatePlatform(String(k))}
                >
                  <Select.Trigger>
                    <Select.Value />
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      {["抖音", "视频号", "小红书", "快手"].map((p) => (
                        <ListBox.Item key={p} id={p} textValue={p}>
                          {p}
                          <ListBox.ItemIndicator />
                        </ListBox.Item>
                      ))}
                    </ListBox>
                  </Select.Popover>
                </Select>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label className="text-sm">时长</Label>
                <Select
                  value={String(brief.durationSec)}
                  aria-label="时长"
                  onChange={(k) =>
                    k && !Array.isArray(k) &&
                    setBrief((b) => ({ ...b, durationSec: Number(k) }))
                  }
                >
                  <Select.Trigger>
                    <Select.Value />
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      {[15, 30, 60].map((d) => (
                        <ListBox.Item key={d} id={String(d)} textValue={`${d} 秒`}>
                          {d} 秒
                          <ListBox.ItemIndicator />
                        </ListBox.Item>
                      ))}
                    </ListBox>
                  </Select.Popover>
                </Select>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label className="text-sm">目标受众</Label>
              <Input
                value={brief.audience}
                onChange={(e) => {
                  const value = e.target.value;
                  setBrief((b) => ({ ...b, audience: value }));
                }}
                placeholder="例如：附近上班族、情侣"
                aria-label="目标受众"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label className="text-sm">口播风格</Label>
              <Select
                value={brief.style}
                aria-label="口播风格"
                onChange={(k) =>
                  k && !Array.isArray(k) && setBrief((b) => ({ ...b, style: String(k) }))
                }
              >
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    {["亲切种草", "专业讲解", "探店体验", "搞笑反转"].map((s) => (
                      <ListBox.Item key={s} id={s} textValue={s}>
                        {s}
                        <ListBox.ItemIndicator />
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>
            </div>

            <Button
              variant="primary"
              onPress={generateScript}
              isDisabled={generatingScript}
              className="gap-1.5"
            >
              {generatingScript ? <Spinner size="sm" color="current" /> : null}
              生成口播脚本
            </Button>
          </Card.Content>
        </Card>

        <Card className="h-fit" variant="secondary">
          <Card.Content className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">{t.paramsTitle}</h2>
            <Button size="sm" variant="ghost" isIconOnly onPress={refreshModels} isDisabled={loadingModels} aria-label={t.paramsRefreshModels}>
              {loadingModels ? <Spinner size="sm" /> : <RefreshCw className="size-4" />}
            </Button>
          </div>

          <Select
            value={settings.chatModel ?? null}
            onChange={setSelected("chatModel")}
            placeholder={t.paramsChatModelPlaceholder}
          >
            <Label>{t.paramsChatModel}</Label>
            <Select.Trigger>
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                {(models?.chat ?? []).map((m) => (
                  <ListBox.Item key={m.name} id={m.name} textValue={m.displayName ?? m.name}>
                    {m.displayName ?? m.name}
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>

          <Select
            value={settings.aspectRatio}
            onChange={(k) =>
              k && !Array.isArray(k) && setSettings((s) => ({ ...s, aspectRatio: k as "16:9" | "9:16" }))
            }
          >
            <Label>{t.paramsAspectRatio}</Label>
            <Select.Trigger>
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                <ListBox.Item id="16:9" textValue={t.paramsLandscape}>
                  {t.paramsLandscape}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
                <ListBox.Item id="9:16" textValue={t.paramsPortrait}>
                  {t.paramsPortrait}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              </ListBox>
            </Select.Popover>
          </Select>

          <Select
            value={String(settings.durationSec)}
            onChange={(k) =>
              k && !Array.isArray(k) && setSettings((s) => ({ ...s, durationSec: Number(k) }))
            }
          >
            <Label>{t.paramsDuration}</Label>
            <Select.Trigger>
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                {allowedDurations.map((d) => (
                  <ListBox.Item key={d} id={String(d)} textValue={`${d} ${t.paramsDurationSec}`}>
                    {d} {t.paramsDurationSec}
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>

          <Select
            value={settings.language}
            onChange={(k) => k && !Array.isArray(k) && setSettings((s) => ({ ...s, language: String(k) }))}
          >
            <Label>{t.paramsSubtitleLang}</Label>
            <Select.Trigger>
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                {([
                  { id: "zh-CN", label: "中文简体" },
                  { id: "zh-TW", label: "中文繁體" },
                  { id: "en-US", label: "English" },
                  { id: "ja", label: "日本語" },
                  { id: "ko", label: "한국어" },
                  { id: "fr", label: "Français" },
                  { id: "de", label: "Deutsch" },
                  { id: "es", label: "Español" },
                ] as const).map((l) => (
                  <ListBox.Item key={l.id} id={l.id} textValue={l.label}>
                    {l.label}
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>

          <Switch
            isSelected={settings.withSubtitle}
            onChange={(v) => setSettings((s) => ({ ...s, withSubtitle: v }))}
            className="flex w-full items-center justify-between"
          >
            <Switch.Content>
              <Label className="text-sm font-normal">{t.paramsSubtitle}</Label>
            </Switch.Content>
            <Switch.Control>
              <Switch.Thumb />
            </Switch.Control>
          </Switch>

        </Card.Content>
        </Card>
      </div>

      {/* right: chat area */}
      <div className="flex h-[calc(100vh-7rem)] flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <SessionsPanel />
            {(() => {
              const rec = sessionsList.find((s) => s.id === activeId);
              if (!rec) return null;
              return (
                <span className="hidden text-xs text-default-400 sm:block">
                  {rec.title}
                  <span className="ml-2 opacity-60">
                    {new Date(rec.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </span>
                </span>
              );
            })()}
          </div>
        </div>
        <Card className="flex-1 overflow-hidden">
          <Card.Content className="flex h-full flex-col gap-3 overflow-y-auto">
            {messages.length === 0 && (
              <div className="m-auto max-w-md text-center text-default-500">
                {t.chatEmpty}
              </div>
            )}
            {messages.map((m, i) => {
              const isLastUnanswered =
                i === messages.length - 1 &&
                m.role === "user" &&
                !submitting;
              // Old sessions did not persist sourceScript; recover it from the
              // nearest preceding user message so publish copy still works.
              const fallbackScript = messages
                .slice(0, i)
                .reverse()
                .find((x) => x.role === "user")?.content;
              return (
                <MessageBubble
                  key={m.id}
                  msg={m}
                  brief={brief}
                  model={settings.chatModel}
                  fallbackScript={fallbackScript}
                  isLastUnanswered={isLastUnanswered}
                  onRetry={() => {
                    void doFetchStoryboard(m.content, messages.slice(0, i));
                  }}
                />
              );
            })}
            {submitting && (
              <Card className="flex flex-row gap-2 text-sm text-default-500" variant="secondary">
                <Spinner size="sm" /> {t.chatSplitting}
              </Card>
            )}
          </Card.Content>
        </Card>

        <div className="flex gap-2">
          <TextArea
            value={input}
            onChange={(e) => setInput(e.currentTarget.value)}
            placeholder={t.chatPlaceholder}
            rows={6}
            className="flex-1"
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                e.preventDefault();
                void submit();
              }
            }}
          />
          <Button variant="primary" onPress={submit} isDisabled={submitting || !input.trim()} className="gap-1.5">
            {submitting ? <Spinner size="sm" color="current" /> : <><Send className="size-4" />{t.chatSubmit}</>}
          </Button>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({
  msg,
  brief,
  model,
  fallbackScript,
  isLastUnanswered,
  onRetry,
}: {
  msg: UiMessage;
  brief: Brief;
  model?: string;
  fallbackScript?: string;
  isLastUnanswered?: boolean;
  onRetry?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const { t } = useI18n();

  const copy = () => {
    void navigator.clipboard.writeText(msg.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  if (msg.role === "user") {
    return (
      <div className="ml-auto max-w-[80%]">
        <button type="button" onClick={copy} className="group w-full text-left">
          <Card variant="secondary">
            <Card.Content className="relative">
              <pre className="whitespace-pre-wrap font-sans text-sm">{msg.content}</pre>
              <Chip className="absolute right-3 top-2 bg-accent opacity-0 transition-opacity group-hover:opacity-100">
                {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
                {copied ? t.chatCopied : t.chatClickCopy}
              </Chip>
            </Card.Content>
          </Card>
        </button>
        {isLastUnanswered && (
          <div className="mt-1 flex items-center justify-end gap-2">
            <span className="text-xs text-warning">{t.chatInterrupted}</span>
            <Button size="sm" variant="outline" onPress={onRetry} className="gap-1.5">
              <RotateCcw className="size-4" />{t.chatRetry}
            </Button>
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="mr-auto w-full max-w-full space-y-2">
      <Card variant="secondary">
        <Card.Content className="text-sm">{msg.content}</Card.Content>
      </Card>
      {msg.storyboard && (
        <StoryboardView
          sb={msg.storyboard}
          sourceScript={msg.sourceScript ?? fallbackScript ?? ""}
          brief={msg.sourceBrief ?? brief}
          targetKnown={!!msg.sourceBrief}
          model={model}
        />
      )}
    </div>
  );
}

function StoryboardView({
  sb,
  sourceScript,
  brief,
  targetKnown,
  model,
}: {
  sb: Storyboard;
  sourceScript: string;
  brief: Brief;
  targetKnown: boolean;
  model?: string;
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publish, setPublish] = useState<PublishCopy | null>(null);
  const [publishCopied, setPublishCopied] = useState(false);

  const copyStoryboard = () => {
    const text = sb.shots
      .map((s) =>
        [
          `#${s.index} ${s.durationSec}s`,
          s.summary,
          `镜头：${s.camera}`,
          `构图：${s.composition}`,
          `氛围：${s.ambiance}`,
          s.dialogue.length > 0
            ? `台词：${s.dialogue.map((d) => `${d.speaker}：${d.line}`).join(" ")}`
            : "",
          s.subtitle ? `字幕：${s.subtitle}` : "",
          s.keywords?.length ? `重点词：${s.keywords.join(" / ")}` : "",
        ]
          .filter(Boolean)
          .join("\n")
      )
      .join("\n\n");
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const fileBase = safeFileName(brief.theme || "口播分镜");

  const exportSrt = () => {
    if (!sb.shots.some((s) => s.subtitle?.trim())) {
      toast.warning("当前分镜没有字幕", {
        description: "请先开启字幕并重新生成分镜。",
      });
      return;
    }
    downloadTextFile(
      `${fileBase}_字幕.srt`,
      buildFullSrt(sb.shots),
      "application/x-subrip;charset=utf-8"
    );
    toast.success("已导出 SRT 字幕");
  };

  const exportShotList = () => {
    downloadTextFile(
      `${fileBase}_拍摄清单.csv`,
      buildShotListCsv(sb),
      "text/csv;charset=utf-8"
    );
    toast.success("已导出拍摄清单");
  };

  const generatePublish = async () => {
    if (!sourceScript || !model || publishing) return;
    setPublishing(true);
    try {
      const res = await fetch("/api/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          theme: brief.theme,
          platform: brief.platform,
          audience: brief.audience,
          script: sourceScript,
        }),
      });
      const d = await res.json();
      if (!res.ok) {
        toast.danger("发布文案生成失败", { description: d.error });
        return;
      }
      setPublish(d.publish as PublishCopy);
    } catch (e) {
      toast.danger("网络错误", { description: String(e) });
    } finally {
      setPublishing(false);
    }
  };

  const copyPublish = () => {
    if (!publish) return;
    const text = [
      "标题：",
      ...publish.titles.map((x, i) => `${i + 1}. ${x}`),
      "",
      "封面短句：",
      ...publish.coverTexts.map((x, i) => `${i + 1}. ${x}`),
      "",
      "发布描述：",
      publish.description,
    ].join("\n");
    void navigator.clipboard.writeText(text).then(() => {
      setPublishCopied(true);
      setTimeout(() => setPublishCopied(false), 1500);
    });
  };

  return (
    <Card variant="secondary" className="space-y-3">
      <div className="flex flex-wrap gap-2 text-xs">
        <Chip variant="soft" color="accent">
          {t.sbStyle}{sb.detectedStyle}
        </Chip>
        <Chip variant="soft">{t.sbLanguage}{sb.language}</Chip>
        <Chip variant="soft">
          {t.sbTotalDuration}
          {sb.totalDurationSec}s
          {targetKnown ? ` / 目标 ${brief.durationSec}s` : ""}
        </Chip>
        <Chip variant="soft">{t.sbShots}{sb.shots.length}</Chip>
        {targetKnown && Math.abs(sb.totalDurationSec - brief.durationSec) > 3 && (
          <div className="w-full text-xs text-warning">
            分镜总时长与目标偏差 {sb.totalDurationSec - brief.durationSec > 0 ? "+" : ""}
            {sb.totalDurationSec - brief.durationSec}s，可修改脚本或重新生成。
          </div>
        )}
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {sb.shots.map((s) => (
          <Card key={s.index} className="w-full">
            <Card.Content className="space-y-3 p-4 text-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-base font-semibold">#{s.index}</span>
                  <Chip size="sm" variant="soft">{s.durationSec}s</Chip>
                </div>
              </div>
              <div className="text-default-700">{s.summary}</div>
              <div className="grid grid-cols-1 gap-2 text-xs text-default-600 sm:grid-cols-2">
                <div><span className="text-default-500">{t.sbCamera}</span>{s.camera}</div>
                <div><span className="text-default-500">{t.sbComposition}</span>{s.composition}</div>
                <div className="sm:col-span-2">
                  <span className="text-default-500">{t.sbAmbiance}</span>{s.ambiance}
                </div>
              </div>
              {s.dialogue.length > 0 && (
                <div className="text-xs">
                  <div className="text-default-500">{t.sbDialogue}</div>
                  {s.dialogue.map((d, i) => (
                    <div key={i}>
                      <b>{d.speaker}:</b> {d.line}
                    </div>
                  ))}
                </div>
              )}
              {s.subtitle && (
                <div className="text-xs">
                  <span className="text-default-500">{t.sbSubtitle}</span>{s.subtitle}
                </div>
              )}
              {s.keywords && s.keywords.length > 0 && (
                <div className="text-xs">
                  <span className="text-default-500">{t.sbKeywords}</span>
                  {s.keywords.join(" / ")}
                </div>
              )}
              {s.continuityHint && (
                <div className="text-xs text-default-500">{t.sbContinuity}{s.continuityHint}</div>
              )}
              <details>
                <summary className="cursor-pointer text-xs text-default-500">{t.sbVeoPrompt}</summary>
                <pre className="mt-1 whitespace-pre-wrap text-xs text-default-600">
                  {s.veoPrompt}
                </pre>
              </details>
            </Card.Content>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 border-t border-default-200 pt-3">
        <Button size="sm" variant="outline" onPress={copyStoryboard} className="gap-1.5">
          <Copy className="size-4" />
          {copied ? "已复制分镜" : "复制全部分镜"}
        </Button>
        <Button size="sm" variant="outline" onPress={exportSrt} className="gap-1.5">
          <Download className="size-4" />
          导出 SRT 字幕
        </Button>
        <Button
          size="sm"
          variant="outline"
          onPress={exportShotList}
          className="gap-1.5"
        >
          <FileSpreadsheet className="size-4" />
          导出拍摄清单
        </Button>
        <Button
          size="sm"
          variant="primary"
          onPress={generatePublish}
          isDisabled={publishing || !sourceScript || !model}
          className="gap-1.5"
        >
          {publishing ? <Spinner size="sm" color="current" /> : null}
          {publish ? "重新生成发布文案" : "生成发布文案"}
        </Button>
      </div>

      {publish && (
        <div className="space-y-2 rounded-md bg-default-100 p-3 text-xs">
          <div>
            <div className="font-medium text-default-500">标题候选</div>
            {publish.titles.map((x, i) => (
              <div key={`title-${i}`}>
                {i + 1}. {x}
              </div>
            ))}
          </div>
          <div>
            <div className="font-medium text-default-500">封面短句</div>
            {publish.coverTexts.map((x, i) => (
              <div key={`cover-${i}`}>
                {i + 1}. {x}
              </div>
            ))}
          </div>
          <div>
            <div className="font-medium text-default-500">发布描述</div>
            <div className="whitespace-pre-wrap">{publish.description}</div>
          </div>
          <Button size="sm" variant="ghost" onPress={copyPublish} className="gap-1.5">
            <Copy className="size-4" />
            {publishCopied ? "已复制" : "复制发布文案"}
          </Button>
        </div>
      )}
    </Card>
  );
}

