/**
 * '다른 강사 뷰'(전체)에서 대상 강사가 쓴 줄의 영상 과제·마감 — DB 트리거의 조용한 원복을 다시 적을 칸(2026-11-05 강사뷰 신원 점검).
 * 판정: teacher-view-video-owner.ts · 배선: video-homework/report-owner.test.ts.
 */
import { describe, expect, it } from "vitest";
import { videoOwnerRewrite } from "./teacher-view-video-owner";

const X = "x-teacher";
const base = {
  viewingOtherTeacher: true,
  ownerId: X,
  saved: { created_by: X, video_homework: false, video_homework_due: null as string | null },
  wantedVideoHomework: true as boolean | undefined,
  wantedDue: { video_homework_due: "2026-11-12" } as { video_homework_due: string | null } | null,
};

describe("videoOwnerRewrite", () => {
  it("강사뷰에서 대상 강사 줄의 값이 되돌려졌으면 그 칸만 다시 적는다", () => {
    expect(videoOwnerRewrite(base)).toEqual({ video_homework: true, video_homework_due: "2026-11-12" });
    expect(videoOwnerRewrite({ ...base, saved: { ...base.saved, video_homework: true } })).toEqual({ video_homework_due: "2026-11-12" });
  });

  it("🔴 강사뷰가 아니면 언제나 null — 남의 줄을 지키는 트리거의 뜻은 그대로다", () => {
    expect(videoOwnerRewrite({ ...base, viewingOtherTeacher: false })).toBeNull();
  });

  it("🔴 작성자가 대상 강사가 아니면 null — 앱 게이트가 '둔' 값을 관리 키로 덮지 않는다", () => {
    expect(videoOwnerRewrite({ ...base, saved: { ...base.saved, created_by: "someone-else" } })).toBeNull();
    expect(videoOwnerRewrite({ ...base, saved: { ...base.saved, created_by: null } })).toBeNull();
  });

  it("이번 저장이 적지 않은 칸(앱이 둔 값 · 칸 미확인)은 건드리지 않는다", () => {
    expect(videoOwnerRewrite({ ...base, wantedVideoHomework: undefined, wantedDue: null })).toBeNull();
    // 칸을 되받지 않았으면(#95 — 마감 칸 미적용) 그 칸은 보지 않는다.
    expect(videoOwnerRewrite({ ...base, saved: { created_by: X, video_homework: false } })).toEqual({ video_homework: true });
  });

  it("저장값이 이미 원하는 값이면 다시 적지 않는다(트리거가 막지 않은 평소 저장)", () => {
    expect(videoOwnerRewrite({ ...base, saved: { created_by: X, video_homework: true, video_homework_due: "2026-11-12" } })).toBeNull();
    expect(videoOwnerRewrite({ ...base, wantedDue: { video_homework_due: null }, saved: { created_by: X, video_homework: true, video_homework_due: null } })).toBeNull();
  });
});
