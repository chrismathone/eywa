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

/** 출결 상태 + 사유 → 문장. 말할 게 없으면 "". */
export function attendanceSentence(status: string | null | undefined, note: string | null | undefined): string {
  const plain = status ? PLAIN_SENTENCE[status] : undefined;
  if (plain) return plain;
  const head = status ? STATUS_SENTENCE[status] : undefined;
  if (!head) return "";
  const reason = cleanReason(note);
  return reason ? `${head}(사유: ${reason}).` : `${head}.`;
}

/** 보고서 머리의 작은 출결 표시 — 글자 + 상태 키(색은 출결 단일 소스 `ATT_SOFT`가 정한다). */
export type AttendanceMark = { status: "present" | "late" | "early_leave" | "excused" | "makeup"; label: string };

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
  for (const [status, sentence] of Object.entries(PLAIN_SENTENCE)) {
    if (t.startsWith(sentence)) return { status: status as AttendanceMark["status"], label: MARK_LABEL[status as AttendanceMark["status"]] };
  }
  for (const [status, head] of Object.entries(STATUS_SENTENCE)) {
    if (t.startsWith(head)) return { status: status as AttendanceMark["status"], label: MARK_LABEL[status as AttendanceMark["status"]] };
  }
  return null;
}

/** 출결 항목이 표시만으로 충분한가 — 출석·보강은 문장이 표시와 같은 말이라 아래 띠를 따로 세우지 않는다. 사유가 있는 지각 등은 띠도 세운다. */
export function attendanceMarkIsEnough(mark: AttendanceMark | null): boolean {
  return mark?.status === "present" || mark?.status === "makeup";
}
