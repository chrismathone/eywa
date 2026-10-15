/**
 * 퇴원·수강 종료 사유 2단계(원장 2026-10-15) — 세부 표의 모양 · 저장 검사 · 배선 가드.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REASON_LABEL, REASON_LABEL_EN, WITHDRAWAL_REASONS } from "./types";
import { REASON_DETAILS, checkReasonInput, detailFor, memoRequired, readReasonForm, reasonDetailOf } from "./reason-detail";
import { reasonKeyOf } from "./reason-key";
import { reasonFacetLabel } from "./breakdown";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("세부 표", () => {
  it("대분류 14 · 세부 42 · 이사·졸업·기타는 세부 없음 — 고른 시안 그대로", () => {
    expect(WITHDRAWAL_REASONS).toHaveLength(14);
    expect(Object.values(REASON_DETAILS).flat()).toHaveLength(42);
    expect([REASON_DETAILS.relocation, REASON_DETAILS.graduated, REASON_DETAILS.other]).toEqual([[], [], []]);
    expect(Object.keys(REASON_DETAILS).sort()).toEqual([...WITHDRAWAL_REASONS].sort());
  });
  it("🔴 세부 키는 전역에서 하나 · 영문 소문자·밑줄 — 키만 보고 대분류를 안다(같은 '친구 따라'도 키가 다르다)", () => {
    const keys = Object.values(REASON_DETAILS).flat().map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k).toMatch(/^[a-z_]{1,40}$/);
    expect(reasonDetailOf("with_friends")?.reason).toBe("competitor");
    expect(reasonDetailOf("friends_left")?.reason).toBe("peers");
  });
  it("🔴 대분류 키는 영문 소문자만 — 강사평가 '뺄 사유' 저장 검사(`^[a-z]{1,20}$`)를 통과해야 고를 수 있다", () => {
    for (const k of WITHDRAWAL_REASONS) expect(k).toMatch(/^[a-z]{1,20}$/);
    expect(Object.keys(REASON_LABEL_EN).sort()).toEqual(Object.keys(REASON_LABEL).sort());
  });
  it("옛 라벨(이름 정리 전)도 같은 키 — 글로 남은 옛 사유가 자유 글로 새지 않는다", () => {
    expect(reasonKeyOf("수업 불만족")).toBe("dissatisfaction");
    expect(reasonKeyOf("시간/일정 조정")).toBe("schedule");
    expect(reasonKeyOf("수업·강사")).toBe("dissatisfaction");
    expect(reasonKeyOf("진로·진학")).toBe("career");
  });
});

describe("세부 살리기 · 저장 검사", () => {
  it("저장된 세부는 그 대분류의 것만 산다 — 대분류를 바꾼 뒤 남은 옛 세부는 버린다 · 별칭 대분류도 된다", () => {
    expect(detailFor("dissatisfaction", "teacher_changes")).toBe("teacher_changes");
    expect(detailFor("dissatisfied", "teacher_changes")).toBe("teacher_changes");
    expect(detailFor("grades", "teacher_changes")).toBeNull();
    expect(detailFor("other", "nope")).toBeNull();
    expect(detailFor(null, "teacher_changes")).toBeNull();
  });
  it("세부는 선택 · 고른 값은 그 대분류의 세부여야 · '기타'는 메모 필수", () => {
    expect(checkReasonInput({ reason: "grades", detail: "", memo: null })).toEqual({ detail: null });
    expect(checkReasonInput({ reason: "grades", detail: "school_grades", memo: null })).toEqual({ detail: "school_grades" });
    expect(checkReasonInput({ reason: "grades", detail: "teacher_left", memo: null }).error).toBeTruthy();
    expect(checkReasonInput({ reason: "other", detail: null, memo: "  " }).error).toContain("기타");
    expect(checkReasonInput({ reason: "other", detail: null, memo: "학원 셔틀 노선 폐지" })).toEqual({ detail: null });
    expect(memoRequired("other")).toBe(true);
    expect(memoRequired("relocation")).toBe(false);
  });
});

describe("폼 사유 칸 읽기(readReasonForm) — 사유를 받는 서버 액션 공용", () => {
  const fd = (o: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(o)) f.set(k, v);
    return f;
  };
  it("대분류를 안 골랐거나 모르는 값이면 거절 — 예전처럼 '기타'로 떨어지지 않는다", () => {
    expect(readReasonForm(fd({}))).toEqual({ error: "퇴원 사유를 골라 주세요." });
    expect(readReasonForm(fd({ reason: "nope" }), "종료")).toEqual({ error: "종료 사유를 골라 주세요." });
  });
  it("'기타'는 메모가 있어야 · 공백뿐인 메모는 없는 것", () => {
    expect(readReasonForm(fd({ reason: "other", memo: "   " })).error).toBeTruthy();
    expect(readReasonForm(fd({ reason: "other", memo: " 개인 사정 " }))).toEqual({ reason: "other", detail: null, memo: "개인 사정" });
  });
  it("세부는 선택 · 그 대분류의 세부만", () => {
    expect(readReasonForm(fd({ reason: "dissatisfaction", detail: "teacher_left" }))).toEqual({ reason: "dissatisfaction", detail: "teacher_left", memo: null });
    expect(readReasonForm(fd({ reason: "grades", detail: "teacher_left" })).error).toBeTruthy();
    expect(readReasonForm(fd({ reason: "graduated" }))).toEqual({ reason: "graduated", detail: null, memo: null });
  });
});

describe("배선 가드", () => {
  it("🔴 퇴원보고서 DB 함수의 사유 목록 = 앱 사유 목록(0367a) — 사유를 늘리면 함수 목록도 함께 늘린다(안 그러면 그 사유로 낸 보고서가 거절된다)", () => {
    const sql = read("supabase/migrations/0367a_withdrawal_reason_details.sql");
    const list = sql.match(/new_list constant text := '(.*)';/)?.[1] ?? "";
    const keys = [...list.matchAll(/''([a-z_]+)''/g)].map((m) => m[1]);
    expect([...keys].sort()).toEqual([...WITHDRAWAL_REASONS].sort());
  });
  it("세 저장 경로가 같은 검사를 지난다 — 퇴원(상태 전환) · 부분 종료 · 퇴원 상세 사유 저장", () => {
    const students = read("src/features/students/server/actions.ts");
    expect(students.match(/checkReasonInput\(/g)?.length).toBe(2);
    expect(students).toContain("endEnrollmentById(supabase, t.id, date, reasonStr, { detail: checked.detail, memo })");
    expect(read("src/features/withdrawals/server/actions.ts")).toContain("checkReasonInput(");
  });
  it("🔴 '기타는 메모 필수'가 모든 곳에 — 사유를 받는 길이 모두 같은 읽기·같은 부품을 지난다(원장 2026-10-15 *\"기타는 모든 곳을 일치하게\"*)", () => {
    const students = read("src/features/students/server/actions.ts");
    // 학생 등록·수정(새 퇴원·예약) · 수강 한 건 종료 — 사유 없이 '기타'로 떨어지는 기본값이 없어야 한다.
    expect(students.match(/readReasonForm\(formData/g)?.length).toBe(3);
    expect(students).not.toContain(`|| "other"`);
    expect(students).not.toMatch(/withdrawal_metadata: createPlan\.kind === "none" \? null : DEFAULT_WITHDRAWAL_METADATA/);
    const end = students.slice(students.indexOf("export async function endSingleEnrollment"), students.indexOf("// ────────────────────── 메모 + 성적"));
    expect(end).toContain("{ detail: picked.detail, memo: picked.memo }");
    // 화면 — 수강 종료 창 넷(반·학생 상세 · 시간표 Delete · 명단 끌기) + 학생 폼이 같은 부품.
    for (const f of [
      "src/features/enrollments/components/end-enrollment-action.tsx",
      "src/app/(shell)/timetable/_components/timetable-board.tsx",
      "src/app/(shell)/timetable/_components/roster-move.tsx",
      "src/app/(shell)/students/_components/withdrawal-reason-slot.tsx",
    ]) expect(read(f), f).toContain("<ReasonFields");
    expect(read("src/app/(shell)/students/_components/student-form.tsx")).toContain("<WithdrawalReasonSlot");
    // 엑셀 가져오기 — 새 퇴원생은 사유를 받고 기본 메타데이터를 박지 않는다.
    const imp = read("src/features/excel-import/importers/students.ts");
    expect(imp).toContain("checkReasonInput(");
    expect(imp).not.toContain("DEFAULT_WITHDRAWAL_METADATA");
    // 퇴원보고서 — 닫는 수강 줄에도 상세사유 메모(0369a).
    const m = read("supabase/migrations/0369a_withdrawal_report_end_memo.sql");
    expect(m).toContain("withdrawal_memo=(select nullif(btrim(q.body->>'detail'),'')");
    expect(m).toContain("withdrawal_memo=nullif(btrim(r.body->>'detail'),'')");
    // 같은 사유로 다시 종료하며 메모를 바꾸는 것 — 원생 상태 변경 권한이 있으면 보호 트리거가 막지 않는다(리뷰 2026-10-15).
    expect(m).toContain("is null) and not student_status_private.allowed() then");
  });
  it("🔴 상태 전환 창은 서버가 거절해도 입력이 남는다 — 액션 폼(자동 초기화)이 아니라 submitAction", () => {
    const dlg = read("src/app/(shell)/students/[id]/_components/status-dialog.tsx");
    expect(dlg).toContain("onSubmit={(e) => submitAction(e,");
    expect(dlg).not.toMatch(/<form\s+action=/);
  });
  it("🔴 상담 칸 토글은 메타데이터의 다른 칸(세부 사유 등)을 지우지 않는다", () => {
    const src = read("src/features/withdrawals/server/actions.ts");
    const toggle = src.slice(src.indexOf("export async function toggleConsultationStep"), src.indexOf("export type ReactivateState"));
    expect(toggle).toContain("...existing,");
  });
  it("🔴 운영실·시간표 X가 쓰는 수강종료 기본 조회엔 새 칸을 넣지 않는다(#95) — 퇴원관리만 따로 읽는다", () => {
    const q = read("src/features/withdrawals/server/queries.ts");
    const main = q.slice(q.indexOf("export async function getSubjectEndedStudents"), q.indexOf("async function attachEndedNotes"));
    expect(main).not.toMatch(/\.select\([^)]*withdrawal_detail/);
    expect(read("src/features/dashboard/overview/server.ts")).toContain("getSubjectEndedStudents()");
    expect(read("src/app/(shell)/withdrawals/page.tsx")).toContain("getSubjectEndedStudents({ withNotes: true })");
  });
  it("🔴 재원 복구로 다시 연 수강은 세부·메모도 비운다 — 나중에 메모 없이 닫으면 옛 메모가 되살아난다", () => {
    const sync = read("src/features/students/server/enrollment-sync.ts");
    const reopen = sync.slice(
      sync.indexOf("export async function reopenEnrollmentsClosedByWithdrawal"),
      sync.indexOf("export async function syncWithdrawalEnrollmentReasons"),
    );
    expect(reopen).toContain("withdrawal_detail: null, withdrawal_memo: null");
  });
  it("🔴 퇴원 사유를 고치면 함께 닫힌 수강 사유도 — 학생보다 먼저(실패 뒤 다시 눌러도 옛 사유를 안다)", () => {
    const src = read("src/features/withdrawals/server/actions.ts");
    const fn = src.slice(src.indexOf("export async function updateWithdrawalReason"), src.indexOf("export type ConsultationToggleState"));
    const sync = fn.indexOf("syncWithdrawalEnrollmentReasons(");
    expect(sync).toBeGreaterThan(-1);
    expect(sync).toBeLessThan(fn.indexOf(".update({ withdrawal_metadata: next })"));
  });
});

describe("주소 값 방어", () => {
  it("기본 속성 이름(constructor 등)은 사유가 아니다 — 화면이 500으로 죽지 않는다", () => {
    for (const v of ["constructor", "toString", "hasOwnProperty", "__proto__"]) expect(reasonFacetLabel(v)).toBeNull();
    expect(reasonFacetLabel("dissatisfaction")).toBe(REASON_LABEL.dissatisfaction);
    expect(read("src/app/(shell)/withdrawals/page.tsx")).toContain("Object.hasOwn(REASON_DETAILS, reason)");
  });
});
