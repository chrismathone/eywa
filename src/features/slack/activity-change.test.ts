import { describe, expect, it } from "vitest";
import { activityChange, transition } from "./activity-change";
import { contentLine } from "./activity-detail";

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
    expect(note.brief).toEqual(["특이사항 입력"]); // 첫 줄엔 내용 없이
    // '자세히'엔 내용까지(원장 2026-09-29 "필요한 정보들은 전부") — 전화번호 모양은 가려서.
    expect(note.rows).toEqual([
      { label: "특이사항 전", value: "(빈칸)" },
      { label: "특이사항 후", value: "5678 엄마 연락" }, // 자르기 전에 가린다
    ]);
    const long = activityChange("ecs_plan_cell_edit", { fieldLabel: "과제", before: "a", after: "x".repeat(40) });
    expect(long.brief).toEqual(["과제 수정"]);
    expect(activityChange("ecs_mark_edit", { fieldLabel: "status", before: "a", after: "b" }).brief).toEqual([]);
  });
  it("옛 기록의 문자열 \"null\"은 빈칸 · 자세히엔 긴 글도 전부(500자까지)", () => {
    const r = activityChange("ecs_mark_edit", { fieldLabel: "태도", before: "보통", after: "null" });
    expect(r.brief).toEqual(["태도 「보통」 → (빈칸)"]);
    const long = "가".repeat(300);
    expect(activityChange("ecs_memo_edit", { fieldLabel: "월 메모", month: "2026-10", before: "null", after: long }).rows).toEqual([
      { label: "달", value: "10월" },
      { label: "월 메모 전", value: "(빈칸)" },
      { label: "월 메모 후", value: long },
    ]);
  });
  it("수강일·반·자산·계획 복사·교재 체크·전자결재 결의서 — 자세히 내용", () => {
    expect(activityChange("enrollment_dates_update", { field: "end", from: "2026-09-22", to: "2026-08-31" }).brief).toEqual([
      "종료일 9/22(화) → 8/31(월)",
    ]);
    expect(activityChange("enrollment_dates_update", { field: "end", from: "null", to: "2026-09-19" }).brief).toEqual(["종료일 (없음) → 9/19(토)"]);
    const cls = activityChange("class_update", { changes: '[{"to":"중등M BS4","from":"중등M BS3R","field":"반 이름"}]' });
    expect(cls.brief).toEqual(["반 이름 수정"]);
    expect(cls.rows).toEqual([{ label: "반 이름", value: "중등M BS3R → 중등M BS4" }]);
    // 예약 cron은 담임을 id로 적는다 — 값은 빼고 무엇을 바꿨는지만
    const cron = activityChange("class_update", {
      changes: '[{"field":"담임","from":"3f2a1b4c-1111-4222-8333-944455556666","to":"9b1c2d3e-1111-4222-8333-944455556666"}]',
    });
    expect(cron).toEqual({ brief: ["담임 수정"], rows: [{ label: "바꾼 칸", value: "담임" }] });
    expect(
      activityChange("class_update", { changes: '[{"field":"담임","from":"3f2a1b4c-1111-4222-8333-944455556666","to":"김선생"}]' }).rows,
    ).toEqual([{ label: "담임", value: "(이전 값) → 김선생" }]);
    expect(activityChange("class_update", { changes: '[{"field":"수업 배치"}]' })).toEqual({ brief: ["수업 배치 수정"], rows: [] });
    expect(activityChange("inventory_asset_update", { changed: '["비고","현위치"]' }).brief).toEqual(["비고·현위치 수정"]);
    expect(activityChange("ecs_plan_copy", { sourceDate: "2026-08-18", copied: 2 }).brief).toEqual(["8/18(화) 계획에서 2줄 복사"]);
    expect(activityChange("textbook_order_check", { fieldLabel: "주문", checked: true }).brief).toEqual(["주문 체크"]);
    expect(activityChange("approval_submit", { amount: 50000, spendDate: "2026-09-28", category: "매입" }).brief).toEqual([
      "매입",
      "지출일 9/28(월)",
      "₩50,000",
    ]);
    expect(activityChange("approval_submit", { days: 2, remaining: 5 })).toEqual({ brief: [], rows: [] }); // 휴가 기안은 싣지 않는다
    expect(activityChange("class_update", { changes: '[{"field":"teacher_id","from":"a","to":"b"}]' })).toEqual({ brief: [], rows: [] });
  });
  it("슬랙 규칙 저장 — 첫 줄에 켜짐·꺼짐(바뀌었으면 전 → 후)", () => {
    expect(activityChange("slack_rule_save", { enabled: false, before: { enabled: true } }).brief).toEqual(["켜짐 → 꺼짐"]);
    expect(activityChange("slack_rule_save", { enabled: true, created: true }).brief).toEqual(["새 규칙 · 켜짐"]);
    expect(activityChange("slack_rule_save", { enabled: true, before: { enabled: true } }).brief).toEqual(["켜짐"]);
  });
  it("'내용' 줄 — uuid 조각·이미 보인 조각은 빼고, 날짜는 짧게, 번호는 가려서", () => {
    const shown = { brief: ["김하늘", "중등M 중1 A", "9/29(화)"], rows: [{ value: "김하늘 (칠성중1)" }] };
    expect(contentLine("김하늘 · 중등M 중1 A · 종료일 2026-09-29 · 사유 이사", shown)).toBe("종료일 9/29(화) · 사유 이사");
    expect(contentLine("변경: 담임 3f2a1b4c-1111-4222-8333-944455556666 → 9b1c2d3e-1111-4222-8333-944455556666", shown)).toBeNull();
    expect(contentLine("메모: 010-1234-5678로 연락", shown)).toBe("메모: 5678로 연락");
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
    // 알림(웹훅) 반영도 같은 모양으로 읽힌다(2026-09-30).
    expect(activityChange("calendar_google_push_sync", { inserted: 0, updated: 0, deleted: 0 }).brief).toEqual(["변경 없음"]);
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
