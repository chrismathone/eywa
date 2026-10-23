import { expect, it, vi } from "vitest";
import { generateVerifiedSummary, validateSummaryVerification } from "./summary-generation";
import type { SummarySource } from "./summary";
const source: SummarySource = { itemId: "consultations:1", section: "상담", title: "상담", text: "학생이 영어를 계속 배우고 싶다고 했으나 시간표는 아직 결정하지 않았다.", date: "2026-02-01", evidence: [{ source: "student_consultations", id: "1", studentId: "s", href: "/consultations/1" }] };
const result = { items: [{ itemId: source.itemId, summary: "상담 당시 영어 수업을 계속할 의향이 있었으며, 시간표는 미정이었습니다.", excerpt: source.text }] };
it("verifies every selected claim against its original, not just a valid source ID", async () => {
  const generate = vi.fn().mockResolvedValueOnce(result).mockResolvedValueOnce({ verdicts: [{ itemId: source.itemId, supported: true }] });
  expect(await generateVerifiedSummary([source], "2026-10-23", generate)).toEqual(result);
  expect(generate).toHaveBeenCalledTimes(2);
  expect(JSON.parse(generate.mock.calls[1]![1])).toMatchObject({ summary: result, records: [{ text: source.text }] });
});
it.each([[], [{ itemId: source.itemId, supported: false }], [{ itemId: "other", supported: true }], [{ itemId: source.itemId, supported: true }, { itemId: source.itemId, supported: true }]].map((verdicts) => ({ verdicts })))("rejects missing, negative, unrelated or duplicate verification %o", ({ verdicts }) => {
  expect(() => validateSummaryVerification({ verdicts }, result)).toThrow();
});
it("does not ask the verifier to salvage an invented quote", async () => {
  const generate = vi.fn().mockResolvedValue({ items: [{ ...result.items[0], excerpt: "영어 수업을 모두 마쳤고 성적이 올랐습니다." }] });
  await expect(generateVerifiedSummary([source], "2026-10-23", generate)).rejects.toThrow();
  expect(generate).toHaveBeenCalledTimes(2);
});
it("rejects source-injected tools and extra result fields", async () => {
  const generate = vi.fn().mockResolvedValue({ ...result, action: "update_student" });
  await expect(generateVerifiedSummary([source], "2026-10-23", generate)).rejects.toThrow();
});
it("regenerates a malformed quote once and independently verifies the corrected summary", async () => {
  const generate = vi.fn().mockResolvedValueOnce({ items: [{ ...result.items[0], excerpt: "원본에 없는 새로운 내용입니다." }] })
    .mockResolvedValueOnce(result).mockResolvedValueOnce({ verdicts: [{ itemId: source.itemId, supported: true }] });
  expect(await generateVerifiedSummary([source], "2026-10-23", generate)).toEqual(result);
  expect(generate).toHaveBeenCalledTimes(3);
  expect(generate.mock.calls[1]![0]).toContain("이전 응답");
});
it("never accepts an unsupported claim after the bounded retry", async () => {
  const generate = vi.fn().mockResolvedValueOnce(result).mockResolvedValueOnce({ verdicts: [{ itemId: source.itemId, supported: false }] })
    .mockResolvedValueOnce(result).mockResolvedValueOnce({ verdicts: [{ itemId: source.itemId, supported: false }] });
  await expect(generateVerifiedSummary([source], "2026-10-23", generate)).rejects.toMatchObject({ code: "unsupported_summary" });
  expect(generate).toHaveBeenCalledTimes(4);
});
it("does not retry provider errors", async () => {
  const generate = vi.fn().mockRejectedValue(new Error("provider unavailable"));
  await expect(generateVerifiedSummary([source], "2026-10-23", generate)).rejects.toThrow("provider unavailable");
  expect(generate).toHaveBeenCalledTimes(1);
});
it("passes bounded verification reasons to the retry without accepting unsupported content", async () => {
  const generate = vi.fn().mockResolvedValueOnce(result)
    .mockResolvedValueOnce({ verdicts: [{ itemId: source.itemId, supported: false, reason: "quote_incomplete" }] })
    .mockResolvedValueOnce(result).mockResolvedValueOnce({ verdicts: [{ itemId: source.itemId, supported: true, reason: "none" }] });
  expect(await generateVerifiedSummary([source], "2026-10-23", generate)).toEqual(result);
  expect(JSON.parse(generate.mock.calls[2]![1])).toMatchObject({ previousVerification: [{ itemId: source.itemId, reason: "quote_incomplete" }] });
});
it.each([
  new SyntaxError("Unexpected end of JSON input"),
  new Error("AI 응답에서 JSON을 찾을 수 없습니다"),
  new Error("AI 응답이 최대 길이(16000 토큰)에서 잘려 해석하지 못했습니다. 응답 한도를 늘리거나 요청을 줄여 주세요."),
])("retries recognized response parsing/truncation failures once", async (error) => {
  const generate = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce(result)
    .mockResolvedValueOnce({ verdicts: [{ itemId: source.itemId, supported: true }] });
  expect(await generateVerifiedSummary([source], "2026-10-23", generate)).toEqual(result);
  expect(generate).toHaveBeenCalledTimes(3);
});
it("retains a specific parsing diagnostic after the final attempt", async () => {
  const generate=vi.fn().mockRejectedValue(new SyntaxError("private response content"));
  await expect(generateVerifiedSummary([source],"2026-10-23",generate)).rejects.toMatchObject({code:"parse_failed"});
  expect(generate).toHaveBeenCalledTimes(2);
});
