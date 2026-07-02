import { describe, expect, it } from "vitest";
import {
  combineConsultationTranscripts,
  formatRecordingTranscript,
} from "./transcripts";

const utter = (speaker: string, text: string) => ({ speaker, text });

describe("formatRecordingTranscript", () => {
  it("화자 발화가 있으면 [화자 X] 라인으로 포맷한다(레거시 동일)", () => {
    expect(
      formatRecordingTranscript({
        utterances: [utter("A", "안녕하세요"), utter("B", "네 반갑습니다")],
        plainText: "무시되어야 함",
      }),
    ).toBe("[화자 A] 안녕하세요\n[화자 B] 네 반갑습니다");
  });

  it("화자가 없으면 plainText 폴백", () => {
    expect(formatRecordingTranscript({ utterances: null, plainText: "통짜 전사" })).toBe("통짜 전사");
    expect(formatRecordingTranscript({ utterances: [], plainText: "통짜 전사" })).toBe("통짜 전사");
  });

  it("둘 다 없으면 빈 문자열", () => {
    expect(formatRecordingTranscript({ utterances: null, plainText: null })).toBe("");
  });
});

describe("combineConsultationTranscripts", () => {
  it("녹음 1개는 헤더 없이 그대로(AI 프롬프트 무변 보장)", () => {
    const out = combineConsultationTranscripts([
      { utterances: [utter("A", "상담 시작")], plainText: null, recordedAt: "2026-07-02T08:00:00Z" },
    ]);
    expect(out).toBe("[화자 A] 상담 시작");
    expect(out).not.toContain("《녹음");
  });

  it("녹음 2개+는 《녹음 n · M/D HH:mm》 헤더로 구분(시간 라벨은 KST)", () => {
    const out = combineConsultationTranscripts([
      { utterances: [utter("A", "1차 상담")], plainText: null, recordedAt: "2026-07-02T08:00:00Z" },
      { utterances: null, plainText: "2차 상담 통짜", recordedAt: "2026-07-03T01:30:00Z" },
    ]);
    // 2026-07-02T08:00Z = KST 7/2 17:00, 2026-07-03T01:30Z = KST 7/3 10:30
    expect(out).toContain("《녹음 1 · 7. 2. 17:00》\n[화자 A] 1차 상담");
    expect(out).toContain("《녹음 2 · 7. 3. 10:30》\n2차 상담 통짜");
    expect(out.indexOf("녹음 1")).toBeLessThan(out.indexOf("녹음 2"));
  });

  it("빈 전사 녹음은 건너뛰고, 남는 게 1개면 헤더 없이", () => {
    const out = combineConsultationTranscripts([
      { utterances: [], plainText: "", recordedAt: "2026-07-02T08:00:00Z" },
      { utterances: [utter("A", "유일한 전사")], plainText: null, recordedAt: "2026-07-02T09:00:00Z" },
    ]);
    expect(out).toBe("[화자 A] 유일한 전사");
  });

  it("전부 비면 빈 문자열", () => {
    expect(combineConsultationTranscripts([])).toBe("");
    expect(
      combineConsultationTranscripts([{ utterances: null, plainText: null, recordedAt: "x" }]),
    ).toBe("");
  });

  it("잘못된 날짜여도 헤더는 시간 라벨 없이 렌더(throw 없음)", () => {
    const out = combineConsultationTranscripts([
      { utterances: null, plainText: "가", recordedAt: "invalid" },
      { utterances: null, plainText: "나", recordedAt: "also-bad" },
    ]);
    expect(out).toContain("《녹음 1》\n가");
    expect(out).toContain("《녹음 2》\n나");
  });
});
