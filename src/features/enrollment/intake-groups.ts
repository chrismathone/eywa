import type { SubjectSetting } from "@/features/owner/settings-types";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { programSubjectsOf, subjectGroupOf } from "@/features/students/enrollment/program";
import { subjectLabelRecord } from "@/features/owner/subjects";
import { tokenColor } from "@/features/students/stats/model";
import { sliceGroupsOf, type GroupsOf } from "@/features/dashboard/layout/slices";

/**
 * 신규 문의 추이의 과목 선 이름·색 — 묶음(`subjectGroupOf`: 수학 계열 = math · 영어 갈래 = english · 그 밖은 과목 키)마다 학원 설정의
 * 이름·색(운영 enum 단일 소스 — 리뷰 2026-10-20). 묶음 이름은 그 묶음 키 과목의 이름(없으면 첫 과목 이름).
 */
export function intakeGroupMeta(subjects: readonly SubjectSetting[]): Record<string, { label: string; color: string }> {
  const maps = buildSubjectMaps([...subjects]);
  const programSubjects = programSubjectsOf(subjectLabelRecord([...subjects]));
  const out: Record<string, { label: string; color: string }> = {};
  for (const s of subjects) {
    const group = subjectGroupOf(s.key, programSubjects);
    if (!group || (out[group] && group !== s.key)) continue;
    // 이름·색은 묶음 키 과목(수학·영어)이 있으면 그 과목 것, 없으면 그 묶음에 처음 선 과목 것 — 모두 학원 설정 값.
    // (위에서 이미 선 묶음은 묶음 키 과목만 덮어쓴다 — 그래서 여기 오는 과목이 곧 그 묶음의 이름·색 주인이다.)
    out[group] = { label: s.label, color: tokenColor(maps.colorOf(s.key)) };
  }
  return out;
}

/**
 * 콜&상담 과목 칸(자유 입력) → 과목 묶음 — 신규 문의 추이와 통계뷰 '관리현황'이 같은 판정을 쓴다('EIE' = 영어 · '영어 수학' = 둘 다 ·
 * 못 읽으면 빈 배열). 운영실 과목 관리자 값과 같은 `sliceGroupsOf`.
 */
export function intakeGroupsOf(subjects: readonly SubjectSetting[]): GroupsOf {
  const programSubjects = programSubjectsOf(subjectLabelRecord([...subjects]));
  return sliceGroupsOf(
    subjects.map((s) => ({ key: s.key, label: s.label })),
    (key) => subjectGroupOf(key, programSubjects),
  );
}
