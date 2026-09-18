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
 * 🔑 규칙(그 날 그 반 기준) — 판정 한 벌 = [`labSplitSlotShows`](#labSplitSlotShows), **자리 출석부·시간표 격자·원생 주간
 *    시간표가 같은 함수를 쓴다**(화면마다 다른 답이 나오면 "출석부엔 있는데 시간표엔 없다"가 된다):
 *    · 켠 학생 = 그 반의 **\*LAB 교시**에만 선다.
 *    · 끈 학생 = 그 반의 **일반 LAB 교시**에만 선다.
 * 🔴 **\*LAB 교시는 켠 학생 전용이다**(원장 2026-09-18 *"*lab 체크가 안된 학생은 *lab이 스케줄에 나오면 안됨.
 *    *lab은 *lab이 체크된 학생만 떠야함"*) — 그 반에 켠 학생이 하나도 없으면 그 교시 명단은 **빈다**.
 *    ⚠️ 2026-09-18 아침의 "켠 학생이 없으면 손대지 않는다"(배포 직후 빈 명단 방지) 가드를 원장이 같은 날 뒤집었다.
 * 🔴 **그 날 \*LAB 교시가 없는 반은 손대지 않는다** — 월요일엔 \*LAB이 없는데 켠 학생을 월요일 LAB에서 빼면
 *    그 학생은 그날 LAB 수업이 통째로 사라진다. 배정은 "그 날 반이 둘로 갈릴 때 어느 쪽인가"다.
 * 🔴 **끈 학생이 갈 일반 LAB이 그 날 없으면 손대지 않는다**(자리 교시가 전부 \*LAB인 날 — 실측 0건) — 명단에서
 *    사람이 사라지는 것이 이 화면의 최악이다(period-choice.ts와 같은 방향으로 실패한다).
 * ⚠️ 켠 학생 명단(`flagged`)을 **모르면**(조회 실패·칸 없음) 호출부가 이 함수를 부르지 않는다 — 모름을 "아무도
 *    안 켰다"로 읽는 것과 결과는 같지만, 그 사실은 호출부가 판단한다.
 */

/** 그 날 이 자리 교시 한 줄 — 반·시작("HH:MM")·\*LAB 여부. */
export type LabSplitSlot = { classId: string; start: string; separate: boolean };

/** `(반|학생)` 키 — 교시 선택(`seatChoiceKey`)과 같은 모양이다. */
export function labSplitKey(classId: string, studentId: string): string {
  return `${classId}|${studentId}`;
}

/**
 * **이 자리(LAB) 교시에 이 학생이 서는가** — 세 표면(자리 출석부·시간표 격자·원생 주간 시간표)의 판정 한 벌.
 * 🔴 강사 교시(일반 수업)엔 부르지 않는다 — 배정은 **자리(LAB) 교시를 가르는 것**이지 수업을 빼는 게 아니다.
 */
export function labSplitSlotShows(v: {
  /** 이 교시가 \*LAB 표식(0271a)인가. */
  slotSeparate: boolean;
  /** 이 학생이 그 반에서 \*LAB에 배정됐는가(0271b). */
  flagged: boolean;
  /** 그 날 그 반에 \*LAB 교시가 있는가 — 없으면 반이 안 갈리므로 아무것도 안 바꾼다. */
  dayHasSeparate: boolean;
  /** 그 날 그 반에 일반 LAB 교시가 있는가 — 끈 학생이 갈 자리가 없으면 안 뺀다. */
  dayHasNormal: boolean;
}): boolean {
  if (!v.dayHasSeparate) return true;
  if (v.flagged) return v.slotSeparate;
  if (!v.dayHasNormal) return true;
  return !v.slotSeparate;
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
    const all = [...(allByClass.get(classId) ?? [])].sort();
    // 같은 시각에 줄이 둘이고 한쪽만 켜졌으면 그 시각은 *LAB 쪽이다(일반 쪽에 또 세우면 두 번 선다).
    const dayHasNormal = all.some((s) => !sepSet.has(s));
    for (const id of students) {
      const key = labSplitKey(classId, id);
      const flagged = v.flagged.has(key);
      // 🔑 교시 목록은 위 판정 함수로 뽑는다 — 자리 출석부와 시간표가 같은 답을 내는 유일한 방법이다.
      const target = all.filter((start) =>
        labSplitSlotShows({ slotSeparate: sepSet.has(start), flagged, dayHasSeparate: true, dayHasNormal }),
      );
      // 전부 서면 배정이 아무것도 안 바꾼다는 뜻 — 기본값을 비워 종전 동작(다 세움)으로 둔다.
      if (target.length > 0 && target.length < all.length) out[key] = target;
    }
  }
  return out;
}
