import { describe, expect, it } from "vitest";
import { hasVideoAttachment, isReportVideoCT, isVideoAttachment, REPORT_VIDEO_EXTS } from "./report-video";
import { VIDEO_NAME_RE, attachedVideoOf, isVideoName, videoUploadWaitMs } from "../../../scripts/_classnote/report-video.mjs";

describe("보고서 영상 첨부 규약", () => {
  it("앱과 발송 PC가 같은 확장자를 영상으로 본다", () => {
    for (const ext of REPORT_VIDEO_EXTS) {
      expect(isVideoAttachment(`a.${ext}`)).toBe(true);
      expect(isVideoName(`a.${ext.toUpperCase()}`)).toBe(true);
      expect(VIDEO_NAME_RE.test(`x/y.${ext}?t=1`)).toBe(true);
    }
    for (const n of ["a.jpg", "a.pdf", "a.mp3", "mp4"]) {
      expect(isVideoAttachment(n)).toBe(false);
      expect(isVideoName(n)).toBe(false);
    }
  });
  it("형식·목록 판정", () => {
    expect(isReportVideoCT("video/mp4")).toBe(true);
    expect(isReportVideoCT("video/quicktime")).toBe(true);
    expect(isReportVideoCT("video/webm")).toBe(false);
    expect(hasVideoAttachment([{ name: "photo.jpg", path: "t/report-attachments/1.jpg" }])).toBe(false);
    expect(hasVideoAttachment([{ name: "", path: "t/report-attachments/1.mov" }])).toBe(true);
    expect(hasVideoAttachment(null)).toBe(false);
  });
  it("발송 PC — 대기 시간 · 영상 칸", () => {
    expect(videoUploadWaitMs(0)).toBe(30_000);
    expect(videoUploadWaitMs(50 * 1024 * 1024)).toBe(130_000);
    expect(videoUploadWaitMs(10_000 * 1024 * 1024)).toBe(360_000);
    expect(attachedVideoOf(null, { name: "a.mp4", size: 1 })).toBeNull();
    expect(attachedVideoOf({ access_key: "k" }, { name: "a.mp4", size: 5 })).toEqual({ access_key: "k", original_file_name: "a.mp4", file_size: 5 });
  });
});

describe("영상 이름·확장자", () => {
  it("확장자 없는 영상 이름에 형식의 확장자를 붙인다", async () => {
    const { videoExtOf, withVideoExt } = await import("./report-video");
    expect(videoExtOf("video/quicktime")).toBe("mov");
    expect(videoExtOf("image/png")).toBeNull();
    expect(withVideoExt("video", "video/mp4")).toBe("video.mp4");
    expect(withVideoExt("IMG_1.MOV", "video/quicktime")).toBe("IMG_1.MOV");
    expect(withVideoExt("", "video/quicktime")).toBe("영상.mov");
  });
  it("발송 PC의 업로드 응답 호스트 판정", async () => {
    const { isKageUploadHost } = await import("../../../scripts/_classnote/classnote-admin-core.mjs");
    expect(isKageUploadHost("https://up-kids-kage.kakao.com/up")).toBe(true);
    expect(isKageUploadHost("https://www.classnote.com/api/kmb")).toBe(false);
    expect(isKageUploadHost("https://kmb.evil.com/")).toBe(false);
  });
});
