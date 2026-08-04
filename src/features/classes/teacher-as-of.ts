/**
 * "그 주에 이 반 담임은 누구였나" **되살리기**(순수 · Vitest) — 원장 2026-08-04:
 * *"보고서를 기준으로 이전담임을 추측하는건 현명한것같네 … 이전주차가 되면 이전담임이 나오는걸로"*
 * + *"전부 할 필요는 없고 최근 2개월치면 이력으로 남기자"*.
 *
 * 🔴 **담임은 반 단위 속성이라 시간 축이 없었다.** 그래서 지난 주 시간표에도 늘 **현재 담임**이 나왔다
 *    (실측: 활성 반 62개는 슬롯에 담당이 아예 없어 반 담임을 상속 — 슬롯 행을 쪼개도 표시가 안 바뀐다).
 *    스키마를 늘리는 대신 **이미 있는 기록 두 가지**로 그 시점 담임을 복원한다.
 *
 * 근거의 등급이 다르므로 **섞지 않고 순서대로** 쓴다:
 *  ① `class_handover_apply` 감사로그(사실) — "이 날부터 이 사람". 연속된 인계 사이 구간이 확정된다.
 *  ② 그 달 **보고서 작성자**(추정) — 인계 기록이 없는 구간은 그 반 보고서를 실제로 쓴 사람으로 메운다.
 *     ⚠️ 작성자는 **담임이 아니다**(사무실 대리 작성이 설계된 동작, [[#93]]) → 반드시 `inferred: true`로
 *        표시해 화면이 "추정"임을 밝히게 한다. 단정하면 거짓이 된다.
 *  ③ 못 찾으면 **아무것도 만들지 않는다**(null) — 호출부가 현재 담임을 그대로 쓴다.
 *
 * ⚠️ 창은 **최근 2개월**(원장 지시). 그 밖의 과거는 애초에 기록이 희박해 추정 신뢰도가 낮고, 창을 넓히면
 *    시간표 한 번에 끌어오는 로그·보고서가 커진다(현재 실측: 인계 29건·반 연결 보고서 539행으로 가볍다).
 */

/** 되살리는 창(개월). 넓히려면 서버 조회 범위도 같이 넓혀야 한다 — 한 곳에서만 바꾸도록 상수로. */
export const TEACHER_HISTORY_MONTHS = 2;

/** 인수인계 감사로그 한 건 — "이 날부터 이 사람"(사실). */
export type TeacherTransition = {
  classId: string;
  /** YYYY-MM-DD — 적용일. */
  date: string;
  teacherName: string | null;
};

/** 그 달 이 반 보고서를 쓴 사람(추정 근거). 같은 달에 여러 명이면 건수가 많은 쪽. */
export type MonthlyWriter = {
  classId: string;
  /** YYYY-MM */
  month: string;
  teacherName: string;
  count: number;
};

export type TeacherAsOfIndex = {
  /** classId → 적용일 오름차순 전이 목록. */
  transitions: Map<string, TeacherTransition[]>;
  /** `${classId}|${YYYY-MM}` → 그 달 최다 작성자 이름. */
  writers: Map<string, string>;
  /** 되살리기 창의 시작일(YYYY-MM-DD) — 이보다 과거는 판정하지 않는다. */
  since: string;
};

export type ResolvedTeacher = {
  name: string;
  /** true = 보고서 작성 기록으로 **추정**한 값(화면이 그렇게 밝혀야 한다). */
  inferred: boolean;
};

/** 원자료 → 조회용 인덱스. 같은 달 작성자가 여럿이면 건수 많은 쪽(동수면 이름 순으로 결정적). */
export function buildTeacherAsOfIndex(input: {
  transitions: TeacherTransition[];
  writers: MonthlyWriter[];
  since: string;
}): TeacherAsOfIndex {
  const transitions = new Map<string, TeacherTransition[]>();
  for (const t of input.transitions) {
    if (!t.teacherName) continue; // 이름을 모르면 이력이 못 된다(빈 칸을 지어내지 않는다)
    const list = transitions.get(t.classId) ?? [];
    list.push(t);
    transitions.set(t.classId, list);
  }
  for (const list of transitions.values()) list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const best = new Map<string, MonthlyWriter>();
  for (const w of input.writers) {
    if (!w.teacherName) continue;
    const key = `${w.classId}|${w.month}`;
    const cur = best.get(key);
    if (!cur || w.count > cur.count || (w.count === cur.count && w.teacherName < cur.teacherName)) {
      best.set(key, w);
    }
  }
  const writers = new Map<string, string>();
  for (const [key, w] of best) writers.set(key, w.teacherName);

  return { transitions, writers, since: input.since };
}

/**
 * `date` 시점의 담임. 못 정하면 null(호출부가 현재 담임을 그대로 쓴다 — 빈 이름을 만들지 않는다).
 *
 * ⚠️ **전이가 date보다 뒤에만 있으면** 그 시점 담임은 감사로그로 알 수 없다(이전 담당을 안 적었으므로).
 *    그때 보고서 작성자로 넘어간다 — 이 폴백이 이 기능의 존재 이유다.
 */
export function resolveTeacherAsOf(
  index: TeacherAsOfIndex,
  classId: string,
  date: string,
): ResolvedTeacher | null {
  if (date < index.since) return null; // 창 밖 — 추정하지 않는다

  const list = index.transitions.get(classId);
  if (list && list.length > 0) {
    // 이 날짜 이하의 마지막 인계 = 그때부터 그 사람(사실).
    let last: TeacherTransition | null = null;
    for (const t of list) {
      if (t.date <= date) last = t;
      else break;
    }
    if (last?.teacherName) return { name: last.teacherName, inferred: false };
    // 인계가 전부 이 날짜보다 뒤 = 그때는 '지금 사람'이 아니었다는 것만 확실하다 → 보고서로.
  }

  const writer = index.writers.get(`${classId}|${date.slice(0, 7)}`);
  return writer ? { name: writer, inferred: true } : null;
}

/** 되살리기 창의 시작일 — `today`에서 N개월 전 1일. */
export function historyWindowStart(today: string, months = TEACHER_HISTORY_MONTHS): string {
  const [y, m] = today.slice(0, 10).split("-").map(Number);
  const d = new Date(Date.UTC(y!, (m ?? 1) - 1 - months, 1));
  return d.toISOString().slice(0, 10);
}
