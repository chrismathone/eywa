import { describe, expect, it } from "vitest";
import { activityChange, transition } from "./activity-change";

describe("슬랙 활동 — 무엇을 했나(원장 2026-09-29, codex·grok 합의)", () => {
  it("출결 전후는 한글로, 이전을 모르면 이후만", () => {
    expect(activityChange("attendance_cell", { prevStatus: "present", status: "absent" }).brief).toEqual(["출석 → 결석"]);
    expect(activityChange("attendance_cell", { status: "excused" }).brief).toEqual(["결석(사유)"]);
    expect(activityChange("attendance_cell", { status: "weird" }).brief).toEqual([]);
  });
  it("콜&상담 상태·학생 상태·자산 상태 전환 — 모르는 값은 그 쪽만 뺀다", () => {
    expect(activityChange("enrollment_consultation_outcome", { from: "pending", to: "enrolled" }).brief).toEqual(["대기 → 재원생 등록 완료"]);
    expect(activityChange("student_update", { statusFrom: "withdrawn", statusTo: "enrolled" }).brief).toEqual(["퇴원 → 재원"]);
    expect(activityChange("enrollment_consultation_outcome", { from: "xxx", to: "enrolled" }).brief).toEqual(["재원생 등록 완료"]);
    expect(transition("출석", "출석")).toBe("출석");
  });
  it("수업보고서 새로 작성 / 수정 — 키가 없으면 안 적는다", () => {
    expect(activityChange("lesson_report_save", { created: true }).brief).toEqual(["새로 작성"]);
    expect(activityChange("lesson_report_save", { created: false }).brief).toEqual(["수정"]);
    expect(activityChange("lesson_report_save", {}).brief).toEqual([]);
  });
  it("강사 시트 칸 — 짧은 전후는 싣고, 특이사항은 내용 없이, 긴 글은 첫 줄에서 '수정'만", () => {
    expect(activityChange("ecs_plan_cell_edit", { fieldLabel: "과제", before: "SB 6-2 풀기", after: "SB 6-3 풀기" }).brief).toEqual([
      "과제 「SB 6-2 풀기」 → 「SB 6-3 풀기」",
    ]);
    const note = activityChange("seat_jj_mark_edit", { fieldLabel: "특이사항", before: null, after: "010-1234-5678 엄마 연락" });
    expect(note.brief).toEqual(["특이사항 입력"]);
    expect(JSON.stringify(note)).not.toContain("010");
    const long = activityChange("ecs_plan_cell_edit", { fieldLabel: "과제", before: "a", after: "x".repeat(40) });
    expect(long.brief).toEqual(["과제 수정"]);
    expect(activityChange("ecs_mark_edit", { fieldLabel: "status", before: "a", after: "b" }).brief).toEqual([]);
  });
  it("줄바꿈이 첫 줄을 끊지 않는다", () => {
    const r = activityChange("ecs_plan_cell_edit", { fieldLabel: "과제", before: "a\nb", after: "c" });
    expect(r.brief[0]).not.toContain("\n");
  });
  it("병합은 건수만 — 버린 항목(연락처 등)은 싣지 않는다", () => {
    const r = activityChange("consultation_merge", { result: { deleted: 1 }, discarded: ["학부모 연락처 010-1111-2222"] });
    expect(r.brief).toEqual(["중복 1건 정리"]);
    expect(JSON.stringify(r)).not.toContain("010");
  });
  it("건수는 0 이상 정수만 · 가져오기 0건은 '변경 없음'", () => {
    expect(activityChange("attendance_bulk", { status: "present", count: 7, created: 0 }).brief).toEqual(["출석 7명"]); // 덮어쓰기면 created 0
    expect(activityChange("classnote_notice_send", { targetCount: "3" }).brief).toEqual([]);
    expect(activityChange("calendar_google_import", { inserted: 0, updated: 0, deleted: 0 }).brief).toEqual(["변경 없음"]);
  });
  it("발송 상태 원문(queued)은 싣지 않는다", () => {
    expect(activityChange("classnote_send", { status: "queued" }).brief).toEqual([]);
  });
  it("첨부 파일명은 첫 줄에 싣지 않는다(학생 이름 중복)", () => {
    const r = activityChange("report_attachment_add", { fileName: "김승언.pdf" });
    expect(r.brief).toEqual(["파일 첨부"]);
    expect(r.rows).toEqual([{ label: "파일", value: "김승언.pdf" }]);
  });
});
