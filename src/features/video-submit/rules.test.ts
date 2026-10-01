import { describe, expect, it } from "vitest";
import { HOMEWORK_VIDEO_MAX_BYTES } from "@/features/students/homework-video-limits";
import { isShareExpired } from "@/features/onescreen/share-expiry";
import { expiredLinkHref, VIDEO_SUBMIT_LINK_DAYS } from "@/features/link-expired/kinds";
import {
  checkVideoFile, isSubmitTokenShape, isVideoLinkExpired, maskStudentName, videoLinkExpiresAt, videoLinkLastDay,
} from "./rules";

describe("제출 링크 토큰 모양", () => {
  it("43자 base64url만 받는다(DB를 묻기 전에 거른다)", () => {
    expect(isSubmitTokenShape("a".repeat(43))).toBe(true);
    expect(isSubmitTokenShape("A-_9".repeat(10) + "abc")).toBe(true);
    expect(isSubmitTokenShape("a".repeat(42))).toBe(false);
    expect(isSubmitTokenShape("a".repeat(42) + "=")).toBe(false);
    expect(isSubmitTokenShape("../" + "a".repeat(40))).toBe(false);
    expect(isSubmitTokenShape(null)).toBe(false);
  });
});

describe("공개 화면 이름 가림", () => {
  it("가운데를 가린다", () => {
    expect(maskStudentName("김민수")).toBe("김*수");
    expect(maskStudentName("남궁민수")).toBe("남**수");
    expect(maskStudentName("이준")).toBe("이*");
    expect(maskStudentName("한")).toBe("*");
    expect(maskStudentName("  ")).toBe("학생");
    expect(maskStudentName(null)).toBe("학생");
  });
});

describe("영상 파일 검사 — 한도는 상수 하나", () => {
  it("1GB까지 받고 1바이트라도 넘으면 거절한다(안내 문구도 1GB)", () => {
    expect(checkVideoFile({ size: HOMEWORK_VIDEO_MAX_BYTES, type: "video/mp4" })).toEqual({ ok: true, mimeType: "video/mp4", ext: ".mp4" });
    const over = checkVideoFile({ size: HOMEWORK_VIDEO_MAX_BYTES + 1, type: "video/mp4" });
    expect(over.ok).toBe(false);
    expect(!over.ok && over.error).toContain("1GB");
  });
  it("폰 기본 형식(.mov)·빈 형식+확장자는 받고, 영상이 아니면 거절한다", () => {
    expect(checkVideoFile({ size: 10, type: "video/quicktime", name: "IMG_1.MOV" })).toEqual({ ok: true, mimeType: "video/quicktime", ext: ".mov" });
    expect(checkVideoFile({ size: 10, type: "", name: "clip.MOV" })).toEqual({ ok: true, mimeType: "video/quicktime", ext: ".mov" });
    expect(checkVideoFile({ size: 10, type: "application/octet-stream", name: "a.mp4" })).toMatchObject({ ok: true, mimeType: "video/mp4" });
    expect(checkVideoFile({ size: 10, type: "image/jpeg", name: "a.jpg" }).ok).toBe(false);
    expect(checkVideoFile({ size: 10, type: "", name: "a.txt" }).ok).toBe(false);
    expect(checkVideoFile({ size: 10, type: "text/html", name: "a.mp4" }).ok).toBe(false);
    expect(checkVideoFile({ size: 0, type: "video/mp4" }).ok).toBe(false);
    expect(checkVideoFile({ size: 1.5, type: "video/mp4" }).ok).toBe(false);
    expect(checkVideoFile({ size: 10, type: "video/<script>" }).ok).toBe(false);
  });
  it("목록 밖 영상 형식은 받지 않고, 확장자는 목록에서만 정한다(.exe가 영상 이름으로 들어가지 않게)", () => {
    expect(checkVideoFile({ size: 10, type: "video/x-a", name: "a.exe" }).ok).toBe(false);
    expect(checkVideoFile({ size: 10, type: "video/mp4", name: "a.exe" })).toEqual({ ok: true, mimeType: "video/mp4", ext: ".mp4" });
    expect(checkVideoFile({ size: 10, type: "", name: "a.exe" }).ok).toBe(false);
    // 별칭 형식(Windows Chrome의 video/avi)은 확장자가 목록에 있으면 그 형식으로.
    expect(checkVideoFile({ size: 10, type: "video/avi", name: "clip.avi" })).toEqual({ ok: true, mimeType: "video/x-msvideo", ext: ".avi" });
    expect(checkVideoFile({ size: 10, type: "image/avi", name: "clip.avi" }).ok).toBe(false);
  });
});

describe("7일 만료 — 보고서 링크와 같은 산술(7일째 당일까지)", () => {
  const base = "2026-10-01";
  it("끝나는 순간 = 8일째 0시(KST)이고 마지막 날 표기는 7일째", () => {
    expect(videoLinkExpiresAt(base)).toBe("2026-10-09T00:00:00+09:00");
    expect(videoLinkLastDay(base)).toBe("2026-10-08");
  });
  it("isShareExpired(기준일, 오늘, 7)과 경계가 같다", () => {
    const end = videoLinkExpiresAt(base);
    expect(isVideoLinkExpired(end, Date.parse("2026-10-08T23:59:59+09:00"))).toBe(false);
    expect(isShareExpired(base, "2026-10-08", 7)).toBe(false);
    expect(isVideoLinkExpired(end, Date.parse("2026-10-09T00:00:00+09:00"))).toBe(true);
    expect(isShareExpired(base, "2026-10-09", 7)).toBe(true);
    // 보고서 링크 90일 기본값은 그대로.
    expect(isShareExpired(base, "2026-12-30")).toBe(false);
  });
  it("월말·DB가 UTC로 돌려준 값도 같은 순간으로 읽고, 못 읽으면 만료로 본다", () => {
    expect(videoLinkExpiresAt("2026-12-28")).toBe("2027-01-05T00:00:00+09:00");
    expect(isVideoLinkExpired("2026-10-08T15:00:00+00:00", Date.parse("2026-10-08T23:59:59+09:00"))).toBe(false);
    expect(isVideoLinkExpired("2026-10-08T15:00:00+00:00", Date.parse("2026-10-09T00:00:01+09:00"))).toBe(true);
    expect(isVideoLinkExpired(null)).toBe(true);
    expect(isVideoLinkExpired("모름")).toBe(true);
  });
});

describe("공용 링크 만료 페이지와 한 값", () => {
  it("기간은 만료 페이지의 상수 하나(7일)이고, 만료 갈래는 /expired?kind=video 다", () => {
    expect(VIDEO_SUBMIT_LINK_DAYS).toBe(7);
    expect(videoLinkLastDay("2026-10-01")).toBe("2026-10-08");
    expect(expiredLinkHref("video")).toBe("/expired?kind=video");
  });
});
