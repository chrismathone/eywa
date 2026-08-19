/**
 * 수업보고서 **회수**(ClassNote 학부모 게시글 삭제) — 판정 순수함수(클라·서버·워커 공용, Vitest).
 *
 * ## 회수 ≠ 링크 취소
 * 오래 "ClassNote는 게시글 삭제가 안 된다"고 적혀 있었지만(report-card 경고문·textbook-send-dedup 주석)
 * 실제로는 **`DELETE /api/v1_2/reports/{id}/` → 204**가 된다(2026-07-13 학원이로 실검증, 반 공지 회수가
 * 이미 그 경로를 쓴다). 그래서 셋을 구분한다:
 *  - **링크 취소**(`revoked_at`) = eywa `/r/{token}` 열람 차단. **ClassNote 게시글은 그대로 남는다.**
 *  - **재발급** = 새 토큰 발급 + 발송 상태 리셋. 옛 게시글은 死링크인 채 게시판에 방치된다.
 *  - **회수**(이 모듈) = 게시글 자체를 지운다. 학부모 게시판에서 사라진다.
 *
 * 🔴 수업보고서는 본문이 **공유 링크 + 보고서 스크린샷 이미지**로 게시된다(classnote-core `content: shareUrl`).
 *    즉 **링크만 취소하면 이미지가 게시판에 그대로 남는다** — 오발송 수습에는 회수만이 답이다.
 *
 * ## 특정 불가능하면 지우지 않는다 (이 모듈의 핵심 안전 규약)
 * 워커는 `content === "{base}/r/{share_token}"` **완전 일치**로 게시글을 찾는다(findChildReportId strict).
 * 공유 토큰은 전역 유니크라 이 일치가 곧 "그 학생의 그 보고서 글"의 증명이다. 따라서 **share_token이 없는
 * 행은 회수 대상이 아니다** — 이름·날짜로 근사해서 지우면 **남의 글을 지운다**(되돌릴 수 없다).
 */

/** 회수 요청됨 — 연동 PC 워커가 아직 안 지움. 완료되면 `recalled`(거둬들이고 끝). */
export const RECALL_REQUESTED = "recall_requested";
/**
 * 워커가 **집어가서 지우는 중** — `classnote-recall-core.mjs`가 원자 클레임하며 세우는 상태.
 * 🔴 이 상태를 "진행 중"에서 빼면 그 사이에 행을 지울 수 있고, 그러면 워커의 결과 기록이 0행이 되어
 *    **학부모 게시판에 글만 남고 eywa엔 흔적이 사라진다**(적대 리뷰 치명, 2026-08-18).
 */
export const RECALLING = "recalling";
/** 회수 완료 — ClassNote 게시글 삭제됨. */
export const RECALLED = "recalled";
/** 회수 실패 — 사유는 `classnote_error`(한글). 다시 시도할 수 있다. */
export const RECALL_FAILED = "recall_failed";

/** 회수 계열 상태 집합 — 발송 큐 집계·필터가 "발송 상태"와 섞지 않도록. */
export const RECALL_STATUSES: readonly string[] = [RECALL_REQUESTED, RECALLING, RECALLED, RECALL_FAILED];

export type RecallableRow = {
  classnoteStatus: string | null;
  shareToken: string | null;
};

/**
 * 회수 가능? = **우리가 실제로 게시했고**(success) + **게시글을 특정할 공유 토큰이 있는** 행.
 * `recall_failed`는 재시도 허용(일시적 네트워크·세션 만료가 흔한 실패 사유).
 */
export function isRecallable(row: RecallableRow): boolean {
  const s = row.classnoteStatus;
  return (s === "success" || s === RECALL_FAILED) && !!row.shareToken;
}

/**
 * 회수 불가 사유(한글) — 버튼 비활성 툴팁. `null` = 회수 가능.
 * ⚠️ raw 상태 코드(`success`·`queued`)를 그대로 내보내지 않는다(UI raw 코드 노출 금지 규칙).
 */
export function recallBlockReason(row: RecallableRow): string | null {
  const s = row.classnoteStatus;
  if (isRecallable(row)) return null;
  if (s === RECALL_REQUESTED || s === RECALLING) return "이미 회수 요청됨 — 연동 PC가 순차 처리합니다";
  if (s === RECALLED) return "이미 회수된 보고서입니다";
  if (s === "queued" || s === "processing") return "발송 처리 중입니다 — 끝난 뒤에 회수할 수 있습니다";
  if (!s) return "아직 학부모에게 발송되지 않은 보고서입니다";
  if (s === "success" && !row.shareToken)
    return "게시글을 특정할 공유 링크가 없어 자동 회수할 수 없습니다 — ClassNote에서 직접 삭제하세요";
  // failed·too_old·name_conflict·blocked_shared·subject_off·absent·report_optout = 애초에 게시가 안 된 상태.
  return "학부모 게시판에 올라가지 않아 회수할 것이 없습니다";
}

/**
 * 회수 진행 중(요청됨) — 목록에서 버튼을 잠그고 "처리 중"으로 보여준다.
 * ⚠️ **재발급 차단도 이 판정을 쓴다** — 진행 중에 토큰이 바뀌면 워커가 게시글을 못 찾는다(고아 게시글).
 */
export function isRecallInFlight(status: string | null): boolean {
  // ⚠️ `recalling`(워커가 집어간 상태)을 빼면 삭제·재발급이 그 창으로 새어 들어간다.
  return status === RECALL_REQUESTED || status === RECALLING;
}

/**
 * 선택된 행들 중 실제로 회수 요청을 보낼 id — 불가한 행은 조용히 버리지 않고 **건수로 돌려준다**
 * (관리자 일괄 회수에서 "몇 건이 왜 빠졌는지"를 화면에 밝히기 위함).
 */
export function partitionRecallTargets<T extends RecallableRow & { id: string }>(
  rows: T[],
): { targets: string[]; blocked: { id: string; reason: string }[] } {
  const targets: string[] = [];
  const blocked: { id: string; reason: string }[] = [];
  for (const r of rows) {
    const reason = recallBlockReason(r);
    if (reason) blocked.push({ id: r.id, reason });
    else targets.push(r.id);
  }
  return { targets, blocked };
}
