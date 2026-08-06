/**
 * 보강 추가 시 "정규 보고서에 **합칠지 / 따로 낼지**" 판정 — 순수 함수(Vitest).
 *
 * 🔴 **자동으로 합치지 않는다**(원장 2026-08-06: *"선생님들이 헷갈린대"*). 2026-08-05에 넣은 자동 합치기는
 *    보강을 추가한 강사가 **아무 안내 없이** 정규 행이 "(정규+보강)"으로 바뀌고 수업타임이 2가 되는 걸
 *    보게 만들었다 — 본 사람이 결과를 예측할 수 없는 동작은 raw 의미 누출과 같은 종류의 문제다.
 *    → 합칠 후보가 있으면 **묻고**(합침 ↔ 분리 토글), 고른 대로만 한다.
 *
 * 합칠 수 있는 정규 행을 고르는 조건 — 셋 다 필요하다(하나라도 빠지면 **돈이 틀린다**):
 *  ① `!makeup && classId` — 이미 보강으로 표시된 행·반 없는 행은 대상이 아니다.
 *  ② **이 강사가 오늘 이 학생에게 가르치는 과목만**(teacherSubjectKeys) — 안 걸면 그 학생의 다른 과목
 *     정규 행까지 보강으로 찍히고 **시수가 같이 2배**가 된다(급여 반영 값이라 조용한 과지급).
 *  ③ **시수를 올려도 되는 상태만**(MERGEABLE_RAW) — 아래 상수 주석 참조.
 *
 * ⚠️ 후보가 둘 이상이어도 **추측하지 않는다** — 예전엔 "알 수 없어 합치지 않았습니다"라고 물러섰지만,
 *    이제 다이얼로그가 후보를 그대로 보여 주고 **강사가 고른다**(고르기 전엔 '합침'을 못 누른다).
 */

/** 합칠 수 있는 정규 행(다이얼로그 선택지) — 화면 state의 Subject에서 필요한 것만 좁힌 shape. */
export type MergeCandidate = {
  /** 카드/표 state 키(Subject.name) — 어느 행에 합칠지 지목하는 값. */
  name: string;
  /** 출결 원장 키. 합치기는 이 반의 session_units를 +1 한다. */
  classId: string;
  subjectKey: string;
  attendanceRaw: string | null;
  attendanceUnits: number | null;
};

/**
 * 합치기(정규+보강)로 **시수를 올려도 되는 출결 상태** — 기록 없음 · 출석 · 지각뿐이다.
 *  · 결석·공결: 정규를 빠지고 보강만 한 것이라 "정규+보강"이 아니고, 애초에 시수 소비 대상도 아니다.
 *  · 조퇴 등 3종 밖 raw: 시수를 올리려면 status를 함께 써야 하는데 pill 3종으로는 그 값을 되쓸 수 없다 —
 *    되쓰면 조퇴가 출석으로 조용히 바뀐다(이 코드베이스가 반복해 막아 온 '축약 되쓰기').
 * 대상에서 빠지면 **묻지 않고 별도 보강 행**이 생긴다(합치기만 안 될 뿐 기록은 남는다).
 */
export const MERGEABLE_RAW: ReadonlySet<string> = new Set(["", "present", "late"]);

/** 판정 입력 — 화면 state에서 필요한 필드만. */
export type PlanSubject = {
  name: string;
  subjectKey?: string;
  classId?: string | null;
  makeup?: boolean;
  attendanceRaw?: string | null;
  attendanceUnits?: number | null;
};

export type MakeupMergePlan =
  /** 합칠 정규 행이 없다 → 종전대로 별도 "(보강)" 행(묻지 않는다). */
  | { kind: "separate" }
  /** 이미 합쳐 둔 과목이 있다 → 또 만들지 않는다(두 번 누르면 결국 두 번 발송된다). */
  | { kind: "already"; subjects: string[] }
  /** 합칠 후보가 있다 → 강사에게 묻는다(합침 ↔ 분리). */
  | { kind: "ask"; candidates: MergeCandidate[] };

export function planMakeupMerge(
  subjects: readonly PlanSubject[],
  teacherSubjectKeys: ReadonlySet<string>,
): MakeupMergePlan {
  const mine = (su: PlanSubject) => !!su.subjectKey && teacherSubjectKeys.has(su.subjectKey);
  // 이미 합쳐 둔 과목(반 있는 보강 행) — 예전 "이미 보강 행이 추가되어 있습니다"와 같은 규약.
  const already = subjects.filter((su) => su.makeup && su.classId && mine(su)).map((su) => su.name);
  if (already.length > 0) return { kind: "already", subjects: already };

  const candidates: MergeCandidate[] = subjects
    .filter((su) => !su.makeup && !!su.classId && mine(su) && MERGEABLE_RAW.has(su.attendanceRaw ?? ""))
    .map((su) => ({
      name: su.name,
      classId: su.classId!,
      subjectKey: su.subjectKey!,
      attendanceRaw: su.attendanceRaw ?? null,
      attendanceUnits: su.attendanceUnits ?? null,
    }));
  return candidates.length > 0 ? { kind: "ask", candidates } : { kind: "separate" };
}

/** 합칠 때 되쓸 출결 상태 — 지각은 지각으로 보존하고, 그 밖(기록 없음·출석)은 출석으로 찍는다. */
export function mergeStatusOf(raw: string | null | undefined): "present" | "late" {
  return raw === "late" ? "late" : "present";
}

/** 합친 뒤의 수업타임 = 지금 값(미입력=1) + 1. 정규 1 + 보강 1 = 2가 기본. */
export function mergedUnits(current: number | null | undefined): number {
  return (current ?? 1) + 1;
}
