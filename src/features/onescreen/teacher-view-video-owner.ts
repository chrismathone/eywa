/**
 * '다른 강사 뷰'(전체)로 대상 강사가 쓴 보고서 줄을 고칠 때, DB 트리거가 **조용히 되돌린** 영상 과제·마감 칸 — 순수 판정(Vitest).
 *
 * 🔴 왜 필요한가: 영상 과제·마감의 주인은 그 줄을 처음 쓴 선생님(`created_by`)이고, 앱(`videoHomeworkKept` ·
 *    `decideVideoHomeworkDue`)은 화면 주인(강사뷰면 대상 강사 X)으로 그 주인을 판정한다. 그런데 DB 트리거
 *    (`lesson_reports_keep_video_homework_owner`, 0425a)는 `auth.uid()` — 세션의 **실제 계정 A** — 로 판정해
 *    "A ≠ 작성자 X"라며 두 칸을 원래 값으로 둔다(거절하지 않아 오류도 없다). 저장 뒤 경합 판정도 `created_by !== X`만 보므로
 *    화면에 아무 말이 없다 — 관리자가 X의 화면에서 영상 숙제를 켜도 저장되지 않는 **조용한 원복**(2026-11-05 강사뷰 신원 점검).
 * 🔑 그래서 강사뷰일 때만, 앱 게이트를 이미 통과한 값 중 **저장된 값과 다른 칸**만 골라 관리 클라이언트로 다시 적는다
 *    (auth.uid()가 없어 트리거 대상이 아니다 — 트리거 주석 "서버 관리 키의 갱신은 대상이 아니다"). 호출부가 tenant_id · 행 id ·
 *    작성자(created_by = X)를 함께 건다.
 * ⚠️ 강사뷰가 아니면 언제나 null이다 — 평소 저장은 세션 그대로이고, 남의 줄을 지키는 트리거의 뜻도 그대로 산다.
 */
export type VideoOwnerRewrite = { video_homework?: boolean; video_homework_due?: string | null };

export function videoOwnerRewrite(input: {
  /** 지금 요청이 '다른 강사 뷰'인가(읽기 강사뷰는 저장 앞에서 이미 거절된다). */
  viewingOtherTeacher: boolean;
  /** 화면 주인(강사뷰 대상)의 id — 앱 게이트가 작성자로 판정한 사람. */
  ownerId: string;
  /** upsert가 되받은 저장값(`created_by`는 트리거가 보존한 원 작성자). 칸이 없으면 그 칸은 보지 않는다(#95). */
  saved: { created_by: string | null; video_homework?: boolean | null; video_homework_due?: string | null };
  /** 이번 저장이 실제로 적으려던 영상 과제 값 — 앱이 '둔' 저장(keptVideoHw)·칸 미확인이면 undefined. */
  wantedVideoHomework: boolean | undefined;
  /** 이번 저장이 적으려던 마감(`decideVideoHomeworkDue().write`) — 없으면 null. */
  wantedDue: { video_homework_due: string | null } | null;
}): VideoOwnerRewrite | null {
  if (!input.viewingOtherTeacher || !input.ownerId || input.saved.created_by !== input.ownerId) return null;
  const patch: VideoOwnerRewrite = {};
  if (typeof input.wantedVideoHomework === "boolean" && "video_homework" in input.saved
    && (input.saved.video_homework ?? null) !== input.wantedVideoHomework) {
    patch.video_homework = input.wantedVideoHomework;
  }
  if (input.wantedDue && "video_homework_due" in input.saved
    && (input.saved.video_homework_due ?? null) !== input.wantedDue.video_homework_due) {
    patch.video_homework_due = input.wantedDue.video_homework_due;
  }
  return Object.keys(patch).length > 0 ? patch : null;
}
