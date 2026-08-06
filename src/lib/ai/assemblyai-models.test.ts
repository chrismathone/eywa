import { describe, expect, it } from "vitest";
import { KOREAN_SPEECH_MODELS } from "./assemblyai";

/**
 * 전사 모델 목록 가드 — **한국어 미지원 모델**이 요청 배열에 섞이는 것을 막는다.
 *
 * 왜 테스트가 필요한가: 미지원 모델을 넣어도 AssemblyAI는 400을 내지 않고 그냥 무시한 뒤
 * 뒤 모델로 폴백한다. 그래서 코드·주석만 보면 상위 모델로 도는 줄 착각하게 되고, 실제로
 * 2026-08-06까지 `universal-3-pro`가 그 상태로 들어 있었다(전 전사가 universal-2로 폴백).
 * 주석은 강제력이 없어서 같은 실수가 반복된다 → 실행되는 가드로 잠근다.
 */

// 2026-08-06 AssemblyAI 지원 언어표에서 `ko`가 확인된 모델만 등재.
// ⚠️ 여기 새 모델을 추가하려면 문서에서 한국어를 **직접 확인**하고 확인 날짜를 함께 적을 것.
// https://www.assemblyai.com/docs/pre-recorded-audio/supported-languages
const KOREAN_CAPABLE = new Set(["universal-2"]);

// 한국어가 빠진 걸로 확인된 모델(=넣으면 조용히 무효). 이름만 봐선 상위 모델이라 더 위험하다.
const KNOWN_NO_KOREAN = ["universal-3-pro", "universal-3.5-pro", "universal-3-5-pro"];

describe("KOREAN_SPEECH_MODELS", () => {
  it("비어 있지 않다", () => {
    expect(KOREAN_SPEECH_MODELS.length).toBeGreaterThan(0);
  });

  it("한국어 지원이 확인된 모델만 담는다", () => {
    const unverified = KOREAN_SPEECH_MODELS.filter((m) => !KOREAN_CAPABLE.has(m));
    expect(
      unverified,
      `한국어 지원이 확인되지 않은 모델: ${unverified.join(", ")}\n` +
        "지원 언어표에서 `ko`를 확인한 뒤 이 테스트의 KOREAN_CAPABLE에 확인 날짜와 함께 추가하세요.",
    ).toEqual([]);
  });

  it("한국어 미지원으로 확인된 상위 모델을 담지 않는다", () => {
    for (const model of KNOWN_NO_KOREAN) {
      expect(
        KOREAN_SPEECH_MODELS as readonly string[],
        `${model}은 한국어를 지원하지 않는다 — 넣어도 universal-2로 조용히 폴백할 뿐이다.`,
      ).not.toContain(model);
    }
  });
});
