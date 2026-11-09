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

/** 할 수 있는 사람 — 담당 데스크가 퇴사했거나 없으면 원장만(리뷰 r3 R2-m7 — 퇴사한 사람 이름을 할 수 있는 사람으로 적지 않는다). */
type DeskState = "active" | "retired" | "none";
const whoCan = (deskName: string | null, desk: DeskState | boolean = "active") => {
  const s = desk === true ? "active" : desk === false ? "retired" : desk;
  return s === "active" ? `담당 데스크${deskName ? `(${deskName})` : ""}와 원장만` : s === "retired" ? "원장만(담당 데스크 퇴사)" : "원장만(담당 데스크 없음)";
};
/** 연결의 데스크 상태 — 지정 없음 · 퇴사 · 재직(모르면 재직 · DB 트리거와 같다). */
const deskStateOf = (link: { deskId: string | null; deskActive?: boolean }): DeskState => (!link.deskId ? "none" : link.deskActive === false ? "retired" : "active");
/** 이어진 요청서의 수정·삭제 잠금 문구(원장 결정 2026-11-09 — 리뷰 r2 I6·B1). */
export const linkedEditLockReason = (deskName: string | null, deskActive: DeskState | boolean = true) =>
  `퇴원보고서에서 이어진 환불 요청서입니다. 고치는 것은 ${whoCan(deskName, deskActive)} 할 수 있습니다.`;
export const linkedDeleteLockReason = (deskName: string | null, deskActive: DeskState | boolean = true) =>
  `퇴원보고서에서 이어진 환불 요청서입니다. 지우는 것은 ${whoCan(deskName, deskActive)} 할 수 있습니다.`;
/** 원장(또는 담당 데스크)이 '다른 강사 뷰'로 보고 있어 막힐 때 — 지금 보는 사람 몫이 아니다(리뷰 r3 R2-m7). */
const teacherViewReason = (what: string) => `'다른 강사 뷰'로 보고 있습니다 — ${what} 본인 화면에서만 할 수 있습니다(지금 보는 사람은 담당 데스크·원장이 아닙니다).`;
// 🔴 '완료일자를 비우고 지운 뒤 다시 승인'으로 늘어난 몫을 돌려주지 않는다 — 이미 돌려준 돈까지 다시 담긴다(리뷰 r3 R2-I2 · 원장 결정 2026-11-09 '따로 환불').
export const LINKED_DELETE_COMPLETED = "환불완료일자가 들어간(돈을 돌려준) 이어진 환불 요청서는 지울 수 없습니다. 그 뒤 늘어난 몫은 따로 환불로 처리합니다(수납의 일반 환불 요청서).";
export const LINKED_CLEAR_DIRECTOR_ONLY = "이어진 환불 요청서의 환불완료일자를 비우는 것은 원장만 할 수 있습니다(요청서의 환불 완료 표시가 사라집니다).";
/** 원장이 이어진 요청서의 완료일자를 비울 때 경고(리뷰 r3 R2-I2) — 비워도 환불 완료 기록은 결정 표에 남아 다시 승인 금액에서 빠진다(DB). */
export const LINKED_CLEAR_WARNING = "이미 돌려준 돈이면 비우지 마세요 — 늘어난 몫은 따로 환불로 처리합니다. 비워도 이 요청서의 환불 완료 기록은 남아, 같은 줄을 다시 승인하면 그 금액만큼 빠집니다.";
/** 삭제 확인 문구(원장 결정 2026-11-09) — 이어진 보고서가 처리 전일 때 · 취소된 요청이면 결정 대기로 돌아갈 것이 없다(리뷰 r3 R2-m9). */
export const LINKED_DELETE_CONFIRM = "퇴원보고서에 이어진 요청서입니다 — 지우면 그 청구는 원장 환불 결정 대기로 돌아갑니다.";
export const LINKED_DELETE_CONFIRM_CANCELED = "취소된 퇴원 요청에 이어진 요청서입니다 — 지워도 퇴원 처리는 바뀌지 않습니다(같은 청구의 새 요청서가 있으면 그 요청서로 처리합니다).";

/** 금액 표기 한 칸 — 숫자(쉼표 세 자리 · 최대 15자리) + 선택 공백 + 선택 '원'. DB `withdrawal_refund_won`과 같은 글자(리뷰 r3 R-2). */
const WON_FORMAT = /^([0-9]{1,3}(,[0-9]{3}){1,4}|[0-9]{1,15}) *원?$/;
/** 결제내역 속 금액 표기 찾기 — DB 트리거와 같은 글자(숫자로 시작하거나 한글 단위가 붙은 '…원'). */
const AMOUNT_TOKEN = /([0-9][0-9,.]*[ ]*[십백천만억]*[ ]*원|[일이삼사오육칠팔구]*[십백천만억]+[ ]*원)/g;
/**
 * 금액 글 → 원(리뷰 r3 R-2 · DB `withdrawal_refund_won`과 같은 규칙) — 앞뒤 빈칸을 떼고 `315,000원` · `315000` · `315,000 원`만 읽는다 · 비면 0 ·
 * 그 밖('300만원' · '1.5백만원' · '삼백만 원' · '3,15,000원')은 null(못 읽음 — 숫자만 골라 읽던 옛 규칙은 '300만원'을 300으로 읽어 상한을 지나갔다).
 */
export function parseWon(text: string): number | null {
  const t = text.trim();
  if (!t) return 0;
  return WON_FORMAT.test(t) ? Number(t.replace(/[^0-9]/g, "")) : null;
}
/** 결제내역 속 금액 표기(글자 그대로 · 찾은 차례). */
export function amountTokens(text: string): string[] {
  return [...text.matchAll(AMOUNT_TOKEN)].map(m => m[1]!);
}
/** 환불완료일자 꼴(리뷰 r3 R-9 · DB 트리거와 같다) — 빈칸 또는 YYYY-MM-DD. */
export const completionDateOk = (value: string) => !value.trim() || /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value);
export const COMPLETION_DATE_FORMAT = "환불완료일자는 날짜(예: 2026-11-09)로 넣어 주세요.";
const wonText = (n: number) => `${n.toLocaleString("ko-KR")}원`;
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
  if (amountChanged) {
    const total = parseWon(next.totalAmount);
    if (total === null) return "총 환불금액은 숫자와 쉼표·'원'만 써 주세요(예: 315,000원).";
    if (total > cap) return `총 환불금액 ${wonText(total)}이 원장이 승인한 줄의 낸 돈 합계 ${wonText(cap)}(상한)을 넘습니다.`;
  }
  // 결제내역의 금액 표기도 같은 규칙 — 못 읽으면 거절 · 이번에 새로 들어온 금액(전에 없던 값)은 상한 이하(DB 트리거와 같다 — 데스크가 결제내역을 보고 돌려줄 수 있다).
  if (paymentChanged) {
    const before = new Set(amountTokens(prev?.paymentDetails ?? "").map(parseWon).filter((v): v is number => v !== null));
    for (const tok of amountTokens(next.paymentDetails)) {
      const v = parseWon(tok);
      if (v === null) return `결제내역의 금액 ${tok}은(는) 읽을 수 없습니다 — 숫자와 쉼표·'원'만 써 주세요(예: 315,000원).`;
      if (v > cap && !before.has(v)) return `결제내역에 원장이 승인한 금액(상한 ${wonText(cap)})보다 큰 금액 ${wonText(v)}이 새로 들어갔습니다.`;
    }
  }
  return null;
}
export const completionLockReason = (deskName: string | null, deskActive: DeskState | boolean = true) =>
  `퇴원보고서에서 이어진 환불 요청서입니다. 환불완료일자는 ${whoCan(deskName, deskActive)} 넣을 수 있고, 비우는 것은 원장만 할 수 있습니다.`;
/** 원장 결정 C.3 — 옛 요청서 완료 막음(DB 트리거 문구와 같다). */
export const COMPLETION_SUPERSEDED = "같은 청구에 새 퇴원 요청의 요청서가 있습니다 — 새 요청서로 처리하세요.";
/** '다른 강사 뷰'에서 실제 로그인 계정이 담당 데스크·원장급이 아닐 때 — DB 트리거는 실제 계정을 본다(팀장 결정 2026-11-06). */
export const completionAccountLockReason = (deskName: string | null) =>
  `'다른 강사 뷰'로 보고 있습니다. 퇴원보고서에서 이어진 환불 요청서의 환불완료일자는 실제 로그인한 계정이 담당 데스크${deskName ? `(${deskName})` : ""}이거나 원장일 때만 넣을 수 있고, 비우는 것은 원장만 할 수 있습니다.`;

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
  if (!canEditLinkedCompletion(link, actor)) return canEditLinkedCompletion(link, account) ? teacherViewReason("환불완료일자 입력은") : completionLockReason(link.deskName, deskStateOf(link));
  if (!canEditLinkedCompletion(link, account)) return completionAccountLockReason(link.deskName);
  return null;
}
/** 이어진 요청서를 고칠 수 있나(모든 칸 · 행위자와 실제 계정 둘 다 — 리뷰 r2 I6). 통과면 null. */
export function linkedEditLock(link: { deskId: string | null; deskName: string | null; deskActive?: boolean } | null, actor: { id: string; directorLevel: boolean }, account: { id: string; directorLevel: boolean }): string | null {
  if (!link) return null;
  if (!canEditLinkedCompletion(link, actor)) return canEditLinkedCompletion(link, account) ? teacherViewReason("이 요청서 고치기는") : linkedEditLockReason(link.deskName, deskStateOf(link));
  if (!canEditLinkedCompletion(link, account)) return `'다른 강사 뷰'로 보고 있습니다. 퇴원보고서에서 이어진 환불 요청서는 실제 로그인한 계정이 담당 데스크${link.deskName ? `(${link.deskName})` : ""}이거나 원장일 때만 고칠 수 있습니다.`;
  return null;
}
/** 이어진 요청서를 지울 수 있나(리뷰 r2 B1) — 완료된 것은 누구도(DB도 막는다) · 미완료는 재직 데스크·원장급(행위자·실제 계정 둘 다). 통과면 null. */
export function linkedDeleteLock(link: { deskId: string | null; deskName: string | null; deskActive?: boolean } | null, completed: boolean, actor: { id: string; directorLevel: boolean }, account: { id: string; directorLevel: boolean }): string | null {
  if (!link) return null;
  if (completed) return LINKED_DELETE_COMPLETED;
  if (!canEditLinkedCompletion(link, actor) && canEditLinkedCompletion(link, account)) return teacherViewReason("이 요청서 지우기는");
  if (!canEditLinkedCompletion(link, actor) || !canEditLinkedCompletion(link, account)) return linkedDeleteLockReason(link.deskName, deskStateOf(link));
  return null;
}
