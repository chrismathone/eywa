/**
 * 그날 출결 → 학부모 보고서 문장. 순수 모듈(Vitest).
 *
 * 원장 2026-10-26 *"영어 및 수학보고서에서 학생의 출결 상황에따라 그런 이야기가없는데 출결 현황에 따라 사유 등으로 멘트 반영되게
 * 출결은 다른데서 하고있으니까"* → 선택 *"상태 + 사유를 문장으로"*.
 *
 * 🔑 재료는 출석부와 **같은 칸**(`attendance_records.status`·`note`, 원스크린 행의 `attendanceRaw`·`attendanceNote`)이다 — 새로 묻지 않는다.
 * 🔑 문장은 **코드가 만든다**(AI에 맡기지 않는다) — 사유가 비었을 때 모델이 '늦잠'·'교통' 같은 이유를 지어낼 수 있다.
 *    그래서 사유가 없으면 상태만 적고, 있으면 강사·데스크가 적은 원문을 괄호 안에 그대로 옮긴다.
 * 🔑 **출석도 적는다**(원장 2026-10-26 *"학원삼이 출석처리되어있는데 그런 언급도없고 출석 지각 결석인지 확인도 안됌"*) — 종전엔 출석을
 *    말할 거리가 아니라고 뺐다. 출석·보강의 메모는 싣지 않는다(지각·조퇴·공결의 사유만 학부모 글에 들어간다).
 * ⚠️ 기록 없음·결석은 "" — 모르는 것을 '출석'으로 적지 않고, 결석한 날은 보고서 자체가 잠긴다(send-gate `absent`).
 */

/** 사유를 싣지 않는 상태 — 메모가 있어도 문장만. */
const PLAIN_SENTENCE: Record<string, string> = {
  present: "오늘 수업에 정상적으로 출석했습니다.",
  makeup: "오늘은 보강 수업에 출석했습니다.",
};

const STATUS_SENTENCE: Record<string, string> = {
  late: "오늘은 조금 늦게 도착했습니다",
  early_leave: "오늘은 수업 중간에 먼저 귀가했습니다",
  excused: "오늘은 공결로 처리되었습니다",
};

const REASON_MAX = 60;

/** 사유 원문 → 한 줄(개행·끝 마침표 정리, 길이 제한). */
function cleanReason(note: string | null | undefined): string {
  return (note ?? "")
    .replace(/\s*\n+\s*/g, " ")
    .trim()
    .replace(/[.。]+$/, "")
    .slice(0, REASON_MAX)
    .trim();
}

/**
 * 보강의 재료(원장 2026-10-26 *"보강 예약 혹은 보강이였으면 0월0일자 결석 보강 0시간 진행 과 같은 안내 멘트"* + *"보강이면 왜 보강을 들었는지
 * 선생님들한테 기입 받게"*). 결석 날짜·시간은 **이미 있는 기록**(보강 예약 `makeupReserved` — 결석분 날짜·시작·끝)에서 오고,
 * 그걸 못 찾을 때만 강사가 적은 `reason`이 붙는다(예약된 보강은 사유를 다시 묻지 않는다 · 사유는 선택 — 비어도 발송된다, 원장 2026-10-27).
 */
export type MakeupFacts = {
  /** 이 줄 자체가 보강 줄인가('(보강)' 줄). false = 정규 줄에 보강 예약이 합쳐진 '정규+보강'. */
  row: boolean;
  /** 결석분 날짜(YYYY-MM-DD) — 예약에서. 모르면 []. */
  absenceDates: readonly string[];
  /** 보강 시간(분) — 예약의 시작·끝에서. 모르면 null. */
  minutes: number | null;
  /** 시간을 예약에서 못 얻었을 때의 수업타임(출석부 `session_units`) — "N시간"으로 적는다. 모르면 null. */
  units: number | null;
  /** 강사가 적은 보강 사유(원문). */
  reason: string;
};

/** "HH:MM" 두 개 → 분(끝이 시작보다 늦을 때만). */
function spanMinutes(start: string, end: string): number | null {
  const toMin = (v: string) => {
    const m = /^(\d{1,2}):(\d{2})/.exec(v.trim());
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  const a = toMin(start);
  const b = toMin(end);
  return a != null && b != null && b > a ? b - a : null;
}

/**
 * 원스크린 줄 → 보강 재료. 줄의 모양으로 셋을 가른다(onescreen-client의 보강 줄 규약 그대로):
 *  · **보강 줄** = 보강 학생 카드(`isMakeup`) 또는 반 없는 보강 줄(`makeup && !classId`) — 그 줄의 예약(결석 날짜·시간) 전부.
 *  · **'정규+보강'** = 반이 있는 보강 표시 줄(`makeup && classId`) — 합친(merge) 예약만, 시간은 그 예약에서만(수업타임엔 정규가 섞인다).
 *  · 그 밖(정규 줄) = null — 따로 선 보강 줄이 말한다.
 * 시간: 예약의 시작·끝(분) → 없으면 보강 줄만 출석부 수업타임.
 */
export function makeupFactsOf(input: {
  isMakeupStudent: boolean;
  rowMakeup: boolean;
  classId: string | null | undefined;
  reserved: readonly { start: string; end: string; absenceDate: string; mode: "merge" | "separate" }[] | undefined;
  units: number | null | undefined;
  reason: string | null | undefined;
}): MakeupFacts | null {
  const row = input.isMakeupStudent || (input.rowMakeup && !input.classId);
  const merged = !row && input.rowMakeup && !!input.classId;
  if (!row && !merged) return null;
  const list = (input.reserved ?? []).filter((r) => row || r.mode === "merge");
  const spans = list.map((r) => spanMinutes(r.start, r.end));
  const minutes = spans.length && spans.every((s) => s != null) ? spans.reduce<number>((a, s) => a + (s ?? 0), 0) : null;
  return {
    row,
    absenceDates: list.map((r) => r.absenceDate),
    minutes,
    units: row ? (input.units ?? null) : null,
    reason: (input.reason ?? "").trim(),
  };
}

/** "2026-10-19" → "10월 19일". 형식이 아니면 "". */
function koDate(iso: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(iso.trim());
  return m ? `${Number(m[1])}월 ${Number(m[2])}일` : "";
}

/**
 * 보강 분량 → "1교시" · "2교시". 분(55분)으로 적지 않는다(원장 2026-10-27 *"보강 55분 대신에 한타임 체크되어있으면 1교시 보강수업을 함께
 * 진행했습니다로"*). 예약은 교시 칸 하나씩이라(학원설정 교시표) 예약 수 = 교시 수 · 예약이 없는 보강 줄은 출석부 수업타임. 모르면 "".
 */
function koPeriods(m: Pick<MakeupFacts, "absenceDates" | "units" | "row">, reservedCount: number): string {
  const n = reservedCount > 0 ? reservedCount : m.row ? (m.units ?? 0) : 0;
  if (!(n > 0)) return "";
  return `${Number.isInteger(n) ? n : n.toFixed(1)}교시`;
}

/** 결석분 날짜를 적을 수 있나 — 하나라도 날짜 형식이면. */
export function hasMakeupAbsenceDate(makeup: Pick<MakeupFacts, "absenceDates"> | null | undefined): boolean {
  return (makeup?.absenceDates ?? []).some((d) => koDate(d) !== "");
}

/** 보강 문장 본체 — "10월 19일 결석에 대한 1교시 보강 수업도 함께 진행했습니다" (마침표·사유 전). */
function makeupClause(m: MakeupFacts, also: boolean): string {
  const dates = [...new Set(m.absenceDates.map(koDate).filter(Boolean))].join("·");
  // 예약 수 = 결석분 날짜 수(예약 한 건 = 교시 한 칸) — 날짜를 모르는 줄은 수업타임으로.
  const dur = koPeriods(m, m.absenceDates.length);
  if (!dates) return also ? "보강 수업도 함께 진행했습니다" : "오늘은 보강 수업에 출석했습니다";
  return `${also ? "" : "오늘은 "}${dates} 결석에 대한 ${dur ? `${dur} ` : ""}보강 수업${also ? "도 함께" : "을"} 진행했습니다`;
}

/** 출결 상태 + 사유(+ 보강 재료) → 문장. 말할 게 없으면 "". */
export function attendanceSentence(
  status: string | null | undefined,
  note: string | null | undefined,
  makeup?: MakeupFacts | null,
): string {
  // 보강 줄 — 결석한 날이 아니면(결석이면 보고서가 잠긴다) 보강 문장. 사유는 강사가 적은 것만(출석부 메모는 싣지 않는다).
  if (makeup?.row && status !== "absent") {
    const reason = cleanReason(makeup.reason);
    const body = makeupClause(makeup, false);
    return reason ? `${body}(사유: ${reason}).` : `${body}.`;
  }
  const base = baseSentence(status, note);
  // '정규+보강' 줄 — 정규 문장 뒤에 보강 한 문장(결석 날짜를 알 때만 — 모르면 덧붙일 사실이 없다).
  if (base && makeup && !makeup.row && hasMakeupAbsenceDate(makeup)) return `${base} ${makeupClause(makeup, true)}.`;
  return base;
}

function baseSentence(status: string | null | undefined, note: string | null | undefined): string {
  const plain = status ? PLAIN_SENTENCE[status] : undefined;
  if (plain) return plain;
  const head = status ? STATUS_SENTENCE[status] : undefined;
  if (!head) return "";
  const reason = cleanReason(note);
  return reason ? `${head}(사유: ${reason}).` : `${head}.`;
}

/**
 * 보고서 머리의 작은 출결 표시 — 글자 + 상태 키(색은 출결 단일 소스 `ATT_SOFT`가 정한다).
 * `detail` = 글이 상태 한 문장보다 더 말한다(사유·보강 날짜) — 그러면 아래 '출결' 띠도 세운다.
 */
export type AttendanceMark = { status: "present" | "late" | "early_leave" | "excused" | "makeup"; label: string; detail?: boolean };

const MARK_LABEL: Record<AttendanceMark["status"], string> = {
  present: "출석",
  late: "지각",
  early_leave: "조퇴",
  excused: "공결",
  makeup: "보강",
};

/**
 * '출결' 항목 글 → 머리 표시(원장 2026-10-26 *"조그마한 마크같은걸로 출석 여부 바로 확인"*). 학부모 카드는 저장된 글만 받으므로
 * 글이 이 모듈이 만든 문장으로 **시작할 때만** 상태를 안다 — 모르는 글이면 null(표시를 지어내지 않는다).
 */
export function attendanceMarkOf(text: string | null | undefined): AttendanceMark | null {
  const t = (text ?? "").trim();
  if (!t) return null;
  const mark = (status: AttendanceMark["status"], plain?: string): AttendanceMark => ({
    status,
    label: MARK_LABEL[status],
    ...(plain !== undefined && t !== plain ? { detail: true } : {}),
  });
  for (const [status, sentence] of Object.entries(PLAIN_SENTENCE)) {
    if (t.startsWith(sentence.replace(/\.$/, ""))) return mark(status as AttendanceMark["status"], sentence);
  }
  // 날짜가 붙은 보강 문장("오늘은 10월 19일 결석에 대한 1교시 보강 수업을 …" · 옛 글 "… 보강 수업을 1시간 …") — 늘 더 말하는 글이다.
  if (/^오늘은 .*결석에 대한 (?:\S+ )?보강 수업/.test(t)) return { status: "makeup", label: MARK_LABEL.makeup, detail: true };
  for (const [status, head] of Object.entries(STATUS_SENTENCE)) {
    if (t.startsWith(head)) return mark(status as AttendanceMark["status"]);
  }
  return null;
}

/**
 * 출결 항목이 표시만으로 충분한가 — 출석·보강 **한 문장뿐**이면 표시와 같은 말이라 아래 띠를 따로 세우지 않는다.
 * 사유·보강 날짜가 붙었거나(detail) 지각 등이면 띠도 세운다.
 */
export function attendanceMarkIsEnough(mark: AttendanceMark | null): boolean {
  return (mark?.status === "present" || mark?.status === "makeup") && !mark.detail;
}
