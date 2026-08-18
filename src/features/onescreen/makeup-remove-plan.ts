/**
 * 보강 빼기 **판정**(순수 · Vitest) — 원스크린에서 잘못 추가한 보강을 지울 때, 저장된 보강 보고서를
 * ① 바로 지울 것 ② 학부모 게시글부터 회수할 것 ③ 지금은 손대면 안 되는 것으로 가른다.
 *
 * 원장 2026-08-18: *"다 삭제"* — 출결 기록과 저장된 보강 보고서를 함께 없앤다. 다만 **학부모에게 이미
 * 나간 게시글이 있으면 행을 먼저 지우면 안 된다**: 회수(ClassNote 게시글 삭제)는 연동 PC 워커가
 * `share_token`으로 게시글을 찾아 지우는데, 그 열쇠를 쥔 행을 없애면 **학부모 게시판에 영원히 남는
 * 유령 글**이 된다([[report-recall]]의 "특정 불가능하면 지우지 않는다"와 같은 이유).
 * 그래서 발송분은 **회수를 먼저 걸고 행은 남긴다** — 워커가 지운 뒤(`recalled`) 다시 누르면 그때 삭제된다.
 *
 * 🔴 발송/회수가 **진행 중**인 행은 어느 쪽도 아니다(`queued`·`processing`·`recall_requested`).
 *    지우면 워커가 방금 집어간 작업의 대상이 사라져 결과를 못 적고, 최악엔 게시만 되고 기록이 없다.
 */

import {
  isRecallable,
  isRecallInFlight,
  RECALL_REQUESTED,
  RECALLED,
} from "@/features/report-admin/report-recall";

export type MakeupReportRef = {
  id: string;
  classnoteStatus: string | null;
  shareToken: string | null;
};

export type MakeupRemovePlan = {
  /** 바로 지울 행 — 학부모 게시판에 없는 것(미발송·실패·회수완료). */
  deleteIds: string[];
  /** 게시글부터 회수할 행 — 이번엔 안 지운다(워커가 지운 뒤 재시도). */
  recallIds: string[];
  /** 지금 건드리면 안 되는 행(발송·회수 처리 중). */
  busyIds: string[];
};

/**
 * 보강 보고서들을 세 갈래로 나눈다.
 * - `recallIds` = 실제로 게시된 글이 있고 특정 가능(`isRecallable`) → 회수 먼저.
 * - `busyIds` = 발송 대기·처리 중이거나 회수 요청 중 → 이번엔 통과.
 * - `deleteIds` = 나머지(미발송·발송 실패·회수 완료) → 행 삭제.
 */
export function planMakeupRemoval(rows: MakeupReportRef[]): MakeupRemovePlan {
  const plan: MakeupRemovePlan = { deleteIds: [], recallIds: [], busyIds: [] };
  for (const r of rows) {
    const status = r.classnoteStatus;
    if (isRecallInFlight(status) || status === "queued" || status === "processing") {
      plan.busyIds.push(r.id);
      continue;
    }
    if (isRecallable({ classnoteStatus: status, shareToken: r.shareToken })) {
      plan.recallIds.push(r.id);
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
  recalled: number;
  busy: number;
}): string {
  const parts: string[] = [];
  if (r.attendanceRemoved) parts.push("출결 기록을 지웠습니다");
  if (r.deleted > 0) parts.push(`수업보고서 ${r.deleted}건을 지웠습니다`);
  if (r.recalled > 0)
    parts.push(`학부모에게 나간 보고서 ${r.recalled}건은 게시글 삭제를 요청했습니다(연동 PC가 순차 처리)`);
  if (r.busy > 0) parts.push(`발송·회수 처리 중인 ${r.busy}건은 끝난 뒤에 다시 시도하세요`);
  return parts.length ? parts.join(" · ") : "지울 기록이 없습니다";
}

/** 회수 완료 상태 — 이 상태의 행은 다음 시도에서 바로 삭제된다(테스트·문서용 재수출). */
export const MAKEUP_RECALLED = RECALLED;

/**
 * 이 보강 보고서는 **강사가 이미 없앤 것**인가 — 회수 요청·완료된 행.
 * 로스터가 화면에 되살리면 안 된다("뺐는데 새로고침하면 있다").
 *
 * 🔴 **NULL을 삼키지 말 것.** SQL `not in ('recall_requested','recalled')`으로 거르면 status가 NULL인
 *    행(저장만 하고 미발송 — 실측 29건)이 NOT IN의 UNKNOWN 판정에 걸려 **통째로 사라진다**.
 *    그래서 판정을 이 순수 함수로 못박고 값이 있을 때만 비교한다.
 */
export function isRecallCleared(status: string | null | undefined): boolean {
  return status === RECALL_REQUESTED || status === RECALLED;
}
