import { describe, it, expect } from "vitest";
import { localizeTranscriptionError } from "./transcription-error";

describe("localizeTranscriptionError — AssemblyAI 영어 에러 한글화", () => {
  it("transcoding/형식 → 처리 불가", () => {
    const m = localizeTranscriptionError(
      "Transcoding failed. File type text/plain (EBML file) may be unsupported.",
    );
    expect(m).toContain("처리할 수 없습니다");
    expect(m).not.toMatch(/[A-Za-z]{6,}/); // 영어 원문 미노출
  });
  it("download/접근 → 내려받지 못함", () => {
    expect(localizeTranscriptionError("Download error: file not found")).toContain("내려받지 못했습니다");
    expect(localizeTranscriptionError("The signed URL has expired")).toContain("내려받지 못했습니다");
  });
  it("too short/무음 → 짧거나 말소리 없음", () => {
    expect(localizeTranscriptionError("Audio is too short")).toContain("말소리");
    expect(localizeTranscriptionError("No speech detected")).toContain("말소리");
  });
  it("인증/키 → 키 오류", () => {
    expect(localizeTranscriptionError("Unauthorized: invalid API key")).toContain("키 오류");
  });
  it("rate limit/한도 → 한도 초과", () => {
    expect(localizeTranscriptionError("429 Too Many Requests")).toContain("한도");
  });
  it("서버/타임아웃 → 일시 응답 없음", () => {
    expect(localizeTranscriptionError("503 Service Unavailable")).toContain("응답하지 않습니다");
  });
  it("이미 한글이면 그대로", () => {
    expect(localizeTranscriptionError("녹음 시간이 너무 짧습니다 (5초 이상 필요)")).toBe(
      "녹음 시간이 너무 짧습니다 (5초 이상 필요)",
    );
  });
  it("빈 값 → 일반 메시지", () => {
    expect(localizeTranscriptionError("")).toContain("오류가 발생");
    expect(localizeTranscriptionError(null)).toContain("오류가 발생");
  });
  it("알 수 없는 영어 → 일반 한글", () => {
    const m = localizeTranscriptionError("Some weird unexpected condition xyz");
    expect(m).toContain("음성 전사 중 오류");
  });
});
