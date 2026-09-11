/**
 * 학생 수업 탭 주간 격자의 **행 구성 도출** — 학원설정 과목 목록 → '수업 있는 교시만' 그리는 과목 키. 순수(Vitest).
 *
 * 규칙: 그 과목 시간표가 **처음 여는 뷰**(`subjects[].defaultView`, 판정은 `subjectDefaultView` 단일 소스)가
 * 통합뷰면 'used'(`rowModeForDefaultView`), 나머지는 교시표 전부. 원장 2026-09-11 *"왜 영어 학생들의 수업탭의
 * 시간표 표시는 실제 영어 시간표와 다른것 같지?"* — 영어 교시표 15줄(EiE·인재원 두 체계)을 전부 그려 원본(영어의
 * 처음 뷰 = 통합뷰)과 다른 모양이었다.
 *
 * ⚠️ `week-grid.ts`에 두지 않았다 — `view-default` → `settings-types`가 zod를 끌고 와, 격자를 그리는 클라 컴포넌트
 *    번들에 유입된다. 서버 컴포넌트(`classes-tab.tsx`)가 여기서 키 목록을 뽑아 prop으로 넘긴다.
 */
import { subjectDefaultView } from "@/features/timetable/lib/view-default";
import { rowModeForDefaultView } from "./week-grid";

export function usedRowSubjectsOf(subjects: readonly { key: string; defaultView?: string }[] | undefined): string[] {
  return (subjects ?? [])
    .map((s) => s.key)
    .filter((k) => rowModeForDefaultView(subjectDefaultView(subjects, k)) === "used");
}
