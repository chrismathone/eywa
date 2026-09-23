/**
 * 회의록 목록 필터 — 순수 함수(Vitest). 서버(getMeetingsPage)가 가벼운 행으로 거르고 페이지를 자른다.
 *
 * 검색(N8, 2026-09-23 감사): 제목·참석자만 찾던 것을 **AI 요약**까지 넓혔다. 전사 원문은 DB의 ilike로
 * 따로 찾아 id로 합친다(원문 전체를 목록으로 내려받지 않기 위해 — T6).
 */
import { kstMonth } from "@/lib/date-kst";

export type MeetingRangeKey = "all" | "7d" | "30d" | "month";
export type MeetingStatusKey = "all" | "completed" | "processing" | "failed" | "idle";

export function inMeetingRange(iso: string, key: MeetingRangeKey, now: Date = new Date()): boolean {
  if (key === "all") return true;
  const then = new Date(iso).getTime();
  const nowMs = now.getTime();
  if (key === "7d") return nowMs - then <= 7 * 86_400_000;
  if (key === "30d") return nowMs - then <= 30 * 86_400_000;
  if (key === "month") return kstMonth(new Date(iso)) === kstMonth(now);
  return true;
}

export function matchMeetingStatus(s: string, key: MeetingStatusKey): boolean {
  if (key === "all") return true;
  if (key === "completed") return s === "completed";
  if (key === "processing") return s === "transcribing" || s === "analyzing" || s === "uploaded";
  if (key === "failed") return s === "failed";
  if (key === "idle") return s === "idle";
  return true;
}

/** 제목·참석자·AI 요약에 검색어가 들어 있나(대소문자 무시). 빈 검색어는 전부 통과. */
export function matchMeetingText(
  m: { title: string; attendees: string[]; aiSummary: string | null },
  q: string,
): boolean {
  const term = q.trim().toLowerCase();
  if (!term) return true;
  return (
    m.title.toLowerCase().includes(term) ||
    m.attendees.some((a) => a.toLowerCase().includes(term)) ||
    (m.aiSummary ?? "").toLowerCase().includes(term)
  );
}

/**
 * PostgREST `ilike` 패턴에 넣을 검색어 — 와일드카드(`%`·`_`)와 구분자(`,`·괄호·`*`·역슬래시)를 지운다.
 * 사람이 친 글자가 패턴 문법으로 읽히면 엉뚱한 행이 걸리거나 요청이 깨진다. 남는 게 없으면 빈 문자열.
 */
export function ilikeTerm(q: string): string {
  return q.replace(/[%_,()*\\"]/g, " ").trim().slice(0, 100);
}
