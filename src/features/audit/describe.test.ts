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

  it("계정 조작(비밀번호·이메일): 영문 mode/키를 노출하지 않는다", () => {
    expect(auditDetail("staff_password_reset", { mode: "temp" }, ctx())).toBe("임시 비밀번호 발급");
    expect(auditDetail("staff_password_reset", { mode: "custom" }, ctx())).toBe("비밀번호 직접 설정");
    expect(auditDetail("staff_password_reset", {}, ctx())).toBeNull();
    // 비밀번호 값이 metadata에 실려도 상세에 새어나가면 안 된다(애초에 넣지 않지만 이중 방어).
    expect(auditDetail("staff_password_reset", { mode: "temp", password: "hunter2" }, ctx())).toBe(
      "임시 비밀번호 발급",
    );
    expect(auditDetail("self_password_change", {}, ctx())).toBeNull();
    for (const a of ["staff_email_change", "self_email_change"]) {
      expect(auditDetail(a, { from: "a@x.com", to: "b@x.com" }, ctx())).toBe("a@x.com → b@x.com");
      expect(auditDetail(a, { to: "b@x.com" }, ctx())).toBe("b@x.com");
      expect(auditDetail(a, {}, ctx())).toBeNull();
    }
  });

  it("반 폐지/복원 · 통합뷰 그룹 · 근로계약: 영문 키가 상세에 남지 않는다", () => {
    expect(auditDetail("class_archive", { classId: SID, affectedStudents: 7 }, ctx())).toBe("수강 7건 종료");
    expect(auditDetail("class_unarchive", { classId: SID, affectedStudents: 7 }, ctx())).toBe("수강 7건 복원");
    expect(auditDetail("class_archive", { classId: SID }, ctx())).toBeNull();
    // 과목은 raw 키가 아니라 학원설정 라벨로(운영 enum 하드코딩 금지와 같은 축).
    expect(auditDetail("owner_integration_groups_update", { subject: "english", enabled: true, groups: 3 }, ctx()))
      .toBe("과목 「영어」 · 통합뷰 사용 · 그룹 3개");
    expect(auditDetail("owner_integration_groups_update", { subject: "math", enabled: false, groups: 0 }, ctx()))
      .toBe("과목 「수학」 · 통합뷰 미사용 · 그룹 0개");
    expect(auditDetail("staff_contract_extend", { seq: 3, startDate: "2026-03-01", endDate: "2027-02-28" }, ctx()))
      .toBe("3차 계약 · 2026-03-01 ~ 2027-02-28");
    expect(auditDetail("staff_contract_delete", { contractId: SID, seq: 2 }, ctx())).toBe("2차 계약 삭제");
    expect(
      auditDetail("staff_contract_update", { contractId: SID, kind: "contract", seq: 1, startDate: "2026-03-01", endDate: "2027-02-28" }, ctx()),
    ).toBe("1차 계약 · 2026-03-01 ~ 2027-02-28");
    // kind='note'(시트 이관 이력)는 차수가 없다 — 영문 "note"가 새면 안 된다.
    expect(auditDetail("staff_contract_update", { contractId: SID, kind: "note", seq: 0 }, ctx())).toBe("이력 줄");
    expect(auditDetail("staff_contract_file_add", { fileName: "근로계약서_2026.pdf" }, ctx()))
      .toBe("파일 근로계약서_2026.pdf");
    expect(auditDetail("staff_contract_file_delete", { docId: SID, fileName: "old.pdf" }, ctx())).toBe("파일 old.pdf");
    // filled = 영문 필드 키 배열 → 개수만 노출
    expect(auditDetail("staff_contract_pdf_extract", { filled: ["startDate", "endDate"] }, ctx()))
      .toBe("PDF에서 항목 2개 추출");
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
    // logAction 전수(2026-07-11 grep) + 실 DB target_type 전수(2026-08-03) — 후자에서 user·users·
    // academy_documents가 라벨 없이 영문으로 노출되고 있었다. 새 targetType은 여기와 AUDIT_TYPE_LABEL에 함께 추가.
    const usedTypes = [
      "staff", "student", "invoice", "exam", "payroll", "class", "classroom",
      "tenant_settings", "staff_resume", "intake_token", "notice_popup",
      "user", "users", "academy_documents", "classnote_notice",
    ];
    for (const t of usedTypes) expect(AUDIT_TYPE_LABEL[t], t).toBeTruthy();
  });
});
