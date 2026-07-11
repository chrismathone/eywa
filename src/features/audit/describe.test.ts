import { describe, it, expect } from "vitest";
import { auditDetail, auditTargetName, collectAuditNameIds, AUDIT_TYPE_LABEL } from "./describe";

const SID = "11111111-2222-3333-4444-555555555555";
const UID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

const ctx = (names: Record<string, string> = {}) => ({
  nameOf: (id: unknown) => (typeof id === "string" ? (names[id] ?? null) : null),
  subjectLabel: (key: string) => ({ math: "수학", english: "영어" })[key] ?? key,
});

describe("auditDetail — 액션별 한글 상세", () => {
  it("owner_settings_update: 섹션 키를 한글 라벨로", () => {
    expect(auditDetail("owner_settings_update", { section: "report" }, ctx())).toBe("「보고서」 설정 저장");
    expect(auditDetail("owner_settings_update", { section: "operations" }, ctx())).toBe("「운영 체계」 설정 저장");
    // 미래에 추가된 미등록 섹션 키는 원문 폴백(빈 상세보단 낫다)
    expect(auditDetail("owner_settings_update", { section: "future" }, ctx())).toBe("「future」 설정 저장");
    expect(auditDetail("owner_settings_update", {}, ctx())).toBe("설정 저장");
  });

  it("staff_role_change / staff_delete: 역할 영문 키를 한글로", () => {
    expect(auditDetail("staff_role_change", { from: "teacher", to: "admin" }, ctx())).toBe("역할 강사 → 관리자");
    expect(auditDetail("staff_delete", { role: "teacher" }, ctx())).toBe("삭제 당시 역할: 강사");
    expect(auditDetail("staff_role_change", { from: "teacher" }, ctx())).toBeNull();
  });

  it("invoice_create: 학생 이름 + 금액 포맷", () => {
    expect(auditDetail("invoice_create", { studentId: SID, amountTotal: 350000 }, ctx({ [SID]: "이윤건" }))).toBe(
      "이윤건 · 청구액 350,000원",
    );
    // 이름 해석 실패(삭제된 학생) → 금액만
    expect(auditDetail("invoice_create", { studentId: SID, amountTotal: 350000 }, ctx())).toBe("청구액 350,000원");
  });

  it("exam_create: 과목 라벨 + 시험유형", () => {
    expect(auditDetail("exam_create", { subject: "math", examType: "weekly" }, ctx())).toBe("수학 · 주간 시험");
  });

  it("exam_delete / class_reopen_term: uuid뿐인 metadata는 상세 없음", () => {
    expect(auditDetail("exam_delete", { examId: SID }, ctx())).toBeNull();
    expect(auditDetail("class_reopen_term", { classId: SID }, ctx())).toBeNull();
  });

  it("exam_scores / student_import / classroom_auto_assign: 건수 풀어쓰기", () => {
    expect(auditDetail("exam_scores", { saved: 12, students: 15 }, ctx())).toBe("학생 15명 중 점수 12건 저장");
    expect(auditDetail("student_import", { inserted: 5, skipped: 2, failed: 0 }, ctx())).toBe(
      "추가 5명 · 건너뜀 2명",
    );
    expect(auditDetail("classroom_auto_assign", { applied: 12, rooms: 4 }, ctx())).toBe(
      "강의실 4곳에 반 12개 자동배정",
    );
  });

  it("payroll_upsert / withdrawal_update: 이름 해석 + 사유", () => {
    expect(auditDetail("payroll_upsert", { userId: UID, total: 2500000 }, ctx({ [UID]: "김강사" }))).toBe(
      "김강사 · 지급 합계 2,500,000원",
    );
    expect(auditDetail("withdrawal_update", { studentId: SID, reason: "이사" }, ctx({ [SID]: "이윤건" }))).toBe(
      "이윤건 · 사유: 이사",
    );
  });

  it("class_end_term / class_handover_*: 날짜·새 담임", () => {
    expect(auditDetail("class_end_term", { classId: SID, closedAt: "2026-07-10" }, ctx())).toBe("종강일 2026-07-10");
    expect(
      auditDetail("class_handover_schedule", { newTeacherId: UID, effectiveDate: "2026-07-15" }, ctx({ [UID]: "김강사" })),
    ).toBe("새 담임 김강사 · 2026-07-15부터");
    expect(auditDetail("class_handover_apply", { newTeacherId: UID }, ctx({ [UID]: "김강사" }))).toBe("새 담임 김강사");
  });

  it("owner_subject_absorb / owner_subject_delete: 이동 건수·과목 라벨", () => {
    expect(auditDetail("owner_subject_absorb", { from: "math", to: "english", moved: 37, detail: {} }, ctx())).toBe(
      "연결 데이터 37건 이동",
    );
    expect(auditDetail("owner_subject_delete", { key: "math" }, ctx())).toBe(
      "과목 「수학」 설정에서 제거(사용 데이터 없음)",
    );
  });

  it("미등록 액션 폴백: uuid는 이름 해석(실패 시 숨김), 나머지는 키: 값", () => {
    expect(auditDetail("future_action", { foo: "bar", id: SID }, ctx())).toBe("foo: bar");
    expect(auditDetail("future_action", { foo: "bar", id: SID }, ctx({ [SID]: "이윤건" }))).toBe("foo: bar · 이윤건");
    expect(auditDetail("future_action", null, ctx())).toBeNull();
  });
});

describe("collectAuditNameIds / auditTargetName", () => {
  it("studentId는 students로, userId·newTeacherId는 users로, classId는 classes로 — 중복 제거", () => {
    const CID = "99999999-8888-7777-6666-555555555555";
    const rows = [
      { metadata: { studentId: SID } },
      { metadata: { studentId: SID, userId: UID } },
      { metadata: { newTeacherId: UID } },
      { metadata: { classId: CID } },
      { metadata: { studentId: "not-a-uuid" } },
      { metadata: null },
    ];
    expect(collectAuditNameIds(rows)).toEqual({ studentIds: [SID], userIds: [UID], classIds: [CID] });
  });

  it("auditTargetName: targetLabel 없는 행의 대상 이름 보충(학생→직원→반 순)", () => {
    expect(auditTargetName({ studentId: SID }, ctx({ [SID]: "이윤건" }).nameOf)).toBe("이윤건");
    expect(auditTargetName({ newTeacherId: UID }, ctx({ [UID]: "김강사" }).nameOf)).toBe("김강사");
    expect(auditTargetName({ classId: SID }, ctx({ [SID]: "중등M 중2" }).nameOf)).toBe("중등M 중2");
    expect(auditTargetName(null, ctx().nameOf)).toBeNull();
  });
});

describe("AUDIT_TYPE_LABEL", () => {
  it("logAction 호출부의 모든 target_type이 한글 라벨을 가진다", () => {
    // logAction 전수(2026-07-11 grep) — 새 targetType 추가 시 여기와 AUDIT_TYPE_LABEL에 함께 추가할 것.
    const usedTypes = [
      "staff", "student", "invoice", "exam", "payroll", "class", "classroom",
      "tenant_settings", "staff_resume", "intake_token", "notice_popup",
    ];
    for (const t of usedTypes) expect(AUDIT_TYPE_LABEL[t], t).toBeTruthy();
  });
});
