// 역동기화(aywa→makeedu) 푸시 대상 판정 — 순수 함수(Vitest). 후보 쿼리·액션·워커가 **같은 규칙**을 쓴다.
//
// ⚠️ 배경(2026-07-21 원장 제보 "권도현이는 왜 makeedu 보내기가 없지? makeedu에 기록도 없는데"):
// 원래 규칙은 `outcome ≠ enrolled` 한 줄이었다. 취지는 **"학원 등록이 끝난 학생을 예비상담으로 밀어넣으면
// 이미 다니는 학생이 신규 문의로 뜨는 군더더기"**(허다언 케이스, 2026-07-02)였고, 그 판단의 **숨은 전제**는
// "등록된 학생은 makeedu 원생목록에 이미 있다"였다.
//
// 실측으로 그 전제가 깨졌다 — enrolled로 제외된 4명 중 3명(권한결 14067·김유하 14106·허다언 14101)은
// 전제대로 makeedu 원생이었지만, **권도현은 makeedu 어디에도 없었다**(QR 접수→같은 날 등록·반배정까지
// aywa에서 끝난 첫 케이스). 그 결과 예비상담 푸시에서도 빠지고 원생등록 푸시는 미구현이라 **어느 경로로도
// 안 나가고**, makeedu에 학생이 없으니 **청구도 안 잡혔다**(수강 2건 / 청구 0건).
//
// 그래서 전제를 조건으로 승격한다: **enrolled는 "학생이 makeedu에 이미 있을 때만" 제외.**

export type PushEligibilityInput = {
  /** enrollment_consultations.outcome */
  outcome: string;
  /** 연결 학생(students.makeedu_id). 연결이 없거나 makeedu 미등록이면 null. */
  studentMakeeduId: string | null | undefined;
};

/**
 * 이 상담을 makeedu **예비상담**으로 보내도 되는가.
 * - enrolled 아님 → 보낼 수 있다(원래대로).
 * - enrolled + 학생이 makeedu 원생 → **제외**(군더더기 — 원래 의도 보존).
 * - enrolled + 학생이 makeedu에 없음 → **보낼 수 있다**(어디에도 없으니 예비상담으로라도 들어가야 한다.
 *   사무실이 makeedu에서 예비→원생 전환하면 청구까지 이어진다).
 */
export function isPushableConsultation(input: PushEligibilityInput): boolean {
  if (input.outcome !== "enrolled") return true;
  return !input.studentMakeeduId;
}

/**
 * 이 후보가 **이미 큐에 들어가 있나**(pending = 연동 PC 대기 · running = 제출 중). 그렇다면 다시 고를 수 없다 —
 * 전송 카드의 체크박스 잠금과 콜&상담 머리글 'makeedu 보내기' 배지(지금 보낼 수 있는 건수)가 같은 판정을 쓴다.
 * 실패(`error`)는 다시 골라 보낼 수 있으니 여기 들지 않는다. 서버 쪽 중복 큐잉 방지는 enqueueConsultationPush가 따로 본다.
 */
export function isPushInFlight(pushStatus: string | null | undefined): boolean {
  return pushStatus === "pending" || pushStatus === "running";
}

/** 목록에 "왜 이 건이 특별한지" 한 줄로 밝힌다 — 아니면 등록된 학생이 신규 문의처럼 보인다. */
export function pushEligibilityNote(input: PushEligibilityInput): string | null {
  return input.outcome === "enrolled" && !input.studentMakeeduId
    ? "등록 완료됐지만 makeedu에 학생 기록이 없습니다 — 보낸 뒤 makeedu에서 원생으로 전환하세요"
    : null;
}
