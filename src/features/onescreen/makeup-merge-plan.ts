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
  /** 반 이름 — **표시 전용**(확인창 선택지·요약 문장). 판정은 `classId`로만 한다. 호출부가 채우고, 없으면 행 이름(`name`)을 쓴다. */
  className?: string | null;
  /**
   * 이번 **보강 시수의 기본값**(확인창 입력칸) — 그 반 정규 1회분. 보통 `attendanceUnits`와 같지만
   * 🔴 **조퇴 행은 다르다**: 조퇴 칸의 저장 시수는 일찍 가서 줄여 둔 값(예: 0.5)일 수 있어, 그걸 보강 기본값으로 쓰면
   *    보강 1회가 조퇴분만큼 깎여 들어간다(급여 과소). 조퇴면 수학 자동 시수(수업 길이), 없으면 null(=확인창 기본 1).
   *    키가 없으면(옛 호출부) `attendanceUnits`를 쓴다.
   */
  makeupBaseUnits?: number | null;
};

/**
 * 합치기(정규+보강)로 **시수를 올려도 되는 출결 상태** — 기록 없음 · 출석 · 지각 · 조퇴.
 *  · 결석·공결: 정규를 빠지고 보강만 한 것이라 "정규+보강"이 아니고, 애초에 시수 소비 대상도 아니다.
 *  · 보강(makeup) raw: 이미 보강 칸이다 — 또 얹으면 한 번의 보강이 두 번 잡힌다.
 *  · 조퇴(원장 2026-09-30 *"조퇴한 날도 합리적으로"*): 예전엔 뺐다 — 합칠 때 status를 pill 3종으로 되쓰면
 *    조퇴가 출석으로 조용히 바뀌기 때문이었다('축약 되쓰기'). 이제 `mergeStatusOf`가 **조퇴를 조퇴로 돌려주고**
 *    쓰기 경로(setAttendanceCell)가 조퇴를 받으므로 보존된다. 조퇴는 시수 소비 상태(COUNTABLE_STATUSES)라
 *    급여·정산(tier-rows)이 그 칸의 시수를 그대로 센다 — 보강분 +N이 사라지지도 두 번 잡히지도 않는다.
 *    옛 체크박스 경로가 없어진 뒤로 조퇴 날엔 합칠 길이 아예 없었다.
 * 대상에서 빠지면 **묻지 않고 별도 보강 행**이 생긴다(합치기만 안 될 뿐 기록은 남는다).
 */
export const MERGEABLE_RAW: ReadonlySet<string> = new Set(["", "present", "late", "early_leave"]);

/** 판정 입력 — 화면 state에서 필요한 필드만. */
export type PlanSubject = {
  name: string;
  subjectKey?: string;
  classId?: string | null;
  makeup?: boolean;
  attendanceRaw?: string | null;
  attendanceUnits?: number | null;
  /** 출결이 없을 때 처음 찍으면 들어갈 수학 자동 시수(수업 길이, attendance/auto-units.ts). */
  attendanceAutoUnits?: number | null;
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
      // 🔴 출결이 **없는** 행의 '지금 값'은 처음 찍으면 들어갈 수학 자동 시수다(화면 '타임' 칸이 보여 주는 값,
      //    2026-09-11). 안 그러면 확인창·합산이 1을 기준으로 삼아 화면(1.5)과 저장(1+보강)이 갈린다.
      attendanceUnits: su.attendanceRaw ? (su.attendanceUnits ?? null) : (su.attendanceAutoUnits ?? su.attendanceUnits ?? null),
      // 조퇴 칸의 저장 시수는 줄여 둔 값일 수 있다 — 보강 기본값은 정규 1회분(자동 시수, 없으면 확인창 기본값).
      ...(su.attendanceRaw === "early_leave" ? { makeupBaseUnits: su.attendanceAutoUnits ?? null } : {}),
    }));
  return candidates.length > 0 ? { kind: "ask", candidates } : { kind: "separate" };
}

/** 합칠 출결 상태 = 합칠 수 있는 출결 상태 중 **지금 칸에 적힌 것**(기록 없음은 출석으로 연다). */
export type MergeStatus = "present" | "late" | "early_leave";

/**
 * 합칠 때 되쓸 출결 상태 — 지각은 지각, **조퇴는 조퇴로 보존**하고, 그 밖(기록 없음·출석)은 출석으로 찍는다.
 * 🔴 조퇴를 출석으로 접지 말 것 — 조퇴 칸에 보강을 합쳐도 그날 조퇴한 사실은 그대로다(원장 2026-09-30).
 */
export function mergeStatusOf(raw: string | null | undefined): MergeStatus {
  return raw === "late" ? "late" : raw === "early_leave" ? "early_leave" : "present";
}

/** 확인창 보강 시수 기본값 — `makeupBaseUnits`가 실려 있으면(조퇴) 그것, 아니면 그 칸의 지금 시수. null = 호출부 기본값. */
export function makeupBaseUnitsOf(c: Pick<MergeCandidate, "attendanceUnits" | "makeupBaseUnits">): number | null {
  return c.makeupBaseUnits !== undefined ? c.makeupBaseUnits : c.attendanceUnits;
}

/** 합친 뒤의 수업타임 = 지금 값(미입력=1) + 1. 정규 1 + 보강 1 = 2가 기본. */
export function mergedUnits(current: number | null | undefined): number {
  return (current ?? 1) + 1;
}
