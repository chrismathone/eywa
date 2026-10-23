import { expect, it } from "vitest";
import { summarySources, validateRecentSummary, validateGroundedSummary, type SummarySource } from "./summary";
import { sectionResult, type LiveConnections } from "./live-contract";

const source: SummarySource = { itemId: "consultations:1", section: "상담", title: "상담자", text: "영어 수업을 계속하고 싶다고 학생이 말했다.", date: "2026-10-23",
  evidence: [{ source: "student_consultations", id: "1", studentId: "s", href: "/consultations/1" }] };
const record = (key: string, detail: string) => sectionResult(key, key, "/students/s", [{ id: "1", title: "기록", detail, evidence: source.evidence }], 1);
const input: LiveConnections = { studentId: "s", asOf: "2026-10-23", checkedAt: "now", ruleVersion: "v1", sections: [] };
it("does not send search-excluded memo content to the model", () => {
  const memo = record("memos", "외부에 공개하고 싶지 않은 상담 내용");
  memo.items[0]!.summaryExcluded = true;
  expect(summarySources({ ...input, sections: [memo] })).toEqual([]);
});
it("excludes tuition, family, source messages and restricted sections from AI input", () => {
  expect(summarySources({ ...input, sections: [record("family", "보호자"), record("tuition", "100000"), record("messages", "학부모 원문"),
    { ...record("consultations", "비공개"), state: "forbidden" }, record("classes", "수강 중")] }).map((r) => r.itemId)).toEqual(["classes:1"]);
});
it.each(["수업료 30만원 납부", "30만원입니다", "전화 010-1234-5678", "주민번호 090101-3123456", "계좌번호 안내", "급여 정보", "국민 12345678901234", "1234 5678 1234 5678", "카드 번호 안내"])("excludes sensitive free text %s", (text) => {
  expect(summarySources({ ...input, sections: [record("memos", text)] })).toEqual([]);
});
it("only accepts an actual contiguous source excerpt", () => {
  const result = validateRecentSummary({ items: [{ itemId: source.itemId, excerpt: "계속하고 싶다고 학생이 말했다." }] }, [source]);
  expect(result.items).toHaveLength(1);
});
it.each([
  { itemId: "invented", excerpt: source.text },
  { itemId: source.itemId, excerpt: "영어 성적이 100점으로 올랐다." },
  { itemId: source.itemId, excerpt: "영어 수업에 완전히 적응한 상태다." },
  { itemId: source.itemId, excerpt: "         " },
])("rejects unsupported source/claim %o", (item) => expect(() => validateRecentSummary({ items: [item] }, [source])).toThrow());
it("rejects invented extra fields and repeated citations", () => {
  const item = { itemId: source.itemId, excerpt: source.text };
  expect(() => validateRecentSummary({ items: [item], diagnosis: "적응 완료" }, [source])).toThrow();
  expect(() => validateRecentSummary({ items: [item, item] }, [source])).toThrow();
});
it("does not accept a source-injected action as a structured response", () => {
  expect(() => validateRecentSummary({ action: "delete_students", items: [] }, [source])).toThrow();
});
it("rejects a valid-shaped Korean response that exceeds the saved JSON byte budget", () => {
  const sources = Array.from({length:6},(_,i)=>({...source,itemId:`consultations:${i}`,text:"가".repeat(800)}));
  const items = sources.map(s=>({itemId:s.itemId,summary:"나".repeat(180),excerpt:s.text}));
  expect(()=>validateGroundedSummary({items},sources)).toThrow("저장 길이");
});
