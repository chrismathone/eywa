/**
 * 보강 빼기 **판정**(순수 · Vitest) — 원스크린에서 잘못 추가한 보강을 지울 때, 저장된 보강 보고서를
 * "지울 수 있는 것"과 "손대면 안 되는 것"으로 가른다.
 *
 * 🔴 **학부모에게 나갔거나 나가는 중인 보고서는 취소 자체를 막는다**(원장 2026-08-18:
 *    *"이미 수업보고서가 발송된건은 보강취소를 못하게 강제해"*). 발송분을 이 버튼으로 회수까지 하던 초안이
 *    있었지만 폐기했다 — 학부모가 이미 본 기록을 "보강 빼기"라는 정리 동작이 조용히 지우면 안 된다.
 *    정말 지워야 하면 **먼저 보고서를 회수**(게시글 삭제)한 뒤 그때 뺀다(회수 완료분은 지울 수 있다).
 *
 * 발송 진행 중(`queued`·`processing`)·회수 진행 중(`recall_requested`)도 같은 이유로 막는다 —
 * 지우면 워커가 방금 집어간 작업의 대상이 사라져 **게시만 되고 기록이 없는** 상태가 된다.
 */

import { isRecallInFlight, RECALL_FAILED, RECALLED } from "@/features/report-admin/report-recall";

export type MakeupReportRef = {
  id: string;
  classnoteStatus: string | null;
  shareToken: string | null;
  /**
   * 학부모가 게시글을 읽은 기록 — **재발급이 지우지 못하는 발송 흔적**(뒷문 방어, 적대 리뷰 M3).
   * `reissueShareLink`는 `classnote_status`를 NULL로 되돌리지만 **게시글은 그대로 남는다**. 그 상태를
   * "미발송"으로 보면 발송분이 삭제 경로로 새므로, 읽힌 적이 있으면 발송분으로 취급한다.
   */
  readAt?: string | null;
};

export type MakeupRemovePlan = {
  /** 바로 지울 행 — 학부모 게시판에 없는 것(미발송·발송 실패·회수 완료). */
  deleteIds: string[];
  /** 이미 학부모에게 나간 행 — **취소 불가**. 회수를 먼저 해야 한다. */
  sentIds: string[];
  /** 발송·회수 처리 중인 행 — 끝난 뒤에 다시. */
  busyIds: string[];
};

/**
 * 보강 보고서들을 세 갈래로 나눈다.
 * - `sentIds` = 학부모 게시판에 **올라가 있다** → 취소 불가(회수가 먼저).
 * - `busyIds` = 발송 대기·처리 중이거나 회수 요청 중 → 끝난 뒤에.
 * - `deleteIds` = 나머지(미발송·발송 실패·회수 완료) → 행 삭제.
 *
 * ⚠️ `success`인데 공유 토큰이 없는 행도 **발송분**이다(자동 회수만 불가) — 지우면 학부모 게시판에
 *    글이 남고 eywa엔 흔적이 0이 된다.
 */
export function planMakeupRemoval(rows: MakeupReportRef[]): MakeupRemovePlan {
  const plan: MakeupRemovePlan = { deleteIds: [], sentIds: [], busyIds: [] };
  for (const r of rows) {
    const status = r.classnoteStatus;
    if (isRecallInFlight(status) || status === "queued" || status === "processing") {
      plan.busyIds.push(r.id);
      continue;
    }
    // 게시된 상태 = success(토큰 유무 무관) · 회수 실패(게시글이 아직 살아 있다) ·
    // 재발급으로 상태가 지워졌지만 **학부모가 읽은 흔적이 남은** 행.
    if (status === "success" || status === RECALL_FAILED || (!status && r.readAt)) {
      plan.sentIds.push(r.id);
      continue;
    }
    // 회수가 끝난 행(recalled)은 게시글이 이미 없다 → 기록만 지우면 끝.
    plan.deleteIds.push(r.id);
  }
  return plan;
}

/**
 * 처리 결과를 사람이 읽는 한 문장으로. **무슨 일이 실제로 일어났는지**만 적는다 —
 * "삭제했습니다"라고 뭉뚱그리면 회수 대기분이 다음 새로고침에 되살아날 때 "안 지워졌다"가 된다.
 */
export function makeupRemoveMessage(r: {
  attendanceRemoved: boolean;
  deleted: number;
  /** 되감은 진도 엔트리 수(원장 "진도기록도 되돌려야지"). */
  progressEntries?: number;
  /** 남이 쓴 보강이라 못 건드린 수 — 조용히 넘기면 "반만 빠졌다"가 원인 불명으로 남는다. */
  notMine?: number;
}): string {
  const parts: string[] = [];
  if (r.attendanceRemoved) parts.push("출결 기록을 지웠습니다");
  if (r.deleted > 0) parts.push(`수업보고서 ${r.deleted}건을 지웠습니다`);
  if ((r.progressEntries ?? 0) > 0) parts.push(`진도 기록 ${r.progressEntries}건을 되돌렸습니다`);
  if ((r.notMine ?? 0) > 0) parts.push(`다른 선생님이 쓴 보강 ${r.notMine}건은 그대로 남습니다`);
  return parts.length ? parts.join(" · ") : "지울 기록이 없습니다";
}

/** 회수 완료 상태 — 이 상태의 행은 게시글이 없어 바로 삭제된다(테스트·문서용 재수출). */
export const MAKEUP_RECALLED = RECALLED;

/**
 * 화면에서 이 보강은 **뺄 수 있는가** — 발송·처리 중이면 버튼을 열지 않는다(서버도 같은 판정으로 막는다).
 * 🔴 **NULL을 "발송됨"으로 보지 말 것** — 저장만 하고 미발송인 행(실측 29건)이 NULL이다.
 */
export function canRemoveMakeupRow(status: string | null | undefined): boolean {
  if (!status) return true; // 미발송 — 지울 수 있다
  // 진행 중 판정은 **공유 소스**(isRecallInFlight)를 쓴다 — `recalling`(워커가 집어간 상태)을 여기서
  // 따로 나열하면 워커가 상태를 하나 더 쓸 때 이 목록만 낡는다(적대 리뷰 치명).
  return !(
    status === "success" ||
    status === RECALL_FAILED ||
    status === "queued" ||
    status === "processing" ||
    isRecallInFlight(status ?? null)
  );
}

/** 못 빼는 이유(한글) — 버튼 툴팁·확인창에 그대로 쓴다. 뺄 수 있으면 null. */
/**
 * 원어민 강사 화면(en)용 같은 세 문장 — 🔴 **한글 바로 옆에 둔다**(사유가 늘 때 한쪽만 채워지는 것 방지).
 * 🔴 서버 액션도 같은 함수를 쓰는데 거기엔 세션 언어가 없다 → **인자를 안 주면 한국어**가 계약이다.
 */
const BLOCK_REASON_EN = {
  inFlight: "This makeup is being sent — try again once that finishes",
  recalling: "This makeup is being recalled — you can remove it once the post is deleted",
  sent: "This makeup has already gone to the parents — recall the report (delete the post) first",
} as const;

export function makeupRemoveBlockReason(
  status: string | null | undefined,
  lang: "ko" | "en" = "ko",
): string | null {
  if (canRemoveMakeupRow(status)) return null;
  if (status === "queued" || status === "processing")
    return lang === "en" ? BLOCK_REASON_EN.inFlight : "발송 처리 중인 보강입니다 — 끝난 뒤에 다시 시도하세요";
  if (isRecallInFlight(status ?? null))
    return lang === "en"
      ? BLOCK_REASON_EN.recalling
      : "회수 처리 중인 보강입니다 — 게시글 삭제가 끝난 뒤에 뺄 수 있습니다";
  return lang === "en"
    ? BLOCK_REASON_EN.sent
    : "이미 학부모에게 발송된 보강이라 뺄 수 없습니다 — 먼저 보고서를 회수(게시글 삭제)하세요";
}
