/**
 * "현재 진행 중인 수업"을 과목별로 묶는 순수 함수(대시보드 콕핏 소비).
 * ⚠️ 과목 라벨·색은 학원설정 단일 소스(buildSubjectMaps)에서 온 labelOf/colorOf만 받는다 — 하드코딩 금지.
 * server-only 미의존(타입만) → Vitest에서 시간과 무관하게 populated 경로를 결정적으로 검증한다.
 */
import type { PillColor } from "@/components/atoms/pill";

/** 그룹핑에 필요한 최소 형태(TodaySlot가 구조적으로 충족). */
type Groupable = { subject: string; startTime: string; status: "done" | "ongoing" | "upcoming" };

export type OngoingGroup<T extends Groupable> = {
  /** 과목 key */
  subject: string;
  /** 한글 라벨 */
  label: string;
  color: PillColor;
  /** 시작시각 오름차순 */
  slots: T[];
};

/**
 * 진행 중(status === "ongoing") 수업만 과목별로 묶어 반환.
 * - 과목 순서: 진행 중 수업 수 desc → 동수면 라벨 가나다순(한국어).
 * - 그룹 내 수업: 시작시각 오름차순.
 * - 진행 중이 없으면 빈 배열.
 */
export function groupOngoingBySubject<T extends Groupable>(
  slots: T[],
  subjects: { labelOf: (key: string) => string; colorOf: (key: string) => PillColor },
): OngoingGroup<T>[] {
  const map = new Map<string, OngoingGroup<T>>();
  for (const s of slots) {
    if (s.status !== "ongoing") continue;
    let g = map.get(s.subject);
    if (!g) {
      g = { subject: s.subject, label: subjects.labelOf(s.subject), color: subjects.colorOf(s.subject), slots: [] };
      map.set(s.subject, g);
    }
    g.slots.push(s);
  }
  const groups = [...map.values()];
  for (const g of groups) g.slots.sort((a, b) => a.startTime.localeCompare(b.startTime));
  groups.sort((a, b) => b.slots.length - a.slots.length || a.label.localeCompare(b.label, "ko"));
  return groups;
}
