/**
 * LAB실 출석부의 **'따로 수업(*LAB)' 학생 배정** — 순수 규칙(IO 없음, Vitest). 0271b `enrollments.lab_separate`.
 *
 * 원장 2026-09-17: *"EiE 의 경우 토글 랩에 배정할 수 있게 따로 기능이 있어야겠어. '특정 요일만 등원' 이외에 하나 더"*
 * → 2026-09-18 *"계획대로 시작해봐"*. 반 상세 학생 줄의 EiE 토글로 켠다.
 *
 * 🔑 **교시 선택(0255a)의 '기본값'이다 — 새 명단 경로를 만들지 않는다.** 결과는 `(반|학생)` → 그 학생이 설
 *    **이 자리 교시들**이고, [`seatShowsAtPeriod`](./period-choice.ts)가 **선택이 없을 때만** 이 값을 본다.
 *    그래서 우선순위가 저절로 선다: 이미 찍힌 기록 → 하루 이동·상시 고정 → (없으면) 이 배정.
 *    화면('전체'·교시 하나)과 서버 쓰기 게이트(`rosterKeys`)가 같은 함수를 지나므로 둘이 갈리지 않는다.
 *
 * 🔑 규칙(그 날 그 반 기준):
 *    · 켠 학생 = 그 반의 **\*LAB 교시**에만 선다.
 *    · 끈 학생 = 그 반의 **일반 LAB 교시**에만 선다.
 * 🔴 **그 날 \*LAB 교시가 없는 반은 손대지 않는다** — 월요일엔 \*LAB이 없는데 켠 학생을 월요일 LAB에서 빼면
 *    그 학생은 그날 LAB 수업이 통째로 사라진다. 배정은 "그 날 반이 둘로 갈릴 때 어느 쪽인가"다.
 * 🔴 **그 반에 켠 학생이 한 명도 없으면 손대지 않는다** — 배정하기 전까지는 지금까지 화면 그대로(두 교시 모두에 선다).
 *    배포하자마자 \*LAB 교시 명단이 텅 비는 일을 막는다.
 * 🔴 **갈 교시가 없으면 손대지 않는다**(그 날 일반 LAB 없이 \*LAB만 도는 반의 끈 학생 등) — 명단에서 사람이
 *    사라지는 것이 이 화면의 최악이다(period-choice.ts와 같은 방향으로 실패한다).
 * ⚠️ 켠 학생 명단(`flagged`)을 **모르면**(조회 실패·칸 없음) 호출부가 이 함수를 부르지 않는다 — 모름을 "아무도
 *    안 켰다"로 읽는 것과 결과는 같지만, 그 사실은 호출부가 판단한다.
 */

/** 그 날 이 자리 교시 한 줄 — 반·시작("HH:MM")·\*LAB 여부. */
export type LabSplitSlot = { classId: string; start: string; separate: boolean };

/** `(반|학생)` 키 — 교시 선택(`seatChoiceKey`)과 같은 모양이다. */
export function labSplitKey(classId: string, studentId: string): string {
  return `${classId}|${studentId}`;
}

export function buildLabSplitDefaults(v: {
  /** 그 날 이 자리(랩실)의 교시들. */
  slots: readonly LabSplitSlot[];
  /** 반 → 그 날 이 자리 명단의 학생 id(등원 요일·수강 기간을 거친 뒤). */
  studentsByClass: ReadonlyMap<string, readonly string[]>;
  /** 켠 수강의 `(반|학생)` 키. */
  flagged: ReadonlySet<string>;
}): Record<string, string[]> {
  const sepByClass = new Map<string, Set<string>>();
  const allByClass = new Map<string, Set<string>>();
  for (const s of v.slots) {
    (allByClass.get(s.classId) ?? allByClass.set(s.classId, new Set()).get(s.classId)!).add(s.start);
    if (s.separate) (sepByClass.get(s.classId) ?? sepByClass.set(s.classId, new Set()).get(s.classId)!).add(s.start);
  }

  const out: Record<string, string[]> = {};
  for (const [classId, sepSet] of sepByClass) {
    const students = v.studentsByClass.get(classId) ?? [];
    if (!students.some((id) => v.flagged.has(labSplitKey(classId, id)))) continue;
    const sep = [...sepSet].sort();
    // 같은 시각에 줄이 둘이고 한쪽만 켜졌으면 그 시각은 *LAB 쪽이다(일반 쪽에 또 세우면 두 번 선다).
    const normal = [...(allByClass.get(classId) ?? [])].filter((s) => !sepSet.has(s)).sort();
    for (const id of students) {
      const key = labSplitKey(classId, id);
      const target = v.flagged.has(key) ? sep : normal;
      if (target.length > 0) out[key] = target;
    }
  }
  return out;
}
