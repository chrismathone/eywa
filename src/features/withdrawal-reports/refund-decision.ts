/**
 * 퇴원보고서 **원장 환불 결정**(원장 2026-11-06 · DB s2_0036) — 순수 판정(테스트용 · server-only 밖 · 화면·서버 공용).
 *
 * - 환불할 수 있는 줄(`lineRefundable` — 과목 수강종료면 끝내는 반 줄·기타 항목 규칙은 `loadLaterInvoices`가 이미 걸렀다)이 남았고
 *   원장급이 그 줄을 정하지 않았으면 퇴원·수강종료를 처리하지 않는다('환불 결정 대기'). 결정 = '환불 승인'(고른 줄 → 데스크 요청서 ·
 *   고르지 않은 줄은 같은 동작에서 '환불하지 않음') 또는 '환불 없음'.
 * - 결정은 줄 키(`<청구 id>#<줄 식별값>`)마다 DB에 남는다. 결정 뒤 새로 생긴 줄 · 요청서가 지워진 줄은 다시 결정 안 됨.
 * - 환불 가능 줄 계산은 앱에만 있다 → **처리 요청마다** 같은 요청에서 계산한 확인 값(`RefundCheck`)을 DB에 넘기고, DB가 저장된 결정으로
 *   결정 안 된 줄을 센다(`withdrawal_report_refund_note`). 확인 값이 없으면 DB는 처리하지 않는다(빠뜨리면 닫히는 쪽).
 */

/**
 * 확인 값(리뷰 2026-11-06 수리판 · DB s2_0036 `withdrawal_report_refund_note`가 같은 모양을 검사한다):
 * - `refundable` = 묶음의 지금 환불 가능 줄 · 그 줄을 보이는 보고서(할 일·알림 링크) · 지금 낸 돈(`paid` — 결정 뒤 늘면 다시 결정 안 됨).
 * - `claimed` = 이 묶음 요청서가 잡아 확인 값에서 뺀 줄 · 그 요청서 · 지금 낸 돈(`paid` — 리뷰 r2 D-4) — 처리 순간 그 요청서가 없으면 결정 안 됨(삭제 경합).
 *   그 줄의 결정 행이 있으면 결정 때 본 낸 돈(`paid_seen`)보다 지금이 크면 결정 안 됨('환불' 결정도 — 늘어난 돈은 다시 묻는다) · 결정 행이 없으면 표식에 그 키가
 *   정확히 있어야 결정됨(표식 키가 낡아 겹침으로 담은 줄은 원장이 한 번 정한다 — 리뷰 r2 D-2 · 막다른 대기 없음).
 * - `asOf` = 계산 전에 DB가 낸 학생의 퇴원월 뒤 청구 **내용 지문**(`withdrawal_refund_later_fingerprint` — 리뷰 r2 D-12: 시각 비교는 늦게 커밋된 변경을 놓친다)
 *   — 처리 순간 다시 낸 지문과 다르면 처리를 보류한다(다음 확인이 다시 계산).
 * - `scope` = 처리 범위 — 처리 함수가 과목 수강종료를 전체 퇴원으로 바꿀 조건(남는 수강 없음)이면 'withdrawal'. 다르면 DB가 보류한다.
 */
export type RefundScope = "withdrawal" | "subject_end";
export type RefundCheck = {
  refundable: { key: string; report: string; paid: number }[];
  claimed: { key: string; doc: string; paid: number; report: string }[];
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
export const reapprovable = (l: { otherRefund?: { canceled: boolean; completed: boolean } | null; otherAll?: readonly { canceled: boolean; completed: boolean }[] }) =>
  !l.otherRefund || (l.otherAll ?? [l.otherRefund]).every(o => o.canceled && !o.completed);
/**
 * 이 줄을 **환불 승인**으로 고를 수 있나 — 환불 가능 · 다시 승인할 수 있는 줄(`reapprovable`) · 금액을 아는 줄(미배분 과목 몫을 계산할 수 없으면 '환불하지 않음'으로만 —
 * 리뷰 r2 I5 · 금액을 모르는 돈을 요청서로 내보내지 않는다). 화면 토글 · 서버 `pick`이 같은 판정.
 */
export const approvable = (inv: { status: string }, l: Parameters<typeof lineRefundable>[1] & Parameters<typeof reapprovable>[0] & { amountUnknown?: boolean }) =>
  lineRefundable(inv, l) && reapprovable(l) && !l.amountUnknown;

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
        if (typeof doc === "string" && !seenClaim.has(l.key)) { seenClaim.add(l.key); claimed.push({ key: l.key, doc, paid: l.paidNet, report: reportId }); }
      }
    }
  }
  return { refundable, claimed, asOf: meta.asOf, scope: meta.scope };
}

export type RefundDecision = { decision: "refund" | "none"; /** '환불' 결정의 요청서가 아직 있나(지워지면 그 줄은 다시 결정 안 됨). */ live: boolean;
  /** 결정 때 그 줄의 낸 돈(DB paid_net — '환불'이면 요청서 상한에 드는 돈). 모르면 없음. */ paidNet?: number | null;
  /** 원장이 마지막으로 본 낸 돈(DB paid_seen · 없으면 paid_net) — 지금 낸 돈이 더 크면 다시 결정 안 됨('환불' 결정도 · 리뷰 #12 · r2 D-4). */ paidSeen?: number | null;
  /** '환불' 결정의 요청서 id. */ documentId?: string | null };

const seenOf = (d: RefundDecision) => d.paidSeen ?? d.paidNet ?? null;
/** 결정 안 된 줄 — DB `withdrawal_report_refund_note`(환불 가능 갈래)와 같은 판정: '환불하지 않음'도, 아직 남은 요청서의 '환불'도 없는 줄 · 본 뒤 낸 돈이 는 줄. */
export function undecidedKeys(refundable: readonly string[], decisions: ReadonlyMap<string, RefundDecision>, paidOf?: ReadonlyMap<string, number>): string[] {
  return refundable.filter(k => {
    const d = decisions.get(k);
    if (!d || (d.decision === "refund" && !d.live)) return true;
    const now = paidOf?.get(k), seen = seenOf(d);
    return seen != null && now != null && now > seen;
  });
}

/**
 * 이 묶음 요청서가 담은 줄 중 다시 정할 것(DB note claimed 갈래와 같은 판정 · 리뷰 r2 D-2·D-4) — 결정 행이 있으면 본 뒤 낸 돈이 늘었을 때(`increase`),
 * 없으면 표식에 그 키가 정확히 없을 때(`inexact` — 수납명이 바뀌었거나 미배분이 줄에 배분돼 겹침으로 담은 줄). 원장은 '환불 없음'으로 정한다(그 요청서가 담은 것으로
 * 보고 더 환불하지 않음 — 늘어난 몫을 환불하려면 요청서를 지우고 다시 환불 승인한다).
 */
export type OpenClaim = { key: string; reason: "increase" | "inexact"; before: number | null; now: number; documentId: string };
export function openClaims(later: Lines, decisions: ReadonlyMap<string, RefundDecision>): OpenClaim[] {
  const out: OpenClaim[] = [];
  for (const inv of later) for (const l of inv.lines) {
    const ref = l.refund as { documentId?: unknown; exact?: unknown } | null;
    if (!ref || typeof ref.documentId !== "string" || out.some(o => o.key === l.key)) continue;
    const d = decisions.get(l.key);
    if (!d) { if (ref.exact === false) out.push({ key: l.key, reason: "inexact", before: null, now: l.paidNet, documentId: ref.documentId }); continue; }
    const seen = seenOf(d);
    if (seen != null && l.paidNet > seen) out.push({ key: l.key, reason: "increase", before: seen, now: l.paidNet, documentId: ref.documentId });
  }
  return out;
}
/** 원장이 지금 정할 줄 전부(환불 가능 줄 + 다시 정할 이 묶음 요청서 줄) — '환불 없음'·'환불 승인'의 고르지 않은 줄 · 서버 대조가 같은 값. */
export function decisionTargets(later: Lines, decisions: ReadonlyMap<string, RefundDecision>): string[] {
  return [...refundableKeys(later), ...openClaims(later, decisions).map(o => o.key)];
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
 * DB '환불 결정 대기' 표시 한 벌(s2_0036 묶음 칸) — `hold` = `refund_hold` · `report` = 결정할 줄을 보이는 보고서(`refund_hold_report`) ·
 * `checkedAt` = DB가 마지막으로 판정한 시각(`refund_checked_at` · 판정한 적 없으면 null).
 */
export type RefundHoldState = { hold: boolean; report: string | null; /** DB가 센 결정 안 된 줄 수(`refund_undecided`) — 결정할 건이 다른 보고서에 있을 때 'N건'. */ undecided: number; checkedAt: string | null };
/** 목록 표시와 지금 계산이 어긋난 방향 — `app` = 지금 계산은 결정 전 · DB는 대기 아님 / `db` = DB는 대기 · 지금 계산은 이 보고서에 정할 건 없음. */
export type RefundHoldGap = "app" | "db";
/**
 * 목록 표시(DB `refund_hold`)와 상세의 지금 계산이 어긋났나(리뷰 r2 (b)). 상세의 '결정 전'·결정 버튼·확인 값은 **지금 계산**(`laterInvoicesFor` → 결정 표)으로
 * 서고, 목록 칩·상태 칸·상세 칩은 DB가 **마지막 처리 시도**(제출·승인·처리일·환불 완료·결정) 때 남긴 표시로 선다 — 그 사이 청구가 동기화되거나 요청서 표식이
 * 낡으면 둘이 다를 수 있다. 결정은 지금 계산으로 하고(바꾸지 않는다), 다르면 상세에 사실대로 한 줄을 보인다(`detailRefundNotes` — refund-detail-notes.ts). 처리 여부는 다음 처리 시도 때 DB가 다시 정한다.
 * - `app`: 이 화면에 결정 전인 줄이 있는데 DB는 대기가 아니다 — DB가 판정했어야 할 때만(판정 시각이 있거나 이 보고서가 제출됨). 제출 전 작성 중이고 판정한 적이
 *   없으면 아직 판정 전이라 어긋남이 아니다(목록은 판정 뒤에 대기를 보인다).
 * - `db`: DB는 대기이고 결정할 줄을 보이는 보고서가 이 보고서(모르면 대표 보고서)인데, 이 화면엔 결정 전인 줄이 없다. 다른 보고서가 결정 보고서면 어긋남이 아니다
 *   (원장에겐 '함께 요청한 다른 보고서' 안내가 선다).
 * - 처리 전 단계(`decisionBlocksProcessing`)만. DB 표시나 지금 계산을 못 읽었으면(`state` null · `computed` false) 모른다 → null(말하지 않는다).
 */
export function refundHoldGap(
  report: { id: string; status: string; group_leader?: boolean | null },
  state: RefundHoldState | null,
  undecided: readonly string[],
  computed = true,
): RefundHoldGap | null {
  if (!state || !computed || !decisionBlocksProcessing(report.status)) return null;
  if (!state.hold) {
    const judged = state.checkedAt !== null || !["requested", "revision"].includes(report.status);
    return undecided.length > 0 && judged ? "app" : null;
  }
  const holdHere = state.report ? state.report === report.id : !!report.group_leader;
  return holdHere && undecided.length === 0 ? "db" : null;
}

/** 화면 문구 — 원장 결정(2026-11-06)이 정한 글자 그대로. */
export const REFUND_DECISION_CHIP = "환불 결정 대기";
export const REFUND_DECISION_WAIT_NOTE = "원장 환불 결정 전 — 승인해도 환불 결정 뒤에 처리됩니다";
export const DESK_NOT_DESIGNATED = "학원 설정에서 데스크 담당자를 먼저 지정해 주세요";
export const unpickedNotice = (n: number) => `고르지 않은 ${n}건은 환불하지 않음으로 기록됩니다`;

// 이어진 요청서 잠금·상한·문구는 linked-request.ts(한 파일 200줄) — 종전 import 자리를 그대로 두려고 다시 내보낸다.
export * from "./linked-request";
