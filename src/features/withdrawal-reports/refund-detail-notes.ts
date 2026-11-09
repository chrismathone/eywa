/**
 * 퇴원보고서 상세의 **환불·처리 안내 한 벌**(리뷰 r2 (b)·I3 · 경미 m1·m2·m4·m5·m6·m19) — 순수 판정(화면·시험 공용 · server-only 밖).
 *
 * 근거가 둘이다(바꾸지 않는다):
 * - **지금 계산**(`undecided` — 이 화면의 퇴원월 뒤 청구 → 결정 표): '결정 전' 줄 · 결정 단추 · 확인 값은 이것으로 선다(결정은 이것으로 한다).
 * - **DB 묶음 표시**(`hold` — `refund_hold`·`refund_hold_report`·`refund_undecided` · 마지막 처리 시도 때의 판정): 목록 칩·상태 칸·상세 칩·결재란 '환불 결정' 칸이 이것으로 선다.
 * 둘이 다르면(그 사이 청구 동기화 · 요청서 표식 변화) 상세에 사실대로 한 줄을 보인다 — 처리는 다음 처리 시도 때 DB가 **그때 다시 계산한 값**으로 정한다.
 * 퇴원월 뒤 청구를 못 읽었거나(조회 실패) 수납 열람권이 없으면 지금 계산이 없다 — 어긋남·결정 위치 안내를 띄우지 않는다(I3 · '없음'이라고 말하지 않는다).
 */
import type { RefundStep, ReportStatus } from "./model";
import { REFUND_DECISION_WAIT_NOTE } from "./refund-decision";

/** 퇴원월 뒤 청구 칸 상태 — 읽음 · 조회 실패 · 수납 열람권 없음(리뷰 r2 I3). */
export type LaterState = "ok" | "failed" | "hidden";
/** DB 묶음 표시 한 벌(상세용) — 대기 · 결정할 줄을 보이는 보고서(모르면 대표 보고서로 서버가 채운다) · DB가 센 결정 안 된 줄 수 · 마지막 판정 시각. */
export type HoldView = { hold: boolean; report: string | null; undecided: number; checkedAt: string | null };
/** 같은 묶음의 다른 과목 보고서 승인 — 승인 전이 있다 · 다 승인 · 모름(조회 실패). 묶음이 없으면 done. */
export type OthersState = "pending" | "done" | "unknown";

export const LATER_FAILED_TEXT = "퇴원월 뒤 청구를 불러오지 못했습니다(새로고침).";
export const LATER_HIDDEN_TEXT = "수납 권한이 없어 청구는 보이지 않습니다.";
/** 원장이 아닌 사람(승인 차례가 아님)의 결정 대기 안내 — '승인해도'는 승인할 사람에게만(리뷰 r2 m4 · 원장이 정한 글은 `REFUND_DECISION_WAIT_NOTE` 그대로). */
export const REFUND_DECISION_WAIT_PLAIN = "원장 환불 결정 전 — 환불 결정 뒤에 처리됩니다";
const BEFORE_APPROVAL: readonly string[] = ["requested", "revision", "manager_pending", "director_pending"];

export type DetailRefundInput = {
  report: { id: string; status: ReportStatus; effective_date: string; direct?: boolean };
  /** 이 화면에서 원장 결정을 할 수 있나(`capabilities.refund`). */
  director: boolean;
  /** 지금 제출·승인 차례인가(`capabilities.approve || capabilities.edit`) — 결정 대기 안내의 '승인해도'. */
  approver: boolean;
  later: LaterState;
  undecided: readonly string[];
  hold: HoldView | null;
  /** 결정할 줄을 보이는 **다른** 보고서(과목 이름 · 이 사람이 열 수 있나) — 서버가 묶음 형제로 채운다. 이 보고서면 null. */
  holdReport?: { id: string; label: string; readable: boolean } | null;
  others: OthersState;
  deskWaiting: boolean;
  /** 데스크 환불 단계가 있었나(모두 끝났어도) — 승인 완료 안내 '관리자 승인과 데스크 환불이 끝났습니다'. */
  hadDesk: boolean;
  /** 서버 `refundHoldGap`(지금 계산을 했을 때만 · 모르면 null). */
  gap: "app" | "db" | null;
  /** 완료 전 데스크 요청서 중 담당이 퇴사했거나 없는 것(할 일 받는 사람 없음 — m19). */
  orphanDesk: { documentId: string } | null;
  today: string;
};

export type DetailRefundNote = { key: string; text: string; tone: "plain" | "note" | "alert"; href?: string; linkText?: string; recheck?: boolean };

/** 결정 대기(처리 전 단계) — DB 표시 또는 이 화면의 지금 계산. 상세 안내·승인 확인·결재 문서의 '퇴원 처리' 칸이 같은 값을 쓴다. */
export function decisionWaitingOf(status: string, hold: boolean, undecided: readonly string[]): boolean {
  return !["completed", "canceled", "blocked"].includes(status) && (hold || undecided.length > 0);
}

/** 다음 DB 판정이 도는 때(코드 확인 2026-11-09 — 제출·승인 · 처리일 cron 00:05 apply · cron 안전망 release(진행 중 전원 승인 · 처리일이 된 예약) · 환불 요청서 저장·삭제). */
export function nextJudgementText(status: string, others: OthersState, effectiveDate: string, today: string): string {
  if (BEFORE_APPROVAL.includes(status)) return "다음 제출·승인 때";
  if (status === "scheduled") return effectiveDate > today ? `처리일(${effectiveDate}) 00:05 확인 때` : "매일 00:05 확인 때";
  if (others === "pending") return "다른 과목 보고서의 제출·승인 때";
  if (others === "unknown") return "다른 과목 보고서의 승인 때 또는 매일 00:05 확인 때";
  return "매일 00:05 확인 때";
}

/** 처리를 기다리는 까닭(승인 완료·처리 예약 안내 · 리뷰 r2 m1·m5 — 모두 이어 쓴다 · '까지'로 조사 문제를 피한다). */
function waitParts(i: DetailRefundInput, decisionWaiting: boolean): string[] {
  return [
    ...(i.report.status === "approved" && i.others === "pending" ? ["함께 요청한 다른 과목 보고서의 승인"] : []),
    ...(decisionWaiting ? ["원장 환불 결정(퇴원월 뒤 청구의 환불 승인 또는 환불 없음)"] : []),
    ...(i.deskWaiting ? ["데스크 환불 처리(환불 요청서의 환불완료일자)"] : []),
  ];
}

export function detailRefundNotes(i: DetailRefundInput): DetailRefundNote[] {
  const { report: r } = i;
  const open = !["completed", "canceled", "blocked"].includes(r.status);
  const hold = !!i.hold?.hold;
  const decisionWaiting = decisionWaitingOf(r.status, hold, i.undecided);
  const out: DetailRefundNote[] = [];
  const waits = waitParts(i, decisionWaiting);
  if (r.status === "scheduled") {
    out.push({ key: "status", tone: "plain", text: `${r.direct ? "처리 예약입니다." : "승인이 완료되었습니다."} ${r.effective_date}${waits.length ? ` 이후 ${waits.join(" · ")}까지 끝나면 처리하며` : "에 처리하며"}, 그 전까지는 기존 수강 상태를 유지합니다.` });
  } else if (r.status === "approved") {
    const head = i.hadDesk && !i.deskWaiting ? "관리자 승인과 데스크 환불이 끝났습니다." : "관리자 승인이 끝났습니다.";
    out.push({ key: "status", tone: "plain", text: waits.length ? `${head} ${waits.join(" · ")}까지 끝나면 처리합니다.`
      // 형제 조회 실패(리뷰 r2 (a)와 같은 축) — '다른 과목 대기'라고 단정하지 않는다.
      : i.others === "unknown" ? `${head} 함께 요청한 다른 과목 보고서의 승인 여부를 확인하지 못했습니다(새로고침). 모두 승인됐으면 매일 00:05 확인 때 처리합니다.`
      // 리뷰 r2 m6 — DB가 확인 값을 '모름'(낡음·범위 다름)으로 보류한 경우 등: 다음 확인 때 저절로 처리된다.
      : `${head} 처리 확인 대기 — 다음 확인(매일 00:05) 때 처리합니다.` });
  }
  if (decisionWaiting && !i.director) out.push({ key: "wait", tone: "plain", text: i.approver && BEFORE_APPROVAL.includes(r.status) ? REFUND_DECISION_WAIT_NOTE : REFUND_DECISION_WAIT_PLAIN });
  // 결정할 줄이 다른 보고서에 있다(DB 표시 · 이 화면 지금 계산 0건) — 그 보고서로 바로 간다(막다른 고리 없음 · 리뷰 r2 (b) I2(ⅰ)). 지금 계산을 못 했으면 말하지 않는다(I3).
  if (open && hold && i.later === "ok" && !i.undecided.length && i.holdReport && i.gap === null) {
    const n = i.hold!.undecided;
    out.push({ key: "elsewhere", tone: "plain",
      text: `원장 환불 결정 대기 — 결정할 건${n > 0 ? ` ${n}건` : ""}은 다른 보고서(${i.holdReport.label})에 있습니다.${i.director ? " 그 보고서의 '환불 확인'에서 정하세요." : ""}`,
      ...(i.holdReport.readable ? { href: `/withdrawal-reports/${i.holdReport.id}#refund`, linkText: "그 보고서 열기" } : {}) });
  }
  if (open && i.gap) {
    const when = nextJudgementText(r.status, i.others, r.effective_date, i.today);
    out.push(i.gap === "app"
      ? { key: "gap", tone: "note", text: `목록 표시와 다릅니다 — 목록과 위 칩에는 '환불 결정 대기'가 없지만(마지막 판정 기준), 지금 계산으로는 원장이 정하지 않은 환불 가능 건이 ${i.undecided.length}건 있습니다. ${when} DB가 다시 판정하고, 그때도 남아 있으면 처리하지 않습니다.` }
      : { key: "gap", tone: "note", text: `목록 표시와 다릅니다 — 목록과 위 칩·결재란은 '환불 결정 대기'(마지막 판정 기준)지만, 지금 계산으로는 이 보고서에 정할 환불 가능 건이 없습니다. ${when} DB가 다시 판정합니다.${i.director ? " 지금 다시 판정하려면 아래 단추를 누르세요." : ""}`,
        ...(i.director ? { recheck: true } : {}) });
  }
  // 리뷰 r2 m19 — 퇴사한(또는 없는) 데스크의 미완료 요청서는 할 일 받는 사람이 없다.
  if (open && i.orphanDesk) out.push({ key: "orphan-desk", tone: "alert", href: `/billing/refunds/${i.orphanDesk.documentId}`, linkText: "요청서 열기",
    text: "데스크 담당자가 퇴사해 이 환불 요청서의 할 일을 받는 사람이 없습니다 — 원장이 환불완료일자를 넣거나, 요청서를 지우고 다시 환불 승인하세요." });
  return out;
}

/** 승인·제출 확인 칸의 처리 안내(리뷰 r2 m2 — 결정 대기면 '처리일이 지났다면 즉시 반영됩니다'를 빼고 한 문장으로). */
export function approveConfirmText(i: { effectiveDate: string; withdrawal: boolean; deskWaiting: boolean; decisionWaiting: boolean; directorStep: boolean }): string {
  if (i.directorStep) return `이 보고서를 승인합니다. 관리자 전원 승인 후 원장 검토로 넘어갑니다.${i.decisionWaiting ? ` ${REFUND_DECISION_WAIT_NOTE}.` : ""}`;
  // 조사까지(종전 글은 '수강종료을'이었다).
  const what = i.withdrawal ? "퇴원을" : "선택 과목 수강종료를";
  if (i.decisionWaiting) return `이 보고서를 승인합니다. 함께 요청한 보고서와 모든 승인자의 승인이 끝나도 원장 환불 결정${i.deskWaiting ? "과 데스크 환불 처리" : ""}까지 끝난 뒤 ${what} 처리합니다. ${REFUND_DECISION_WAIT_NOTE}.`;
  return `이 보고서를 승인합니다. 함께 요청한 보고서와 모든 승인자의 승인이 끝나면${i.deskWaiting ? " 데스크 환불 처리까지 끝난 뒤" : ""} ${i.effectiveDate}에 ${what} 처리합니다. 처리일이 지났다면 즉시 반영됩니다.`;
}

/**
 * 요청 취소 확인 글(리뷰 r2 m13·m18) — 이어진 환불 요청서(환불 완료 건수)를 말하고, 사유가 처리 이력에 남는지는 관문 SQL 적용 여부로 가른다
 * (적용 전 DB는 사유를 이력에 남기지 않는다 — 감사로그에만).
 */
export function cancelConfirmText(steps: readonly RefundStep[], gateReady: boolean): string {
  const done = steps.filter(s => s.completedDate).length;
  const open = steps.length - done;
  const refunds = steps.length ? ` 이 요청에 이어진 환불 요청서 ${steps.length}건${done ? `(환불 완료 ${done}건)` : ""}은 남습니다 —${open ? " 환불 전 요청서는 데스크 할 일이 취소되고 데스크 담당자에게 '환불 진행 전 확인' 알림이 갑니다." : ""}${done ? " 환불을 마친 요청서는 처리한 사람에게 '환불 확인 필요' 알림이 갑니다(돌려준 돈은 저절로 되돌려지지 않습니다)." : ""}` : "";
  return `함께 요청한 모든 강사의 보고서를 취소합니다. 학생의 수강 상태는 유지됩니다.${refunds} ${gateReady ? "취소 사유는 처리 이력에 남고 목록에서 확인할 수 있습니다." : "시스템 준비 중이라 취소 사유는 이 화면의 처리 이력에 남지 않습니다."}`;
}
