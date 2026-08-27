/**
 * 운영 기간(시작일·종료일) 입력에 붙는 **사전 고지** — 순수 함수(Vitest).
 *
 * 🔴 왜 있는가(원장 제보 2026-08-27 *"저장이 안되는데 … 알림멘트도 없어서 왜 저장안되는지 사용자가 알 수도
 *    없어"*): 운영 기간은 반이 아니라 **교시 행(`class_schedules.valid_from/valid_to`)에** 저장된다.
 *    그래서 ① 편집할 교시가 하나도 없으면 날짜를 넣어도 적을 곳이 없고(저장이 아무 일도 안 한다)
 *    ② 종료일을 지난 날짜로 넣으면 저장 즉시 전 교시가 '지난 배치'가 되어 폼에서 사라진다(= 다시 열면
 *    빈 칸 → "저장이 안 됐다"로 보인다). 실측(injaewon 2026-08-27): 그렇게 교시가 전부 만료된 반 7개.
 *
 * 두 가지를 **미리** 말해 준다. 막지는 않는다 — 지난 날짜로 끝난 특강은 정상적인 입력이다.
 */
export type PeriodNoticeKind = "no-slots" | "past-end" | "future-start";

export type PeriodNotice = { kind: PeriodNoticeKind; text: string };

const TEXT: Record<PeriodNoticeKind, string> = {
  "no-slots":
    "이 반에는 지금 운영 중인 교시가 없습니다. 운영 기간은 교시(요일·시간)에 저장되므로, 아래 시간표에서 교시를 먼저 지정해야 시작일·종료일이 저장됩니다.",
  "past-end":
    "종료일이 이미 지난 날짜입니다. 저장하면 이 반의 교시가 곧바로 시간표에서 내려가고, 다시 열었을 때 아래 시간표와 기간 칸이 비어 보입니다(지난 배치 기록은 지워지지 않습니다).",
  "future-start":
    "시작일이 아직 오지 않았습니다. 그날 전까지는 시간표·출석부에 이 반이 나타나지 않습니다.",
};

/**
 * 지금 화면 상태로 알려야 할 것 — 없으면 null.
 * @param hasSlots 폼이 지금 들고 있는(또는 이 반에 남아 있는) 편집 가능한 교시가 하나라도 있나
 * @param validFrom/validTo 입력값(`YYYY-MM-DD`) — 빈 칸은 null
 * @param today KST 오늘(`YYYY-MM-DD`)
 */
export function periodNotice(input: {
  hasSlots: boolean;
  /**
   * 이 반에 **지난 배치 기록**이 있나(운영이 끝난 교시). 새 반 만들기 화면에서 아무것도 안 한 사람에게
   * 경고를 띄우지 않기 위한 구분 — 기록이 있는데 교시가 0개면 "끝나서 사라진 것"이라 이유를 말해야 한다.
   */
  hasHistory?: boolean;
  validFrom: string | null;
  validTo: string | null;
  today: string;
}): PeriodNotice | null {
  // 교시가 없으면 날짜 해석은 의미가 없다 — 저장할 자리 자체가 없다는 게 더 중요한 사실이다.
  // 단 **아직 아무 날짜도 안 넣은 새 반**에는 말하지 않는다(빈 폼에 경고부터 띄우지 않는다).
  if (!input.hasSlots && (input.hasHistory || input.validFrom || input.validTo)) {
    return { kind: "no-slots", text: TEXT["no-slots"] };
  }
  if (input.validTo && input.validTo < input.today) return { kind: "past-end", text: TEXT["past-end"] };
  if (input.validFrom && input.validFrom > input.today) {
    return { kind: "future-start", text: TEXT["future-start"] };
  }
  return null;
}

/** 저장이 아무 일도 못 할 때의 거절 사유(서버 `validate`와 폼이 같은 문장을 쓴다). */
export const PERIOD_NO_SLOT_ERROR =
  "운영 기간은 교시(요일·시간)에 저장됩니다 — 아래 시간표에서 교시를 지정하거나, 시작일·종료일 칸을 비우고 저장해주세요.";
