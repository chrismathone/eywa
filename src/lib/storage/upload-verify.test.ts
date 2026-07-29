import { describe, expect, it } from "vitest";
import { assertUploadedSize } from "./upload-verify";

const MAX = 10 * 1024 * 1024; // 10MB

describe("assertUploadedSize", () => {
  it("범위 안이면 통과", () => {
    expect(assertUploadedSize(1, MAX)).toBe(true);
    expect(assertUploadedSize(1024, MAX)).toBe(true);
  });

  it("상한 경계 — 같으면 통과, 1바이트 넘으면 거부", () => {
    expect(assertUploadedSize(MAX, MAX)).toBe(true);
    expect(assertUploadedSize(MAX + 1, MAX)).toBe(false);
  });

  it("0·음수는 거부 — 빈 파일이거나 메타를 못 읽은 것이라 신뢰할 수 없다", () => {
    expect(assertUploadedSize(0, MAX)).toBe(false);
    expect(assertUploadedSize(-1, MAX)).toBe(false);
  });

  it("숫자가 아니면 거부 — 메타 미기록(undefined→NaN)이 통과하면 검증이 무력해진다", () => {
    expect(assertUploadedSize(NaN, MAX)).toBe(false);
    expect(assertUploadedSize(Infinity, MAX)).toBe(false);
    expect(assertUploadedSize(Number("x"), MAX)).toBe(false);
  });

  it("🔴 크기 판정은 MIME과 무관하다 — 형식 관문은 버킷 allowed_mime_types 담당(회귀 방지)", () => {
    // 이 테스트는 "MIME을 여기서 강제하지 말 것"이라는 결정을 코드로 못박는다.
    // (강제하면 MediaRecorder의 video/webm 오디오가 거부되고 호출부가 원본을 삭제한다.)
    expect(assertUploadedSize(500, MAX)).toBe(true);
  });
});
