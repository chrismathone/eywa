import { describe, it, expect } from "vitest";
import { formatBytes, formatSeconds, validateAudioFile, MAX_AUDIO_SIZE } from "./audio-upload";

describe("formatBytes", () => {
  it("B/KB/MB 경계", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});

describe("formatSeconds", () => {
  it("mm:ss 패딩", () => {
    expect(formatSeconds(5)).toBe("00:05");
    expect(formatSeconds(65)).toBe("01:05");
    expect(formatSeconds(600)).toBe("10:00");
  });
});

describe("validateAudioFile", () => {
  const f = (p: Partial<{ type: string; name: string; size: number }>) => ({
    type: "audio/webm",
    name: "rec.webm",
    size: 1000,
    ...p,
  });

  it("정상 MIME → null", () => expect(validateAudioFile(f({}))).toBeNull());
  it("MIME 없어도 확장자 허용 → null", () =>
    expect(validateAudioFile(f({ type: "", name: "rec.mp3" }))).toBeNull());
  it("지원 안 하는 형식 → 에러", () =>
    expect(validateAudioFile(f({ type: "video/mp4", name: "x.mp4" }))).toMatch(/지원하지 않는/));
  it("크기 초과 → 에러", () =>
    expect(validateAudioFile(f({ size: MAX_AUDIO_SIZE + 1 }))).toMatch(/너무 큽니다/));
  it("경계: 정확히 MAX → null", () =>
    expect(validateAudioFile(f({ size: MAX_AUDIO_SIZE }))).toBeNull());
});
