/**
 * 퇴원보고서 **원장 환불 결정**(원장 2026-11-06 · DB s2_0033) — 순수 판정(테스트용 · server-only 밖 · 화면·서버 공용).
 *
 * - 환불할 수 있는 줄(`lineRefundable` — 과목 수강종료면 끝내는 반 줄·기타 항목 규칙은 `loadLaterInvoices`가 이미 걸렀다)이 남았고
 *   원장급이 그 줄을 정하지 않았으면 퇴원·수강종료를 처리하지 않는다('환불 결정 대기'). 결정 = '환불 승인'(고른 줄 → 데스크 요청서 ·
 *   고르지 않은 줄은 같은 동작에서 '환불하지 않음') 또는 '환불 없음'.
 * - 결정은 줄 키(`<청구 id>#<줄 식별값>`)마다 DB에 남는다. 결정 뒤 새로 생긴 줄 · 요청서가 지워진 줄은 다시 결정 안 됨.
 * - 환불 가능 줄 계산은 앱에만 있다 → **처리 요청마다** 같은 요청에서 계산한 확인 값(`RefundCheck`)을 DB에 넘기고, DB가 저장된 결정으로
 *   결정 안 된 줄을 센다(`withdrawal_report_refund_note`). 확인 값이 없으면 DB는 처리하지 않는다(빠뜨리면 닫히는 쪽).
 */

/**
 * 확인 값(리뷰 2026-11-06 수리판 · DB s2_0033 `withdrawal_report_refund_note`가 같은 모양을 검사한다):
 * - `refundable` = 묶음의 지금 환불 가능 줄 · 그 줄을 보이는 보고서(할 일·알림 링크) · 지금 낸 돈(`paid` — 결정 뒤 늘면 다시 결정 안 됨).
 * - `claimed` = 이 묶음 요청서가 잡아 확인 값에서 뺀 줄과 그 요청서 — 처리 순간 그 요청서가 없거나 그 줄을 안 담으면 DB가 결정 안 됨으로 센다(삭제 경합).
 * - `asOf` = 계산 전에 읽은 학생의 퇴원월 뒤 청구 max(updated_at)(없으면 null) — DB 값이 더 새것이면 처리를 보류한다(다음 확인이 다시 계산).
 * - `scope` = 처리 범위 — 처리 함수가 과목 수강종료를 전체 퇴원으로 바꿀 조건(남는 수강 없음)이면 'withdrawal'. 다르면 DB가 보류한다.
 */
export type RefundScope = "withdrawal" | "subject_end";
export type RefundCheck = {
  refundable: { key: string; report: string; paid: number }[];
  claimed: { key: string; doc: string }[];
  asOf: string | null;
  scope: RefundScope;
};

/** 줄을 환불할 수 있나 — 낸 돈이 있고 · 환불된 청구·줄이 아니고 · 아직 남은 요청서가 없음. */
export const lineRefundable = (inv: { status: string }, l: { paidNet: number; billingRefund: boolean; refund: unknown }) =>
  l.paidNet > 0 && inv.status !== "refunded" && !l.billingRefund && !l.refund;

/**
 * 다른 묶음의 요청서가 담은 줄을 이 묶음에서 다시 **환불 승인**할 수 있나(팀장 결정 2026-11-06) — 그 요청서가 취소된 요청에만 이어졌고 환불 전일 때만.
 * 돈을 돌려줬거나(완료) 진행 중인 다른 요청의 요청서면 같은 돈을 두 번 돌려줄 수 있어 고를 수 없다 — 결정은 '환불하지 않음'(고르지 않은 줄 · '환불 없음')으로만.
 * 그 줄도 이 묶음에선 결정 안 됨이다(`lineRefundable` — 확인 값에 든다).
 */
export const reapprovable = (l: { otherRefund?: { canceled: boolean; completed: boolean } | null }) => !l.otherRefund || (l.otherRefund.canceled && !l.otherRefund.completed);

type Lines = readonly { status: string; lines: readonly { key: string; paidNet: number; billingRefund: boolean; refund: { documentId: string } | null | unknown }[] }[];

/** 한 보고서 화면의 환불 가능 줄 키(보이는 차례 · 겹침 없음). */
export function refundableKeys(later: Lines): string[] {
  const out: string[] = [];
  for (const inv of later) for (const l of inv.lines) if (lineRefundable(inv, l) && !out.includes(l.key)) out.push(l.key);
  return out;
}

/**
 * 묶음 확인 값 — 보고서마다(대표 보고서 먼저) 환불 가능 줄(낸 돈 포함). 같은 줄이 두 보고서에 보이면 먼저 본 보고서 몫.
 * 이 묶음 요청서가 잡은 줄(`refund`)은 `claimed`로 — 그 요청서 id와 함께. `asOf`·`scope`는 부르는 쪽이 계산 전에 정한 값.
 */
export function buildRefundCheck(perReport: readonly { reportId: string; later: Lines }[], meta: { asOf: string | null; scope: RefundScope }): RefundCheck {
  const refundable: RefundCheck["refundable"] = [];
  const claimed: RefundCheck["claimed"] = [];
  const seen = new Set<string>();
  const seenClaim = new Set<string>();
  for (const { reportId, later } of perReport) {
    for (const inv of later) for (const l of inv.lines) {
      if (lineRefundable(inv, l)) {
        if (seen.has(l.key)) continue;
        seen.add(l.key);
        refundable.push({ key: l.key, report: reportId, paid: l.paidNet });
      } else {
        const doc = (l.refund as { documentId?: unknown } | null)?.documentId;
        if (typeof doc === "string" && !seenClaim.has(l.key)) { seenClaim.add(l.key); claimed.push({ key: l.key, doc }); }
      }
    }
  }
  return { refundable, claimed, asOf: meta.asOf, scope: meta.scope };
}

export type RefundDecision = { decision: "refund" | "none"; /** '환불' 결정의 요청서가 아직 있나(지워지면 그 줄은 다시 결정 안 됨). */ live: boolean;
  /** 결정 때 그 줄의 낸 돈(DB paid_net) — 지금 낸 돈이 더 크면 다시 결정 안 됨(리뷰 #12). 모르면 없음. */ paidNet?: number | null };

/** 결정 안 된 줄 — DB `withdrawal_report_refund_note`와 같은 판정: '환불하지 않음'도, 아직 남은 요청서의 '환불'도 없는 줄. */
export function undecidedKeys(refundable: readonly string[], decisions: ReadonlyMap<string, RefundDecision>, paidOf?: ReadonlyMap<string, number>): string[] {
  return refundable.filter(k => {
    const d = decisions.get(k);
    if (!d || (d.decision === "refund" && !d.live)) return true;
    const now = paidOf?.get(k);
    return d.paidNet != null && now != null && now > d.paidNet;
  });
}

/** '환불하지 않음'으로 정해 둔 줄(이 화면의 환불 가능 줄 중). */
export function declinedKeys(refundable: readonly string[], decisions: ReadonlyMap<string, RefundDecision>): string[] {
  return refundable.filter(k => decisions.get(k)?.decision === "none");
}

/** 환불 결정이 처리를 막는 단계인가 — 처리 완료·취소·재검토 보고서엔 기다릴 처리가 없다. */
export function decisionBlocksProcessing(status: string): boolean {
  return !["completed", "canceled", "blocked"].includes(status);
}

/**
 * 보고서에 이어진 환불 요청서의 환불완료일자를 넣거나 지울 수 있나(원장 2026-11-06) — 그 요청서의 데스크 담당과 원장급만.
 * 이어지지 않은 요청서(`link` 없음)는 종전대로 수납 쓰기 권한이면 된다. `directorLevel` = 원장 역할 · 강사뷰 아님(`cancelsAsDirector`).
 * DB도 같은 판정으로 직원 세션의 쓰기를 막는다(s2_0033 `withdrawal_report_refund_complete_guard`).
 */
export function canEditLinkedCompletion(link: { deskId: string | null } | null, user: { id: string; directorLevel: boolean }): boolean {
  return !link || user.directorLevel || (!!link.deskId && link.deskId === user.id);
}

/** 화면 문구 — 원장 결정(2026-11-06)이 정한 글자 그대로. */
export const REFUND_DECISION_CHIP = "환불 결정 대기";
export const REFUND_DECISION_WAIT_NOTE = "원장 환불 결정 전 — 승인해도 환불 결정 뒤에 처리됩니다";
export const DESK_NOT_DESIGNATED = "학원 설정에서 데스크 담당자를 먼저 지정해 주세요";
export const unpickedNotice = (n: number) => `고르지 않은 ${n}건은 환불하지 않음으로 기록됩니다`;
export const completionLockReason = (deskName: string | null) =>
  `퇴원보고서에서 이어진 환불 요청서입니다. 환불완료일자는 담당 데스크${deskName ? `(${deskName})` : ""}와 원장만 넣거나 지울 수 있습니다.`;
/** 원장 결정 C.3 — 옛 요청서 완료 막음(DB 트리거 문구와 같다). */
export const COMPLETION_SUPERSEDED = "같은 청구에 새 퇴원 요청의 요청서가 있습니다 — 새 요청서로 처리하세요.";
/** '다른 강사 뷰'에서 실제 로그인 계정이 담당 데스크·원장급이 아닐 때 — DB 트리거는 실제 계정을 본다(팀장 결정 2026-11-06). */
export const completionAccountLockReason = (deskName: string | null) =>
  `'다른 강사 뷰'로 보고 있습니다. 퇴원보고서에서 이어진 환불 요청서의 환불완료일자는 실제 로그인한 계정이 담당 데스크${deskName ? `(${deskName})` : ""}이거나 원장일 때만 넣거나 지울 수 있습니다.`;

/**
 * 이어진 요청서의 환불완료일자 잠금 사유(통과면 null) — **화면 행위자**(강사뷰면 대상 직원 · 강사뷰 = 그 사람)와 **실제 로그인 계정** 둘 다
 * 담당 데스크이거나 원장급이어야 한다(팀장 결정 2026-11-06). DB 트리거(s2_0033)는 세션의 실제 계정을 본다 — 앱이 행위자만 보면 저장이 DB에서
 * 막히거나, 강사뷰 쓰기(`writeSessionFirst`)가 관리 키로 다시 써 트리거를 지나 버린다. 화면 잠금과 저장 액션이 같은 함수를 쓴다.
 */
export function linkedCompletionLock(
  link: { deskId: string | null; deskName: string | null; superseded?: boolean } | null,
  actor: { id: string; directorLevel: boolean },
  account: { id: string; directorLevel: boolean },
): string | null {
  if (!link) return null;
  // 원장 결정 C.3 — 같은 청구 줄에 새 퇴원 요청의 요청서가 있는 옛 요청서(취소된 요청)는 누구도 완료일자를 넣지 못한다(DB 트리거와 같은 판정).
  if (link.superseded) return COMPLETION_SUPERSEDED;
  if (!canEditLinkedCompletion(link, actor)) return completionLockReason(link.deskName);
  if (!canEditLinkedCompletion(link, account)) return completionAccountLockReason(link.deskName);
  return null;
}
