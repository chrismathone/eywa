import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MAX_AUDIO_SIZE, validateAudioFile } from "./audio-upload";

/**
 * 오디오 업로드 상한은 **클라·서버 두 곳에 적혀 있고 반드시 같아야 한다**.
 *
 * 🔴 갈리면 증상이 고약하다 — 클라 검증은 통과시키는데 서버가 티켓 발급에서 거절해서, 올리는 사람은
 *    "형식도 크기도 맞는데 업로드 준비 실패"라는 **이유 없는 오류**만 본다(파일을 다시 고르거나 형식을
 *    바꿔 봐도 소용없다). 그래서 값 자체를 여기서 잠근다.
 * ⚠️ 파일을 직접 읽어 비교한다 — `media-storage.ts`는 서버 모듈이라 테스트가 import하면 안 된다.
 */
describe("오디오 업로드 상한 — 클라·서버가 같은 값", () => {
  const serverSrc = readFileSync(join(process.cwd(), "src/lib/storage/media-storage.ts"), "utf8");

  it("서버 AUDIO_MAX가 클라 MAX_AUDIO_SIZE와 같다", () => {
    const m = serverSrc.match(/const AUDIO_MAX = (\d+) \* 1024 \* 1024/);
    expect(m, "media-storage.ts의 AUDIO_MAX 선언을 못 찾음").toBeTruthy();
    expect(Number(m![1]) * 1024 * 1024).toBe(MAX_AUDIO_SIZE);
  });

  it("상한은 100MB (원장 2026-09-10)", () => {
    expect(MAX_AUDIO_SIZE).toBe(100 * 1024 * 1024);
  });

  it("🔴 버킷 상한(200MB)을 넘지 않는다 — 넘으면 스토리지가 거절하고 앱은 그 이유를 모른다", () => {
    expect(MAX_AUDIO_SIZE).toBeLessThanOrEqual(200 * 1024 * 1024);
  });

  it("상한 이하는 통과, 초과는 크기를 말해 주는 한글 오류", () => {
    expect(validateAudioFile({ type: "audio/mpeg", name: "a.mp3", size: 99 * 1024 * 1024 })).toBeNull();
    const err = validateAudioFile({ type: "audio/mpeg", name: "a.mp3", size: 101 * 1024 * 1024 });
    expect(err).toContain("너무 큽니다");
    expect(err).toContain("100.0 MB");
  });
});
