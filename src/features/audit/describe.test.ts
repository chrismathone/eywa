import { describe, it, expect } from "vitest";
import {
  auditActorName,
  auditDetail,
  auditTargetLabel,
  auditTargetName,
  collectAuditNameIds,
  systemActorMatches,
  AUDIT_TYPE_LABEL,
} from "./describe";

const SID = "11111111-2222-3333-4444-555555555555";
const UID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

const ctx = (names: Record<string, string> = {}) => ({
  nameOf: (id: unknown) => (typeof id === "string" ? (names[id] ?? null) : null),
  subjectLabel: (key: string) => ({ math: "수학", english: "영어" })[key] ?? key,
});

describe("auditDetail — ClassNote 명부 퇴원처리(2026-11-03)", () => {
  it("정기 동기화 요약 — 실제로 내린 수와 관찰 모드(자동 퇴원처리 꺼짐)의 예정 수를 가른다", () => {
    expect(auditDetail("classnote_board_sync_daily", { changed: 3, failed: 0, held: 12, offboarded: 0, offboardPlanned: 10 }, ctx())).toContain("명부 퇴원처리 예정 10명(자동 퇴원처리 꺼짐)");
    const live = auditDetail("classnote_board_sync_daily", { changed: 3, failed: 0, held: 2, offboarded: 4 }, ctx());
    expect(live).toContain("명부 퇴원처리 4명");
    expect(live).not.toContain("예정");
  });
  it("확인 실패 — 사유 문장을 그대로 · 원아 번호·백업 위치는 안 보인다", () => {
    const line = auditDetail("classnote_offboard_unconfirmed", { childId: 5611926, childName: "박예서", days: 60, why: "퇴원처리 요청 뒤에도 재원 명부에 그대로 있습니다(ClassNote가 처리하지 않음)", backupPath: "t/x.json" }, ctx());
    expect(line).toContain("확인 필요");
    expect(line).toContain("재원 명부에 그대로");
    expect(line).not.toContain("5611926");
    expect(line).not.toContain("x.json");
  });
});

describe("auditDetail — 원스크린 일괄 입력(2026-10-15)", () => {
  const C1 = "c1111111-2222-3333-4444-555555555555";
  const C2 = "c2222222-2222-3333-4444-555555555555";
  it("방식 · 날짜 · 행 수 · 반 이름 · 칸(한글) — 모르는 칸 키는 안 보인다", () => {
    const line = auditDetail(
      "onescreen_bulk_apply",
      { mode: "copy", date: "2026-10-15", rows: 16, classIds: [C1, C2], fields: ["today", "homeworkToday", "weird"] },
      ctx({ [C1]: "MS2A", [C2]: "PS3A" }),
    );
    expect(line).toBe("맨 위 행 복사 · 2026-10-15 · 16행 · 반 MS2A·PS3A · 칸 진도·오늘 과제");
  });
  it("배열로 적은 반 id도 이름 조회 대상이다 — 쓰는 분기가 없는 학생 id 배열은 안 모은다(조회 폭증)", () => {
    expect(collectAuditNameIds([{ metadata: { classIds: [C1, "x", C2], studentIds: [SID] } }])).toEqual({ studentIds: [], userIds: [], classIds: [C1, C2] });
  });
});

describe("auditDetail — 감사로그 빈틈 메우기(2026-10-15)", () => {
  it("학생 기록은 누구 · 과목(한글) · 날짜 — 점수·본문은 기록에 없다", () => {
    expect(auditDetail("student_grade_create", { studentId: SID, subject: "math", year: 2026, term: 2, slot: "mid", date: "2026-10-15" }, ctx({ [SID]: "김학생" })))
      .toBe("김학생 · 수학 · 2026-10-15");
    expect(auditDetail("student_grade_comment_delete", { commentId: "x", studentId: SID, subject: "english" }, ctx({ [SID]: "김학생" }))).toBe("김학생 · 영어");
  });
  it("켜고 끄는 기록은 방향을 말한다", () => {
    expect(auditDetail("student_memo_pin", { studentId: SID, pinned: false }, ctx({ [SID]: "김학생" }))).toBe("김학생 · 고정 해제");
    expect(auditDetail("progress_anomaly_resolve", { studentId: SID, resolved: true }, ctx({ [SID]: "김학생" }))).toBe("김학생 · 이상 없음으로 확인");
    expect(auditDetail("tuition_catalog_toggle", { itemId: "x", active: false }, ctx())).toBe("중지로");
    expect(auditDetail("shuttle_rider_weekdays", { studentId: SID, weekdays: ["mon", "wed"] }, ctx({ [SID]: "김학생" }))).toContain("김학생");
  });
  it("보강 연결 — 메모만 붙인 것과 시수까지 고친 것을 가른다 · 보강관리 처리는 명령 이름 한글로", () => {
    expect(auditDetail("attendance_makeup_link", { studentId: SID, absentDate: "2026-10-01", makeupDate: "2026-10-03", memoOnly: true }, ctx({ [SID]: "김학생" })))
      .toBe("김학생 · 결석 2026-10-01 · 보강 2026-10-03 · 메모만 연결");
    // 시수까지 고친 옛 기록 — 보강 반·결석 반 이름이 보인다.
    const CA = "ca111111-2222-3333-4444-555555555555";
    const CB = "cb111111-2222-3333-4444-555555555555";
    expect(auditDetail("attendance_makeup_link", { studentId: SID, classId: CA, absentClassId: CB, absentDate: "2026-10-01", makeupDate: "2026-10-03", units: 2 }, ctx({ [SID]: "김학생", [CA]: "MS1A", [CB]: "MS2A" })))
      .toBe("김학생 · 결석 2026-10-01 MS2A · 보강 2026-10-03 MS1A · 보강 칸 시수 2");
    expect(collectAuditNameIds([{ metadata: { absentClassId: CB } }]).classIds).toEqual([CB]);
    expect(auditDetail("makeup_case_command", { command: "reserve", studentId: SID }, ctx({ [SID]: "김학생" }))).toBe("예약 · 김학생");
    expect(auditDetail("makeup_case_command", { command: "weird" }, ctx())).toBeNull();
  });
  it("반 생성의 담임 id도 이름 조회 대상이다", () => {
    expect(collectAuditNameIds([{ metadata: { teacherId: UID } }]).userIds).toEqual([UID]);
  });
  it("새 대상 유형은 한글 라벨이 있다", () => {
    for (const t of ["textbook_catalog", "tuition_catalog", "tuition_quote", "staff_leave", "withdrawal_report_archive", "makeup"]) expect(AUDIT_TYPE_LABEL[t], t).toBeTruthy();
  });
});

describe("auditDetail — 청구 회차 행 생성(출석부 줄에 맞춤, 2026-09-18)", () => {
  it("영문 이름 변경은 이전·이후 이름을 남긴다", () => {
    expect(auditDetail("student_english_name_update", { studentId: SID, before: "Lucy", after: "Luna" }, ctx({ [SID]: "김학생" }))).toContain("영문 이름 Lucy → Luna");
    expect(auditDetail("student_english_name_update", { studentId: SID, before: null, after: "Lucy" }, ctx())).toBe("영문 이름 없음 → Lucy");
  });
  it("회차 삭제는 0시수·0원과 삭제된 메모까지 표시한다", () => {
    expect(auditDetail("session_term_delete", { period: "2026-09", sessionsBefore: 0, amountBefore: 0, note: "종료반 정리" }, ctx()))
      .toBe("2026-09 · 확정 0시수 삭제 · 0원 · 메모: 종료반 정리");
  });
  const CID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  it("어느 달·어느 반·왜·예정 시수를 한 줄로 — 기록만 있는 줄은 '예정 없음', 모르는 계기는 영문을 흘리지 않는다", () => {
    expect(
      auditDetail("session_term_create", { period: "2026-09", classId: CID, studentId: SID, reason: "confirm_class", plannedSessions: 9 }, ctx({ [CID]: "수학A" })),
    ).toBe("2026-09 · 수학A 반 · 반 일괄 확정 때 생성 · 예정 9시수");
    expect(auditDetail("session_term_create", { period: "2026-09", reason: "allocate", plannedSessions: null }, ctx())).toBe("2026-09 · 수납 배분 때 생성 · 예정 없음(기록만)");
    expect(auditDetail("session_term_create", { period: "2026-09", reason: "bogus_reason", plannedSessions: 3 }, ctx())).toBe("2026-09 · 예정 3시수");
    // '대상' 열은 metadata의 학생 이름으로(auditTargetName 규약).
    expect(auditTargetName({ studentId: SID, classId: CID }, ctx({ [SID]: "김학생", [CID]: "수학A" }).nameOf)).toBe("김학생");
  });
});

describe("auditDetail — 도움말 게시판(0265a)", () => {
  it("질문·답변은 제목만 한글로", () => {
    expect(auditDetail("help_post_create", { title: "출석부가 안 열려요" }, ctx())).toBe("출석부가 안 열려요");
    expect(auditDetail("help_answer_create", { title: "출석부가 안 열려요" }, ctx())).toBe("출석부가 안 열려요");
  });
});

describe("auditDetail — 인재원 학습 계정 짝(2026-09-10)", () => {
  it("연결·일괄·해제 모두 어느 계정인지 적는다(이름이 아이디 그대로면 한 번만)", () => {
    expect(auditDetail("student_ijw_link", { studentId: SID, ijwId: "ijwgsy", ijwName: "공서연" }, ctx())).toBe(
      "인재원 계정 ijwgsy(공서연)",
    );
    expect(auditDetail("student_ijw_link_bulk", { studentId: SID, ijwId: "ijwgsy", ijwName: "ijwgsy" }, ctx())).toBe(
      "인재원 계정 ijwgsy",
    );
    expect(auditDetail("student_ijw_unlink", { studentId: SID, ijwId: "ijwgsy" }, ctx())).toBe("인재원 계정 ijwgsy");
  });

  it("아이디가 없는 기록은 빈 칸 — 영문 키가 새지 않는다", () => {
    expect(auditDetail("student_ijw_unlink", { studentId: SID }, ctx())).toBeNull();
  });
});

describe("auditDetail — 학원 설정 변경 내역(2026-08-27 감사 커버리지)", () => {
  it("무엇이 바뀌었는지가 섹션명과 함께 나온다", () => {
    const detail = auditDetail(
      "owner_settings_update",
      { section: "billing", changes: [{ label: "납부일", from: "10", to: "5" }] },
      ctx(),
    );
    expect(detail).toBe("「수납·청구 기본값」 납부일 10 → 5");
  });

  it("여러 건은 가운뎃점으로 잇고, 많으면 '외 N건'으로 접는다", () => {
    const changes = Array.from({ length: 8 }, (_, i) => ({ label: `항목${i}`, note: "변경됨" }));
    const detail = auditDetail("owner_settings_update", { section: "profile", changes }, ctx());
    expect(detail).toContain("항목0 변경됨");
    expect(detail).toContain("외 2건");
  });

  it("라벨 없는 필드 개수(others)도 함께 알린다 — 조용히 숨기지 않는다", () => {
    const detail = auditDetail(
      "owner_settings_update",
      { section: "operations", changes: [{ label: "과목", note: "내용 변경" }], others: 2 },
      ctx(),
    );
    expect(detail).toContain("(그 외 2건)");
  });

  it("🔴 옛 행(changes 없음)은 종전대로 섹션명만 — 빈칸이 되지 않는다", () => {
    expect(auditDetail("owner_settings_update", { section: "operations" }, ctx())).toBe(
      "「운영 체계」 설정 저장",
    );
  });

  it("연동·프롬프트·강의실·팝업 액션 상세", () => {
    expect(auditDetail("integration_sync_toggle", { enabled: false }, ctx())).toBe("끄기");
    expect(auditDetail("integration_sheets_toggle", { enabled: true }, ctx())).toBe("켜기");
    expect(auditDetail("integration_sheet_target", { cleared: true }, ctx())).toBe("대상 시트 해제");
    expect(auditDetail("integration_sync_now", { mode: "relay" }, ctx())).toBe("지금 동기화 실행");
    expect(auditDetail("intake_push_enqueue", { count: 3 }, ctx())).toBe("상담 3건 역동기화 요청");
    expect(auditDetail("ai_prompt_save", { type: "comment" }, ctx())).toBe("프롬프트 저장(새 버전)");
    expect(auditDetail("classroom_update", { from: "본원302", to: "본원303" }, ctx())).toBe(
      "이름 본원302 → 본원303",
    );
    expect(auditDetail("notice_popup_toggle", { active: true }, ctx())).toBe("노출 켜기");
  });

  it("🔴 시트 ID·프롬프트 본문 같은 값은 상세에 안 실린다(감사로그가 사본이 되면 안 된다)", () => {
    const detail = auditDetail(
      "integration_sheet_target",
      { subject: "english", cleared: false, spreadsheetId: "1-secret-id" },
      ctx(),
    );
    expect(detail).not.toContain("1-secret-id");
  });
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

  it("class_schedule_move: 적용일 · 첫 줄 이동 + 줄 수 · 함께 옮긴 기록을 자르지 않는다(폴백은 60자에서 잘랐다 · 2026-10-28)", () => {
    const carried =
      "함께 옮긴 기록: 수업 계획 42건 · 학생 기록 118건 · 미룸·당김 표식 3건 · 교시 메모 2건 · 교재 배정 교시 2개 (새 요일이 적용일보다 앞서 블록의 기록을 모두 한 주 뒤 같은 요일로)";
    const meta = {
      classId: SID,
      effectiveDate: "2026-11-06",
      moves: [
        { slotId: "a", from: { day: "tue", start: "16:20:00", end: "17:20:00" }, to: { day: "mon", start: "16:20:00", end: "17:20:00" } },
        { slotId: "b", from: { day: "fri", start: "16:20:00", end: "17:20:00" }, to: { day: "thu", start: "16:20:00", end: "17:20:00" } },
      ],
      newSlotIds: ["x", "y"],
      carried,
      carriedCounts: { class_sheet_plan_lines: 42 },
    };
    expect(auditDetail("class_schedule_move", meta, ctx())).toBe(`적용일 2026-11-06 · 화 16:20 → 월 16:20 외 1줄 · ${carried}`);
    expect(auditDetail("class_schedule_move", { effectiveDate: "2026-11-06", moves: [] }, ctx())).toBe("적용일 2026-11-06");
  });

  it("exam_scores / student_import / classroom_auto_assign: 건수 풀어쓰기", () => {
    expect(auditDetail("exam_scores", { saved: 12, students: 15 }, ctx())).toBe("학생 15명 중 점수 12건 저장");
    expect(auditDetail("exam_scores", { saved: 12, students: 15, todaysMathSame: 3 }, ctx())).toBe("학생 15명 중 점수 12건 저장 · 오늘 수학 결과와 같은 값 3건");
    // 보고서 저장 줄은 종전 기본 분기 그대로 + 출처 표시만 덧붙는다(옛 기록의 상세가 비지 않게).
    const meta = { reportId: "r", studentId: "s", date: "2026-10-18", subject: "math", classId: "c", via: "teacher", created: true };
    const base = auditDetail("__fallback_probe__", meta, ctx());
    expect(base).not.toBeNull();
    expect(auditDetail("lesson_report_save", meta, ctx())).toBe(base);
    expect(auditDetail("lesson_report_save", { ...meta, todaysMathSame: ["daily", "check"] }, ctx())).toBe(`${base} · 일일·확인테스트가 오늘 수학 결과와 같은 값`);
    expect(auditDetail("lesson_report_save", { ...meta, todaysMathSame: ["weird"] }, ctx())).toBe(base);
    expect(auditDetail("student_import", { inserted: 5, skipped: 2, failed: 0 }, ctx())).toBe(
      "추가 5명 · 건너뜀 2명",
    );
    expect(auditDetail("classroom_auto_assign", { applied: 12, rooms: 4 }, ctx())).toBe(
      "강의실 4곳에 반 12개 자동배정",
    );
  });

  it("student_withdrawn_without_report(0454a DB 트리거): 누구 · 퇴원/예약/예약일 변경 · 날짜 · 퇴원보고서 없음 — 영문 키 없음", () => {
    const c = ctx({ [SID]: "이윤건" });
    expect(auditDetail("student_withdrawn_without_report", { studentId: SID, kind: "withdraw", date: "2026-10-26", requestRole: "authenticated" }, c)).toBe(
      "이윤건 · 퇴원 · 퇴원일 2026-10-26 · 퇴원보고서 없음",
    );
    expect(auditDetail("student_withdrawn_without_report", { studentId: SID, kind: "schedule", date: "2026-12-24" }, c)).toBe(
      "이윤건 · 퇴원 예약 · 예약일 2026-12-24 · 퇴원보고서 없음",
    );
    expect(auditDetail("student_withdrawn_without_report", { studentId: SID, kind: "reschedule", date: "2026-12-05", previousDate: "2026-12-01" }, c)).toBe(
      "이윤건 · 퇴원 예약일 변경 · 2026-12-01 → 2026-12-05 · 퇴원보고서 없음",
    );
  });

  it("withdrawal_reason_restore(옛 퇴원 사유 복원): 누구 · 사유 라벨 · 메모 — 영문 키 없음", () => {
    const c = ctx({ [SID]: "이윤건" });
    expect(auditDetail("withdrawal_reason_restore", { studentId: SID, reason: "other", detail: null, memo: "고등수학관 이동" }, c)).toBe("이윤건 · 사유: 기타 · 고등수학관 이동");
    expect(auditDetail("withdrawal_reason_restore", { studentId: SID, reason: "relocation" }, c)).toBe("이윤건 · 사유: 이사");
    expect(auditDetail("withdrawal_reason_restore", { studentId: SID, reverted: true }, c)).toBe("이윤건 · 복원한 사유를 되돌림");
  });

  it("payroll_upsert / withdrawal_update: 이름 해석 + 사유", () => {
    expect(auditDetail("payroll_upsert", { userId: UID, total: 2500000 }, ctx({ [UID]: "김강사" }))).toBe(
      "김강사 · 지급 합계 2,500,000원",
    );
    expect(auditDetail("withdrawal_update", { studentId: SID, reason: "이사" }, ctx({ [SID]: "이윤건" }))).toBe(
      "이윤건 · 사유: 이사",
    );
    // 사유·세부는 영문 키로 남는다 — 한글로(모르는 세부 키는 싣지 않는다).
    expect(
      auditDetail("withdrawal_update", { studentId: SID, reason: "dissatisfaction", detail: "teacher_left" }, ctx({ [SID]: "이윤건" })),
    ).toBe("이윤건 · 사유: 수업·강사 · 세부: 강사 퇴사");
    expect(auditDetail("withdrawal_update", { studentId: SID, reason: "grades", detail: "nope" }, ctx({ [SID]: "이윤건" }))).toBe(
      "이윤건 · 사유: 성적",
    );
  });

  it("withdrawal_consultation_step / intake_token_toggle: 한글 상세(감사 M3·M4)", () => {
    expect(
      auditDetail(
        "withdrawal_consultation_step",
        { studentId: SID, step: "adminCalledParent", done: true },
        ctx({ [SID]: "이윤건" }),
      ),
    ).toBe("이윤건 · 관리자 학부모 통화 체크");
    expect(auditDetail("intake_token_toggle", { change: "close" }, ctx())).toBe("링크 닫기");
    expect(auditDetail("intake_token_toggle", { change: "expire", expiresOn: "2026-12-31" }, ctx())).toBe(
      "만료일 2026-12-31로 변경",
    );
  });

  it("class_period_enrollments: 운영 종료일 · 닫은 수강 수", () => {
    expect(auditDetail("class_period_enrollments", { classId: SID, periodEnd: "2026-09-21", changed: 5 }, ctx())).toBe(
      "운영 종료일 2026-09-21 · 수강 5건 종료",
    );
  });

  it("class_end_term / class_handover_*: 날짜·새 담임", () => {
    expect(auditDetail("class_end_term", { classId: SID, closedAt: "2026-07-10" }, ctx())).toBe("종강일 2026-07-10");
    const two = [{ id: "a" }, { id: "b" }];
    expect(auditDetail("class_end_term", { classId: SID, closedAt: "2026-09-30", fromName: "LS4b", toName: "LS4b (~26.09.30)", affectedStudents: 3, schedules: two }, ctx()))
      .toBe("종강일 2026-09-30 · 시간표 배치 2줄 닫음");
    expect(auditDetail("class_end_term", { classId: SID, closedAt: "2026-09-30", fromName: "LS4b (~26.09.30)", toName: "LS4b (~26.09.30)", affectedStudents: 0, schedules: two }, ctx()))
      .toBe("종강일 2026-09-30 · 남은 시간표 배치 2줄 정리");
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

  it("class_update: 어디서 → 어디로를 항목마다 적는다", () => {
    // 원장 2026-08-05: "강의실만 딸랑 남기지말고 어디서 → 어디로 이렇게. 담당도 마찬가지."
    expect(
      auditDetail(
        "class_update",
        {
          changed: ["담임", "강의실"],
          changes: [
            { field: "담임", from: "박소선", to: "이수진" },
            { field: "강의실", from: "301호", to: "205호" },
          ],
        },
        ctx(),
      ),
    ).toBe("변경: 담임 박소선 → 이수진 · 강의실 301호 → 205호");
  });

  it("class_update: 비어 있던 쪽은 '없음' · 짝이 없는 항목(수업 배치)은 이름만", () => {
    expect(
      auditDetail(
        "class_update",
        { changes: [{ field: "수업 배치" }, { field: "강의실", from: null, to: "205호" }] },
        ctx(),
      ),
    ).toBe("변경: 수업 배치 · 강의실 없음 → 205호");
  });

  it("🔴 class_update 옛 행(항목 이름만)은 그대로 — 없는 화살표를 지어내지 않는다", () => {
    // 2026-08-05 이전에 쌓인 행에는 이전값이 아예 없다. "강의실 없음 → 없음"으로 보이면 거짓말이 된다.
    expect(auditDetail("class_update", { changed: ["강의실"] }, ctx())).toBe("변경: 강의실");
  });

  it("class_update: 예약 적용이 규칙 때문에 건너뛴 반 이름은 이유와 함께 적는다(2026-09-30)", () => {
    const skipped = [{ field: "반 이름", to: "(수학)홍길동", reason: "개인 보드 이름과 겹침" }];
    expect(auditDetail("class_update", { changed: [], changes: [], skipped }, ctx())).toBe("반 이름 (수학)홍길동 적용 안 함(개인 보드 이름과 겹침)");
    const withChange = auditDetail("class_update", { changes: [{ field: "강의실", from: "302", to: "303" }], skipped }, ctx());
    expect(withChange).toContain("변경: 강의실 302 → 303");
    expect(withChange).toContain("적용 안 함");
  });

  it("class_update: 사유(note)가 있으면 뒤에 붙인다 — 종강·폐지 반 이름 비우기(2026-10-01)", () => {
    const note = "종강 처리된 반이 쥔 이름을 비움";
    expect(
      auditDetail("class_update", { changes: [{ field: "반 이름", from: "PL5", to: "PL5 (~2026-07)" }], note }, ctx()),
    ).toBe(`변경: 반 이름 PL5 → PL5 (~2026-07) · ${note}`);
  });

  it("🔴 미등록 액션 폴백은 영문 키·값을 내보내지 않는다(2026-08-20 정책 변경)", () => {
    // 종전엔 `foo: bar`를 그대로 뱉었다 — 감사 화면 raw 코드 노출의 뿌리. 이제 모르는 키는 숨긴다
    // (원문 JSON은 뷰어 title 툴팁이 항상 보존).
    expect(auditDetail("future_action", { foo: "bar", id: SID }, ctx())).toBeNull();
    expect(auditDetail("future_action", { foo: "bar", id: SID }, ctx({ [SID]: "이윤건" }))).toBe("이윤건");
    expect(auditDetail("future_action", null, ctx())).toBeNull();
  });

  it("폴백이라도 사람이 읽는 값(한글 문장·날짜·이메일·공통 키)은 살린다", () => {
    // 무조건 버리는 게 아니다 — 뜻이 분명한 공통 키는 한글 라벨로, 한글 문장·날짜는 키 없이 값만.
    expect(auditDetail("future_action", { note: "원장 지시로 임시 개방", slot: "observer" }, ctx())).toBe(
      "원장 지시로 임시 개방",
    );
    expect(auditDetail("future_action", { date: "2026-08-19", enabled: true }, ctx())).toBe("날짜 2026-08-19");
    expect(auditDetail("future_action", { whateverKey: "2026-08-19" }, ctx())).toBe("2026-08-19");
    expect(auditDetail("future_action", { email: "a@x.com" }, ctx())).toBe("a@x.com");
    expect(auditDetail("future_action", { className: "중등M 중2" }, ctx())).toBe("중등M 중2");
    expect(auditDetail("future_action", { reason: "이사" }, ctx())).toBe("사유 이사");
  });
});

describe("collectAuditNameIds / auditTargetName", () => {
  it("studentId는 students로, userId·newTeacherId·delegateUserId는 users로, classId는 classes로 — 중복 제거", () => {
    const CID = "99999999-8888-7777-6666-555555555555";
    const rows = [
      { metadata: { studentId: SID } },
      { metadata: { studentId: SID, userId: UID } },
      { metadata: { newTeacherId: UID } },
      // 담임 위임 로그 — 이 키가 빠지면 위임 상세의 강사 이름이 영영 해석 안 된다(적대 리뷰 2026-08-18).
      { metadata: { delegateUserId: UID } },
      { metadata: { classId: CID } },
      { metadata: { studentId: "not-a-uuid" } },
      { metadata: null },
    ];
    expect(collectAuditNameIds(rows)).toEqual({ studentIds: [SID], userIds: [UID], classIds: [CID] });
  });

  it("scopeTeacherId(출석부 강사 보기)도 users로 — 상세엔 '강사 보기: 이름', uuid는 안 보인다", () => {
    expect(collectAuditNameIds([{ metadata: { studentId: SID, scopeTeacherId: UID } }])).toEqual({
      studentIds: [SID],
      userIds: [UID],
      classIds: [],
    });
    for (const action of ["attendance_cell", "attendance_range"]) {
      const d = auditDetail(
        action,
        { studentId: SID, date: "2026-09-10", units: 4, scopeTeacherId: UID },
        ctx({ [SID]: "이윤건", [UID]: "Charlie" }),
      );
      expect(d, action).toContain("강사 보기: Charlie");
      expect(d, action).not.toContain(UID);
    }
    // 이름을 못 구하면 uuid를 내보내지 않고 접는다.
    expect(auditDetail("attendance_cell", { scopeTeacherId: UID }, ctx())).toBeNull();
  });

  it("건너뛴 자리 기록(skippedSeatRows)은 한글 라벨로 — 영문 키를 흘리지 않는다(원장 2026-09-12)", () => {
    const d = auditDetail(
      "attendance_cell",
      { studentId: SID, date: "2026-09-10", scopeTeacherId: UID, skippedSeatRows: 1 },
      ctx({ [SID]: "이윤건", [UID]: "Charlie" }),
    );
    expect(d).toContain("건너뛴 자리 기록 1");
    expect(d).not.toContain("skippedSeatRows");
  });

  it("빗금 칸 입력(ghostTransfer)은 한글로 — 영문 키를 흘리지 않는다(원장 2026-09-14)", () => {
    const d = auditDetail(
      "attendance_cell",
      { studentId: SID, date: "2026-09-14", status: "present", prevStatus: "absent", overwrote: true, ghostTransfer: 2 },
      ctx({ [SID]: "이윤건" }),
    );
    expect(d).toContain("결석 → 출석");
    expect(d).toContain("다른 선생님 교시에 상태만 옮김 2건");
    expect(d).not.toContain("ghostTransfer");
    expect(auditDetail("attendance_cell", { date: "2026-09-14", ghostTransfer: 1, partial: true }, ctx())).toContain(
      "일부만 저장(오류로 멈춤)",
    );
  });

  it("시수는 '얼마에서 얼마로' — 칸에 보이는 값(nextUnits)이 친 값(units)보다 먼저다(원장 2026-09-14)", () => {
    const cell = (m: Record<string, unknown>) =>
      auditDetail("attendance_cell", { studentId: SID, date: "2026-09-14", status: "present", ...m }, ctx());
    // 원장 사례 — 영어 3교시 칸을 1.5로 정정.
    expect(cell({ units: 1.5, prevUnits: 3, nextUnits: 1.5, overwrote: true })).toContain("시수 3 → 1.5");
    /**
     * 🔴 교시가 여럿인 칸에 '1'(교시마다 기본)을 치면 칸은 **2**가 된다 — `units`(친 값)를 적으면 "3 → 1"이라는
     *    거짓이 남는다. `nextUnits`가 이겨야 한다(적대 리뷰 2026-09-14).
     */
    const basic = cell({ units: null, prevUnits: 3, nextUnits: 2, overwrote: true });
    expect(basic).toContain("시수 3 → 2");
    expect(basic).not.toContain("→ 1");
  });

  it("nextUnits가 없는 옛 로그는 종전대로 — 저장 규약상 1은 null이라 '1'로 읽는다", () => {
    // 원장이 지금 하는 작업(1.5 → 1). `num()`만 쓰면 이 칸이 숫자 없이 남는다.
    expect(
      auditDetail(
        "attendance_cell",
        { studentId: SID, date: "2026-09-14", status: "present", units: null, prevUnits: 1.5, overwrote: true },
        ctx(),
      ),
    ).toContain("시수 1.5 → 1");
    // 시수를 아예 안 건드린 저장엔 시수 문구가 없다.
    expect(auditDetail("attendance_cell", { studentId: SID, date: "2026-09-14", status: "absent" }, ctx())).not.toContain(
      "시수",
    );
  });

  it("반 이름을 '대상' 열과 겹쳐 적지 않는다 — 일괄·범위는 대상이 이미 반 이름이다", () => {
    const names = ctx({ [SID]: "이윤건", [CID]: "중등M TP2A" });
    // 단건 셀은 대상 열이 **학생 이름**이라(studentId) 어느 반 수업인지를 상세가 적어야 한다.
    expect(
      auditDetail("attendance_cell", { studentId: SID, classId: CID, date: "2026-09-14", status: "present" }, names),
    ).toContain("중등M TP2A");
    // 범위는 studentId가 없어 대상 열이 반 이름이다 — 또 적으면 같은 이름이 두 번 뜬다.
    expect(
      auditDetail(
        "attendance_range",
        { classId: CID, studentIds: [SID], dates: ["2026-09-14"], status: "present", count: 3 },
        names,
      ),
    ).not.toContain("중등M TP2A");
  });

  it("상태도 '얼마에서 얼마로' 적는다 — 정정은 무엇이 무엇으로 바뀌었는지가 값이다", () => {
    expect(
      auditDetail(
        "attendance_cell",
        { studentId: SID, date: "2026-09-14", status: "absent", prevStatus: "present", overwrote: true },
        ctx(),
      ),
    ).toContain("출석 → 결석");
    // 공결·결석은 같은 '결석'으로 접힌다 — `결석 → 결석`이라 적지 않는다.
    expect(
      auditDetail(
        "attendance_cell",
        { studentId: SID, date: "2026-09-14", status: "absent", prevStatus: "excused", overwrote: true },
        ctx(),
      ),
    ).not.toContain("→");
  });

  it("범위 채우기는 '몇 칸의 합'인지 적는다 — 안 적으면 한 칸 값으로 읽힌다", () => {
    const d = auditDetail(
      "attendance_range",
      { studentIds: [SID], dates: ["2026-09-14"], status: "present", count: 20, units: 1.5, prevUnits: 6, nextUnits: 4.5, unitsChangedCells: 3 },
      ctx(),
    );
    expect(d).toContain("시수 3칸 6 → 4.5");
    expect(d).not.toContain("unitsChangedCells");
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

describe("auditDetail — 셔틀(0225a)은 영문 enum을 그대로 내보내지 않는다", () => {
  // 🔴 이 케이스들이 없으면 기본 폴백이 `ioKind: in` · `status: missed` · `season: term`을
  //    영문 그대로 화면에 뱉는다(raw 코드 노출 금지 — 2026-08-17 원장 제보와 같은 증상).
  const noEnglishEnum = (v: string | null) => {
    expect(v).toBeTruthy();
    expect(v, `영문 enum이 새어나옴: ${v}`).not.toMatch(/\b(in|out|term|vacation|missed|boarded|extra)\b/);
  };

  it("정류장 추가·수정은 이름을 보여준다", () => {
    expect(auditDetail("shuttle_stop_create", { name: "빌리브루센트 앞" }, ctx())).toBe(
      "정류장 「빌리브루센트 앞」",
    );
  });

  it("회차 추가는 시즌·회차를 한글로", () => {
    const v = auditDetail("shuttle_run_create", { season: "vacation", runNo: 3 }, ctx());
    expect(v).toBe("방학중 3회차");
    noEnglishEnum(v);
  });

  it("회차 수정은 등원/하원을 한글로", () => {
    const v = auditDetail("shuttle_run_update", { direction: "out" }, ctx());
    expect(v).toBe("하원으로 변경");
    noEnglishEnum(v);
  });

  it("배정은 승/하차 + 요일 압축", () => {
    const v = auditDetail(
      "shuttle_rider_assign",
      { ioKind: "in", weekdays: ["mon", "wed", "thu"] },
      ctx(),
    );
    expect(v).toBe("승차 · 월수목");
    noEnglishEnum(v);
  });

  it("등하원 기록은 날짜 + 상태를 한글로", () => {
    const v = auditDetail("shuttle_boarding_record", { boardedOn: "2026-08-19", status: "missed" }, ctx());
    expect(v).toBe("2026-08-19 · 미탑승");
    noEnglishEnum(v);
  });

  it("정류장 제거는 함께 해제된 배정 수를 알린다(조용한 데이터 손실 방지)", () => {
    expect(auditDetail("shuttle_run_stop_remove", { riders: 3 }, ctx())).toBe("배정 3명 함께 해제");
    expect(auditDetail("shuttle_run_stop_remove", { riders: 0 }, ctx())).toBe("정류장 제거");
  });
});

describe("auditDetail — 시간표 연습본 저장(개인 사본)", () => {
  it("규모만 한글로 적고 식별자·영문 키는 싣지 않는다", () => {
    const meta = { draftId: SID, lessonCount: 12, classCount: 5, studentCount: 31, referenceDate: "2026-09-28" };
    expect(auditDetail("timetable_lab_draft_save", meta, ctx())).toBe("개인 연습본 · 반 5개 · 수업 12개 · 학생 31명");
    expect(auditDetail("timetable_lab_draft_save", {}, ctx())).toBe("개인 연습본");
    expect(auditDetail("timetable_lab_draft_overwrite", meta, ctx())).toBe("개인 연습본 · 반 5개 · 수업 12개 · 학생 31명");
    expect(auditDetail("timetable_lab_draft_delete", meta, ctx())).toBe("개인 연습본 · 반 5개 · 수업 12개 · 학생 31명");
    expect(AUDIT_TYPE_LABEL.timetable_lab_draft).toBe("시간표 연습본");
  });
});

describe("auditDetail — 데이터 정리 도구(2026-10-06)", () => {
  it("enrollment_orphan_close: 몇 건을 언제 처리했는지 — 종료일은 수강마다 달라 '처리일'로 적는다", () => {
    expect(auditDetail("enrollment_orphan_close", { count: 12, processedOn: "2026-10-06" }, ctx())).toBe(
      "12건 (관리 도구 · 퇴원 학생의 남은 수강) · 처리일 2026-10-06",
    );
    // 아직 시작 전이던 수강은 처리일이 아니라 그 시작일로 닫힌다 — 그 건수를 따로 적는다.
    expect(auditDetail("enrollment_orphan_close", { count: 12, processedOn: "2026-10-06", futureCount: 2 }, ctx())).toBe(
      "12건 (관리 도구 · 퇴원 학생의 남은 수강) · 처리일 2026-10-06 · 시작 전 수강 2건은 시작일로 종료",
    );
    expect(auditDetail("enrollment_orphan_close", {}, ctx())).toBeNull();
  });

  it("enrollment_orphan_close: 중간에 멈춘 것과 응답을 받지 못한 것(적용 여부 미확인)을 구별해 적는다", () => {
    expect(auditDetail("enrollment_orphan_close", { count: 7, processedOn: "2026-10-06", partial: true }, ctx())).toBe(
      "7건 (관리 도구 · 퇴원 학생의 남은 수강) · 처리일 2026-10-06 · 중간에 멈춤",
    );
    expect(auditDetail("enrollment_orphan_close", { count: 0, processedOn: "2026-10-06", partial: true, uncertain: true }, ctx())).toBe(
      "0건 (관리 도구 · 퇴원 학생의 남은 수강) · 처리일 2026-10-06 · 응답을 받지 못함(적용 여부 미확인)",
    );
  });

  it("student_merge: 끝난 병합은 종전 그대로, 중간에 멈춘 병합은 멈춘 자리를 함께 적는다", () => {
    const names = ctx({ [SID]: "권민서A" });
    expect(auditDetail("student_merge", { studentId: SID, mergedName: "권민서B", mergedRows: 34 }, names)).toBe("권민서A · ← 권민서B 병합");
    expect(
      auditDetail("student_merge", { studentId: SID, mergedName: "권민서B", mergedRows: 32, partial: true, failedStep: "청구 기록 옮기기" }, names),
    ).toBe("권민서A · ← 권민서B 병합 · 중간에 멈춤(청구 기록 옮기기)");
    expect(auditDetail("student_merge", { studentId: SID, mergedName: "권민서B", partial: true }, names)).toBe("권민서A · ← 권민서B 병합 · 중간에 멈춤");
  });

  it("student_merge: 응답을 받지 못한 단계는 '멈췄다'가 아니라 적용 여부를 모른다고 적는다", () => {
    const names = ctx({ [SID]: "권민서A" });
    expect(
      auditDetail(
        "student_merge",
        { studentId: SID, mergedName: "권민서B", mergedRows: 0, partial: true, uncertain: true, failedStep: "수강 기록 옮기기" },
        names,
      ),
    ).toBe("권민서A · ← 권민서B 병합 · 응답을 받지 못함(수강 기록 옮기기) — 적용 여부 미확인");
  });
});

describe("AUDIT_TYPE_LABEL", () => {
  it("logAction 호출부의 모든 target_type이 한글 라벨을 가진다", () => {
    // logAction 전수(2026-07-11 grep) + 실 DB target_type 전수(2026-08-03) — 후자에서 user·users·
    // academy_documents가 라벨 없이 영문으로 노출되고 있었다. 새 targetType은 여기와 AUDIT_TYPE_LABEL에 함께 추가.
    // 2026-08-17 재전수(grep `targetType:`) — attendance·lesson_report·approval_document·
    // enrollment_consultations·document 5종이 라벨 없이 영문 노출되고 있었다(원장 제보: "attendance 공민규").
    const usedTypes = [
      "staff", "student", "invoice", "exam", "payroll", "class", "classroom",
      "tenant_settings", "staff_resume", "intake_token", "notice_popup",
      "user", "users", "academy_documents", "classnote_notice", "operating_periods",
      "attendance", "lesson_report", "approval_document", "enrollment_consultations", "document",
      // 2026-08-19 셔틀(0225a) — targetType "shuttle".
      "shuttle",
      // 2026-08-20 캘린더(0218a) — 일정 삭제 로그의 대상이 영문 "calendar_event"로 떠 있었다.
      // ⚠️ 이 수기 목록은 늘 늦는다 — 전수 스캔 가드는 actions-registry.test.ts("대상 유형 라벨")에 있다.
      "calendar_event",
      "calendar_tag",
      // 2026-08-25 회의록·학생상담 — 이 두 영역은 애초에 logAction이 0이라 target_type도 없었다.
      "meeting",
      "student_consultation",
      // 2026-09-22 성적관리 개편 — 저장 대상이 시험 행이 아니라 `학기·과목·시험 칸` 격자다.
      "grades",
      "demo_roster",
    ];
    for (const t of usedTypes) expect(AUDIT_TYPE_LABEL[t], t).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────
// 2026-08-20 원장 지시("알기 쉽게 변경") — 감사 화면에 영문 키·enum·스크립트 식별자가 날것으로 떴다.
// 아래 metadata는 **실 DB 표본**이다(추측 아님). 여기 없는 필드를 지어내지 말 것.
// ─────────────────────────────────────────────────────────────────────────────────────
const DOC = "12121212-3434-5656-7878-909090909090";
const DOC2 = "21212121-4343-6565-8787-090909090909";
const CID = "99999999-8888-7777-6666-555555555555";
const names = { [SID]: "김승언", [UID]: "김강사", [CID]: "초등M 초4 BS1J" };

describe("auditDetail — 2026-08-20 신규 case (실데이터 metadata 표본)", () => {
  it("수업 평가: slot·observerMode·areas/items를 영문으로 내보내지 않는다", () => {
    expect(auditDetail("class_review_submit", { slot: "observer", docId: DOC, answered: 25 }, ctx())).toBe(
      "관찰자 채점 · 문항 25개 응답",
    );
    expect(auditDetail("class_review_submit", { slot: "self", docId: DOC, answered: 25 }, ctx())).toBe(
      "본인 채점 · 문항 25개 응답",
    );
    expect(
      auditDetail(
        "class_review_create",
        { date: "2026-08-19", assigned: 3, template: "EiE 수업평가", observerMode: "assigned", observerLimit: 3 },
        ctx(),
      ),
    ).toBe("2026-08-19 · 평가자 지정 3명 · 문항 「EiE 수업평가」");
    // 선착순 모드는 **정원**이 읽을 값이다(지정 인원이 아니라).
    expect(
      auditDetail(
        "class_review_create",
        { date: "2026-08-19", assigned: 0, template: "기본 문항", observerMode: "open", observerLimit: 3 },
        ctx(),
      ),
    ).toBe("2026-08-19 · 선착순 3명 · 문항 「기본 문항」");
    expect(auditDetail("class_review_template_save", { areas: 6, items: 31, created: false }, ctx())).toBe(
      "문항 세트 수정 · 영역 6개 · 문항 31개",
    );
    expect(auditDetail("class_review_template_save", { areas: 6, items: 31, created: true }, ctx())).toBe(
      "문항 세트 생성 · 영역 6개 · 문항 31개",
    );
    expect(auditDetail("class_review_delete", { docId: DOC }, ctx())).toBeNull();
  });

  it("전자결재: decision enum은 approvals/types 라벨로, 양식마다 다른 metadata를 견딘다", () => {
    expect(
      auditDetail("approval_decide", { step: 1, docId: DOC, proxy: false, decision: "final", deferred: 0 }, ctx()),
    ).toBe("전결 · 1번째 결재란");
    expect(
      auditDetail("approval_decide", { step: 2, docId: DOC, proxy: true, decision: "approved", deferred: 1 }, ctx()),
    ).toBe("승인 · 2번째 결재란 · 대결 · 앞 단계 1칸을 후결로 넘김");
    expect(auditDetail("approval_decide", { docId: DOC, postApproval: true }, ctx())).toBe("후결 확인");
    // 휴가 양식
    expect(
      auditDetail(
        "approval_submit",
        { days: 1, period: "2026-01-02 ~ 2027-01-01", granted: 100, remaining: 99 },
        ctx(),
      ),
    ).toBe("1일 사용 · 연차 100일 중 잔여 99일 · 기간 2026-01-02 ~ 2027-01-01");
    // 지출·수입결의서 — ⚠️ 없는 필드를 "없음"으로 지어내지 않는다
    expect(auditDetail("approval_submit", { amount: 120000, spendDate: "2026-08-10", category: "운영비" }, ctx())).toBe(
      "120,000원 · 지출일 2026-08-10 · 운영비",
    );
    expect(auditDetail("approval_submit", { amount: 50000, incomeDate: "2026-08-11", category: "교재 판매" }, ctx())).toBe(
      "50,000원 · 수입일 2026-08-11 · 교재 판매",
    );
    // 품의서는 auditMetadata 자체가 없다 → 상세 없음(대상 열이 제목을 보여준다)
    expect(auditDetail("approval_submit", null, ctx())).toBeNull();
    expect(auditDetail("approval_withdraw", null, ctx())).toBeNull();
  });

  it("보강 빼기: 과목은 학원설정 라벨, 지워진 것만 적는다", () => {
    expect(
      auditDetail(
        "makeup_remove",
        {
          date: "2026-08-18",
          classId: CID,
          subject: "math",
          studentId: SID,
          deletedReports: 0,
          attendanceRemoved: true,
          rolledBackProgress: 0,
        },
        ctx(names),
      ),
    ).toBe("초등M 초4 BS1J · 2026-08-18 · 수학 · 출결 보강 칸 삭제");
    expect(
      auditDetail(
        "makeup_remove",
        { date: "2026-08-18", classId: CID, subject: "english", studentId: SID, deletedReports: 2, attendanceRemoved: false, rolledBackProgress: 1 },
        ctx(names),
      ),
    ).toBe("초등M 초4 BS1J · 2026-08-18 · 영어 · 수업보고서 2건 삭제 · 진도 1건 되돌림");
  });

  it("세션 기간·상담 병합: 대상 열이 못 보여주는 것만 덧붙인다", () => {
    expect(auditDetail("operating_periods_save", { year: 2026, count: 12, classId: null, subjectKey: "english" }, ctx())).toBe(
      "세션 12건",
    );
    expect(auditDetail("operating_periods_save", { year: 2026, count: 4, classId: CID, subjectKey: "math" }, ctx(names))).toBe(
      "반 초등M 초4 BS1J · 세션 4건",
    );
    expect(
      auditDetail(
        "consultation_merge",
        { winnerId: DOC, loserIds: [DOC2], discarded: [{ field: "연락처", values: ["010-0000-0000"] }], result: {} },
        ctx(),
      ),
    ).toBe("상담 1건 병합 · 버린 값: 연락처");
  });

  it("직원 등록·QR: 역할은 한글, 이메일은 그대로(staff_email_change 선례)", () => {
    expect(auditDetail("staff_intake_token_create", { role: "teacher" }, ctx())).toBe("기본 역할 강사");
    expect(auditDetail("staff_intake_token_create", { action: "rotate" }, ctx())).toBe(
      "새 링크 재발급(옛 링크 폐기)",
    );
    expect(auditDetail("staff_intake_token_toggle", { action: "close" }, ctx())).toBe("링크 닫기");
    expect(
      auditDetail(
        "staff_create_from_resume",
        { role: "teacher", email: "kim@x.com", userId: UID, resumeId: DOC, autoEmail: true },
        ctx(),
      ),
    ).toBe("강사 · kim@x.com · 아이디 자동 생성");
    expect(
      auditDetail(
        "staff_create_from_intake",
        { role: "teacher", email: "a@x.com", userId: UID, resumeId: DOC, tokenName: "QA 테스트 QR" },
        ctx(),
      ),
    ).toBe("강사 · a@x.com · QR 「QA 테스트 QR」");
    // 스크립트가 남긴 행(AUDIT_ACTIONS 라벨도 함께 추가됐다)
    expect(
      auditDetail(
        "staff_create",
        { via: "script", email: "t@x.com", purpose: "계약서 PDF 테스트(원장 지시 2026-08-03)" },
        ctx(),
      ),
    ).toBe("t@x.com · 계약서 PDF 테스트(원장 지시 2026-08-03)");
    expect(auditDetail("staff_delete", { via: "script", docs: 3 }, ctx())).toBe("문서 3건 함께 삭제");
    expect(auditDetail("staff_link_from_resume", { resumeId: DOC, userId: UID, filled: ["bankName", "phone"] }, ctx())).toBe(
      "이력서에서 항목 2개 채움",
    );
    expect(auditDetail("staff_roster_import", { createdIds: [UID], sheetTab: "2026 직원명부" }, ctx())).toBe(
      "시트 「2026 직원명부」",
    );
  });

  it("회의록: 제목은 대상 열이 보여주므로 상세엔 되찾을 수 없는 것만", () => {
    // 녹음 업로드 — 원장이 감사로그에서 찾던 그 줄.
    expect(
      auditDetail(
        "meeting_create_audio",
        { meetingId: DOC, sizeBytes: 12_582_912, attendees: 5, heldAt: "2026-08-25", notepadChars: 320 },
        ctx(),
      ),
    ).toBe("회의일 2026-08-25 · 녹음 12.0MB · 참석 5명 · 메모 320자");
    expect(
      auditDetail(
        "meeting_create_text",
        { meetingId: DOC, notepadChars: 1240, attendees: 3, heldAt: "2026-08-25" },
        ctx(),
      ),
    ).toBe("회의일 2026-08-25 · 메모 1,240자 · 참석 3명");
    // 삭제 — 무엇이 사라졌는지가 이 로그의 존재 이유(본문은 없다, 분량·모델만).
    expect(
      auditDetail(
        "meeting_delete",
        {
          meetingId: DOC,
          heldAt: "2026-08-20",
          hadAudio: true,
          audioRemoved: true,
          audioDurationSec: 750,
          transcriptChars: 4880,
          hadReport: true,
          model: "deepseek-v4-pro-2026-07-16",
        },
        ctx(),
      ),
    ).toBe(
      "회의일 2026-08-20 · 녹음 파일 함께 삭제 (12분 30초) · 전사 4,880자 · AI 분석 있었음 · DeepSeek v4-pro · 삭제됨(복구 불가)",
    );
    // 옛 ijw 공유 경로는 파일을 안 지운다 — 그 사실이 로그에도 갈리게.
    expect(
      auditDetail(
        "meeting_delete",
        { meetingId: DOC, heldAt: "2026-05-02", hadAudio: true, audioRemoved: false, transcriptChars: 0, hadReport: false },
        ctx(),
      ),
    ).toBe("회의일 2026-05-02 · 녹음 파일은 보존 · 삭제됨(복구 불가)");
  });

  it("회의록 재실행: 직전 상태를 한글로 — 완료된 건 재전사가 곧 낭비 사례", () => {
    expect(
      auditDetail("meeting_retry_transcribe", { meetingId: DOC, fromStatus: "failed", transcriptChars: 0 }, ctx()),
    ).toBe("직전 상태: 실패 · 원본 녹음을 외부 전사에 재제출");
    expect(
      auditDetail("meeting_retry_transcribe", { meetingId: DOC, fromStatus: "completed", transcriptChars: 4880 }, ctx()),
    ).toBe("직전 상태: 완료 · 원본 녹음을 외부 전사에 재제출 · 기존 전사 4,880자 있음");
    expect(
      auditDetail("meeting_regenerate_analysis", { meetingId: DOC, transcriptChars: 4880, notepadChars: 0 }, ctx()),
    ).toBe("전사 4,880자");
  });

  it("회의록 수정: 이전 제목·화자 연결·섹션 라벨", () => {
    expect(auditDetail("meeting_title_update", { meetingId: DOC, from: "8월 정기회의" }, ctx())).toBe(
      "이전 제목 「8월 정기회의」",
    );
    // 이전 제목을 못 구했으면(행이 그 사이 사라짐) 지어내지 않는다 — 새 제목은 대상 열에 있다.
    expect(auditDetail("meeting_title_update", { meetingId: DOC, from: null }, ctx())).toBeNull();
    expect(auditDetail("meeting_speakers_update", { meetingId: DOC, speakers: 3, linked: 2 }, ctx())).toBe(
      "화자 3명 표시명 지정 · 직원 연결 2명",
    );
    expect(auditDetail("meeting_speakers_update", { meetingId: DOC, speakers: 0, linked: 0 }, ctx())).toBe(
      "화자 표시·직원 연결 모두 해제",
    );
    expect(
      auditDetail("meeting_report_edit", { meetingId: DOC, section: "actionItems", chars: 412 }, ctx()),
    ).toBe("「액션 아이템」 섹션 · 수정 후 412자");
    // 미등록 섹션 키는 표기 생략(영문 원문을 흘리지 않는다)
    expect(auditDetail("meeting_report_edit", { meetingId: DOC, section: "future", chars: 10 }, ctx())).toBe(
      "수정 후 10자",
    );
  });

  it("학생상담: 분류·대상·후속조치만 — 요약 본문은 metadata에 애초에 없다", () => {
    const meta = {
      consultationId: DOC,
      studentId: SID,
      consultedAt: "2026-08-25",
      category: "academic",
      audience: "parent",
      hasFollowUp: true,
      followUpDate: "2026-09-01",
    };
    expect(auditDetail("student_consultation_create", meta, ctx(names))).toBe(
      "상담일 2026-08-25 · 학습 · 대상 학부모 · 후속조치 2026-09-01까지",
    );
    expect(auditDetail("student_consultation_update", meta, ctx(names))).toBe(
      "상담일 2026-08-25 · 학습 · 대상 학부모 · 후속조치 2026-09-01까지",
    );
    expect(
      auditDetail(
        "student_consultation_delete",
        { consultationId: DOC, studentId: SID, consultedAt: "2026-08-11", category: "emotional", audience: "both", hasFollowUp: false },
        ctx(names),
      ),
    ).toBe("상담일 2026-08-11 · 정서 · 대상 학부모+학생 · 삭제됨(복구 불가)");
    expect(auditDetail("student_consultation_follow_up", { consultationId: DOC, studentId: SID, done: true }, ctx())).toBe(
      "완료로 표시",
    );
    // 반(0318a) — 판정한 저장만 반을 말한다. 바뀌면 이전 → 지금, 사람이 비운 반은 '없음(직접 고름)'.
    expect(
      auditDetail("student_consultation_create", { ...meta, classId: CID, className: "초등M 초4 BS1J", classPick: "auto" }, ctx(names)),
    ).toBe("상담일 2026-08-25 · 학습 · 대상 학부모 · 후속조치 2026-09-01까지 · 반 초등M 초4 BS1J(자동)");
    expect(
      auditDetail(
        "student_consultation_update",
        { ...meta, classId: null, className: null, classPick: "manual", prevClassId: CID, prevClassName: null },
        ctx(names),
      ),
    ).toBe("상담일 2026-08-25 · 학습 · 대상 학부모 · 후속조치 2026-09-01까지 · 반 초등M 초4 BS1J → 없음(직접 고름)");
    expect(
      auditDetail("student_consultation_class_backfill", { count: 1902, mapped: 678, reasons: { "반 하나로 좁혀짐": 678, "상담사가 가르치는 반 없음": 990 } }, ctx()),
    ).toBe("상담 1902건 판정 · 반 연결 678건 · 반 하나로 좁혀짐 678, 상담사가 가르치는 반 없음 990");
    expect(auditDetail("student_consultation_follow_up", { consultationId: DOC, studentId: SID, done: false }, ctx())).toBe(
      "완료 해제",
    );
    // 미등록 분류·대상은 **표기 생략**(영문 원문 노출 금지)
    expect(
      auditDetail("student_consultation_create", { consultationId: DOC, studentId: SID, category: "future", audience: "future" }, ctx()),
    ).toBeNull();
  });

  it("AI 케어 분석: 모델은 친화 라벨, 원시 id는 안 나온다", () => {
    expect(auditDetail("student_care_analysis", { studentId: SID, model: "claude-sonnet-5", focus: 3 }, ctx(names))).toBe(
      "케어 포인트 3건 · Claude Sonnet 5",
    );
    // 알 수 없는 모델은 미표시(raw 코드 노출 금지 — modelDisplayLabel 규약)
    expect(auditDetail("student_care_analysis", { studentId: SID, model: "some-future-llm", focus: 2 }, ctx())).toBe(
      "케어 포인트 2건",
    );
  });

  it("owner_settings_update: 스크립트가 남긴 한글 note를 버리지 않는다", () => {
    // 종전엔 section만 봐서 스크립트 행이 통째로 "설정 저장"으로 뭉갰다(원장 제보 줄의 마지막 사례).
    const note = "수업 평가(class_review) 개방 — 원장직급(master) + 개인 이승엽·정유진(원장 지시 2026-08-13 테스트)";
    expect(
      auditDetail("owner_settings_update", { menu: "class_review", note, roles: ["master"], users: [], revoke: false }, ctx()),
    ).toBe(note);
    expect(
      auditDetail("owner_settings_update", { via: "script:narrow-staff-menu", grants: ["설현", "이승엽", "김예원", "오은진", "엄소윤"] }, ctx()),
    ).toBe("개인 예외 5명 (설현, 이승엽, 김예원 외)");
    // section이 있으면 종전과 동일(회귀 방지)
    expect(auditDetail("owner_settings_update", { section: "permissions" }, ctx())).toBe(
      "「역할별 메뉴 권한」 설정 저장",
    );
  });
});

/**
 * 🔴 다음 사람이 case를 빼먹어도 걸리게 — **실 DB 표본 전수**를 auditDetail에 통과시키고
 * 결과에 `slot:`·`decision:` 같은 **영문 키 패턴**과 매핑 대상 **영문 enum 값**이 없음을 검사한다.
 */
describe("🔴 감사 상세에 영문이 새지 않는다(실표본 전수)", () => {
  const KEY_LEAK = /[A-Za-z][A-Za-z0-9_]*:\s/;
  const SAMPLES: Array<{ action: string; meta: Record<string, unknown> | null; banned?: string[] }> = [
    { action: "class_review_submit", meta: { slot: "observer", docId: DOC, answered: 25 }, banned: ["observer", "answered"] },
    { action: "class_review_submit", meta: { slot: "self", docId: DOC, answered: 25 }, banned: ["self", "answered"] },
    {
      action: "class_review_create",
      meta: { date: "2026-08-19", assigned: 3, template: "EiE 수업평가", observerMode: "assigned", observerLimit: 3 },
      banned: ["assigned", "observerMode", "observerLimit"],
    },
    { action: "class_review_template_save", meta: { areas: 6, items: 31, created: false }, banned: ["areas", "items", "created", "false"] },
    { action: "class_review_delete", meta: { docId: DOC } },
    { action: "class_review_template_delete", meta: { templateId: DOC } },
    { action: "approval_decide", meta: { step: 1, docId: DOC, proxy: false, decision: "final", deferred: 0 }, banned: ["final", "decision", "proxy", "deferred", "step"] },
    { action: "approval_decide", meta: { docId: DOC, postApproval: true }, banned: ["postApproval", "true"] },
    { action: "approval_submit", meta: { days: 1, period: "2026-01-02 ~ 2027-01-01", granted: 100, remaining: 99 }, banned: ["days", "granted", "remaining", "period"] },
    { action: "approval_submit", meta: { amount: 120000, spendDate: "2026-08-10", category: "운영비" }, banned: ["amount", "spendDate", "category"] },
    { action: "approval_withdraw", meta: null },
    {
      action: "leave_adjust",
      meta: { days: 3, before: 15, after: 18, period: "2026-01-02 ~ 2027-01-01", reason: "2025년도 미사용 연차 이월" },
      banned: ["days", "before", "after", "period", "reason"],
    },
    {
      action: "leave_adjust_delete",
      meta: { days: -1.5, after: 15, period: "2026-01-02 ~ 2027-01-01", reason: "정산 차감 취소" },
      banned: ["days", "after", "period", "reason"],
    },
    { action: "approval_comment", meta: { docId: DOC } },
    { action: "approval_comment_delete", meta: { commentId: DOC2, docId: DOC } },
    {
      action: "makeup_remove",
      meta: { date: "2026-08-18", classId: CID, subject: "math", studentId: SID, deletedReports: 0, attendanceRemoved: true, rolledBackProgress: 0 },
      banned: ["math", "subject", "attendanceRemoved", "deletedReports", "rolledBackProgress", "true"],
    },
    { action: "operating_periods_save", meta: { year: 2026, count: 12, classId: null, subjectKey: "english" }, banned: ["english", "subjectKey", "count", "year"] },
    { action: "consultation_merge", meta: { winnerId: DOC, loserIds: [DOC2], discarded: [{ field: "연락처", values: ["x"] }], result: {} }, banned: ["winnerId", "loserIds", "discarded", "result"] },
    { action: "staff_intake_token_create", meta: { role: "teacher" }, banned: ["teacher", "role"] },
    { action: "staff_intake_token_create", meta: { action: "rotate" }, banned: ["rotate"] },
    { action: "staff_intake_token_toggle", meta: { action: "close" }, banned: ["close"] },
    { action: "staff_create", meta: { via: "script", email: "t@x.com", purpose: "계약서 PDF 테스트" }, banned: ["via", "purpose"] },
    { action: "staff_create_from_resume", meta: { role: "teacher", email: "kim@x.com", userId: UID, resumeId: DOC, autoEmail: true }, banned: ["teacher", "autoEmail", "resumeId"] },
    { action: "staff_create_from_intake", meta: { role: "teacher", email: "a@x.com", userId: UID, resumeId: DOC, tokenName: "QA 테스트 QR" }, banned: ["teacher", "tokenName", "resumeId"] },
    { action: "staff_link_from_resume", meta: { resumeId: DOC, userId: UID, filled: ["bankName", "phone"] }, banned: ["bankName", "filled"] },
    { action: "staff_roster_import", meta: { createdIds: [UID], sheetTab: "2026 직원명부" }, banned: ["sheetTab", "createdIds"] },
    { action: "staff_roster_import_revert", meta: { revertedLog: "C:/eywa/scripts/logs/import-2026.json" }, banned: ["revertedLog", "json"] },
    { action: "classnote_offboard", meta: { studentId: UID, childId: 5611926, childName: "박예서", baseDate: "2026-09-04", days: 60, posts: 3, backupPath: "t/offboard/2026-11-03/5611926.json" }, banned: ["backupPath", "json", "5611926", "studentId"] },
    { action: "classnote_offboard_unconfirmed", meta: { studentId: UID, childId: 5611926, childName: "박예서", days: 60, outcome: "unconfirmed", why: "재원 명부에서는 빠졌는데 퇴소 명부에서 찾지 못했습니다(확인 필요)", backupPath: "t/offboard/2026-11-03/5611926.json" }, banned: ["backupPath", "json", "5611926", "studentId", "unconfirmed"] },
    { action: "teacher_view_impersonate", meta: { targetUserId: UID }, banned: ["targetUserId"] },
    { action: "resume_view_unlock", meta: { resumeId: DOC }, banned: ["resumeId"] },
    { action: "shuttle_rider_remove", meta: { riderId: DOC }, banned: ["riderId"] },
    { action: "shuttle_rider_move", meta: { riderId: DOC, toRunStopId: DOC2 }, banned: ["riderId", "toRunStopId"] },
    { action: "shuttle_stop_archive", meta: { stopId: DOC }, banned: ["stopId"] },
    { action: "shuttle_vehicle_create", meta: { vehicleId: DOC }, banned: ["vehicleId"] },
    { action: "shuttle_run_delete", meta: { runId: DOC }, banned: ["runId"] },
    { action: "shuttle_run_stop_add", meta: { runId: DOC, stopId: DOC2 }, banned: ["runId", "stopId"] },
    { action: "shuttle_boarding_clear", meta: { boardingId: DOC }, banned: ["boardingId"] },
    { action: "intake_token_create", meta: {} },
    { action: "calendar_event_create", meta: {} },
    { action: "calendar_event_update", meta: {} },
    { action: "calendar_event_delete", meta: {} },
    { action: "classroom_create", meta: {} },
    { action: "classroom_archive", meta: {} },
    { action: "notice_popup_create", meta: {} },
    { action: "owner_settings_update", meta: { via: "script:narrow-staff-menu", grants: ["설현", "이승엽"] }, banned: ["via", "grants", "script:narrow-staff-menu"] },
    // 회의록·학생상담(2026-08-25 신규 배선) — 호출부가 실제로 넘기는 모양 그대로.
    { action: "meeting_create_audio", meta: { meetingId: DOC, sizeBytes: 12_582_912, attendees: 5, heldAt: "2026-08-25", notepadChars: 0 }, banned: ["sizeBytes", "attendees", "heldAt", "meetingId", "notepadChars"] },
    { action: "meeting_create_text", meta: { meetingId: DOC, notepadChars: 1240, attendees: 3, heldAt: "2026-08-25" }, banned: ["notepadChars", "attendees", "heldAt"] },
    { action: "meeting_delete", meta: { meetingId: DOC, heldAt: "2026-08-20", hadAudio: true, audioRemoved: true, audioDurationSec: 750, transcriptChars: 4880, hadReport: true, model: "deepseek-v4-pro-2026-07-16" }, banned: ["hadAudio", "audioRemoved", "audioDurationSec", "transcriptChars", "hadReport", "deepseek-v4-pro-2026-07-16", "true"] },
    { action: "meeting_retry_transcribe", meta: { meetingId: DOC, fromStatus: "failed", transcriptChars: 0 }, banned: ["fromStatus", "failed", "transcriptChars"] },
    { action: "meeting_retry_transcribe", meta: { meetingId: DOC, fromStatus: "completed", transcriptChars: 4880 }, banned: ["fromStatus", "completed"] },
    { action: "meeting_regenerate_analysis", meta: { meetingId: DOC, transcriptChars: 4880, notepadChars: 120 }, banned: ["transcriptChars", "notepadChars", "meetingId"] },
    { action: "meeting_title_update", meta: { meetingId: DOC, from: "8월 정기회의" }, banned: ["meetingId", "from"] },
    { action: "meeting_speakers_update", meta: { meetingId: DOC, speakers: 3, linked: 2 }, banned: ["speakers", "linked", "meetingId"] },
    { action: "meeting_report_edit", meta: { meetingId: DOC, section: "actionItems", chars: 412 }, banned: ["section", "actionItems", "chars"] },
    { action: "student_consultation_create", meta: { consultationId: DOC, studentId: SID, consultedAt: "2026-08-25", category: "academic", audience: "parent", hasFollowUp: true, followUpDate: "2026-09-01" }, banned: ["academic", "parent", "category", "audience", "hasFollowUp", "followUpDate", "consultedAt", "true"] },
    { action: "student_consultation_update", meta: { consultationId: DOC, studentId: SID, consultedAt: "2026-08-25", category: "social", audience: "student", hasFollowUp: false, followUpDate: null }, banned: ["social", "student", "category", "audience", "hasFollowUp", "consultedAt", "false"] },
    { action: "student_consultation_delete", meta: { consultationId: DOC, studentId: SID, consultedAt: "2026-08-11", category: "emotional", audience: "both", hasFollowUp: false }, banned: ["emotional", "both", "consultedAt", "category", "audience", "hasFollowUp"] },
    { action: "student_consultation_follow_up", meta: { consultationId: DOC, studentId: SID, done: true }, banned: ["done", "true", "consultationId", "studentId"] },
    { action: "student_consultation_update", meta: { consultationId: DOC, studentId: SID, consultedAt: "2026-09-30", category: "general", audience: "parent", hasFollowUp: false, followUpDate: null, classId: CID, className: "초등M 초4 BS1J", classPick: "manual", prevClassId: null, prevClassName: null }, banned: ["manual", "classPick", "classId", "prevClassId", CID] },
    { action: "student_consultation_class_backfill", meta: { count: 3, mapped: 1, reasons: { "반 하나로 좁혀짐": 1, not_teaching: 2 } }, banned: ["not_teaching", "reasons", "mapped"] },
    { action: "student_care_analysis", meta: { studentId: SID, model: "claude-sonnet-5", focus: 3 }, banned: ["claude-sonnet-5", "model", "focus", "studentId"] },
    // 재고 관리(0242a) — 호출부가 실제로 넘기는 모양 그대로. 영문 enum(on_loan·laptop·missing)이 새면 안 된다.
    { action: "inventory_asset_create", meta: { assetId: DOC, assetCode: "NB-019", category: "laptop", status: "in_use" }, banned: ["laptop", "in_use", "category", "status"] },
    { action: "inventory_asset_update", meta: { assetId: DOC, assetCode: "NB-019", changed: ["모델명", "현위치"] }, banned: ["changed", "assetId"] },
    { action: "inventory_asset_status", meta: { assetId: DOC, assetCode: "NB-014", from: "in_use", to: "disposed", disposedOn: "2026-08-28" }, banned: ["in_use", "disposed", "from", "to:"] },
    { action: "inventory_loan_out", meta: { loanId: DOC, assetId: DOC2, assetCode: "NB-005", borrowerName: "김태건", dept: "강사", lentOn: "2026-06-14", dueOn: "2026-08-31", dueNote: null }, banned: ["borrowerName", "lentOn", "dueOn", "loanId"] },
    { action: "inventory_loan_out", meta: { loanId: DOC, assetId: DOC2, assetCode: "MN-005", borrowerName: "셔틀담당", dept: "운영", lentOn: "2026-07-16", dueOn: null, dueNote: "상시" }, banned: ["dueNote", "null"] },
    { action: "inventory_loan_return", meta: { loanId: DOC, assetId: DOC2, assetCode: "NB-005", borrowerName: "김태건", returnedOn: "2026-09-02", restoredStatus: "check" }, banned: ["check", "restoredStatus", "returnedOn"] },
    { action: "inventory_audit", meta: { auditId: DOC, assetId: DOC2, assetCode: "NB-006", auditedOn: "2026-07-23", result: "missing", location: null, action: "사용자 연락" }, banned: ["missing", "result", "auditedOn", "auditId"] },
    { action: "inventory_supply_update", meta: { supplyId: DOC, itemCode: "SP-01", name: "키보드", qtyFrom: 20, qtyTo: 18, checkedOn: "2026-09-02" }, banned: ["qtyFrom", "qtyTo", "checkedOn", "supplyId"] },
    { action: "inventory_excel_import", meta: { mode: "overwrite", assetsInserted: 3, assetsUpdated: 96, assetsSkipped: 0, suppliesInserted: 0, suppliesUpdated: 11, suppliesSkipped: 0 }, banned: ["overwrite", "assetsInserted", "suppliesUpdated", "mode"] },
    // 공용 엑셀 가져오기 — kind(students)·mode(append)·counts 키가 새면 안 된다.
    { action: "excel_import", meta: { kind: "students", mode: "append", file: "원생.xlsx", counts: [{ label: "원생", insert: 12, update: 0, skip: 3 }], error: null }, banned: ["students", "append", "counts", "insert", "kind"] },
  ];

  for (const s of SAMPLES) {
    it(`${s.action} — 영문 키·enum 미노출`, () => {
      const out = auditDetail(s.action, s.meta, ctx(names));
      if (out === null) return; // 표기할 상세 없음 = 화면엔 "—" (영문 노출 아님)
      expect(out, `영문 "키: 값"이 그대로 새어나옴 → ${out}`).not.toMatch(KEY_LEAK);
      for (const bad of s.banned ?? []) {
        expect(out, `영문 원문 "${bad}"이 그대로 새어나옴 → ${out}`).not.toContain(bad);
      }
    });
  }
});

/**
 * 🔴 **빈 상세도 실패다** — 2026-08-21 폴백 정책 반전 이후 case 누락은 영문 노출이 아니라
 * **빈 칸**으로 나타난다(위 SAMPLES 루프는 null을 "표기할 상세 없음"으로 통과시킨다).
 * 회의록·학생상담은 전부 metadata에 실제 값을 싣는 액션이라, 실호출 표본에서 null이면 배선 실수다.
 */
describe("🔴 회의록·학생상담 상세는 빈 칸이 아니다(실호출 표본)", () => {
  const LIVE: Array<{ action: string; meta: Record<string, unknown> }> = [
    { action: "meeting_create_audio", meta: { meetingId: DOC, sizeBytes: 8_400_000, attendees: 4, heldAt: "2026-08-25", notepadChars: 0 } },
    { action: "meeting_create_text", meta: { meetingId: DOC, notepadChars: 640, attendees: 0, heldAt: "2026-08-25" } },
    { action: "meeting_delete", meta: { meetingId: DOC, heldAt: "2026-08-20", hadAudio: false, audioRemoved: false, audioDurationSec: null, transcriptChars: 0, hadReport: false, model: null } },
    { action: "meeting_retry_transcribe", meta: { meetingId: DOC, fromStatus: "failed", transcriptChars: 0 } },
    { action: "meeting_regenerate_analysis", meta: { meetingId: DOC, transcriptChars: 0, notepadChars: 640 } },
    { action: "meeting_title_update", meta: { meetingId: DOC, from: "8월 정기회의" } },
    { action: "meeting_speakers_update", meta: { meetingId: DOC, speakers: 0, linked: 0 } },
    { action: "meeting_report_edit", meta: { meetingId: DOC, section: "summary", chars: 0 } },
    { action: "student_consultation_create", meta: { consultationId: DOC, studentId: SID, consultedAt: "2026-08-25", category: "general", audience: "parent", hasFollowUp: false, followUpDate: null } },
    { action: "student_consultation_update", meta: { consultationId: DOC, studentId: SID, consultedAt: null, category: "career", audience: "both", hasFollowUp: true, followUpDate: null } },
    { action: "student_consultation_delete", meta: { consultationId: DOC, studentId: SID, consultedAt: "2026-08-11", category: null, audience: null, hasFollowUp: false } },
    { action: "student_consultation_follow_up", meta: { consultationId: DOC, studentId: SID, done: false } },
    { action: "student_consultation_class_backfill", meta: { count: 0, mapped: 0, reasons: {} } },
    { action: "student_care_analysis", meta: { studentId: SID, model: "deepseek-v4-pro", focus: 0 } },
  ];
  for (const s of LIVE) {
    it(`${s.action} — 상세가 비어 있지 않다`, () => {
      const out = auditDetail(s.action, s.meta, ctx(names));
      expect(out, `${s.action}: 상세가 빈 칸(case 누락 의심)`).toBeTruthy();
      expect(out).toMatch(/[가-힣]/);
    });
  }
});

describe("auditTargetLabel — '대상' 열 한글화", () => {
  const tctx = { subjectLabel: (key: string) => ({ math: "수학", english: "영어" })[key] ?? key };

  it("tenant_settings의 설정 섹션 키·과목 키를 한글로(원장 제보 '학원 설정permissions')", () => {
    expect(auditTargetLabel("tenant_settings", "permissions", tctx)).toBe("역할별 메뉴 권한");
    expect(auditTargetLabel("tenant_settings", "english", tctx)).toBe("영어");
    // 설정에서 지운 과목처럼 labelOf가 키를 되돌려주면 **원문 그대로**(지어내지 않는다)
    expect(auditTargetLabel("tenant_settings", "subject_9", tctx)).toBe("subject_9");
  });

  it("🔴 사람·반·문서 이름은 건드리지 않는다(바꾸면 실제 이름이 사라진다)", () => {
    expect(auditTargetLabel("user", "이다교", tctx)).toBe("이다교");
    expect(auditTargetLabel("class", "초등M 초4 BS1J", tctx)).toBe("초등M 초4 BS1J");
    expect(auditTargetLabel("tenant_settings", "학원 프로필·브랜드", tctx)).toBe("학원 프로필·브랜드");
    expect(auditTargetLabel(null, null, tctx)).toBeNull();
  });

  it("이름을 못 구해 실려온 uuid는 접는다(approval_withdraw·classroom_delete 폴백)", () => {
    expect(auditTargetLabel("approval_document", DOC, tctx)).toBeNull();
    expect(auditTargetLabel("classroom", CID, tctx)).toBeNull();
  });
});

describe("auditActorName — '실행자' 열의 스크립트 식별자", () => {
  it("system:* 를 한글로, 사람 이름은 그대로", () => {
    expect(auditActorName("system:grant-class-review")).toBe("시스템 · 직원 평가 권한 부여");
    expect(auditActorName("system:narrow-staff-menu")).toBe("시스템 · 직원관리 권한 조정");
    expect(auditActorName("박소선")).toBe("박소선");
    expect(auditActorName(null)).toBeNull();
  });

  it("🔴 미등록 system:* 도 접두를 그대로 내보내지 않는다", () => {
    expect(auditActorName("system:some-future-script")).toBe("시스템 스크립트");
    expect(auditActorName("system:some-future-script")).not.toContain("system:");
  });

  it("보이는 한글로 검색이 된다(액션 라벨 역인덱스와 같은 규약)", () => {
    expect(systemActorMatches("직원 평가 권한").names).toEqual(["system:grant-class-review"]);
    expect(systemActorMatches("시스템").allSystem).toBe(true);
    expect(systemActorMatches("김승언")).toEqual({ names: [], allSystem: false });
  });
});

describe("auditDetail — 등록상담·강사 시트·캘린더(2026-09-10 김근우 건)", () => {
  it("자동 연결은 누구에게·어떤 규칙으로·언제 붙었는지를 말한다", () => {
    expect(
      auditDetail(
        "consultation_autolink",
        { studentId: SID, rule: "name_school_grade", via: "intake" },
        ctx({ [SID]: "김근우" }),
      ),
    ).toBe("→ 김근우 · 이름·학교·학년 일치 · 학부모 QR 접수 때");
    expect(
      auditDetail(
        "consultation_autolink",
        { studentId: SID, rule: "phone_name", via: "student", userId: UID },
        ctx({ [SID]: "홍길동", [UID]: "허은진" }),
      ),
    ).toBe("→ 홍길동 · 연락처·이름 일치 · 학생 등록·수정 때 · 허은진의 저장으로");
  });

  it("🔴 모르는 규칙·경로 값은 영문으로 흘리지 않는다", () => {
    const d = auditDetail("consultation_autolink", { rule: "weird_rule", via: "cron" }, ctx());
    expect(d ?? "").not.toMatch(/weird|cron/);
  });

  it("상담 수정은 이름 전후 값 + 나머지 바뀐 항목(연락처는 항목 이름만)", () => {
    expect(
      auditDetail(
        "enrollment_consultation_update",
        { changed: ["이름", "보호자 연락처"], changes: [{ field: "이름", from: "김근우", to: "김근우A" }] },
        ctx(),
      ),
    ).toBe("이름 김근우 → 김근우A · 보호자 연락처");
  });

  it("목록 칸 수정·QR 상담완료 전환도 읽힌다", () => {
    expect(
      auditDetail(
        "enrollment_consultation_update",
        { changed: ["학년"], changes: [{ field: "학년", from: null, to: "중1" }], via: "list" },
        ctx(),
      ),
    ).toBe("목록에서 · 학년 (빈 값) → 중1");
    expect(
      auditDetail("enrollment_consultation_update", { changed: [], changes: [], outcomeTo: "consulted" }, ctx()),
    ).toBe("상태 → 상담완료");
  });

  it("상태 변경은 한글 라벨로, 모르는 값은 숨긴다", () => {
    expect(auditDetail("enrollment_consultation_outcome", { from: "consulted", to: "enrolled" }, ctx())).toBe(
      "상담완료 → 재원생 등록 완료", // 원장 2026-09-18 라벨 변경
    );
    expect(auditDetail("enrollment_consultation_outcome", { from: "zzz", to: "declined" }, ctx())).toBe("→ 거절");
  });

  it("QR 접수·작성은 과목을 학원설정 라벨로", () => {
    expect(auditDetail("enrollment_consultation_intake", { subject: "math" }, ctx())).toBe("학부모 QR 접수 · 수학");
    expect(auditDetail("enrollment_consultation_create", { subject: "english", withAudio: true }, ctx())).toBe(
      "영어 · 녹음 포함",
    );
  });

  it("연결 해제·재사용·삭제는 대상 학생 이름", () => {
    expect(
      auditDetail("consultation_unlink", { studentId: SID, reason: "동명이인 오연결 정정" }, ctx({ [SID]: "김근우" })),
    ).toBe("김근우에서 분리 · 동명이인 오연결 정정");
    expect(auditDetail("consultation_link_existing", { studentId: SID }, ctx({ [SID]: "김근우" }))).toBe(
      "→ 김근우 · 같은 이름·학교·학년 재원생 재사용",
    );
    expect(
      auditDetail("enrollment_consultation_delete", { studentId: SID, hadRecording: true }, ctx({ [SID]: "김근우" })),
    ).toBe("연결 학생 김근우 · 녹음 포함");
  });

  it("강사 시트 수업계획 복사 — 날짜·교시·원본 회차(영문 termMode는 안 흘린다)", () => {
    const d = auditDetail(
      "ecs_plan_copy",
      { classId: "c", planDate: "2026-09-10", slotStart: "21:10", sourceDate: "2026-09-03", copied: 1, termMode: "regular" },
      ctx(),
    );
    expect(d).toBe("2026-09-10 21:10 · 2026-09-03 회차에서 · 1줄 복사");
    expect(auditDetail("ecs_plan_line_add", { planDate: "2026-09-08", slotStart: "17:20", termMode: "exam" }, ctx())).toBe(
      "2026-09-08 17:20 · 시험 기간",
    );
  });

  it("강사 시트 칸 편집 — 칸을 떠날 때 한 줄: 위치·칸 이름·이전 값 → 새 값(영문 kind·role은 안 흘린다)", () => {
    expect(
      auditDetail(
        "ecs_mark_edit",
        {
          classId: "c",
          kind: "mark",
          studentId: SID,
          date: "2026-09-14",
          slotStart: "17:20",
          field: "progressNote",
          fieldLabel: "특이사항",
          before: "PL 6",
          after: "PL 7",
        },
        ctx({ [SID]: "김학생" }),
      ),
    ).toBe("김학생 · 2026-09-14 17:20 · 특이사항 「PL 6」 → 「PL 7」");
    expect(
      auditDetail(
        "ecs_goal_edit",
        {
          kind: "goal",
          scope: "week",
          periodStart: "2026-09-14",
          role: "assistant",
          skillArea: "reading",
          areaLabel: "Reading",
          fieldLabel: "교재명",
          before: null,
          after: "Wonders 3",
        },
        ctx(),
      ),
    ).toBe("2026-09-14 주 목표 · 부담임 · Reading · 교재명 (빈칸) → 「Wonders 3」");
    expect(
      auditDetail("ecs_memo_edit", { kind: "monthMemo", month: "2026-09", fieldLabel: "특이사항 메모", before: "a", after: null }, ctx()),
    ).toBe("2026-09 · 특이사항 메모 「a」 → (빈칸)");
    expect(
      auditDetail("ecs_memo_edit", { kind: "memo", weekStart: "2026-09-14", memoKey: "panel", fieldLabel: "주간 메모", before: null, after: "b" }, ctx()),
    ).toBe("2026-09-14 주 · 주간 메모 (빈칸) → 「b」");
    expect(
      auditDetail("ecs_month_plan_edit", { kind: "mpCell", date: "2026-09-15", colKind: "in_class", fieldLabel: "In-class", before: "", after: "U3" }, ctx()),
    ).toBe("2026-09-15 · In-class (빈칸) → 「U3」");
    expect(
      auditDetail("ecs_month_plan_edit", { change: "ebookColumn", show: true, days: 4, from: "2026-09-01", to: "2026-09-22" }, ctx()),
    ).toBe("e-book 열 세움 · 2026-09-01~2026-09-22 · 4일");
    expect(auditDetail("ecs_month_plan_edit", { change: "dayOff", date: "2026-09-25", off: true }, ctx())).toBe(
      "2026-09-25 · 휴강으로 표시",
    );
    expect(auditDetail("ecs_shouting_toggle", { date: "2026-09-14", slotStart: "16:20", checked: false }, ctx())).toBe(
      "2026-09-14 16:20 · Shouting 체크 해제",
    );
    expect(AUDIT_TYPE_LABEL.class_sheet).toBe("강사 시트");
  });

  it("범위 확대 — 계획 줄 칸 · 수학 시트 목표 · 자리 JJ 칸도 위치·칸 이름·이전 값 → 새 값 한 줄", () => {
    expect(
      auditDetail(
        "ecs_plan_cell_edit",
        {
          classId: "c",
          kind: "plan",
          lineId: "l1",
          planDate: "2026-09-14",
          slotStart: "17:20",
          field: "progress",
          fieldLabel: "진도",
          before: "U3",
          after: "U4",
        },
        ctx(),
      ),
    ).toBe("2026-09-14 17:20 · 진도 「U3」 → 「U4」");
    expect(
      auditDetail(
        "ecs_plan_cell_edit",
        { planDate: "2026-09-14", slotStart: "17:20", fieldLabel: "과제", before: null, after: "WB p.3", viaPin: true },
        ctx(),
      ),
    ).toBe("2026-09-14 17:20 · 과제 (빈칸) → 「WB p.3」 · 공개 PIN 화면");
    expect(
      auditDetail(
        "mcs_goal_edit",
        { studentId: SID, month: "2026-09", field: "targetProgress", fieldLabel: "목표 진도", before: "3단원", after: "4단원" },
        ctx({ [SID]: "김학생" }),
      ),
    ).toBe("김학생 · 2026-09 목표 · 목표 진도 「3단원」 → 「4단원」");
    expect(
      auditDetail(
        "seat_jj_mark_edit",
        {
          studentId: SID,
          date: "2026-09-14",
          slotStart: "17:20",
          field: "listeningLevel",
          fieldLabel: "듣기 레벨",
          before: "3",
          after: "4",
          viaPin: true,
        },
        ctx({ [SID]: "김학생" }),
      ),
    ).toBe("김학생 · 2026-09-14 17:20 · 듣기 레벨 「3」 → 「4」 · 공개 PIN 화면");
  });

  it("구글 캘린더 가져오기 — 건수, 아무것도 없으면 '변경 없음'", () => {
    expect(
      auditDetail(
        "calendar_google_import",
        { inserted: 1074, updated: 0, deleted: 0, skippedEdited: 0, failed: [] },
        ctx(),
      ),
    ).toBe("추가 1,074건");
    expect(auditDetail("calendar_google_import", { inserted: 0, updated: 0, deleted: 0, failed: [] }, ctx())).toBe(
      "변경 없음",
    );
  });

  it("구글 캘린더 알림 반영 — 가져오기와 같은 모양(추가·갱신·삭제 건수)", () => {
    expect(
      auditDetail("calendar_google_push_sync", { inserted: 0, updated: 1, deleted: 2, failed: [], changes: 3 }, ctx()),
    ).toBe("갱신 1건 · 삭제 2건");
    expect(auditDetail("calendar_google_push_sync", { inserted: 0, updated: 0, deleted: 0, failed: [] }, ctx())).toBe("변경 없음");
  });

  it("대상 유형 calendar도 한글", () => {
    expect(AUDIT_TYPE_LABEL.calendar).toBe("캘린더");
  });
});

describe("auditDetail — 슬랙 규칙 '누가'(0311a)", () => {
  it("보낼 사람 인원이 바뀌면 전 → 후 · 같은 인원에 사람만 바뀌면 (교체)", () => {
    const base = { enabled: true, actorCount: 0, actorSig: "" };
    expect(auditDetail("slack_rule_save", { enabled: true, actorCount: 2, actorSig: "h1", before: base }, ctx())).toBe(
      "수정: 보낼 사람(발동자) 0 → 2명 · 켜짐",
    );
    expect(
      auditDetail("slack_rule_save", { enabled: true, actorCount: 1, actorSig: "h2", before: { enabled: true, actorCount: 1, actorSig: "h1" } }, ctx()),
    ).toBe("수정: 보낼 사람(발동자) 1 → 1명(교체) · 켜짐");
  });
  it("옛 기록(before에 actorCount 없음)은 비교하지 않는다", () => {
    expect(auditDetail("slack_rule_save", { enabled: true, actorCount: 2, before: { enabled: true } }, ctx())).not.toContain("보낼 사람");
  });
});

describe("auditDetail — ClassNote 반 보드 자동 동기화(2026-10-03)", () => {
  it("자동 요청 = 어느 반이 왜 달라졌는지 적는다(영문 키·id 없이)", () => {
    const d = auditDetail(
      "classnote_board_sync_request",
      { requestId: UID, auto: true, full: false, classCount: 2, studentCount: 0, source: "auto", classes: [{ name: "초등M 개별 BS1K", reasons: ["새 학생"] }, { name: "중2A", reasons: ["반 이름 변경", "담임 변경"] }] },
      ctx(),
    );
    expect(d).toBe("달라진 반 2개 자동 동기화 요청 · 초등M 개별 BS1K(새 학생) · 중2A(반 이름 변경, 담임 변경)");
    expect(d).not.toMatch(/auto|source|requestId/);
    // 사람이 누른 요청은 예전 문구 그대로
    expect(auditDetail("classnote_board_sync_request", { full: true }, ctx())).toBe("바뀐 반 전부 수동 동기화 요청");
  });
  it("자동 요청의 실행 결과는 앞에 '자동 동기화'를 붙인다 · 사람이 누른 것은 그대로", () => {
    expect(auditDetail("classnote_board_sync_run", { ok: true, auto: true, classes: 2, enrolled: 1, releasedChildren: 1 }, ctx())).toBe("자동 동기화 · 반 2 · 원아 배정 1 · 원아 해제 1");
    expect(auditDetail("classnote_board_sync_run", { ok: true, auto: true, noChange: true }, ctx())).toBe("자동 동기화 · 바뀐 반 없음(ClassNote 변경 없음)");
    expect(auditDetail("classnote_board_sync_run", { ok: true, classes: 2, enrolled: 1 }, ctx())).toBe("반 2 · 원아 배정 1");
  });
  it("보고서 발송이 반 보드 배정 전이라 막혀 그 자리에서 낸 요청은 그렇게 적는다 — 버튼을 누른 요청과 가린다", () => {
    const blocked = { requestId: UID, full: false, classCount: 1, studentCount: 1, source: "send_blocked" };
    expect(auditDetail("classnote_board_sync_request", blocked, ctx())).toBe("지목한 반·학생만(반 1 · 학생 1) 자동 동기화 요청 · 보고서 발송이 반 보드 배정 전이라 막혀 자동으로 요청");
    expect(auditDetail("classnote_board_sync_request", { ...blocked, joined: true }, ctx())).toBe(
      "이미 요청된 동기화에 자동 합류 — 지목한 반·학생만(반 1 · 학생 1) · 보고서 발송이 반 보드 배정 전이라 막혀 자동으로 요청",
    );
    // 버튼으로 누른 요청은 예전 그대로
    expect(auditDetail("classnote_board_sync_request", { ...blocked, source: "onescreen_send_class" }, ctx())).toBe("지목한 반·학생만(반 1 · 학생 1) 수동 동기화 요청");
  });
  it("🔴 새 행은 서버가 적은 구분(trigger)으로 읽는다 — 호출자가 준 source보다 앞선다", () => {
    const base = { requestId: UID, full: false, classCount: 1, studentCount: 1 };
    // 버튼을 누른 사람이 source를 꾸며도 수동으로 읽힌다.
    const forged = auditDetail("classnote_board_sync_request", { ...base, trigger: "manual", source: "send_blocked" }, ctx());
    expect(forged).toBe("지목한 반·학생만(반 1 · 학생 1) 수동 동기화 요청");
    expect(auditDetail("classnote_board_sync_request", { ...base, trigger: "auto", source: "send_blocked" }, ctx())).toBe(
      "지목한 반·학생만(반 1 · 학생 1) 자동 동기화 요청 · 보고서 발송이 반 보드 배정 전이라 막혀 자동으로 요청",
    );
    expect(auditDetail("classnote_board_sync_request", { ...base, trigger: "manual", joined: true }, ctx())).toBe(
      "이미 요청된 동기화에 수동 합류 — 지목한 반·학생만(반 1 · 학생 1)",
    );
    expect(forged).not.toMatch(/trigger|manual|auto/);
  });
});

describe("auditDetail — 숙제 영상 올리기 사이트에서 연 링크(2026-10-03)", () => {
  it("번호·이름으로 열었고 어느 수업의 숙제를 골랐는지 적는다 · 학생 상세에서 복사한 링크는 예전 그대로", () => {
    const d = auditDetail("lesson_report_video_link_issue", { studentId: UID, classId: UID, origin: "site", lastDay: "2026-10-04", homeworkDate: "2026-10-01" }, ctx());
    expect(d).toContain("올리기 사이트에서 번호·이름으로 엶");
    expect(d).toContain("2026-10-01 수업 숙제");
    expect(d).toContain("2026-10-04까지");
    const manual = auditDetail("lesson_report_video_link_issue", { studentId: UID, classId: UID, origin: "manual", lastDay: "2026-10-09" }, ctx());
    expect(manual).toContain("학생 상세에서 복사");
    expect(manual).not.toContain("수업 숙제");
  });
});

describe("auditDetail — 퇴원보고서 처리 결과(2026-10-23)", () => {
  it("마지막 승인으로 끝났으면 결과 · 처리일 · 끝난 수업 — 옛 기록(결과 칸 없음)은 종전 그대로", () => {
    expect(auditDetail("withdrawal_report_update", { operation: "승인", result: "학생 퇴원", date: "2026-10-23", endedClasses: ["M1A", "E2B"] }, ctx()))
      .toBe("승인 · 학생 퇴원 · 처리일 2026-10-23 · 끝난 수업 M1A·E2B");
    expect(auditDetail("withdrawal_report_update", { operation: "승인", result: "처리 예약", date: "2026-11-01" }, ctx())).toBe("승인 · 처리 예약 · 처리일 2026-11-01");
    expect(auditDetail("withdrawal_report_update", { operation: "보고서 제출", date: "2026-10-23" }, ctx())).toBe("보고서 제출 · 처리일 2026-10-23");
  });
});

describe("auditDetail — 학습 추세 미발송 설정(2026-10-23)", () => {
  const C1 = "c1111111-2222-3333-4444-555555555555";
  it("학생 · 반 · 켬/끔 · 비운 보고서 수", () => {
    const names = ctx({ [SID]: "김학생", [C1]: "M1A" });
    expect(auditDetail("onescreen_trend_optout", { studentId: SID, classId: C1, on: true, cleared: 2 }, names)).toBe("김학생 · M1A · 미발송 켬 · 안 나간 보고서 2건 추세 비움");
    expect(auditDetail("onescreen_trend_optout", { studentId: SID, classId: C1, on: false, cleared: 0 }, names)).toBe("김학생 · M1A · 미발송 끔");
  });
});
