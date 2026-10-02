/**
 * ClassNote 반 보드 **해제 대상**(0329a, 원장 2026-10-02) — 칸 값 읽기·요약(순수, 서버·테스트 공용).
 *
 * 반 보드 동기화는 수강이 끝난 것이 확인된 원아만 스스로 해제한다(2026-10-02 자동 해제 — 그 전 워커는 배정만 했다). 반을 옮긴 학생처럼
 * "보드엔 있는데 aywa 그 반 명단엔 없는 원아"를 워커가 반 보드 행에 적어 두고(`release_names`), 동기화 보고서
 * (classnote-sync-report.ts)가 그것을 '해제 확인이 필요한 원아'로 싣는다(수강이 끝난 것이 확인된 원아는 워커가 스스로 해제한다 — 여기 남는 것은 보류분).
 * ⚠️ 순수 모듈 — `server-only` 금지(#61).
 */

/** 반 보드 하나의 해제 대상 — 워커가 마지막으로 확인한 시각과 함께. */
export type ReleaseBoard = {
  /** ClassNote에 지금 붙은 보드 이름(사람이 ClassNote 화면에서 찾을 이름). */
  boardName: string;
  /** aywa 반 이름 — 보드 이름과 다를 때만 함께 적는다. 못 읽었으면 null. */
  className: string | null;
  /** 해제할 원아 이름(ClassNote에 등록된 이름). */
  names: string[];
  checkedAt: string;
};

/** jsonb 칸 → 이름 배열. 모르는 모양은 빈 배열(없는 이름을 지어내지 않는다). */
export function parseReleaseNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean))];
}

export type ReleaseSummary = { classes: number; names: number; checkedAt: string | null };

/** 해제할 원아가 있는 반 수 · 원아 수 · 가장 최근 확인 시각(확인한 반이 하나도 없으면 null). */
export function summarizeRelease(boards: readonly ReleaseBoard[]): ReleaseSummary {
  let checkedAt: string | null = null;
  let classes = 0;
  let names = 0;
  for (const b of boards) {
    if (!checkedAt || Date.parse(b.checkedAt) > Date.parse(checkedAt)) checkedAt = b.checkedAt;
    if (!b.names.length) continue;
    classes += 1;
    names += b.names.length;
  }
  return { classes, names, checkedAt };
}
