/**
 * 자리(랩실·JJ실) 출석부 카드의 **사유 툴팁** — 순수 함수(Vitest).
 *
 * 원장 2026-08-28: *"seat/lab 이나 seat/jj로 들어가는 출석부에서 결석사유가 안보이는데 마우스 오버시
 * 결석사유 보이도록 해줘."*
 *
 * 자리판은 이름 카드에 **상태 세 종류만** 찍는 화면이라 `attendance_records.note`를 그릴 자리가 없었다.
 * 그런데 사유는 이미 거기 적혀 있다(반별 출석부·오늘 출결에서 적은 것) — 자리 당번이 "얘는 왜 없지"를
 * 물어볼 때 화면이 답을 들고도 안 보여주고 있었던 셈이다.
 *
 * 🔴 **표시일 뿐이다.** 여기서 나온 문자열로 무언가를 쓰거나 판정하지 말 것(사유 분류는
 *    [classifyAbsenceReason](../absence-reason.ts)이고, 그쪽도 표시 전용이다).
 * ⚠️ 라벨은 **상태를 따라간다** — 결석 칸의 메모를 "지각 사유"로 부르면 거짓이 된다. 상태가 없는데
 *    메모만 있는 칸(자리판이 표현 못 하는 상태를 반 출석부에서 찍어 둔 경우)은 중립적으로 '메모'다.
 * ⚠️ 비로그인 PIN 화면(`/seat/…`)에는 **이 값을 아예 안 내려보낸다** — 사유 메모엔 병원·수술·가족
 *    일정이 그대로 적혀 있다([queries.ts](./server/queries.ts)의 직원 이름과 같은 규약).
 */

/** 자리판이 표현하는 상태 셋. (server/actions의 `SeatStatus`와 같은 집합 — 순수 모듈이라 여기 적는다.) */
type Status = "present" | "absent" | "late" | null;

const NOTE_LABEL: Record<"present" | "absent" | "late", string> = {
  present: "메모",
  absent: "결석 사유",
  late: "지각 사유",
};

/** 그 칸에 띄울 툴팁 문자열. 메모가 없으면 `null`(툴팁 자체를 안 단다). */
export function seatNoteTitle(status: Status, note: string | null | undefined): string | null {
  const body = note?.trim();
  if (!body) return null;
  return `${status ? NOTE_LABEL[status] : "메모"} — ${body}`;
}
