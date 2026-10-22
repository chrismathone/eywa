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

/**
 * 반·과목만으로 본 검사 대상 여부 — 학년은 학생마다라 줄에서 `isVideoHomeworkEnabled`로 마저 본다.
 * 영상 제출 현황이 숙제 0건 반(대상 밖 반은 줄도 검색 명단도 없다)을 명단·영상을 읽기 전에 거를 때 쓴다.
 */
export function isVideoHomeworkClassEnabled(policy: VideoHomeworkPolicy, target: { classId: string; subjectKey: string }): boolean {
  return policy.enabled && !policy.disabledSubjectKeys.includes(target.subjectKey) && !policy.disabledClassIds.includes(target.classId);
}

/** 현재 설정의 검사 대상 여부. 기존 기록은 이 판정과 무관하게 이력으로 남는다. */
export function isVideoHomeworkEnabled(
  policy: VideoHomeworkPolicy,
  target: { classId: string; subjectKey: string; grade: string | null | undefined },
): boolean {
  return isVideoHomeworkClassEnabled(policy, target) && !policy.disabledSchoolLevels.includes(studentLevelOf(target.grade));
}
