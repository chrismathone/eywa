/**
 * 퇴원보고서에 **이어진 환불 요청서**(s2_0025 연결 표)의 잠금·상한 — 순수 판정(화면·서버 공용 · server-only 밖).
 * 원장 결정 2026-11-06(완료일자 = 담당 데스크·원장) · 2026-11-09(수정·삭제 = 담당 데스크(재직)·원장 · 완료된 것은 지우지 않음 · 총 환불금액 ≤ 원장 승인 줄 낸 돈 합).
 * DB 트리거(s2_0036 `withdrawal_report_refund_complete_guard`)가 같은 규칙으로 직원 세션 쓰기를 막는다 — 관리 키(강사뷰 재시도 · 서버)는 이 판정이 먼저 막는다.
 */
/**
 * 보고서에 이어진 환불 요청서를 고치거나(모든 칸 — 원장 결정 2026-11-09) 환불완료일자를 넣을 수 있나 — 그 요청서의 **재직 중인** 데스크 담당과 원장급만.
 * 이어지지 않은 요청서(`link` 없음)는 종전대로 수납 쓰기 권한이면 된다. `directorLevel` = 원장 역할 · 강사뷰 아님(`cancelsAsDirector`).
 * DB도 같은 판정으로 직원 세션의 쓰기를 막는다(s2_0036 `withdrawal_report_refund_complete_guard`).
 */
export function canEditLinkedCompletion(link: { deskId: string | null; deskActive?: boolean } | null, user: { id: string; directorLevel: boolean }): boolean {
  return !link || user.directorLevel || (!!link.deskId && link.deskId === user.id && link.deskActive !== false);
}

/** 이어진 요청서의 수정·삭제 잠금 문구(원장 결정 2026-11-09 — 리뷰 r2 I6·B1). */
export const linkedEditLockReason = (deskName: string | null) =>
  `퇴원보고서에서 이어진 환불 요청서입니다. 고치는 것은 담당 데스크${deskName ? `(${deskName})` : ""}와 원장만 할 수 있습니다.`;
export const linkedDeleteLockReason = (deskName: string | null) =>
  `퇴원보고서에서 이어진 환불 요청서입니다. 지우는 것은 담당 데스크${deskName ? `(${deskName})` : ""}와 원장만 할 수 있습니다.`;
export const LINKED_DELETE_COMPLETED = "환불완료일자가 들어간(돈을 돌려준) 이어진 환불 요청서는 지울 수 없습니다. 지워야 하면 원장이 먼저 환불완료일자를 비우세요.";
export const LINKED_CLEAR_DIRECTOR_ONLY = "이어진 환불 요청서의 환불완료일자를 비우는 것은 원장만 할 수 있습니다(돌려준 기록이 사라집니다).";
/** 삭제 확인 문구(원장 결정 2026-11-09). */
export const LINKED_DELETE_CONFIRM = "퇴원보고서에 이어진 요청서입니다 — 지우면 그 청구는 원장 환불 결정 대기로 돌아갑니다.";
/**
 * 총 환불금액 글 → 원(숫자만 읽는다 · DB `withdrawal_refund_won`과 같은 규칙 — 숫자가 아닌 글자는 모두 버린다 · 비면 0).
 * "315,000원" → 315000. 숫자를 두 번 쓰면(“315,000원(교재 30,000원 제외)”) 이어 붙어 커진다 — 상한을 넘으면 저장이 막히는 쪽(닫힘).
 */
export function parseWon(text: string): number {
  const digits = text.replace(/[^0-9]/g, "");
  return digits ? Number(digits.slice(0, 15)) : 0;
}
/**
 * 이어진 요청서의 상한(원장 승인 줄의 낸 돈 합 · 결정 표 paid_net — 리뷰 r2 I6) 검사. `cap` = 합(모르면 null — 옛 연결·결정 행 paid_net 없음).
 * - 상한을 알면: 총 환불금액(숫자)이 상한을 넘으면 거절.
 * - 상한을 모르면: 금액 칸(총 환불금액·결제내역)을 바꾸는 저장만 거절(완료일자 입력 등은 받는다 — 막으면 그 묶음이 영원히 기다린다).
 * DB 트리거도 같은 규칙(관리 키 포함 · 금액이 바뀔 때만).
 */
export function linkedCapError(cap: number | null, prev: { totalAmount: string; paymentDetails: string } | null, next: { totalAmount: string; paymentDetails: string }): string | null {
  const amountChanged = !prev || prev.totalAmount !== next.totalAmount;
  const paymentChanged = !prev || prev.paymentDetails !== next.paymentDetails;
  if (cap === null) return amountChanged || paymentChanged ? "원장 승인 금액(상한)을 알 수 없어 총 환불금액·결제내역은 바꿀 수 없습니다 — 원장에게 확인해 주세요." : null;
  if (!amountChanged && !paymentChanged) return null; // DB 트리거와 같이 — 금액 칸 어느 하나라도 바뀌면 상한을 본다
  const total = parseWon(next.totalAmount);
  return total > cap ? `총 환불금액 ${total.toLocaleString("ko-KR")}원이 원장이 승인한 줄의 낸 돈 합계 ${cap.toLocaleString("ko-KR")}원(상한)을 넘습니다.` : null;
}
export const completionLockReason = (deskName: string | null) =>
  `퇴원보고서에서 이어진 환불 요청서입니다. 환불완료일자는 담당 데스크${deskName ? `(${deskName})` : ""}와 원장만 넣거나 지울 수 있습니다.`;
/** 원장 결정 C.3 — 옛 요청서 완료 막음(DB 트리거 문구와 같다). */
export const COMPLETION_SUPERSEDED = "같은 청구에 새 퇴원 요청의 요청서가 있습니다 — 새 요청서로 처리하세요.";
/** '다른 강사 뷰'에서 실제 로그인 계정이 담당 데스크·원장급이 아닐 때 — DB 트리거는 실제 계정을 본다(팀장 결정 2026-11-06). */
export const completionAccountLockReason = (deskName: string | null) =>
  `'다른 강사 뷰'로 보고 있습니다. 퇴원보고서에서 이어진 환불 요청서의 환불완료일자는 실제 로그인한 계정이 담당 데스크${deskName ? `(${deskName})` : ""}이거나 원장일 때만 넣거나 지울 수 있습니다.`;

/**
 * 이어진 요청서의 환불완료일자 잠금 사유(통과면 null) — **화면 행위자**(강사뷰면 대상 직원 · 강사뷰 = 그 사람)와 **실제 로그인 계정** 둘 다
 * 담당 데스크이거나 원장급이어야 한다(팀장 결정 2026-11-06). DB 트리거(s2_0036)는 세션의 실제 계정을 본다 — 앱이 행위자만 보면 저장이 DB에서
 * 막히거나, 강사뷰 쓰기(`writeSessionFirst`)가 관리 키로 다시 써 트리거를 지나 버린다. 화면 잠금과 저장 액션이 같은 함수를 쓴다.
 */
export function linkedCompletionLock(
  link: { deskId: string | null; deskName: string | null; deskActive?: boolean; superseded?: boolean } | null,
  actor: { id: string; directorLevel: boolean },
  account: { id: string; directorLevel: boolean },
  /** 이미 든 완료일자를 비우는가(원장만 — 리뷰 r2 B1·D-13: 담당 데스크가 비운 뒤 지우면 완료 기록이 사라진다). */
  clearing = false,
): string | null {
  if (!link) return null;
  if (clearing) return actor.directorLevel && account.directorLevel ? null : LINKED_CLEAR_DIRECTOR_ONLY;
  // 원장 결정 C.3 — 같은 청구 줄에 새 퇴원 요청의 요청서가 있는 옛 요청서(취소된 요청)는 누구도 완료일자를 넣지 못한다(DB 트리거와 같은 판정).
  if (link.superseded) return COMPLETION_SUPERSEDED;
  if (!canEditLinkedCompletion(link, actor)) return completionLockReason(link.deskName);
  if (!canEditLinkedCompletion(link, account)) return completionAccountLockReason(link.deskName);
  return null;
}
/** 이어진 요청서를 고칠 수 있나(모든 칸 · 행위자와 실제 계정 둘 다 — 리뷰 r2 I6). 통과면 null. */
export function linkedEditLock(link: { deskId: string | null; deskName: string | null; deskActive?: boolean } | null, actor: { id: string; directorLevel: boolean }, account: { id: string; directorLevel: boolean }): string | null {
  if (!link) return null;
  if (!canEditLinkedCompletion(link, actor)) return linkedEditLockReason(link.deskName);
  if (!canEditLinkedCompletion(link, account)) return `'다른 강사 뷰'로 보고 있습니다. 퇴원보고서에서 이어진 환불 요청서는 실제 로그인한 계정이 담당 데스크${link.deskName ? `(${link.deskName})` : ""}이거나 원장일 때만 고칠 수 있습니다.`;
  return null;
}
/** 이어진 요청서를 지울 수 있나(리뷰 r2 B1) — 완료된 것은 누구도(DB도 막는다) · 미완료는 재직 데스크·원장급(행위자·실제 계정 둘 다). 통과면 null. */
export function linkedDeleteLock(link: { deskId: string | null; deskName: string | null; deskActive?: boolean } | null, completed: boolean, actor: { id: string; directorLevel: boolean }, account: { id: string; directorLevel: boolean }): string | null {
  if (!link) return null;
  if (completed) return LINKED_DELETE_COMPLETED;
  if (!canEditLinkedCompletion(link, actor) || !canEditLinkedCompletion(link, account)) return linkedDeleteLockReason(link.deskName);
  return null;
}
