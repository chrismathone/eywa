/**
 * 탑승 학생 시간표 **"수정된 내용" 확인 기록**(순수 · Vitest) — 사용자 2026-10-29 *"알림에 확인 버튼 — 누르면 경고들이 없어지게"*.
 *
 * 겹침 하나 = 학생 × 수업 배치(또는 보강) × 배차 카드. 확인하면 이 열쇠를 계정(`users.ui_prefs.shuttleConflictAcks`)에 남긴다.
 * 🔑 수업 시간을 또 바꾸면 배치 id가 새로 생기고(행 분할), 보강을 다른 시각으로 잡으면 보강 카드 id가 달라져 **새 열쇠** — 그래서 다시 뜬다.
 * 🔑 계정 귀속(작업 규칙 "모든 뷰 세팅은 계정 귀속") — 다른 PC에서도 확인한 그대로. 오래된 열쇠는 최근 것부터 상한만 남긴다.
 */
export const ACK_LIMIT = 300;

export const conflictKey = (c: { studentId: string; classId: string; runCardId: string }) => `${c.studentId}|${c.classId}|${c.runCardId}`;

/** 저장된 값 → 열쇠 배열(모양이 깨져도 throw하지 않는다). */
export function parseAcks(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length < 300).slice(-ACK_LIMIT) : [];
}

/** 기존 + 새 열쇠 — 중복 없이, 최근 것이 뒤로, 상한만큼. */
export function mergeAcks(prev: readonly string[], add: readonly string[]): string[] {
  const out = prev.filter((k) => !add.includes(k));
  for (const k of add) if (!out.includes(k)) out.push(k);
  return parseAcks(out);
}
