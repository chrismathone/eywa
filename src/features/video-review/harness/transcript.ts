/**
 * 판정 자료(전사·말하기 자료)를 만드는 순수 함수 — 2026-10-20 하네스 6차의 `tr2d` 그대로.
 * 시각별 전사(5초·3초 멈춤 단위로 줄) + 코드가 센 멈춤·군말 + 수학 용어 사전 보정.
 */
import { applyTermDict } from "./term-dict";

export type Word = readonly [number, string];

const FILLER_RE = /^(대충|뭐|음+|어+|그+|막|약간|이렇게)$/;
/** 3초 넘게 말이 없으면 '멈춤'. */
export const PAUSE_MS = 3000;

export function mmss(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export type SpeechStats = { pauses: string[]; fillers: Record<string, number>; wordCount: number; lastAt: number | null };

export function speechStats(words: readonly Word[]): SpeechStats {
  const pauses: string[] = [];
  const fillers: Record<string, number> = {};
  words.forEach(([t, w], i) => {
    if (i > 0 && t - words[i - 1][0] > PAUSE_MS) {
      pauses.push(`${mmss(words[i - 1][0])}~${mmss(t)}(${((t - words[i - 1][0]) / 1000).toFixed(1)}초)`);
    }
    const bare = w.replace(/[.,?!]/g, "");
    if (FILLER_RE.test(bare)) fillers[bare] = (fillers[bare] ?? 0) + 1;
  });
  return { pauses, fillers, wordCount: words.length, lastAt: words.length ? words[words.length - 1][0] : null };
}

/** 5초마다 또는 3초 넘는 멈춤에서 줄을 바꾼다. */
export function transcriptLines(words: readonly Word[]): { at: number; text: string }[] {
  const lines: { at: number; ws: string[] }[] = [];
  words.forEach(([t, w], i) => {
    const cur = lines[lines.length - 1];
    if (!cur || t - cur.at >= 5000 || (i > 0 && t - words[i - 1][0] > PAUSE_MS)) lines.push({ at: t, ws: [w] });
    else cur.ws.push(w);
  });
  return lines.map((l) => ({ at: l.at, text: l.ws.join(" ") }));
}

export type MaterialInput = { words: readonly Word[]; durationSec: number; grade: string | null; progress: string | null };

/** 판정·확인 프롬프트에 그대로 붙는 자료 블록. */
export function formatMaterial(input: MaterialInput): string {
  const lines = transcriptLines(input.words);
  const st = speechStats(input.words);
  const fillerText = Object.entries(st.fillers).map(([k, v]) => `${k} ${v}회`).join(", ");
  return [
    `[학년] ${input.grade ?? "모름"}`,
    `[최근 진도] ${(input.progress ?? "기록 없음").replace(/\n/g, " / ")}(최근 보고서 진도 — 이 영상과 다를 수 있음)`,
    "",
    "[음성 전사 — 시각별] (자동 전사라 숫자·용어가 틀릴 수 있음 · '(전사: …)'는 코드가 용어 사전으로 고친 자리)",
    ...(lines.length
      ? lines.map((l) => `[${mmss(l.at)}] ${applyTermDict(l.text)}`)
      : ["(말소리가 전사되지 않음 — 말이 없거나 들리지 않는 영상일 수 있음)"]),
    "",
    "[말하기 자료 — 코드가 센 값]",
    `- 영상 길이 ${mmss(input.durationSec * 1000)} · 말한 단어 ${st.wordCount}개 · 마지막 말 ${st.lastAt == null ? "-" : mmss(st.lastAt)}`,
    `- 3초 넘게 말이 멈춘 곳: ${st.pauses.length ? st.pauses.join(", ") : "없음"}`,
    `- 군말(대충·뭐·음·어 등): ${fillerText || "없음"}`,
    // 메모 금지어를 이 영상 값으로 미리 계산해 준다(코드 후처리 fixNote와 같은 규칙).
    `- 이 영상의 메모 금지어: ${[
      st.pauses.length ? "'막힘 없이·끊김 없이·멈춤 없이'" : "",
      Object.keys(st.fillers).length ? "'군말 없이'" : "",
    ].filter(Boolean).join(", ") || "없음"}`,
  ].join("\n");
}
