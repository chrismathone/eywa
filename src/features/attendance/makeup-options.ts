/**
 * 보강이 메울 **결석 후보** 정리(순수 · Vitest) — "며칠자 결석분인가"를 손으로 적는 대신 고르게 한다.
 *
 * 원장 2026-08-19: *"반이동으로 인해 반이 이동했는데 이전 수업을 이월해 보강할 수도 있을테니까."*
 * 그래서 후보는 **지금 수강 중인 반이 아니라 출결 기록**에서 뽑는다 — 반을 옮겨도 옛 반의 결석 기록은
 * 그 반 이름으로 남아 있으므로, 이월 보강이 자연히 후보에 들어온다(수강 여부로 거르면 사라진다).
 *
 * 🔴 **보강한 날은 후보가 아니다** — 출석부가 (반·학생·날짜) 한 칸이라 "결석 0 그대로 + 보강 시수"를
 *    동시에 적을 자리가 없다(그 경우는 합침이거나 '추가 보강'이다). 서버도 같은 이유로 거절한다.
 * ⚠️ 같은 날 같은 반에 **교시 수만큼 행이 있다**(slot_start) — 실측 한 학생 하루 3행. 화면엔 한 줄로 접는다.
 */

/** 결석 후보 한 줄(화면·판정에 필요한 것만). */
export type MakeupAbsenceOption = {
  classId: string;
  className: string;
  /** YYYY-MM-DD */
  date: string;
  /** 지금은 그 반 수강이 아님(반 이동·수강 종료 뒤) — 화면에 "이전 반"으로 밝힌다. */
  pastClass?: boolean;
  /**
   * 이미 보강으로 메운 결석 — 그 칸 메모에 "N/N 보강 예정·완료"가 남아 있다.
   * 🔴 목록에서 지우지 않고 **표시만** 한다: 같은 결석을 두 번 메우는 오조작은 막아야 하지만,
   *    보이지 않으면 "왜 내 결석이 목록에 없지"가 된다(멱등은 같은 날짜쌍만 막는다).
   */
  alreadyMadeUp?: boolean;
  /**
   * 그날 그 반의 결석 **교시**("HH:MM", 이른 순) — 하루에 여러 교시를 도는 반(JJ실·영어)에서 어느
   * 수업의 결석인지 밝힌다. 교시 없이 하루 단위로 찍힌 결석은 비어 있다.
   * 🔴 **교시 '이름'을 붙이지 않는다** — 시작시각이 같은 교시가 둘 있어(EiE 4교시 16:20~17:00 /
   *    IJW 1교시 16:20~17:20) 이름으로 옮기면 조용히 다른 교시로 보인다([[#106]]). 시각이 사실이다.
   */
  slots?: string[];
};

/** 원본 출결 행(중복·정렬 전). */
export type AbsenceRow = {
  classId: string;
  className: string | null;
  date: string;
  /** 그 결석 칸의 메모 — "N/N 보강 예정"이 있으면 이미 메운 결석이다. */
  note?: string | null;
  /** 그 칸의 교시("HH:MM[:SS]") — 하루 단위로 찍힌 결석은 없다(null). */
  slotStart?: string | null;
  /**
   * 그 결석이 난 **반의 과목 키**(`classes.subject`) — 앵커 반과 맞는 것만 남기는 기준.
   * 🔴 화면에 그대로 쓰지 않는다(raw 키 노출 금지) — 판정에만 쓰고, 라벨은 학원설정이 단일 소스다.
   */
  subject?: string | null;
};

/**
 * 확인창이 받는 결석 후보 한 벌 — 목록 + **왜 이만큼인지**.
 * 🔴 배열만 돌려주면 "0건"의 뜻이 갈린다(결석이 없다 ↔ 과목이 달라 뺐다). 화면이 이유를 말할 수 있게
 *    숨긴 건수를 함께 준다.
 */
export type MakeupAbsenceList = {
  options: MakeupAbsenceOption[];
  /** 앵커 반과 과목이 달라 목록에서 뺀 후보 수(0 = 아무것도 안 걸렀다). */
  hiddenBySubject: number;
  /**
   * 보강 기한(결석한 달의 다음 달 말일, `makeupDeadlineOf`)이 지나 뺀 후보 수 — **강사뷰에서만** 거른다.
   * 없거나 0 = 안 걸렀다(사무실 화면은 1년치를 그대로 본다).
   */
  hiddenByDeadline?: number;
  /**
   * 기준 과목의 **화면 라벨**(학원설정 단일 소스) — 서버가 채운다. 설정에 없는 키면 비운다
   * (raw 키를 화면에 흘리지 않는다).
   */
  subjectLabel?: string;
};

/**
 * **보강 기한** = 결석한 달의 **다음 달 말일**(원장 2026-09-18 *"강사뷰 보강 추가할때 1개월 초과된 보강은
 * 보여주지말것. 월 기준으로. 9월 결석이면 10월 마지막날까지 보강 가능."*).
 * 🔑 날짜 수(30일)가 아니라 **달**로 센다 — 9/1 결석도 9/30 결석도 10/31까지다. 12월 결석은 이듬해 1/31.
 * @param absenceDate YYYY-MM-DD(형식이 아니면 빈 문자열 — 판정하지 않는다)
 */
export function makeupDeadlineOf(absenceDate: string): string {
  const m = /^(\d{4})-(\d{2})-\d{2}/.exec(absenceDate);
  if (!m) return "";
  // 다음 달 말일 = 다다음 달 0일(월 인덱스는 0부터라 1부터 센 달 번호 + 1이 곧 다다음 달 인덱스다).
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) + 1, 0)).toISOString().slice(0, 10);
}

/**
 * 이 결석을 그날(`makeupDate`) 보강으로 메울 수 있나 — 기한 안이면 참.
 * 🔴 **선보강**(결석일이 보강일보다 뒤 — 시험 직전에 당겨 하는 보강)은 언제나 참이다. 기한은 지난 결석에만 건다.
 * ⚠️ 형식이 아닌 날짜는 참(모르는 것을 막지 않는다 — 막으면 후보가 조용히 사라진다).
 */
export function isWithinMakeupDeadline(absenceDate: string, makeupDate: string): boolean {
  const deadline = makeupDeadlineOf(absenceDate);
  if (!deadline || !/^\d{4}-\d{2}-\d{2}$/.test(makeupDate)) return true;
  return makeupDate <= deadline;
}

/**
 * 기한이 지난 결석을 막을 때의 한 문장 — 확인창·서버 쓰기 문이 **같은 문장**을 쓴다(표면마다 딴말 금지).
 * 예: `보강 기한이 지난 결석입니다 — 5월 결석은 6/30까지 보강할 수 있습니다`
 */
export function makeupDeadlineMessage(absenceDate: string): string {
  const deadline = makeupDeadlineOf(absenceDate);
  if (!deadline) return "보강 기한이 지난 결석입니다";
  const [, dm, dd] = deadline.split("-");
  return `보강 기한이 지난 결석입니다 — ${Number(absenceDate.slice(5, 7))}월 결석은 ${Number(dm)}/${Number(dd)}까지 보강할 수 있습니다`;
}

/** 결석 칸 메모의 보강 표시 — `absenceMemo()`가 남기는 "7/16 보강 예정 · 보강 완료" 형태. */
const MADE_UP_RE = /\d{1,2}\/\d{1,2}\s*보강\s*(예정|완료)/;

/**
 * 앵커 반(지금 보강을 넣는 반)의 과목과 **맞는 결석인가** — 비대칭 규칙(`english-track.ts` 선례와 같은 결).
 *
 * 🔴 **거르는 쪽이 아니라 남기는 쪽이 기본**이다. 후보가 사라지면 보강을 못 넣는데, 그 실패는 화면에
 *    "결석이 없다"로만 보여 원인을 알 수 없다. 그래서 모르면 통과시킨다:
 *  · 앵커 과목을 모르면(null·빈 문자열) **아무것도 안 거른다**.
 *  · 결석이 난 반의 과목이 비어 있으면(미분류) **항상 통과**시킨다.
 *  · 둘 다 있을 때만 같은 과목인지 본다.
 */
/**
 * 앵커가 **없을 때**(반 보강이 아니라 그냥 보강 추가) 쓰는 기준 — **그 강사가 가르치는 과목**.
 *
 * 원장 2026-09-02: *"수학선생님이나 영어선생님이 보강 추가할때 본인 과목만 팝업되게 해줘. 전과목
 * 팝업되는데"* — 수학 강사 화면에 영어 반 결석이 줄줄이 떠서 잘못 고르면 영어 결석 칸에 메모가 갔다
 * (앵커가 있을 때는 2026-08-19에 이미 막았는데, 앵커가 없는 경로가 남아 있었다).
 *
 * 🔴 **비대칭은 위와 같다 — 모르면 통과**시킨다(후보가 사라지면 보강을 못 넣는데, 화면엔 "결석이
 *    없다"로만 보여 원인을 알 수 없다): 과목 목록이 비면(사무실 계정·담당 반 0개) 안 거르고,
 *    결석 반의 과목이 비어 있으면(미분류) 통과시킨다.
 */
export function subjectMatchesTeacher(
  teacherSubjects: readonly string[] | null | undefined,
  rowSubject: string | null | undefined,
): boolean {
  const allowed = (teacherSubjects ?? []).map((x) => (x ?? "").trim()).filter(Boolean);
  if (allowed.length === 0) return true;
  const row = (rowSubject ?? "").trim();
  if (!row) return true;
  return allowed.includes(row);
}

export function subjectMatchesAnchor(
  anchorSubject: string | null | undefined,
  rowSubject: string | null | undefined,
): boolean {
  const anchor = (anchorSubject ?? "").trim();
  if (!anchor) return true;
  const row = (rowSubject ?? "").trim();
  if (!row) return true;
  return row === anchor;
}

/**
 * 결석 행을 화면에 쓸 후보로 접는다 — (반,날짜) 중복 제거 + 최신순 + 보강일 제외 + 과목 필터.
 * @param makeupDate 보강을 실제로 한 날 — 이 날은 후보에서 뺀다(위 🔴).
 * @param currentClassIds 지금 수강 중인 반 id 집합 — 여기 없으면 '이전 반'으로 표시한다.
 * @param anchorSubject 보강을 넣는 반의 과목 키 — 다른 과목 결석을 목록에서 뺀다(위 비대칭 규칙).
 *   🔴 클라가 넘긴 문자열이 아니라 **서버가 앵커 classId로 조회한 값**이어야 한다.
 */
export function buildAbsenceOptions(
  rows: readonly AbsenceRow[],
  makeupDate: string,
  currentClassIds: ReadonlySet<string> = new Set(),
  anchorSubject?: string | null,
  /**
   * 앵커 과목이 **없을 때만** 쓰는 폴백 — 그 강사가 가르치는 과목들(원장 2026-09-02).
   * ⚠️ 앵커가 있으면 이 값은 무시된다(앵커가 더 정확한 기준이다 — 그 반의 과목이 곧 답이다).
   */
  teacherSubjects?: readonly string[] | null,
  /**
   * 보강 기한으로 거를지(`isWithinMakeupDeadline`) — **강사뷰만** 참(원장 2026-09-18). 사무실 화면은 정정·이월을
   * 손보는 자리라 1년치를 그대로 본다.
   */
  opts?: { deadline?: boolean },
): MakeupAbsenceList {
  // 같은 (반,날짜)의 교시별 행을 **접으면서** 교시를 모은다 — 첫 행만 보고 버리면 "어느 수업의
  // 결석인지"가 사라지고, 보강 메모가 뒤 행에만 있는 경우 '보강 완료' 표시도 놓친다.
  const folded = new Map<
    string,
    { option: MakeupAbsenceOption; slots: Set<string>; madeUp: boolean; subject: string | null }
  >();
  for (const r of rows) {
    const date = String(r.date).slice(0, 10);
    if (!r.classId || !date || date === makeupDate) continue;
    const key = `${r.classId}|${date}`;
    const madeUp = MADE_UP_RE.test(r.note ?? "");
    const slot = slotLabel(r.slotStart);
    const hit = folded.get(key);
    if (hit) {
      if (slot) hit.slots.add(slot);
      hit.madeUp = hit.madeUp || madeUp;
      continue;
    }
    folded.set(key, {
      option: {
        classId: r.classId,
        // 반 이름이 비면 그렇게 적는다 — 빈 칸을 만들지 않는다(무엇을 고르는지 모르게 된다).
        className: r.className?.trim() || "(반 이름 없음)",
        date,
        ...(currentClassIds.has(r.classId) ? {} : { pastClass: true }),
      },
      slots: new Set(slot ? [slot] : []),
      madeUp,
      // 같은 (반,날짜)의 행들은 같은 반이라 과목도 같다 — 첫 행의 값이 그 후보의 과목이다.
      subject: r.subject ?? null,
    });
  }
  // 과목이 다른 후보는 **뺀 건수를 세어** 함께 돌려준다 — 조용히 사라지면 화면이 "결석이 없다"고
  // 거짓말하게 된다(수학 보강인데 영어 결석뿐인 학생이 실측 29명).
  const all = [...folded.values()];
  const anchor = (anchorSubject ?? "").trim();
  const kept = all.filter((f) =>
    anchor ? subjectMatchesAnchor(anchor, f.subject) : subjectMatchesTeacher(teacherSubjects, f.subject),
  );
  // 기한은 과목 필터 **뒤**에 센다 — 두 숫자가 겹치지 않아야 화면 문장이 참이다(한 결석을 두 번 세지 않는다).
  const live = opts?.deadline ? kept.filter((f) => isWithinMakeupDeadline(f.option.date, makeupDate)) : kept;
  const out: MakeupAbsenceOption[] = live.map(({ option, slots, madeUp }) => ({
    ...option,
    ...(madeUp ? { alreadyMadeUp: true } : {}),
    ...(slots.size > 0 ? { slots: [...slots].sort() } : {}),
  }));
  return {
    options: out.sort((a, b) =>
      a.date < b.date ? 1 : a.date > b.date ? -1 : a.className.localeCompare(b.className, "ko"),
    ),
    hiddenBySubject: all.length - kept.length,
    ...(opts?.deadline ? { hiddenByDeadline: kept.length - live.length } : {}),
  };
}

/** 저장된 교시 시각을 화면용 "HH:MM"으로 — 형식이 아니면 버린다(추측해서 만들지 않는다). */
function slotLabel(raw: string | null | undefined): string | null {
  const m = /^(\d{2}):(\d{2})/.exec(String(raw ?? "").trim());
  return m ? `${m[1]}:${m[2]}` : null;
}

/** 화면 표기 — "8/12 수학 초4 BS1J 16:20" · 이전 반이면 꼬리표를 단다. */
export function absenceOptionLabel(o: MakeupAbsenceOption): string {
  const [, m, d] = o.date.split("-");
  const tags = [o.pastClass ? "이전 반" : null, o.alreadyMadeUp ? "보강 완료" : null].filter(Boolean);
  // 하루 여러 교시를 도는 반이면 어느 수업의 결석인지 시각으로 밝힌다(교시 이름은 안 쓴다 — 위 🔴).
  const slots = o.slots?.length ? ` ${o.slots.join("·")}` : "";
  return `${Number(m)}/${Number(d)} ${o.className}${slots}${tags.length ? ` (${tags.join(" · ")})` : ""}`;
}
