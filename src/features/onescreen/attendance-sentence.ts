/**
 * 그날 출결 → 학부모 보고서 문장. 순수 모듈(Vitest).
 *
 * 원장 2026-10-26 *"영어 및 수학보고서에서 학생의 출결 상황에따라 그런 이야기가없는데 출결 현황에 따라 사유 등으로 멘트 반영되게
 * 출결은 다른데서 하고있으니까"* → 선택 *"상태 + 사유를 문장으로"*.
 *
 * 🔑 재료는 출석부와 **같은 칸**(`attendance_records.status`·`note`, 원스크린 행의 `attendanceRaw`·`attendanceNote`)이다 — 새로 묻지 않는다.
 * 🔑 문장은 **코드가 만든다**(AI에 맡기지 않는다) — 사유가 비었을 때 모델이 '늦잠'·'교통' 같은 이유를 지어낼 수 있다.
 *    그래서 사유가 없으면 상태만 적고, 있으면 강사·데스크가 적은 원문을 괄호 안에 그대로 옮긴다.
 * ⚠️ 출석·기록 없음·결석은 "" — 출석은 말할 거리가 아니고, 결석한 날은 보고서 자체가 잠긴다(send-gate `absent`).
 * ⚠️ 보강도 "" — 보강 보고서는 제목에 이미 "(보강)"이 붙는다(같은 말을 두 번 하지 않는다).
 */

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
  const head = status ? STATUS_SENTENCE[status] : undefined;
  if (!head) return "";
  const reason = cleanReason(note);
  return reason ? `${head}(사유: ${reason}).` : `${head}.`;
}
