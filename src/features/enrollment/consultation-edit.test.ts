import { describe, expect, it } from "vitest";
import { counselorAutofill, CONSULTATION_EDIT_FIELDS, hasConsultationEdit } from "./consultation-edit";
const before = { from_public_intake: true, counselor: null, parent_request: "상담" };
describe("QR 상담 진짜 수정", () => {
 it("모든 폼 칸의 변경을 잡는다", () => {
  for (const key of CONSULTATION_EDIT_FIELDS) expect(hasConsultationEdit({}, { [key]: key === "learning_history" ? { prevAcademy: "학원" } : "새 값" }), key).toBe(true);
 });
 it("빈 문자열·공백·null과 JSON 빈 키·키 순서는 같은 의미", () => {
  expect(hasConsultationEdit({ counselor: null, subject_details: null }, { counselor: "  ", subject_details: { english: { testType: "", memo: null } } })).toBe(false);
  expect(hasConsultationEdit({ subject_details: { math: { b: "2", a: "1" } } }, { subject_details: { math: { a: " 1 ", b: "2", c: "" } } })).toBe(false);
 });
 it("학습 이력 파생 값·기계 작업·상태 끌기는 제외", () => {
  expect(hasConsultationEdit({ learning_history: { weakSubjects: ["영어"] } }, { learning_history: { weakSubjects: [] }, outcome: "consulted", updated_at: "now", student_id: "x" })).toBe(false);
 });
 it("그냥 저장은 제외, 완료 전환은 포함", () => {
  expect(counselorAutofill(before, { parent_request: " 상담 " }, "직원")).toBeNull();
  expect(counselorAutofill(before, {}, "직원", true)).toBe("직원");
  expect(counselorAutofill(before, { parent_request: "변경" }, " 직원 ")).toBe("직원");
 });
 it("수기 상담·기존 상담자·직접 입력과 비우기를 존중", () => {
  expect(counselorAutofill({ ...before, from_public_intake: false }, { parent_request: "변경" }, "직원")).toBeNull();
  expect(counselorAutofill({ ...before, counselor: "기존" }, { parent_request: "변경" }, "직원")).toBeNull();
  expect(counselorAutofill(before, { counselor: "직접" }, "직원")).toBeNull();
  expect(counselorAutofill({ ...before, counselor: "기존" }, { counselor: "", parent_request: "변경" }, "직원")).toBeNull();
 });
 it("조회 실패·직원 이름 없음은 채우지 않는다", () => {
  expect(counselorAutofill(null, { parent_request: "변경" }, "직원")).toBeNull();
  expect(counselorAutofill(before, { parent_request: "변경" }, " ")).toBeNull();
 });
});
