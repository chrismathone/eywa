"use server";

import { after } from "next/server";
import { reportError } from "@/lib/observability/report-error";
import { readonlyTeacherViewError } from "@/lib/auth/view-as";
import { reviewAccess, reviewViewFor } from "./view";
import { runReviewNow } from "./run-now";

/**
 * '다시 분석' — 재생과 같은 권한을 지난 사람만. 즉시 호출(정가)은 응답 뒤에(after) 돌고, 화면은 저장된 상태를 다시 읽는다.
 * 전사는 다시 하지 않는다(영상당 한 번). 결과가 없는 영상·배치에 실린 영상은 누를 수 없다(canRerun).
 */
export async function rerunVideoReview(videoId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  // 요청자(requested_by)는 화면 주인(reviewAccess → 강사뷰면 검증된 대상)이다 — 대상 명의로 쓰는 일이라 읽기 강사뷰는
  // 맨 앞에서 막는다(이 경로는 canWriteTenant를 지나지 않는다).
  const readonly = await readonlyTeacherViewError();
  if (readonly) return { ok: false, error: readonly };
  const access = await reviewAccess(videoId);
  if (!access.ok) return { ok: false, error: "이 영상의 메모를 다시 분석할 수 없습니다." };
  const view = await reviewViewFor(access.tenantId, videoId);
  if (!view?.canRerun) return { ok: false, error: "아직 준비 중이거나 분석 중인 영상입니다." };
  after(() => runReviewNow(access.tenantId, videoId, access.userId).catch((e) => reportError(e, { scope: "video-review.rerun", videoId })));
  return { ok: true };
}
