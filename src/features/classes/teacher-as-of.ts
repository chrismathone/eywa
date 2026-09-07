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
 * ⚠️ 창은 원래 **2개월**이었다 — 그때는 반이 연결된 보고서가 539행뿐이라 "그 밖의 과거는 기록이 희박"이
 *    사실이었기 때문이다(2026-08-04). 🔴 **2026-09-07에 그 전제가 바뀌었다**: edutrix 이관분 6,198행에
 *    반을 되살려(`scripts/_oneoff/backfill-edutrix-report-class.mjs`, 원장 *"됐어 최대한 채우면 된다"*)
 *    2026-02~06 구간에 **(반,달) 근거 227개·보고서 5,411행**이 새로 생겼는데, 창이 2개월이면 그 전부가
 *    창 밖이라 화면에선 여전히 `—`다(채워 놓고 안 보는 꼴). 그래서 12개월로 넓힌다.
 * ⚠️ 대가(실측 2026-09-07): 이 조회가 3,318행·4페이지·251ms → **8,729행·9페이지·332ms**(+81ms).
 *    **지난 주/지난 수업을 볼 때만** 도는 조회라
 *    감수한다. 월 ~1,700행씩 늘어나므로 더 무거워지면 다음 수는 창을 다시 좁히는 게 아니라
 *    **(반,달,작성자) group-by RPC**다(B2 규칙 그대로 — 전건을 JS로 끌어와 세는 지금 모양이 원인).
 */

/** 되살리는 창(개월). 넓히려면 서버 조회 범위도 같이 넓혀야 한다 — 한 곳에서만 바꾸도록 상수로. */
export const TEACHER_HISTORY_MONTHS = 12;

/** 인수인계 감사로그 한 건 — "이 날부터 이 사람"(사실). */
export type TeacherTransition = {
  classId: string;
  /** YYYY-MM-DD — 적용일. */
  date: string;
  teacherName: string | null;
  /**
   * 새 담임의 user id(`metadata.newTeacherId`). 모르면 null.
   *
   * 🔴 이름과 **다른 질문**에 쓰인다 — 아래 `buildHomeroomSinceIndex` 주석 참조. 같은 로그에서 나오지만
   *    이름은 표시용(동명이인·개명에 흔들린다)이고 id는 판정용(사람을 확정한다)이다.
   */
  teacherId?: string | null;
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

// ──────────────────────────────────────────────────────────────────────────────
// "언제부터 이 사람이 이 반 담임인가"(id 기준) — 위 `resolveTeacherAsOf`와 **다른 질문**이다.
// ──────────────────────────────────────────────────────────────────────────────

/**
 * 🔴 왜 위 함수로 답하지 않나(같은 모듈·같은 원자료를 쓰면서 함수를 나눈 이유):
 *
 *  · **묻는 것이 다르다.** 위는 "그 날짜의 담임이 **누구**였나"(표시용 이름)이고, 여기는 "이 **사람**이
 *    언제부터 담임인가"(경계 날짜)다. 앞은 매 칸마다 이름을 뽑아야 하고, 뒤는 반·사람당 날짜 하나면 된다.
 *  · **폴백이 달라야 한다.** 위는 근거가 없으면 **그 달 보고서 작성자**로 추정한다(`inferred`). 그 폴백을
 *    여기 쓰면 안 된다 — 작성자는 담임이 아니고([[#93]] 사무실 대리 작성), "작성 기록이 8/3부터 있으니
 *    8/3부터 담임"은 **없는 사실을 만들어 남의 출결을 남의 표에서 지우는** 결과가 된다. 여기의 유일한
 *    근거는 감사로그이고, 없으면 **null**(= 지금처럼 전부 보여준다)이 정답이다.
 *  · **이름이 아니라 id로 판정해야 한다.** 화면이 좁히는 대상은 로그인한 그 사람이지 같은 이름이 아니다.
 *
 * 규칙: 그 반 전이를 날짜순으로 놓고 **맨 끝의 연속 구간**이 이 사람이면 그 구간의 **첫 날**.
 *   · 마지막 전이가 남이면 → null. DB의 현재 담임과 로그가 어긋난다는 뜻이라 지어내지 않는다
 *     (호출부는 "DB상 현재 담임"일 때만 물어보므로, 이 경우는 로그가 불완전한 것이다).
 *   · 같은 사람으로 연달아 찍힌 로그(재적용·중복)는 한 구간으로 접어 **더 이른 날**을 준다 —
 *     경계를 늦게 잡을수록 남의 화면에서 기록이 더 많이 사라지므로, 애매하면 **덜 지우는 쪽**으로.
 */
export type HomeroomSinceIndex = {
  /** `${classId}|${teacherId}` → 그 사람의 **현재 담임 구간 시작일**(YYYY-MM-DD). */
  byClassTeacher: Map<string, string>;
  /** 되살리기 창의 시작일 — 이보다 과거의 전이는 애초에 조회되지 않는다(호출부 안내용). */
  since: string;
};

export function buildHomeroomSinceIndex(
  transitions: readonly TeacherTransition[],
  since: string,
): HomeroomSinceIndex {
  const byClass = new Map<string, TeacherTransition[]>();
  for (const t of transitions) {
    if (!t.classId || !t.teacherId) continue; // 반이나 사람을 모르면 경계를 못 만든다
    const list = byClass.get(t.classId) ?? [];
    list.push(t);
    byClass.set(t.classId, list);
  }
  const byClassTeacher = new Map<string, string>();
  for (const [classId, list] of byClass) {
    // 같은 날 여러 건이면 입력 순서를 tie-break로 쓴다(조회가 created_at 오름차순으로 준다).
    const sorted = [...list].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const last = sorted[sorted.length - 1]!;
    let start = last.date;
    for (let i = sorted.length - 2; i >= 0; i--) {
      if (sorted[i]!.teacherId !== last.teacherId) break;
      start = sorted[i]!.date;
    }
    byClassTeacher.set(`${classId}|${last.teacherId}`, start);
  }
  return { byClassTeacher, since };
}

/**
 * 이 사람이 이 반 담임이 된 날. **근거가 없으면 null** — 호출부는 그때 아무것도 숨기지 않는다(안전벨트).
 */
export function homeroomSinceOf(
  index: HomeroomSinceIndex,
  classId: string,
  teacherId: string | null | undefined,
): string | null {
  if (!teacherId) return null;
  return index.byClassTeacher.get(`${classId}|${teacherId}`) ?? null;
}

/**
 * 반 이름 → id (**이름이 유일할 때만**). 중복 이름은 아예 담지 않는다.
 *
 * 🔴 이게 필요한 이유: `class_handover_apply` 감사로그는 metadata에 **classId를 남기지 않는다**
 *    (실측 2026-08-19: 최근 2개월 인계 로그 전건). 남는 단서는 `target_label`(그 시점 반 이름)뿐이라,
 *    이름으로 잇지 않으면 인계 기록이 통째로 버려진다.
 * ⚠️ 그래서 **잘못 붙이느니 비운다** — 이름이 둘 이상이면 후보를 못 고르므로 인덱스에서 뺀다.
 *    (실측 2026-08-19: 반 152개 중 중복 이름 0개라 지금은 전부 이어진다.)
 * ⚠️ 반 이름을 **바꾸면** 옛 로그의 label과 어긋나 그 전이는 조용히 사라진다 — 사실을 지어내는 것보다
 *    낫다는 판단이고, 그때는 `homeroomSinceOf`가 null이라 화면이 종전처럼 전부 보여 준다.
 */
export function buildUniqueClassNameIndex(
  rows: readonly { id: string; name: string | null }[],
): Map<string, string> {
  const seen = new Map<string, string | null>(); // name → id, 중복이면 null
  for (const r of rows) {
    const name = (r.name ?? "").trim();
    if (!name) continue;
    if (seen.has(name)) seen.set(name, null);
    else seen.set(name, r.id);
  }
  const out = new Map<string, string>();
  for (const [name, id] of seen) if (id) out.set(name, id);
  return out;
}

/**
 * 감사로그 한 건의 반 id — metadata가 있으면 그것, 없으면 **유일한** 반 이름으로 잇는다(위 주석).
 */
export function resolveTransitionClassId(input: {
  metaClassId?: string | null;
  targetLabel?: string | null;
  classIdByUniqueName: ReadonlyMap<string, string>;
}): string | null {
  // ⚠️ 원자료가 jsonb라 타입 단언이 거짓일 수 있다 — `String()`으로 감싸 `.trim()`이 던지지 않게 한다.
  const meta = String(input.metaClassId ?? "").trim();
  if (meta) return meta;
  const label = String(input.targetLabel ?? "").trim();
  if (!label) return null;
  return input.classIdByUniqueName.get(label) ?? null;
}
