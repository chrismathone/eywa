// 수업보고서 → 출결 파생 — 순수 함수(Vitest).
//
// 2026-07-21 원장 지시: *"출석부를 수업보고서 발송건으로 대체. 특별한 일이 없으면 수업보고서가 존재하면
// 해당 날짜에 1, 수업 등원일임에도 수업보고서가 찍혀있지 않으면 0. 이건 수학만. 영어는 출석부 미작동."*
//
// 배경: `attendance_records` 입력이 2026-06-09에서 사실상 멈춰(7월 2행) 출석부가 텅 비어 있었다. 반면
// 수업보고서는 계속 쌓인다(7월 1,248건). 등원 슬롯 대비 보고서 존재율은 실측 6월 82% / 7월 78%.
//
// ⚠️ **읽기 시점 파생이다 — `attendance_records`에 쓰지 않는다.** 그 테이블은 시수 검증 RPC(0103a/0115a)를
// 통해 **청구=N회 모델의 실 소비**로, 그리고 강사 급여 정산으로 흘러간다. 파생값을 써넣으면 돈 계산이
// 조용히 바뀐다(골든마스터 대상). 수기 기록은 언제나 진실이고, 파생은 **빈 칸을 메우는 것뿐**이다.

/** 파생을 적용할 과목 키. 영어는 출석부 미가동(구축만) — 켤 때 여기에 "english" 추가. */
export const DERIVED_ATTENDANCE_SUBJECTS: ReadonlySet<string> = new Set(["math"]);

/**
 * "수업보고서가 있다"의 기준 — 원장 표현은 "발송된 수업보고서"였으나 **작성됨**을 기본으로 둔다.
 *
 * 출결이 답해야 할 질문은 "그날 수업이 있었나"이지 "발송에 성공했나"가 아니다. 발송 실패·보류분까지
 * 결석으로 뒤집으면 **강사는 수업하고 보고서도 썼는데 학생이 결석 처리**된다.
 * ⚠️ 실측(2026-07): 등원 슬롯 대비 보고서 존재 78% vs 발송완료 67% — 기준을 바꾸면 출석률이 ~11%p 움직인다.
 * 발송 성공만 인정하려면 이 값을 true로 (쿼리가 `classnote_status='success'`를 건다).
 */
export const REQUIRE_SENT_REPORT = false;

export function isDerivedAttendanceSubject(subject: string | null | undefined): boolean {
  return !!subject && DERIVED_ATTENDANCE_SUBJECTS.has(subject);
}

export type DerivedMark = "present" | "absent";

/**
 * 한 학생의 등원일 × 보고서 유무 → 파생 출결.
 *
 * - `manualDates`(수기 기록 있는 날)는 **건드리지 않는다** — "특별한 일"은 사람이 적은 게 이긴다.
 * - 보고서가 있으면 `present`(미래 날짜여도 — 보고서가 있다는 건 수업이 있었다는 뜻).
 * - 보고서가 없으면 **`today` 이전 날짜만** `absent`. 오늘·미래는 아직 수업 전일 수 있어 **판정하지 않는다**
 *   (이 가드가 없으면 이번 달 남은 날이 전부 결석으로 찍힌다).
 */
export function deriveMarksFromReports(input: {
  attendDates: readonly string[];
  reportDates: ReadonlySet<string>;
  manualDates: ReadonlySet<string>;
  today: string;
  /**
   * **판정 보류일** — 이 학생이 그날 같은 과목의 **다른 반**에 보고서를 남긴 날(0134a).
   *
   * 🔴 왜 필요한가: 실데이터에 "한 수업, 두 수강행"이 있다(같은 강사가 같은 요일에 같은 학생을 두 반에
   *    걸어 둔 형태 — 이유정 전주율 BS3E+BS2G, 김은정 김지호 CR1C+CR1D 등). 강사는 그 수업을 **한 번**
   *    가르치고 보고서도 **한 건** 쓴다. 보고서를 반 단위로 좁힌 뒤 이 보류가 없으면, 짝 반의 그 날짜가
   *    매주 영구히 **결석**으로 찍힌다 — 실제로는 온 학생인데.
   *    (실측 2026-07-22: 이 규칙 없이는 6칸이 즉시 거짓 결석 — 마수호 JJPS 5칸·김은정 JJ1E 1칸.)
   * 규약: **출석으로 올려주지도 않는다.** 그 반 수업이 실제로 있었는지 여기선 알 수 없다.
   *    "모르면 아무 말도 하지 않는다" — 빈 칸으로 두고 사람이 채우게 한다.
   */
  siblingReportDates?: ReadonlySet<string>;
  /**
   * **'수업보고서 미발송' 반**(0174a)인가 — true면 "보고서 없음 = 결석" 규칙만 끈다.
   *
   * 🔴 왜 필요한가: 그 반은 앞으로 보고서가 **영구히 0건**이라, 이 가드가 없으면 지난 등원일이 전부
   *    결석으로 뒤집히고 출석률이 0%로 표시된다 — 토글 하나가 실데이터를 거짓말하게 만든다.
   * ⚠️ 반대로 **'출석'은 그대로 살린다** — 토글 켜기 전에 쌓인 보고서는 "그날 수업이 있었다"는 사실이고,
   *    파생을 통째로 끄면 그 사실까지 빈칸으로 지워진다. 모르는 건 비우되, 아는 건 지우지 않는다.
   */
  reportOptoutClass?: boolean;
}): Record<string, DerivedMark> {
  const out: Record<string, DerivedMark> = {};
  for (const date of input.attendDates) {
    if (input.manualDates.has(date)) continue;
    if (input.reportDates.has(date)) {
      out[date] = "present";
    } else if (input.siblingReportDates?.has(date)) {
      // 같은 과목 다른 반에 그날 보고서가 있다 → 이 반의 결석을 단정하지 않는다(위 🔴).
      continue;
    } else if (input.reportOptoutClass) {
      // 보고서를 안 쓰기로 한 반 — 없는 게 정상이라 결석의 근거가 되지 않는다(빈칸 = 사람이 채운다).
      continue;
    } else if (date < input.today) {
      out[date] = "absent";
    }
  }
  return out;
}

/**
 * 보고서 한 건이 **이 반 출석부에 무엇으로 쓰이나** — 파생 근거 분류의 단일 소스.
 *
 * - `own`   = 이 반의 정규 수업 근거(출석으로 파생)
 * - `hold`  = **판정 보류**(출석도 결석도 아님 — 빈 칸으로 두고 사람이 채운다)
 * - `ignore`= 이 출석부와 무관(다른 과목)
 *
 * 🔴 **보강 보고서(`makeup`)는 언제나 `hold`다.** 보강은 그 반의 정규 수업이 아니고, 이제
 *    **보이지 않는 '보강' 반**(0241a)에 제 칸이 따로 선다. 파생이 같은 보고서를 정규 반 출석으로도
 *    세면 한 수업이 두 칸이 된다 — 원장 제보 2026-09-02: *"결론적으로는 수업을 1회 했는데,
 *    보강1, 본수업1로 되어버렸네"*(이윤 9/2: 보강 반 보라 1 + JJ2I 초록 1).
 *    반이 비어 있다(`classId === null`)는 이유로 '이 반 것'으로 보던 종전 규약의 구멍이었다.
 * 🔴 그렇다고 **결석으로 보내지 않는다** — 그날 정규 수업이 실제로 있었는지 여기선 알 수 없다.
 *    "모르면 아무 말도 하지 않는다"(짝 반 보류와 같은 자리).
 * ⚠️ 반이 박힌 보강(반 보강)도 같다 — 그쪽은 그 반에 `makeup` 출결이 **직접** 찍힌다.
 * ⚠️ 반 미상(`classId === null`)이면서 보강이 **아닌** 보고서는 종전대로 `own`이다
 *    (이관분·관리자 작성 — 그게 유일한 근거인 날이 많다).
 */
export function reportEvidenceKind(input: {
  makeup: boolean | null | undefined;
  classId: string | null;
  selectedClassId: string;
  sameSubjectClassIds: ReadonlySet<string>;
}): "own" | "hold" | "ignore" {
  if (input.makeup === true) return "hold";
  if (!input.classId || input.classId === input.selectedClassId) return "own";
  return input.sameSubjectClassIds.has(input.classId) ? "hold" : "ignore";
}
