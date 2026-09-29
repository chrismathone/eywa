import { studentLevelOf, type StudentLevel } from "@/features/students/list-filter-values";

export type VideoHomeworkPolicy = {
  enabled: boolean;
  disabledSubjectKeys: string[];
  disabledSchoolLevels: StudentLevel[];
  disabledClassIds: string[];
};

export const DEFAULT_VIDEO_HOMEWORK_POLICY: VideoHomeworkPolicy = {
  enabled: true,
  disabledSubjectKeys: [],
  disabledSchoolLevels: [],
  disabledClassIds: [],
};

/** 현재 설정의 검사 대상 여부. 기존 기록은 이 판정과 무관하게 이력으로 남는다. */
export function isVideoHomeworkEnabled(
  policy: VideoHomeworkPolicy,
  target: { classId: string; subjectKey: string; grade: string | null | undefined },
): boolean {
  return policy.enabled &&
    !policy.disabledSubjectKeys.includes(target.subjectKey) &&
    !policy.disabledSchoolLevels.includes(studentLevelOf(target.grade)) &&
    !policy.disabledClassIds.includes(target.classId);
}
