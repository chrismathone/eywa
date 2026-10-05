/** 학생·과목·날짜당 새 참여는 하나. 같은 담당의 정규+보강 1회만 합친다. */

export function decideSameDayNative(input: {
  subjectKey: string;
  pilotSubjects: readonly string[];
  addingNative: boolean;
  nativeCount: number;
  hasRegularSameAnchor: boolean;
  regularTeacherId: string | null;
  makeupTeacherId: string | null;
}): string | null {
  if (!input.addingNative) return null;
  if (!input.subjectKey.trim()) return "과목을 확인해 주세요";
  if (!input.pilotSubjects.includes(input.subjectKey)) return "이 과목은 보강 참여로 열 수 없습니다";
  if (input.nativeCount >= 1) return "같은 날 이 과목의 보강 참여는 한 번만 기록합니다";
  if (!input.hasRegularSameAnchor) return null;
  const same = !!input.regularTeacherId && input.regularTeacherId === input.makeupTeacherId;
  return same ? null : "정규 수업과 보강의 담당이 달라 같은 날에 함께 기록할 수 없습니다";
}

/**
 * 저장 경로용. 운영이 꺼져 있거나 시범 과목이 아니거나 참여가 없으면 옛 경로 그대로(null).
 * 이미 있는 참여 한 건을 그 참여의 담당 비교로 막지 않는다. 둘째 참여만 거절한다.
 */
export function mappedSameDayDecision(input: {
  mode: "off" | "on" | "draining";
  subjectKey: string;
  pilotSubjects: readonly string[];
  nativeCount: number;
  hasRegularSameAnchor: boolean;
  regularTeacherId: string | null;
  makeupTeacherId: string | null;
}): string | null {
  if (input.mode === "off" || input.nativeCount <= 0 || !input.pilotSubjects.includes(input.subjectKey)) return null;
  return decideSameDayNative({
    subjectKey: input.subjectKey,
    pilotSubjects: input.pilotSubjects,
    addingNative: true,
    nativeCount: input.nativeCount > 1 ? input.nativeCount : 0,
    hasRegularSameAnchor: input.hasRegularSameAnchor,
    regularTeacherId: input.regularTeacherId,
    makeupTeacherId: input.makeupTeacherId,
  });
}
