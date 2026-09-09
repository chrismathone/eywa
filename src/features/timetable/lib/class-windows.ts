/**
 * 화면에 뜬 반들이 **언제 도는가** — 학생 드래그 빗금(`blockedClassesForStudent`)이 읽는 좌표.
 *
 * 기본뷰는 격자 칸 하나가 곧 한 배치라 칸이 제 좌표를 직접 단다(`class-cell.tsx`). 통합뷰는 카드 하나가
 * 요일·교시 여럿이라 **카드가 한 좌표로 답할 수 없어서**, 슬롯에서 좌표를 뽑아 화면 밖(숨김) 표식으로 깐다.
 * 판정·표시는 그대로 기본뷰와 같은 기계(`annotateStudentBlocks`)를 쓴다 — 판정을 두 벌로 만들지 않는다.
 *
 * 🔴 **중복을 접는다** — 한 반이 같은 요일·같은 시각에 여러 슬롯 행으로 있을 수 있고(합반 세그먼트·
 *    운영 이력 분할), 접지 않으면 같은 좌표 표식이 수백 개 깔린다(판정 결과는 같고 DOM만 는다).
 * ⚠️ 시각은 `HH:MM`으로 자른다 — 겹침 판정(`timeRangesOverlap`)이 문자열 비교라 초가 붙으면 형식이 갈린다.
 */

export type ClassWindowSlot = {
  classId: string;
  className: string;
  dayOfWeek: string;
  startTime: string;
  endTime: string;
};

export type ClassWindow = {
  classId: string;
  className: string;
  day: string;
  start: string;
  end: string;
};

export function classWindowsFromSlots(slots: readonly ClassWindowSlot[]): ClassWindow[] {
  const seen = new Set<string>();
  const out: ClassWindow[] = [];
  for (const s of slots) {
    if (!s.classId || !s.dayOfWeek || !s.startTime || !s.endTime) continue;
    const start = String(s.startTime).slice(0, 5);
    const end = String(s.endTime).slice(0, 5);
    const key = `${s.classId}|${s.dayOfWeek}|${start}|${end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ classId: s.classId, className: s.className ?? "", day: s.dayOfWeek, start, end });
  }
  return out;
}
