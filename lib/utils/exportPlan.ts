interface ShotLike {
  index: number;
  durationSec: number;
  summary: string;
  camera: string;
  composition: string;
  ambiance: string;
  dialogue: { speaker: string; line: string }[];
  subtitle?: string;
  keywords?: string[];
  veoPrompt: string;
}

interface StoryboardLike {
  shots: ShotLike[];
}

function csvCell(value: unknown): string {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

/**
 * Build a UTF-8 CSV shot list for Excel / editing handoff.
 * A BOM is prepended so Excel on Windows displays Chinese correctly.
 */
export function buildShotListCsv(sb: StoryboardLike): string {
  const header = [
    "序号",
    "时长(秒)",
    "画面/内容",
    "镜头",
    "构图",
    "氛围",
    "台词",
    "字幕",
    "重点词",
    "拍摄提示",
  ];
  const rows = sb.shots.map((shot) => [
    shot.index,
    shot.durationSec,
    shot.summary,
    shot.camera,
    shot.composition,
    shot.ambiance,
    shot.dialogue.map((d) => `${d.speaker}：${d.line}`).join(" "),
    shot.subtitle ?? "",
    (shot.keywords ?? []).join(" / "),
    shot.veoPrompt,
  ]);
  return (
    "﻿" +
    [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") +
    "\r\n"
  );
}

/** Make a safe cross-platform file name from the topic. */
export function safeFileName(input: string): string {
  const cleaned = input
    .replace(/[\\/:*?"<>|\r\n]+/g, "")
    .trim()
    .slice(0, 24);
  return cleaned || "口播分镜";
}

/** Download a text file in the browser. */
export function downloadTextFile(
  filename: string,
  content: string,
  mimeType: string
): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
