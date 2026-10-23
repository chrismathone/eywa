/**
 * 항목별 보고서 글(`■ 제목\n본문`, math-report-pilot-sections.ts) → 학부모 카드가 그릴 조각. 순수 모듈(Vitest).
 *
 * 원장 2026-10-23 *"이거는 표형식이 아님"* → 시안 B(막대형 표) 확정 + *"표에맞게 밑에도 어느정도 디자인 맞춰서"*.
 * 글은 그대로 저장하고(원스크린 미리보기·ClassNote 본문은 글자), **학부모 카드(/r·인쇄 = ClassNote 게시 사진)** 만
 * 이 조각으로 진짜 표와 항목 블록을 그린다. 그래서 형식이 안 맞으면 null — 카드는 예전처럼 글을 그대로 보인다.
 */

import { LEVELS, type Level } from "./math-report-pilot-sections";

export type PilotNoteSection = { title: string; body: string };

/** `■ 제목` 줄로 시작하는 글이면 항목 목록, 아니면 null(손으로 쓴 글·다른 학생 글). */
export function parsePilotNotes(notes: string | null | undefined): PilotNoteSection[] | null {
  const t = (notes ?? "").replace(/\r\n?/g, "\n").trim();
  if (!t.startsWith("■ ")) return null;
  const out: PilotNoteSection[] = [];
  for (const chunk of t.split(/\n+(?=■ )/)) {
    const [head = "", ...rest] = chunk.split("\n");
    const title = head.replace(/^■\s*/, "").trim();
    if (!title) return null;
    out.push({ title, body: rest.join("\n").trim() });
  }
  return out;
}

export type LevelRow = { label: string; level: Level };

const MARK = /[○●]/;

/**
 * '수업 평가' 본문 → 줄 목록. 눈금 기호(○●)가 있는 줄만 읽는다 — 머리 줄('구분…')·옛 안내 줄('(왼쪽부터…)')은 건너뛴다.
 * 이름 = 첫 기호 앞, 등급 = 마지막 기호 뒤(전각·반각 공백 무시). 등급이 눈금 밖이면 null(표를 지어내지 않는다).
 */
export function parseLevelRows(body: string): LevelRow[] | null {
  const rows: LevelRow[] = [];
  for (const line of body.split("\n")) {
    const first = line.search(MARK);
    if (first < 0) continue;
    const last = Math.max(line.lastIndexOf("○"), line.lastIndexOf("●"));
    const label = line.slice(0, first).replace(/[\s　]+/g, " ").trim();
    const level = line.slice(last + 1).replace(/[\s　]+/g, "");
    if (!label || !(LEVELS as readonly string[]).includes(level)) return null;
    rows.push({ label, level: level as Level });
  }
  return rows.length ? rows : null;
}

/** 테스트 항목 첫 줄이 점수("N문제 중 M개 맞음")인가 — 카드가 그 줄만 굵게 세운다. */
export function isScoreLine(line: string): boolean {
  return /^\d+문제 중 \d+개 맞음$/.test(line.trim());
}
