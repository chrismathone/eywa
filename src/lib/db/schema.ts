import { sql } from "drizzle-orm";
import {
  boolean,
  bigint,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// === Enums ===
export const systemRoleEnum = pgEnum("system_role", [
  "master",
  "admin",
  "manager",
  "teacher",
  "counselor",
  "accountant",
  "viewer",
  "student", // 학생 본인 화면(내 학습 현황) 로그인용 — 직원 위계 밖
]);

export const userStatusEnum = pgEnum("user_status", ["active", "inactive", "pending"]);

export const studentStatusEnum = pgEnum("student_status", [
  "prospect",
  "consulted",
  "enrolled",
  "on_hold",
  "withdrawn",
]);

export const attendanceStatusEnum = pgEnum("attendance_status", [
  "present",
  "absent",
  "late",
  "excused",
  "makeup",
  "early_leave",
]);

// 출결/등하원 기록의 입력 경로. "manual"=직원 수동 입력, "kiosk"=무인 태블릿 셀프 체크인.
export const attendanceAccessMethodEnum = pgEnum("attendance_access_method", ["manual", "kiosk"]);

export const announcementAudienceEnum = pgEnum("announcement_audience", [
  "all",
  "staff",
  "office", // 강사·학생 제외 운영진(0066a) — 강사 미니셸과 무관한 풀셸 공지용
  "teachers",
  "counselors",
  "accounting",
]);

export const dayOfWeekEnum = pgEnum("day_of_week", [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
]);

export const invoiceStatusEnum = pgEnum("invoice_status", [
  "unpaid",
  "partial",
  "paid",
  "refunded",
  "void",
]);

export const consultationOutcomeEnum = pgEnum("consultation_outcome", [
  "pending", // 첫 문의 접수
  "scheduled", // 상담 예약됨
  "consulted", // 상담 완료, AI 분석 대기
  "ai_done", // AI 분석 완료, 인쇄 대기
  "enrolled", // 등록 완료
  "declined", // 거절
  "no_show", // 노쇼
]);

// === meeting_minutes processing pipeline status ===
// idle: text-only meeting (no audio)
// uploaded → transcribing → analyzing → completed | failed
export const meetingProcessingStatusEnum = pgEnum("meeting_processing_status", [
  "idle",
  "uploaded",
  "transcribing",
  "analyzing",
  "completed",
  "failed",
]);

// Same shape as meeting status, but separate enum so the two flows can diverge later
// (e.g. different terminal states, different retry semantics).
export const consultationProcessingStatusEnum = pgEnum("consultation_processing_status", [
  "idle",
  "uploaded",
  "transcribing",
  "analyzing",
  "completed",
  "failed",
]);

// === 재등록 캠페인 퍼널 상태 ===
// pending(대상) → contacted(연락함) → enrolled(재등록 완료) | declined(이탈)
export const reenrollmentStatusEnum = pgEnum("reenrollment_status", [
  "pending",
  "contacted",
  "enrolled",
  "declined",
]);

/**
 * @deprecated 0161a에서 `academy_documents.category`가 text로 완화되고 분류가 테넌트 데이터
 * (`document_categories`)로 내려갔다. DB의 enum 타입 자체는 롤백 경로로 남겨 뒀을 뿐 **컬럼은 안 쓴다** —
 * 새 코드에서 이 enum을 다시 컬럼에 붙이지 말 것(학원장이 추가한 분류가 통째로 거부된다).
 */
export const academyDocumentCategoryEnum = pgEnum("academy_document_category", [
  "enrollment",
  "billing",
  "consultation",
  "hr",
  "class",
  "other",
]);

// === tenants ===
export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  plan: text("plan").notNull().default("free"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// === users (1:1 with auth.users via id) ===
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    phone: text("phone"),
    systemRole: systemRoleEnum("system_role").notNull().default("viewer"),
    status: userStatusEnum("status").notNull().default("active"),
    hireDate: date("hire_date"),
    jobTitle: text("job_title"),
    subjects: text("subjects").array(),
    defaultClassroom: text("default_classroom"),
    memo: text("memo"),
    // 강사 퍼스널 색 — 시간표 강사 헤더 밴드(ijw Teacher.bgColor/textColor 패리티). 0054a.
    bgColor: text("bg_color"),
    textColor: text("text_color"),
    // 강사 영문 닉네임(ijw staff.englishName) — 영어 시간표 슬롯 라벨이 영문닉네임이라, 라벨→강사색
    // 해결에 필요(통합뷰 셀 색 배선). 0055a.
    englishName: text("english_name"),
    // Notion 사용자 매핑 외부키(0100a) — 직원 상세 '월간일정' 탭이 이 값으로 Notion 업무를 조회. nullable.
    // 부분 유니크(tenant당 1:1)는 alpha SQL(drizzle 미표현, [[#15]]).
    notionUserId: text("notion_user_id"),
    // 급여 정산용. 외부 노출은 master + 본인만 (RLS).
    hourlyRate: numeric("hourly_rate", { precision: 10, scale: 0 }).notNull().default("0"),
    monthlyBase: numeric("monthly_base", { precision: 10, scale: 0 }).notNull().default("0"),
    // 급여 방식·배분율(0119a, 급여 연계 v1). null=미설정. commission/hybrid=비율%를 청구 기준에 적용.
    salaryType: text("salary_type"), // 'commission' | 'fixed' | 'hybrid' | null
    commissionRate: numeric("commission_rate", { precision: 5, scale: 2 }),
    // 주간 근무 시간표 — { mon: ["09:00-12:00", …], … } 요일별 시간대 배열. null = 미설정.
    workSchedule: jsonb("work_schedule"),
    // 강사별 AI 멘트 공지 모드 오버라이드(0104a) — 'A'(단일 문단)|'B'(2문단 분리). null = 학원 기본(report.noticeMode) 따름.
    // 소비: generateReportComment(강사값 > 학원기본 > A). 쓰기: setMyNoticeMode(본인만, admin client).
    reportNoticeMode: text("report_notice_mode"),
    // 교재요청 학부모 발송 멘트(0129a) — 강사가 마지막에 쓴 멘트 = 다음 발송 기본값(PC 공유라 브라우저 저장 불가).
    // 소비: prepareTextbookNotice. 쓰기: saveMyTextbookMent(본인만, admin client). null=미설정(기본 템플릿).
    textbookNoticeMent: text("textbook_notice_ment"),
    // 수업보고서 발송용 이름(0217a) — 학부모 표면(ClassNote 작성자명·/r '담임' 칸·인쇄·미리보기)에서만
    // 실명 대신 표시. null=실명 그대로. ⚠️ lesson_reports.teacher_name 저장 축은 불변(이력·귀속이 이름 일치).
    // 소비: resolveReportAuthorSettings(+워커 복제본). 쓰기: updateMyReportName(본인만, admin client).
    reportDisplayName: text("report_display_name"),
    // 수업보고서 표시 이름 앞에 해당 보고서 반명을 붙인다(본인 /me 설정, 기본 꺼짐).
    reportClassNamePrefix: boolean("report_class_name_prefix").default(false).notNull(),
    // 계정 귀속 화면 설정(0146a) — 화면별 네임스페이스 1단({"timetable":{grades,…}}).
    // 저장은 **해당 화면 키만 병합**(다른 화면 설정을 지우지 않게). 소비: /timetable 서버 렌더.
    uiPrefs: jsonb("ui_prefs").default({}).notNull(),
    // 근무부서·근무형태(0147a) — 이력서/직원명부 시트에서 승격(선택지는 코드 RESUME_DEPARTMENTS·
    // EMPLOYMENT_TYPES). 소비: 직원목록 list·대시보드 집계. null=미입력.
    department: text("department"),
    employmentType: text("employment_type"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("users_tenant_email_idx").on(t.tenantId, t.email),
    index("users_tenant_role_idx").on(t.tenantId, t.systemRole),
  ],
);

// === payroll_records (월별 강사 정산) ===
export const payrollRecords = pgTable(
  "payroll_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    period: text("period").notNull(), // 'YYYY-MM'
    baseAmount: numeric("base_amount", { precision: 12, scale: 0 }).notNull().default("0"),
    hoursWorked: numeric("hours_worked", { precision: 8, scale: 2 }).notNull().default("0"),
    hourlyAmount: numeric("hourly_amount", { precision: 12, scale: 0 }).notNull().default("0"),
    bonus: numeric("bonus", { precision: 12, scale: 0 }).notNull().default("0"),
    deduction: numeric("deduction", { precision: 12, scale: 0 }).notNull().default("0"),
    total: numeric("total", { precision: 12, scale: 0 }).notNull(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("payroll_tenant_user_period_idx").on(t.tenantId, t.userId, t.period)],
);

// === staff_leaves (강사 휴가) ===
// 직원 계약 이력(0149a) — 직원 상세 '계약현황'. 기본은 첫 출근일부터 1년이고 차수만큼 이어진다.
// 파생 계산은 features/staff/contract/contract.ts(순수)가 단일 소스 — 이 테이블엔 **실제 기입·연장분만** 담는다.
export const staffContracts = pgTable(
  "staff_contracts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(), // 계약 차수(1차·2차…). note는 0.
    // 0159a — 시트 히스토리엔 기간 없는 줄(입사·수당 조항·부서 이전…)이 섞여 있어 날짜가 nullable.
    kind: text("kind").notNull().default("contract"), // 'contract'(기간 있음) | 'note'(원문 한 줄)
    startDate: date("start_date"),
    endDate: date("end_date"),
    lineNo: integer("line_no"), // 시트 셀에서의 줄 순서(0=맨 위)
    terms: text("terms"), // 계약조건(시트 '계약조건' 열 대응 자유 텍스트)
    memo: text("memo"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("staff_contracts_user_seq_idx").on(t.tenantId, t.userId, t.seq),
    index("staff_contracts_user_idx").on(t.userId, t.startDate),
  ],
);

export const staffLeaves = pgTable(
  "staff_leaves",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    leaveType: text("leave_type").notNull(), // 연차/반차/병가/경조사/기타
    startsOn: date("starts_on").notNull(),
    endsOn: date("ends_on").notNull(),
    reason: text("reason"),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("staff_leaves_tenant_user_idx").on(t.tenantId, t.userId),
    index("staff_leaves_tenant_dates_idx").on(t.tenantId, t.startsOn, t.endsOn),
  ],
);

// === classrooms ===
export const classrooms = pgTable(
  "classrooms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    capacity: integer("capacity"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("classrooms_tenant_name_idx").on(t.tenantId, t.name)],
);

// === classes ===
export const classes = pgTable(
  "classes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    className: text("class_name").notNull(),
    subject: text("subject").notNull(),
    teacherId: uuid("teacher_id").references(() => users.id, { onDelete: "set null" }),
    classroomId: uuid("classroom_id").references(() => classrooms.id, { onDelete: "set null" }),
    isActive: boolean("is_active").notNull().default(true),
    // 종강(0059a): 운영 종료일. is_active(폐지)와 별개 — 종강 반은 is_active=true 유지하고
    // 타임머신에서 closed_at 이전 주엔 표시(이력), 이후 주에선 숨김. NULL=운영중.
    closedAt: date("closed_at"),
    // 특강(0133a): 방학 단기강좌. 폼 토글이 쓰는 컬럼 — false여도 반 이름에 '특강'이 있으면 특강으로 본다
    // (하위호환 폴백). 판정 단일소스 = src/features/classes/special-lecture.ts `isSpecialLecture`.
    isSpecial: boolean("is_special").notNull().default(false),
    // 수업보고서 미발송(0174a): 랩실 등 보고서를 쓰지 않는 반. 보고서 작성/발송 화면의 반 목록·작성률
    // 분모·미작성 재촉에서 빠진다. ⚠️ is_special과 달리 **이름 폴백이 없다**(반 이름 규칙이 없어서).
    // 판정 단일소스 = src/features/classes/report-optout.ts `isReportOptout`.
    reportOptout: boolean("report_optout").notNull().default(false),
    notes: text("notes"),
    // Cell color (ijw bgColor/textColor). Stored as #RRGGBB; ARGB normalized on import.
    bgColor: text("bg_color"),
    textColor: text("text_color"),
    // 강사 인수인계(담임 교체) 예약 — ijw TeacherHandover 경량 이식(0044a). NULL=예약 없음.
    pendingTeacherId: uuid("pending_teacher_id").references(() => users.id, { onDelete: "set null" }),
    pendingTeacherDate: date("pending_teacher_date"),
    pendingTeacherReason: text("pending_teacher_reason"),
    // makeedu 동기화 외부키 — makeedu 수업 No(예 147). 부분 유니크는 손수 alpha SQL(0057a).
    makeeduLessonId: text("makeedu_lesson_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("classes_tenant_name_subject_idx").on(t.tenantId, t.className, t.subject),
    index("classes_tenant_active_idx").on(t.tenantId, t.isActive),
  ],
);

// === students ===
// Note: a partial unique index on (tenant_id, name_normalized, school, grade) WHERE status<>'withdrawn'
// is added in a hand-written migration (Drizzle can't express WHERE clauses on unique indexes).
export const students = pgTable(
  "students",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    studentCode: text("student_code"),
    // makeedu 동기화 외부키 — makeedu 원생고유번호(예 09327). ⚠️ student_code와 분리(ijw studentCode 충돌 방지).
    // 부분 유니크 (tenant_id, makeedu_id) WHERE makeedu_id IS NOT NULL 는 손수 alpha SQL(0057a).
    makeeduId: text("makeedu_id"),
    // Edutrix public.students.id — 수업보고서 이관·cron 매칭 키(0094a). 이름-only 매칭 금지(동명이인 fan-out).
    // 부분 유니크 (tenant_id, edutrix_student_id) WHERE NOT NULL 는 0094a alpha.
    edutrixStudentId: text("edutrix_student_id"),
    // "지난 동기화가 새로 추가한 학생" 표시용(목록의 ↻ 동기화 배지). 동기화 신규 insert 시 now(),
    // 다음 동기화가 성공하면 그 실행 시작에 전부 NULL로 클리어 → 라벨이 "다음 동기화까지만" 유지된다(0061a).
    syncAddedAt: timestamp("sync_added_at", { withTimezone: true }),
    // makeedu 동기화가 이름 충돌로 자동 접미사(테스트→테스트A)를 붙여 만든 신규 학생 표시(0078a).
    // "확인 필요" 배지 → 사람이 '정상 확인'하거나 병합할 때까지 유지(동기화로 안 지워짐, sync_added_at과 별개).
    dupSuspect: boolean("dup_suspect").notNull().default(false),
    name: text("name").notNull(),
    englishName: text("english_name"),
    // ClassNote 보드명 오버라이드(동명이인 구분, 0088a) — 지정 시 워커 보드명·감지가 (classnote_name || name) 사용.
    classnoteName: text("classnote_name"),
    /**
     * 테스트 전용 학생(0141a). ClassNote 발송 시험은 실학생 대신 이 학생에게 한다(`학원이`).
     * 작성률 등 **집계에서 제외** — 화면에서 숨기지는 않는다(원장이 테스트하려면 찾을 수 있어야 함).
     */
    isTest: boolean("is_test").notNull().default(false),
    school: text("school"),
    grade: text("grade"),
    gender: text("gender"), // "male" | "female" | null
    birthDate: date("birth_date"),
    address: text("address"),
    email: text("email"),
    studentPhone: text("student_phone"),
    parentPhone: text("parent_phone"),
    parentName: text("parent_name"),
    // 키오스크 셀프 체크인용 출석번호(학생 휴대폰 뒷4자리 우선, 충돌 시 5자리).
    // 부분 유니크 (tenant_id, attendance_code) WHERE status<>'withdrawn' 는 손수 alpha SQL에서.
    attendanceCode: text("attendance_code"),
    status: studentStatusEnum("status").notNull().default("prospect"),
    enrolledAt: date("enrolled_at"),
    withdrawnAt: date("withdrawn_at"),
    // Structured withdrawal record — reason category + memo + 3-step consultation tracking.
    // Set to NULL when status reverts to 'enrolled' (재원 복구).
    withdrawalMetadata: jsonb("withdrawal_metadata"),
    notes: text("notes"),
    aiCareSummary: text("ai_care_summary"),
    aiCareFocus: jsonb("ai_care_focus"),
    aiCareModelVersion: text("ai_care_model_version"),
    aiCareGeneratedAt: timestamp("ai_care_generated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("students_tenant_status_idx").on(t.tenantId, t.status),
    index("students_attendance_code_idx").on(t.tenantId, t.attendanceCode),
  ],
);

// === enrollments (student × class, daterange overlap blocked by GiST EXCLUDE in raw SQL) ===
export const enrollments = pgTable(
  "enrollments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    classId: uuid("class_id")
      .notNull()
      .references(() => classes.id, { onDelete: "restrict" }),
    startDate: date("start_date").notNull(),
    endDate: date("end_date"),
    onHold: boolean("on_hold").notNull().default(false),
    withdrawalReason: text("withdrawal_reason"),
    // 분리등원: [] = 수업의 모든 요일 등원, ['mon'] = 월요일만. day_of_week 문자열.
    // ijw가 같은 (학생,반)에 attendanceDays만 다른 enrollment를 복수 공존시키던 것을
    // 단일 enrollment + 배열로 정규화 → GiST enrollments_no_overlap 충돌 회피.
    attendanceDays: text("attendance_days")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    // 반이동 흔적: is_transferred = 이동으로 종료(퇴원 집계 제외), is_transferred_in = 이동으로 들어옴.
    isTransferred: boolean("is_transferred").notNull().default(false),
    isTransferredIn: boolean("is_transferred_in").notNull().default(false),
    // 급여 단가 티어 라벨(salary_tiers.label 참조, FK 아님 — 라벨만이라 금액 비노출, 0199a).
    salaryTier: text("salary_tier"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("enrollments_tenant_class_idx").on(t.tenantId, t.classId),
    index("enrollments_tenant_student_idx").on(t.tenantId, t.studentId),
  ],
);

// === attendance_records (append-only audit-style) ===
export const attendanceRecords = pgTable(
  "attendance_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    classId: uuid("class_id")
      .notNull()
      .references(() => classes.id, { onDelete: "cascade" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    sessionDate: date("session_date").notNull(),
    /**
     * 이 출결이 가리키는 **교시**(class_schedules.start_time과 같은 값, 0196a).
     * null = "그날 전체" — 2026-08-10 이전 기록과 교시 구분이 없는 화면의 기본값.
     * ⚠️ 같은 날 한 반이 두 교시면 **교시마다 한 행**이다(그전엔 하루 1건이라 ECS의 4교시·6교시 카드가
     *    같은 행을 비춰 한쪽을 고르면 다른 쪽도 바뀌었다 — 원장 2026-08-10 제보).
     */
    slotStart: time("slot_start"),
    status: attendanceStatusEnum("status").notNull(),
    // 시수(정규 수업 1회 기준 배수, 0115a). null=1(기본). 보강 연장=1.5/2, 부분 출석=0.5 등.
    sessionUnits: numeric("session_units", { precision: 4, scale: 1 }),
    // 이 출결 1건에만 적용하는 급여 티어 예외(0199a). null = 수강(enrollments.salary_tier)을 따른다.
    // 같은 반에서 두 티어를 소비하는 드문 사례(교시 분리 0.5T)용 — 라벨만이라 금액 비노출.
    salaryTier: text("salary_tier"),
    note: text("note"),
    homeworkRequired: boolean("homework_required").notNull().default(false),
    homeworkDone: boolean("homework_done").notNull().default(false),
    // nullable: 키오스크 셀프 체크인이 'present'로 반영하는 행은 입력 직원이 없다(recorded_by=null).
    recordedBy: uuid("recorded_by").references(() => users.id, { onDelete: "restrict" }),
    // null/"manual"=직원 입력, "kiosk"=무인 태블릿 유래.
    accessMethod: attendanceAccessMethodEnum("access_method"),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).defaultNow().notNull(),
    supersedesId: uuid("supersedes_id"),
  },
  (t) => [
    index("attendance_student_date_idx").on(t.tenantId, t.studentId, t.sessionDate),
    index("attendance_class_date_idx").on(t.tenantId, t.classId, t.sessionDate),
  ],
);

// === class_schedules (weekly recurrence pattern for a class) ===
export const classSchedules = pgTable(
  "class_schedules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    classId: uuid("class_id")
      .notNull()
      .references(() => classes.id, { onDelete: "cascade" }),
    dayOfWeek: dayOfWeekEnum("day_of_week").notNull(),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
    validFrom: date("valid_from").notNull(),
    validTo: date("valid_to"),
    // Cell-level overrides (ijw slotTeachers/slotRooms). NULL = inherit classes.teacher_id/classroom_id.
    teacherId: uuid("teacher_id").references(() => users.id, { onDelete: "set null" }),
    classroomId: uuid("classroom_id").references(() => classrooms.id, { onDelete: "set null" }),
    // 셀 단위 표시 라벨 (ijw slotTeachers/slotRooms 그대로). 영문 닉네임("Hannah"/"Zoe")·"LAB"·요일별
    // 강의실("LAB실")은 users.display_name(한글)·classrooms FK로 못 풀어 문자열로 보존 — 통합뷰 미니그리드용.
    // NULL = 반 기본(classes.teacher_id/classroom_id) 상속.
    slotTeacherLabel: text("slot_teacher_label"),
    slotRoomLabel: text("slot_room_label"),
    // Display-only period label ('3교시'). Absolute time (start/end) is the source of truth.
    periodLabel: text("period_label"),
    // 합반(merged): schedules sharing one cell carry the same merge_group. Partial index in alpha SQL.
    mergeGroup: uuid("merge_group"),
    // LAB 자리 교시의 '따로 수업(*LAB)' 표식(0271a) — LAB이 아닌 교시에선 의미 없음. NULL = 꺼짐(0271b: 옛 스냅샷 되살리기가 NULL을 넣는다).
    labSeparate: boolean("lab_separate").default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("schedules_tenant_class_idx").on(t.tenantId, t.classId),
    index("schedules_tenant_day_idx").on(t.tenantId, t.dayOfWeek),
  ],
);

// === english_levels (영어 레벨 정의: DP=Dr.Phonics … MEC. 반이름 약어로 레벨업/다운) ===
export const englishLevels = pgTable(
  "english_levels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    abbreviation: text("abbreviation").notNull(),
    fullName: text("full_name"),
    sortOrder: integer("sort_order").notNull().default(0),
    color: text("color"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("english_levels_tenant_abbr_idx").on(t.tenantId, t.abbreviation)],
);

// === timetable_snapshots (엑셀 import 적용 직전 before-state 백업 → 1클릭 복원) ===
export const timetableSnapshots = pgTable(
  "timetable_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    label: text("label"),
    referenceDate: date("reference_date"),
    summary: jsonb("summary"),
    payload: jsonb("payload").notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("timetable_snapshots_tenant_idx").on(t.tenantId, t.createdAt)],
);

// === timetable_import_logs (엑셀 import 이력: 누가·언제·무엇을, snapshot 참조로 되돌리기 추적) ===
export const timetableImportLogs = pgTable(
  "timetable_import_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    weekLabel: text("week_label"),
    snapshotId: uuid("snapshot_id").references(() => timetableSnapshots.id, {
      onDelete: "set null",
    }),
    result: jsonb("result").notNull(),
    details: jsonb("details"),
    restoredAt: timestamp("restored_at", { withTimezone: true }),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("timetable_import_logs_tenant_idx").on(t.tenantId, t.createdAt)],
);

// === enrollment_consultations (신입생 상담) ===
// Two flows:
//   1. text-only: parent_request is filled manually, processing_status='idle'.
//   2. audio: upload to consultation-recordings bucket → AssemblyAI → Claude 13-section analysis.
//      Same pipeline shape as meetings, status flows uploaded→transcribing→analyzing→completed.
export const enrollmentConsultations = pgTable(
  "enrollment_consultations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    prospectName: text("prospect_name").notNull(),
    prospectGrade: text("prospect_grade"),
    prospectSchool: text("prospect_school"),
    parentName: text("parent_name"),
    parentPhone: text("parent_phone"),
    parentRequest: text("parent_request"),
    learningHistory: jsonb("learning_history"),
    consultantId: uuid("consultant_id").references(() => users.id, { onDelete: "set null" }),
    outcome: consultationOutcomeEnum("outcome").notNull().default("pending"),
    studentId: uuid("student_id").references(() => students.id, { onDelete: "set null" }),
    // Audio + transcription pipeline (mirrors meeting_minutes columns)
    audioPath: text("audio_path"),
    audioDurationSec: integer("audio_duration_sec"),
    audioSizeBytes: integer("audio_size_bytes"),
    transcription: text("transcription"),
    speakerLabels: jsonb("speaker_labels"),
    processingStatus: consultationProcessingStatusEnum("processing_status")
      .notNull()
      .default("idle"),
    processingError: text("processing_error"),
    assemblyaiTranscriptId: text("assemblyai_transcript_id"),
    // 등록 상담 폼 전체(0046a) — ijw ConsultationForm 이식. 과목별 점수 탭은 subjectDetails jsonb에.
    englishName: text("english_name"),
    gender: text("gender"),
    bloodType: text("blood_type"),
    birthDate: date("birth_date"),
    studentPhone: text("student_phone"),
    homePhone: text("home_phone"),
    parentRelation: text("parent_relation"),
    address: text("address"),
    zipCode: text("zip_code"),
    addressDetail: text("address_detail"),
    consultationPath: text("consultation_path"),
    subject: text("subject"),
    careerGoal: text("career_goal"),
    siblings: text("siblings"),
    safetyNotes: text("safety_notes"),
    shuttleBusRequest: boolean("shuttle_bus_request").notNull().default(false),
    registrationStatus: text("registration_status"),
    paymentAmount: numeric("payment_amount"),
    paymentDate: date("payment_date"),
    registrar: text("registrar"),
    privacyAgreement: boolean("privacy_agreement").notNull().default(false),
    installmentAgreement: boolean("installment_agreement").notNull().default(false),
    followUpDate: date("follow_up_date"),
    followUpContent: text("follow_up_content"),
    nonRegistrationReason: text("non_registration_reason"),
    subjectDetails: jsonb("subject_details"),
    // 완전 이식(0064a) — ijw ConsultationForm 잔여 필드.
    counselor: text("counselor"),
    receivedDate: date("received_date"),
    studentType: text("student_type"),
    siblingsDetails: text("siblings_details"),
    // 상담일 = 편집 가능한 순수 date. consulted_at(timestamptz)는 정렬용 레코드 타임스탬프라 폼에서 안 건드린다
    // (timestamptz에 date 문자열을 쓰면 KST↔UTC 하루밀림·시각 소실 발생).
    consultationDate: date("consultation_date"),
    // 사전 상담 브리프(0152a) — 상담 *전* 준비 문서 스냅샷 { source, model, facts, brief }.
    // 상담 *후* 산출물인 consultation_ai_analysis(인수인계서)와 방향이 반대다.
    prepBrief: jsonb("prep_brief"),
    prepBriefAt: timestamp("prep_brief_at", { withTimezone: true }),
    // 생성 백그라운드화(0153b): NULL=대기/완료 · generating · failed. 진행바·watcher 근거.
    prepBriefStatus: text("prep_brief_status"),
    prepBriefError: text("prep_brief_error"),
    // QR 공개접수 출처(0047a)
    fromPublicIntake: boolean("from_public_intake").notNull().default(false),
    intakeTokenId: uuid("intake_token_id").references(() => intakeTokens.id, { onDelete: "set null" }),
    // makeedu 동기화 외부키 — makeedu 예비원생 No(예 725). 부분 유니크는 손수 alpha SQL(0057a).
    makeeduId: text("makeedu_id"),
    // "지난 동기화가 새로 추가" 표시용(목록 ↻ 동기화 배지). 신규 insert 시 now(), 다음 동기화 성공 시 클리어(0062a).
    syncAddedAt: timestamp("sync_added_at", { withTimezone: true }),
    consultedAt: timestamp("consulted_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("ec_tenant_outcome_idx").on(t.tenantId, t.outcome),
    index("ec_tenant_consulted_idx").on(t.tenantId, t.consultedAt),
    index("ec_assemblyai_transcript_idx").on(t.assemblyaiTranscriptId),
  ],
);

// === intake_tokens (학부모 QR 공개접수 토큰, 0047a) ===
// 테넌트별 공개 접수 링크. token=공유 시크릿(URL에 노출). 공개 제출은 admin client가 이 토큰으로 테넌트 해석.
export const intakeTokens = pgTable(
  "intake_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    name: text("name").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    usageCount: integer("usage_count").notNull().default(0),
    submissionCount: integer("submission_count").notNull().default(0),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("intake_tokens_tenant_idx").on(t.tenantId)],
);

// === intake_attempts (공개접수 시도 로그 — 다층 레이트리밋 단일 소스, 0048a) ===
// 거부건 포함 기록 → 시도 기반 per-IP/per-tenant/per-token 제한. 원본 IP 미저장(sha256 해시만).
export const intakeAttempts = pgTable(
  "intake_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    intakeTokenId: uuid("intake_token_id").references(() => intakeTokens.id, { onDelete: "cascade" }),
    ipHash: text("ip_hash").notNull(),
    ok: boolean("ok").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("intake_attempts_ip_idx").on(t.ipHash, t.createdAt),
    index("intake_attempts_tenant_idx").on(t.tenantId, t.createdAt),
    index("intake_attempts_token_idx").on(t.intakeTokenId, t.createdAt),
  ],
);

// === lesson_reports (수업 진도/보고서 — ijw 시간표 학생 hover의 "[진도]" 줄, Edutrix 이식, 0049a) ===
// 학생별 최신 1건이 hover에 표시. 진도/시험/숙제/담당강사.
export const lessonReports = pgTable(
  "lesson_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    reportDate: date("report_date").notNull(),
    progress: text("progress"),
    examInfo: text("exam_info"),
    homeworkScore: text("homework_score"),
    teacherName: text("teacher_name"),
    notes: text("notes"),
    source: text("source"),
    // Edutrix public.reports.id — 이관 멱등 키(0094a). source=edutrix_import 증분·재이관.
    edutrixReportId: text("edutrix_report_id"),
    // 학부모 보고서 표시용 분리 필드 — 0082a(일일/확인테스트·수업태도). 기존 exam_info 합본의 3단계 분리.
    dailyTest: text("daily_test"),
    checkTest: text("check_test"),
    attitude: text("attitude"),
    // 교재명·보강 — 0089a(edutrix 강사 필드 패리티). textbook=과목 교재(학부모 카드에도 표시), makeup=보강 수업 여부.
    textbook: text("textbook"),
    makeup: boolean("makeup").notNull().default(false),
    // 오늘 과제(숙제 내용) — 0096a(edutrix homework_today 패리티, 사용률 90%). homework_score(수행 상태)와 별개.
    // 학부모 카드 표시(showHomeworkToday) + AI 멘트 마무리("오늘 과제는 ~입니다") 재료.
    homeworkToday: text("homework_today"),
    // 오늘 영상 과제 있음/없음 — 0308a. null=모름(기능 이전) → 다음 수업 영상 숙제 검사는 false일 때만 숨긴다.
    videoHomework: boolean("video_homework"),
    // 영상 첨부 링크 넣기(0328a) — 보고서 글에 영상 제출 링크를 붙일지. null = 고른 적 없음(안 붙임).
    videoSubmitLink: boolean("video_submit_link"),
    // 영상 숙제 마감(0425a) — null = 숙제일 + 7일 · 날짜 = '다음 수업'을 고른 보고서의 다음 수업일(video-homework/due.ts).
    videoHomeworkDue: date("video_homework_due"),
    // 학습 추세(종합분석) — 0091a(edutrix graph_eval 이식). 멘트(notes)와 별개. 자동작성 시 함께 생성, /r '학습 추세' 섹션.
    trendNote: text("trend_note"),
    // 멘트(notes) 작성 방식 — 0214a. auto(자동작성 그대로)/auto_edited(자동작성 후 수정)/manual(직접 작성)/
    // NULL(도입 전·미상). 강사별 말투 코퍼스의 키(created_by와 결합). 판정·라벨 = onescreen/ment-source.ts 단일 소스.
    // plain text(체크제약 없음 — classnote_status 선례). 쓰기는 probe(mentSourceColumnReady) 뒤에만(#95).
    mentSource: text("ment_source"),
    // 학부모 공개 보고서 링크(/r/[token]) 토큰 — 0081a. 공개 페이지가 service_role로 이 토큰 단건 조회.
    shareToken: uuid("share_token").notNull().defaultRandom(),
    // ClassNote 발송 큐 + 과목별 dedup — 0083a. 인덱스(부분 유니크·queued 부분)는 0083a alpha에 정의.
    subject: text("subject"),
    // NULL=미요청 / queued / processing / success / failed / too_old / name_conflict / blocked_shared(프리플라이트 보드 안전 게이트 보류).
    // plain text(체크제약 없음) — 새 상태 추가에 마이그레이션 불필요. 라벨은 classnoteBadge가 단일 소스.
    classnoteStatus: text("classnote_status"),
    classnoteError: text("classnote_error"),
    classnoteQueuedAt: timestamp("classnote_queued_at", { withTimezone: true }),
    classnoteProcessingAt: timestamp("classnote_processing_at", { withTimezone: true }),
    classnoteSentAt: timestamp("classnote_sent_at", { withTimezone: true }),
    classnoteRetryCount: integer("classnote_retry_count").notNull().default(0),
    // ClassNote 학부모 읽음(0122a) — 연동 PC 워커가 피드의 read_by_parent.date_read를 채운다(앱은 읽기만).
    classnoteReadAt: timestamp("classnote_read_at", { withTimezone: true }),
    // edutrix reports.share_token — ClassNote 본문 링크(edutrix.vercel.app/share/{uuid})와 잇는 매칭 키(0122a).
    edutrixShareToken: text("edutrix_share_token"),
    // 공유 링크 폐기(취소) — 0085a. 만료(보고서일+90일)는 파생이라 컬럼 없음(share-expiry.ts).
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedBy: uuid("revoked_by").references(() => users.id, { onDelete: "set null" }),
    // 학생 사진 첨부 — 0087a. [{path,name,size}] (report-attachments 버킷). /r·ClassNote 스샷에 렌더.
    attachments: jsonb("attachments").notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("lesson_reports_student_idx").on(t.studentId, t.reportDate),
    index("lesson_reports_tenant_idx").on(t.tenantId),
    uniqueIndex("lesson_reports_share_token_key").on(t.shareToken),
  ],
);

// === share_link_views (학부모 공개 보고서 /r/[token] 조회 로그 — 0086a) ===
// 부모 열람 1회 = 1행(공개 페이지가 service_role로 insert). "N회 열람" 배지·이력. ip_hash는 원본 IP 미저장.
export const shareLinkViews = pgTable(
  "share_link_views",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    lessonReportId: uuid("lesson_report_id")
      .notNull()
      .references(() => lessonReports.id, { onDelete: "cascade" }),
    ipHash: text("ip_hash"),
    userAgent: text("user_agent"),
    viewedAt: timestamp("viewed_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("share_link_views_report_idx").on(t.lessonReportId, t.viewedAt),
    index("share_link_views_tenant_idx").on(t.tenantId, t.viewedAt),
  ],
);

// === onescreen_daily_sessions (선생님 원스크린 "오늘 작업중" 상태 영속 — 새로고침 유지, 0065a) ===
// 점수/진도/태도/과제/진도확정을 (student, session_date) 하루 1행 upsert. lesson_reports(발송 스냅샷)와 별개.
export const onescreenDailySessions = pgTable(
  "onescreen_daily_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    sessionDate: date("session_date").notNull(),
    classId: uuid("class_id")
      .notNull()
      .references(() => classes.id, { onDelete: "cascade" }), // 반 단위(합산 금지 — 반마다 단가 상이)
    studyGrade: text("study_grade"),
    subjectProgress: jsonb("subject_progress").notNull().default({}),
    dailyScore: integer("daily_score"),
    dailyMax: integer("daily_max"),
    checkScore: integer("check_score"),
    checkMax: integer("check_max"),
    // 🔴 표기 모드(0148a) — **더 이상 쓰지 않는다**(원장 2026-08-11: 표기는 맞은 개수 하나뿐).
    //    앱은 읽지도 쓰지도 않으며 컬럼만 남겨 뒀다(옛 행 보존 · 마이그레이션 0). 다시 배선하지 말 것.
    dailyScoreMode: text("daily_score_mode"),
    checkScoreMode: text("check_score_mode"),
    attitude: text("attitude"),
    homework: text("homework"),
    specialNote: text("special_note"), // 강사 특이사항(메모) — 0093a. AI 멘트 입력(공지 모드 A/B).
    progressConfirmed: boolean("progress_confirmed").notNull().default(false),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("onescreen_daily_sessions_student_date_key").on(
      t.tenantId,
      t.studentId,
      t.sessionDate,
    ),
    index("onescreen_daily_sessions_lookup_idx").on(t.tenantId, t.sessionDate, t.studentId),
  ],
);

// === 진도 컨테이너 자동분석 (Edutrix 이식, 0090a) — 현행/선행 컨테이너 + 감사 이벤트 ===
// CHECK(track/status/event_type)·부분 unique(active 1개·report_id 멱등)·updated_at 트리거는 0090a SQL에 정의.
export const progressContainers = pgTable(
  "progress_containers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    track: text("track").notNull(), // current | ahead
    sequenceNumber: integer("sequence_number").notNull().default(1),
    gradeScope: text("grade_scope"), // 개시 시 진도 학년
    startPosition: integer("start_position"),
    lastPosition: integer("last_position"),
    chapterCount: integer("chapter_count").notNull().default(0), // 담긴 엔트리(보고서) 수
    maxJump: integer("max_jump").notNull().default(0),
    status: text("status").notNull().default("active"), // active | archived | errored
    errorReason: text("error_reason"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    openedAt: timestamp("opened_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("progress_containers_seq_key").on(t.studentId, t.track, t.sequenceNumber),
    index("progress_containers_student_idx").on(t.studentId, t.track, t.status),
    index("progress_containers_tenant_idx").on(t.tenantId),
  ],
);

export const progressEntries = pgTable(
  "progress_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    containerId: uuid("container_id")
      .notNull()
      .references(() => progressContainers.id, { onDelete: "cascade" }),
    reportId: uuid("report_id").references(() => lessonReports.id, { onDelete: "set null" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    entryDate: date("entry_date").notNull(),
    softChapterName: text("soft_chapter_name"), // 차시 문자열
    globalPosition: integer("global_position"),
    rawProgress: text("raw_progress"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("progress_entries_container_idx").on(t.containerId, t.entryDate),
    index("progress_entries_student_idx").on(t.studentId, t.entryDate),
  ],
);

export const progressEvents = pgTable(
  "progress_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    containerId: uuid("container_id").references(() => progressContainers.id, { onDelete: "set null" }),
    relatedContainerId: uuid("related_container_id").references(() => progressContainers.id, {
      onDelete: "set null",
    }),
    eventType: text("event_type").notNull(), // forward|regression|jump_error|overlap_error|container_opened|container_closed|manual_note
    fromPosition: integer("from_position"),
    toPosition: integer("to_position"),
    jumpSize: integer("jump_size"),
    reportId: uuid("report_id").references(() => lessonReports.id, { onDelete: "set null" }),
    details: jsonb("details"),
    actor: text("actor"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    // "이상 없음 확인"(0151a) — 사람이 보고 정상이라 판정한 이벤트. 배지·이상 카드·알림 감지에서 제외.
    // 삭제가 아니라 해소 표시라 되돌릴 수 있고 누가 언제 확인했는지 남는다.
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: uuid("resolved_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    index("progress_events_student_idx").on(t.studentId, t.createdAt),
    index("progress_events_container_idx").on(t.containerId, t.createdAt),
    uniqueIndex("progress_events_report_type_key").on(t.reportId, t.eventType),
  ],
);

// === ai_prompt_overrides (AI 멘트 프롬프트 런타임 오버라이드 — edutrix ai_prompt_settings 이식, 0092a) ===
// 활성값(is_active)이 코드 기본 프롬프트를 덮어씀. append-only(버전 이력). (tenant,type)당 활성 1건(부분 unique).
export const aiPromptOverrides = pgTable(
  "ai_prompt_overrides",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    promptType: text("prompt_type").notNull(), // comment | trend | comment_p1 | comment_p2
    promptText: text("prompt_text").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("ai_prompt_overrides_active_key").on(t.tenantId, t.promptType).where(sql`is_active`),
    index("ai_prompt_overrides_history_idx").on(t.tenantId, t.promptType, t.createdAt),
  ],
);

// === teacher_ment_styles (강사별 멘트 말투 프로파일 — 0214a ment_source 코퍼스를 주 1회 접은 것, 0262a) ===
// 강사당 1행. 자동작성(generateReportComment)이 프롬프트 끝에 붙인다. 서버 액션·cron(service_role) 전용 — 정책 0개(의도).
export const teacherMentStyles = pgTable(
  "teacher_ment_styles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    teacherId: uuid("teacher_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    profile: jsonb("profile").notNull(), // { tone, sentence, length, phrases[], closing, caution } — ment-style.ts parseMentStyleProfile
    sampleCount: integer("sample_count").notNull().default(0),
    manualCount: integer("manual_count").notNull().default(0),
    editedCount: integer("edited_count").notNull().default(0),
    corpusHash: text("corpus_hash").notNull(), // 표본 id 지문 — 같으면 AI를 다시 부르지 않는다
    corpusUntil: timestamp("corpus_until", { withTimezone: true }),
    model: text("model"),
    builtBy: text("built_by").notNull().default("cron"), // 'cron' | users.id
    builtAt: timestamp("built_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("teacher_ment_styles_teacher_uniq").on(t.tenantId, t.teacherId)],
);

// === consultation_ai_analysis (AI 분석 결과 — model_version 별 동결 스냅샷) ===
export const consultationAiAnalysis = pgTable(
  "consultation_ai_analysis",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    consultationId: uuid("consultation_id")
      .notNull()
      .references(() => enrollmentConsultations.id, { onDelete: "cascade" }),
    modelVersion: text("model_version").notNull(),
    recommendedClassIds: uuid("recommended_class_ids").array(),
    diagnosis: jsonb("diagnosis").notNull(),
    learningPlan: jsonb("learning_plan").notNull(),
    printPayload: jsonb("print_payload").notNull(),
    generatedAt: timestamp("generated_at", { withTimezone: true }).defaultNow().notNull(),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
    // AI 분석 섹션 인라인 수정 — 마지막 수정자(이름)·시각. (0053a)
    reportEditedBy: text("report_edited_by"),
    reportEditedAt: timestamp("report_edited_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("ai_consultation_model_idx").on(t.consultationId, t.modelVersion)],
);

// === consultation_recordings (등록상담 녹음 — 여러 행, 0068a 손수 alpha) ===
// 여러 상담사가 같은 등록상담에 각자 녹음/업로드를 추가한다(사용자 결정 2026-07-02).
// enrollment_consultations의 단일 오디오 컬럼은 "최신 녹음 미러"로 유지(레거시 소비처 무회귀),
// 13섹션 분석은 녹음 완료 시마다 완료된 전체 녹음 전사 합본으로 재생성(웹훅).
export const consultationRecordings = pgTable(
  "consultation_recordings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    consultationId: uuid("consultation_id")
      .notNull()
      .references(() => enrollmentConsultations.id, { onDelete: "cascade" }),
    audioPath: text("audio_path").notNull(),
    audioSizeBytes: integer("audio_size_bytes"),
    audioDurationSec: integer("audio_duration_sec"),
    transcription: text("transcription"),
    speakerLabels: jsonb("speaker_labels"),
    processingStatus: consultationProcessingStatusEnum("processing_status")
      .notNull()
      .default("uploaded"),
    processingError: text("processing_error"),
    assemblyaiTranscriptId: text("assemblyai_transcript_id"),
    // 누가 녹음/업로드했나(여러 상담사 구분)
    recordedBy: uuid("recorded_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("cr_consultation_idx").on(t.consultationId, t.createdAt),
    index("cr_assemblyai_transcript_idx").on(t.assemblyaiTranscriptId),
    index("cr_tenant_idx").on(t.tenantId),
  ],
);

// === notifications (인앱 알림 — 직원 대상, 0074a 손수 alpha) ===
// "자신과 관련된 행동"이 생기면 수신자에게 1행(수업 배정·반이동 전입·강사 인수인계 등).
// 발송은 service_role(notifyUsers)이 타 사용자에게 insert. RLS: 수신자는 자기 알림만 조회/읽음/삭제.
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    recipientId: uuid("recipient_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    link: text("link"),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    readAt: timestamp("read_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }), // null=받은함, not null=보관함(0125a)
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  // ⚠️ 실 DB(0074a)엔 created_at DESC + 부분 인덱스 `notifications_recipient_unread_idx WHERE read_at is null`도
  // 있으나 Drizzle이 정렬방향·partial을 표현 못 해 여기선 생략(손수 alpha가 정본, CLAUDE.md #15). db:generate 금지.
  (t) => [index("notifications_recipient_idx").on(t.recipientId, t.createdAt)],
);

// === help_posts / help_answers (도움말 질문 게시판, 0265a) ===
// 손수 SQL 이 정본. 쓰기는 서버 액션(service_role). Drizzle 은 타입·문서용.
export const helpPosts = pgTable(
  "help_posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    body: text("body").notNull(),
    status: text("status").notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("help_posts_tenant_created_idx").on(t.tenantId, t.createdAt)],
);

export const helpAnswers = pgTable(
  "help_answers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    postId: uuid("post_id")
      .notNull()
      .references(() => helpPosts.id, { onDelete: "cascade" }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("help_answers_post_idx").on(t.tenantId, t.postId, t.createdAt)],
);

// === student_consultations (재원생 상담 기록) ===
// 카테고리: 일반(general), 학습/성적(academic), 정서/심리(emotional), 진로(career), 교우관계(social), 기타(other)
// 대상: 학부모(parent) / 학생(student) / 학부모+학생(both)
export const studentConsultations = pgTable(
  "student_consultations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    counselorId: uuid("counselor_id").references(() => users.id, { onDelete: "set null" }),
    consultedAt: timestamp("consulted_at", { withTimezone: true }).defaultNow().notNull(),
    category: text("category"), // general / academic / emotional / career / social / other
    subject: text("subject"), // 과목(수학/영어/...) 또는 null
    audience: text("audience"), // parent / student / both
    summary: text("summary").notNull(),
    followUpAction: text("follow_up_action"),
    followUpDate: date("follow_up_date"),
    followUpDone: boolean("follow_up_done").notNull().default(false),
    // 음성→전사→AI 파이프라인(0045a) — enrollment_consultations/meeting_minutes 미러.
    // 텍스트 상담은 processing_status='idle'. 오디오는 uploaded→transcribing→analyzing→completed.
    audioPath: text("audio_path"),
    audioDurationSec: integer("audio_duration_sec"),
    audioSizeBytes: integer("audio_size_bytes"),
    transcription: text("transcription"),
    speakerLabels: jsonb("speaker_labels"),
    processingStatus: consultationProcessingStatusEnum("processing_status")
      .notNull()
      .default("idle"),
    processingError: text("processing_error"),
    assemblyaiTranscriptId: text("assemblyai_transcript_id"),
    // AI 분석 결과 — 행에 직접 저장(재원생은 enrollment 같은 동결 스냅샷 테이블 불요).
    aiReport: jsonb("ai_report"),
    aiSummary: text("ai_summary"),
    aiModelVersion: text("ai_model_version"),
    aiGeneratedAt: timestamp("ai_generated_at", { withTimezone: true }),
    // makeedu 동기화 외부키 — makeedu 상담 No(예 5046). 부분 유니크는 손수 alpha SQL(0057a).
    makeeduId: text("makeedu_id"),
    // "지난 동기화가 새로 추가" 표시용(목록 ↻ 동기화 배지). 신규 insert 시 now(), 다음 동기화 성공 시 클리어(0062a).
    syncAddedAt: timestamp("sync_added_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("sc_tenant_student_idx").on(t.tenantId, t.studentId),
    index("sc_tenant_date_idx").on(t.tenantId, t.consultedAt),
    index("sc_tenant_followup_idx").on(t.tenantId, t.followUpDate),
    index("sc_assemblyai_transcript_idx").on(t.assemblyaiTranscriptId),
  ],
);

// === reenrollment_campaign_targets (재등록 캠페인 대상 추적) ===
// 재등록 위험(risk.renewal) 학생을 퍼널로 추적. status로 진행, 학생당 1트랙(unique).
export const reenrollmentCampaignTargets = pgTable(
  "reenrollment_campaign_targets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    status: reenrollmentStatusEnum("status").notNull().default("pending"),
    counselorId: uuid("counselor_id").references(() => users.id, { onDelete: "set null" }),
    triggerReason: text("trigger_reason"), // 대상 편입 사유 (예: renewal_risk)
    note: text("note"),
    contactedAt: timestamp("contacted_at", { withTimezone: true }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("rct_tenant_student_uq").on(t.tenantId, t.studentId),
    index("rct_tenant_status_idx").on(t.tenantId, t.status),
  ],
);

// === meeting_minutes (회의록) ===
// Two flows:
//   1. text-only: `content` is the meeting body, status='idle'
//   2. audio: upload to Supabase Storage → AssemblyAI transcription → Claude analysis.
//      `audio_path` set, `transcription` filled by webhook, `ai_report` filled after Claude.
export const meetingMinutes = pgTable(
  "meeting_minutes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    // Manual text content (legacy). Audio flow leaves this empty.
    content: text("content").notNull().default(""),
    attendees: jsonb("attendees"),
    heldAt: timestamp("held_at", { withTimezone: true }).notNull(),
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    // Audio + transcription pipeline
    audioPath: text("audio_path"),
    audioDurationSec: integer("audio_duration_sec"),
    audioSizeBytes: integer("audio_size_bytes"),
    transcription: text("transcription"),
    speakerLabels: jsonb("speaker_labels"),
    processingStatus: meetingProcessingStatusEnum("processing_status").notNull().default("idle"),
    processingError: text("processing_error"),
    assemblyaiTranscriptId: text("assemblyai_transcript_id"),
    // AI analysis — `aiReport` is the 8-section structured output, `aiSummary` kept for
    // backward compatibility with the legacy text-only flow.
    aiSummary: text("ai_summary"),
    aiActionItems: jsonb("ai_action_items"),
    aiReport: jsonb("ai_report"),
    // AI 보고서 섹션 인라인 수정 — 마지막 수정자(이름)·시각. (0052a)
    aiReportEditedBy: text("ai_report_edited_by"),
    aiReportEditedAt: timestamp("ai_report_edited_at", { withTimezone: true }),
    aiSpeakerRoles: jsonb("ai_speaker_roles"),
    // 화자(A/B/C) → 직원(users.id) 연결 맵. ai_speaker_roles는 표시 라벨, 이건 연계 기반(staffId). (0050a)
    speakerStaff: jsonb("speaker_staff"),
    aiModelVersion: text("ai_model_version"),
    aiGeneratedAt: timestamp("ai_generated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("mm_tenant_held_idx").on(t.tenantId, t.heldAt),
    index("mm_assemblyai_transcript_idx").on(t.assemblyaiTranscriptId),
  ],
);

// === invoices (월별 청구서) ===
export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "restrict" }),
    period: text("period").notNull(),
    category: text("category").notNull().default("tuition"), // tuition/material/exam/other
    amountTotal: numeric("amount_total", { precision: 12, scale: 0 }).notNull(),
    amountPaid: numeric("amount_paid", { precision: 12, scale: 0 }).notNull().default("0"),
    amountDiscount: numeric("amount_discount", { precision: 12, scale: 0 }).notNull().default("0"),
    status: invoiceStatusEnum("status").notNull().default("unpaid"),
    lineItems: jsonb("line_items").notNull(),
    receiptMergeGroups: jsonb("receipt_merge_groups").notNull().default([]), // 반 이동 수납 합산 설정(동기화 원본과 별도)
    notes: text("notes"),
    dueDate: date("due_date"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    // "지난 동기화가 새로 추가" 표시용(목록 ↻ 동기화 배지). 신규 insert 시 now(), 다음 동기화 성공 시 클리어(0062a).
    syncAddedAt: timestamp("sync_added_at", { withTimezone: true }),
    // 결제 상세(회계/세무 투명성, 0042a) — 결제수단·카드사·현금영수증·적립금·할인사유·청구일.
    paymentMethod: text("payment_method"), // card/transfer/cash/other
    cardCompany: text("card_company"),
    cashReceiptNumber: text("cash_receipt_number"),
    pointsUsed: numeric("points_used", { precision: 12, scale: 0 }).notNull().default("0"),
    discountReason: text("discount_reason"),
    billedAt: date("billed_at"),
    // 청구 시점의 학생 담임강사 id (학생 담임 변경 시에도 invoice는 불변)
    teacherSnapshotId: uuid("teacher_snapshot_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("invoices_tenant_student_period_idx").on(t.tenantId, t.studentId, t.period),
    index("invoices_tenant_status_idx").on(t.tenantId, t.status),
    index("invoices_tenant_period_idx").on(t.tenantId, t.period),
    index("invoices_tenant_category_idx").on(t.tenantId, t.category),
  ],
);

// === textbook_orders (교재신청) ===
// ijw식 3개 독립 체크(등록/주문/납부) + 마지막 변경자·시각. 수납관리 창의 '교재' 책갈피 면.
export const textbookOrders = pgTable(
  "textbook_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    studentId: uuid("student_id").references(() => students.id, { onDelete: "set null" }),
    studentName: text("student_name"), // denormalized (학생 매칭 실패/퇴원 대비 표시용)
    // 🔴 소유자 = teacherName(표시명 스냅샷). 아래 createdBy(실제 작성자)와 **다른 사실**이다 —
    //    대리 작성이 의도된 동작이라 사무실이 강사 앞으로 내면 createdBy=사무실·teacherName=그 강사이고
    //    소유자는 teacherName 쪽이다(ownsTextbookRequest 단일 소스). 둘을 섞지 말 것.
    teacherName: text("teacher_name"),
    // 이 요청을 실제로 저장한 계정(0168a) — 감사·위조 방지(RLS가 INSERT 시 남의 id를 못 적게 막는다).
    // 0168a 이전 447행은 null(작성자 미상) — teacherName으로 백필하지 않았다(의미가 다르다).
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    bookName: text("book_name").notNull(),
    bookDetail: text("book_detail"),
    price: numeric("price", { precision: 12, scale: 0 }).notNull().default("0"),
    status: text("status").notNull().default("requested"), // 파생: paid>ordered>requested (체크에서 도출)
    requestDate: date("request_date"),
    // ijw식 3개 독립 체크 — 각자 타임스탬프(체크=시각, 해제=null).
    registeredAt: timestamp("registered_at", { withTimezone: true }), // 등록
    orderedAt: timestamp("ordered_at", { withTimezone: true }), // 주문
    deliveredAt: timestamp("delivered_at", { withTimezone: true }), // (폐기)
    billedAt: timestamp("billed_at", { withTimezone: true }), // (폐기)
    paidAt: timestamp("paid_at", { withTimezone: true }), // 납부
    // 수동 해제 마커(0079a) — 등록/납부 체크 해제 시 기록, makeedu 자동 체크(mirror-textbook-checks)가 영구 제외(핑퐁 방지).
    checkDismissedAt: timestamp("check_dismissed_at", { withTimezone: true }),
    statusByName: text("status_by_name"), // 마지막 변경자(이름 denormalize)
    statusAt: timestamp("status_at", { withTimezone: true }), // 마지막 변경 시각
    // 학부모에게 이미 나간 공지(0174a). 한 컬럼이 두 일을 한다:
    //  ① 삭제할 때 "이 요청서가 어느 글로 나갔나" 되짚기 ② **중복 발송 차단 표식**
    //     (수업보고서 classnote_status='success'가 재발송을 막는 것과 같은 역할).
    // ⚠️ 채우는 시점은 **발송 성공 직후**여야 한다 — 먼저 채우면 실패한 건이 영영 재발송 불가가 된다.
    // ⚠️ 실제 FK(→ classnote_notices, on delete set null)는 0174a SQL에 있다 —
    //    classnote_notices는 이 파일에 미러돼 있지 않아 참조를 걸 수 없다(문서용 선언).
    classnoteNoticeId: uuid("classnote_notice_id"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("textbook_orders_tenant_status_idx").on(t.tenantId, t.status),
    index("textbook_orders_tenant_student_idx").on(t.tenantId, t.studentId),
    index("textbook_orders_tenant_request_idx").on(t.tenantId, t.requestDate),
  ],
);

// === textbook_catalog (교재 마스터 단가표) ===
// 학원 표준 교재·단가를 한 번 등록해 교재 신청 시 자동 채움(textbook-dialog 교재검색 picker).
// 수납관리 창의 '단가표' 책갈피 면에서 CRUD.
export const textbookCatalog = pgTable(
  "textbook_catalog",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    bookDetail: text("book_detail"), // 단원/상세 (예: "3. 함수")
    gradeLevel: text("grade_level"), // 초/중/고
    subject: text("subject"), // math/english/... (classes.subject 동일 코드)
    publisher: text("publisher"),
    price: numeric("price", { precision: 12, scale: 0 }).notNull().default("0"),
    isActive: boolean("is_active").notNull().default(true),
    // makeedu 동기화 외부키 — makeedu 단가표 No(예 170). 부분 유니크는 손수 alpha SQL(0057a).
    makeeduId: text("makeedu_id"),
    // "지난 동기화가 새로 추가" 표시용(목록 ↻ 동기화 배지). 신규 insert 시 now(), 다음 동기화 성공 시 클리어(0062a).
    syncAddedAt: timestamp("sync_added_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("textbook_catalog_tenant_active_idx").on(t.tenantId, t.isActive),
    index("textbook_catalog_tenant_title_idx").on(t.tenantId, t.title),
  ],
);

// === tuition_catalog (수강료 단가표 — 과목·기타·할인 통합 레지스트리) ===
// ijw 수강료 계산기 "설정"의 수강료 단가표(과목별 회당/월 단가)·기타항목·할인 프리셋을 한 테이블로 통합.
// category로 구분: 과목 분류(수학/EIE/영어/국어) → 단가 picker, "기타" → 부가항목, "할인" → 할인 프리셋.
// 수강료 계산기 면의 '수강료 단가' 서브탭에서 CRUD, 계산기 탭이 소비(picker로 회당단가·할인 자동입력).
export const tuitionCatalog = pgTable(
  "tuition_catalog",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    category: text("category").notNull().default("기타"), // 분류 라벨(수학/EIE/영어/국어/기타/할인) — ijw 충실 이식
    name: text("name").notNull(),
    price: numeric("price", { precision: 12, scale: 0 }).notNull().default("0"), // 회당/월 단가 또는 할인액
    pricingMode: text("pricing_mode"), // per_session/monthly/discount — null=미지정(곱셈 금지, 0102a)
    note: text("note"), // 비고(예: "(3T2H)" 시수 표기, 적용 조건)
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("tuition_catalog_tenant_active_idx").on(t.tenantId, t.isActive),
    index("tuition_catalog_tenant_category_idx").on(t.tenantId, t.category),
  ],
);

// === invoice_session_terms (청구=N회 — 청구서×과목 회차 확정, 0102a) ===
// docs/per-session-billing-plan.md. line_items 밖 별도 테이블(임포터 upsert가 line_items를 통째 교체하므로).
// planned_sessions=자동 산출(참고 전용, N1) / confirmed_sessions=수기 확정(청구값으로 인정되는 유일한 값).
export const invoiceSessionTerms = pgTable(
  "invoice_session_terms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    subject: text("subject").notNull(),
    classId: uuid("class_id")
      .notNull()
      .references(() => classes.id, { onDelete: "cascade" }), // 반 단위(합산 금지 — 반마다 단가 상이)
    plannedSessions: numeric("planned_sessions", { precision: 6, scale: 1 }),
    confirmedSessions: numeric("confirmed_sessions", { precision: 6, scale: 1 }),
    quantityBasis: text("quantity_basis").notNull().default("days"),
    allocationLineIndex: integer("allocation_line_index"),
    allocationAmount: numeric("allocation_amount", { precision: 12, scale: 0 }),
    allocationSource: jsonb("allocation_source"),
    allocationBaseAmount: numeric("allocation_base_amount", { precision: 12, scale: 0 }),
    // 금액 이월(0278a) — 확정액보다 더 받은 몫을 다음 달 반으로. 받는 반은 FK 없음(임베드 모호성, gotchas #94).
    allocationCarryOut: numeric("allocation_carry_out", { precision: 12, scale: 0 }).notNull().default("0"),
    allocationCarryClassId: uuid("allocation_carry_class_id"),
    allocationCarryNote: text("allocation_carry_note"),
    allocationCarryBy: uuid("allocation_carry_by"),
    allocationCarryAt: timestamp("allocation_carry_at", { withTimezone: true }),
    pricingMode: text("pricing_mode").notNull().default("per_session"),
    unitPrice: numeric("unit_price", { precision: 12, scale: 0 }),
    amount: numeric("amount", { precision: 12, scale: 0 }),
    confirmedBy: uuid("confirmed_by").references(() => users.id, { onDelete: "set null" }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("invoice_session_terms_invoice_class_uq").on(t.tenantId, t.invoiceId, t.classId),
    index("invoice_session_terms_invoice_idx").on(t.tenantId, t.invoiceId),
  ],
);

// === invoice_teacher_splits (강사 분배 스냅샷 — 로드맵 2단계 b, 0117a) ===
// 시수 검증의 강사별 분배를 기간 단위로 저장(청구서×반 1행, 저장 시점 담당 강사 스냅샷).
// 기록 전용 — invoices 절대 불변(N2). confirmed_amount(청구 기준)·actual_amount(실측 기준)는 합산 금지(R3).
export const invoiceTeacherSplits = pgTable(
  "invoice_teacher_splits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    classId: uuid("class_id")
      .notNull()
      .references(() => classes.id, { onDelete: "cascade" }),
    period: text("period").notNull(), // 'YYYY-MM' — 기간 조회·재저장 키
    subject: text("subject").notNull(),
    teacherId: uuid("teacher_id").references(() => users.id, { onDelete: "set null" }), // null=미배정
    teacherName: text("teacher_name"), // 표시 스냅샷(개명·삭제 후에도 기록 보존)
    confirmedSessions: numeric("confirmed_sessions", { precision: 6, scale: 1 }).notNull(),
    pricingMode: text("pricing_mode").notNull().default("per_session"),
    unitPrice: numeric("unit_price", { precision: 12, scale: 0 }).notNull(),
    confirmedAmount: numeric("confirmed_amount", { precision: 12, scale: 0 }).notNull(),
    actualUnits: numeric("actual_units", { precision: 6, scale: 1 }).notNull(),
    actualAmount: numeric("actual_amount", { precision: 12, scale: 0 }).notNull(),
    diffAmount: numeric("diff_amount", { precision: 12, scale: 0 }).notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("invoice_teacher_splits_invoice_class_uq").on(t.tenantId, t.invoiceId, t.classId),
    index("invoice_teacher_splits_period_idx").on(t.tenantId, t.period),
    index("invoice_teacher_splits_teacher_idx").on(t.tenantId, t.teacherId),
  ],
);

// === tuition_quotes (수강료 견적 — 신입생 상담용 저장 청구서) ===
// 수강료 계산기의 "청구서로 저장"은 재원생 invoices가 아니라 신입생 상담 견적이다(ijw tuition_invoices 이식).
// 학생정보는 자유 입력(미등록 신입생), 과목·기타·할인은 jsonb 스냅샷. invoices와 완전 분리.
export const tuitionQuotes = pgTable(
  "tuition_quotes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    studentName: text("student_name").notNull(),
    school: text("school"),
    grade: text("grade"),
    consultant: text("consultant"),
    startDate: date("start_date"),
    endDate: date("end_date"),
    courses: jsonb("courses"), // QuoteCourse[] 스냅샷
    extras: jsonb("extras"), // QuoteExtra[]
    discounts: jsonb("discounts"), // QuoteDiscount[]
    totalAmount: numeric("total_amount", { precision: 12, scale: 0 }).notNull().default("0"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("tuition_quotes_tenant_created_idx").on(t.tenantId, t.createdAt),
    index("tuition_quotes_tenant_name_idx").on(t.tenantId, t.studentName),
  ],
);

// === expenses (지출관리) ===
// 학원 지출 기록(인건비/운영비/매입/기타) + 품목 라인아이템. 수납관리 창의 '지출' 책갈피 면.
export const expenses = pgTable(
  "expenses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    category: text("category").notNull().default("기타"), // 인건비/운영비/매입/기타
    // scale 2 — 달러·유로 등 소수 통화 지출($10.60). 원·엔은 소수 자릿수 0으로 코드가 관리(currencies.ts). 0111a.
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull().default("0"),
    expenseDate: date("expense_date").notNull(),
    vendor: text("vendor"),
    department: text("department"),
    author: text("author"),
    paymentMethod: text("payment_method"),
    approvalStatus: text("approval_status").notNull().default("pending"), // pending/approved
    lineItems: jsonb("line_items"),
    memo: text("memo"),
    // 작성자 user id(0112a) — 강사가 제출한 결의서의 "본인 것만" 스코프 소스. 이름 문자열 author와 별개(동명이인 방지).
    // 사무실이 만든 결의서·ijw 임포트본은 NULL. RLS는 tenant-isolation만, own-only는 앱 레이어가 강제.
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("expenses_tenant_date_idx").on(t.tenantId, t.expenseDate),
    index("expenses_tenant_category_idx").on(t.tenantId, t.category),
    index("expenses_tenant_creator_idx").on(t.tenantId, t.createdBy),
  ],
);

// === user_integrations (테넌트별 외부 통합 — 현재 Google Sheets) ===
export const userIntegrations = pgTable(
  "user_integrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    provider: text("provider").notNull().default("google_sheets"),
    spreadsheetId: text("spreadsheet_id"),
    spreadsheetUrl: text("spreadsheet_url"),
    sharedWithEmail: text("shared_with_email"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    lastError: text("last_error"),
    syncEnabled: boolean("sync_enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("user_integrations_tenant_provider_idx").on(t.tenantId, t.provider)],
);

// === student_grades (시험 점수 기록) ===
// 학생별로 시험·과제 점수를 누적. 학생 상세 페이지의 "성적" 탭에서 시각화.
export const studentGrades = pgTable(
  "student_grades",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    // 시험(exams) 일괄입력으로 생성된 점수는 exam_id로 시험에 묶인다. NULL=학생 상세에서 직접 입력한 자유 성적.
    examId: uuid("exam_id").references(() => exams.id, { onDelete: "cascade" }),
    examName: text("exam_name").notNull(),
    subject: text("subject").notNull(),
    score: numeric("score", { precision: 6, scale: 2 }),
    maxScore: numeric("max_score", { precision: 6, scale: 2 }),
    takenOn: date("taken_on").notNull(),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("grades_tenant_student_idx").on(t.tenantId, t.studentId),
    index("grades_tenant_taken_idx").on(t.tenantId, t.takenOn),
    index("grades_exam_idx").on(t.examId),
    // 부분 유니크 ux_grades_exam_student (exam_id, student_id) WHERE exam_id is not null 는
    // 손수 alpha SQL(0028a)에서 — 일괄 저장 upsert 키. (Drizzle은 부분 유니크 WHERE 미표현, #15)
  ],
);

// === exams (시험 정의) ===
// 반/학년/학원 단위 시험을 1급 엔티티로 관리(/exams). 시험 등록 → 일괄 성적입력의 기준.
export const exams = pgTable(
  "exams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    subject: text("subject").notNull(),
    examType: text("exam_type").notNull().default("weekly"), // weekly/mock/school (주간/모의/학교)
    examDate: date("exam_date").notNull(),
    maxScore: numeric("max_score", { precision: 6, scale: 2 }),
    scope: jsonb("scope"), // {type:'class'|'grade'|'academy', classIds?:[], grades?:[]}
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("exams_tenant_date_idx").on(t.tenantId, t.examDate),
    index("exams_tenant_subject_idx").on(t.tenantId, t.subject),
  ],
);

// === level_tests (레벨테스트 — 배치/승급/진단) ===
// 학생 상세 성적 탭의 레벨테스트 섹션. 과목별 세부점수는 subscores jsonb로 유연 수용.
export const levelTests = pgTable(
  "level_tests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    testType: text("test_type").notNull().default("placement"), // placement/promotion/diagnostic
    subject: text("subject").notNull(),
    testedOn: date("tested_on").notNull(),
    level: text("level"), // 결과 레벨/반/등급
    subscores: jsonb("subscores"), // {계산:.., 이해:..} 또는 {어휘:.., 문법:..}
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("level_tests_tenant_student_idx").on(t.tenantId, t.studentId),
    index("level_tests_tenant_tested_idx").on(t.tenantId, t.testedOn),
  ],
);

// === grade_goals (성적 목표설정) ===
// 학생별 목표 점수(과목·시험명 단위). 실제 점수(student_grades)와 examName+subject(또는 examId)로
// 매칭해 달성 여부를 읽기 시점에 산출(denormalize 안 함). ijw GoalSetting 이식.
export const gradeGoals = pgTable(
  "grade_goals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    examId: uuid("exam_id").references(() => exams.id, { onDelete: "set null" }),
    examName: text("exam_name").notNull(),
    subject: text("subject").notNull(),
    targetScore: numeric("target_score", { precision: 6, scale: 2 }).notNull(),
    maxScore: numeric("max_score", { precision: 6, scale: 2 }),
    reason: text("reason"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("grade_goals_tenant_student_idx").on(t.tenantId, t.studentId),
    index("grade_goals_exam_idx").on(t.examId),
  ],
);

// === grade_comments (성적 코멘트 — 학습 피드백) ===
// 학생별 학습 코멘트(카테고리/월/공유여부). 강사 피드백. ijw GradeComment 이식.
export const gradeComments = pgTable(
  "grade_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    category: text("category").notNull(), // strength/improvement/effort/potential/general
    subject: text("subject"), // NULL=전체, 또는 과목 키
    content: text("content").notNull(),
    period: text("period").notNull(), // 'YYYY-MM'
    sharedWithParent: boolean("shared_with_parent").notNull().default(false),
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("grade_comments_tenant_student_idx").on(t.tenantId, t.studentId),
    index("grade_comments_student_period_idx").on(t.tenantId, t.studentId, t.period),
  ],
);

// === student_memos (학생별 자유 메모) ===
// 학생별 자유 메모. 학생 상세 페이지의 "메모" 탭에서 누적 표시.
export const studentMemos = pgTable(
  "student_memos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    category: text("category").notNull().default("general"),
    content: text("content").notNull(),
    pinned: boolean("pinned").notNull().default(false),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("memos_tenant_student_idx").on(t.tenantId, t.studentId)],
);

// === announcements ===
export const announcements = pgTable(
  "announcements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    content: text("content").notNull(),
    audience: announcementAudienceEnum("audience").notNull().default("all"),
    pinned: boolean("pinned").notNull().default(false),
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("announcements_tenant_pinned_created_idx").on(t.tenantId, t.pinned, t.createdAt)],
);

// === notice_popups (셸 진입 시 뜨는 창형 공지 — "팝업광고" 패턴, 0060a) ===
// announcements(대시보드 카드)와 별개: 노출기간·이미지·링크·위치·크기·우선순위를 가진 배너형.
export const noticePopups = pgTable(
  "notice_popups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    body: text("body"),
    imageUrl: text("image_url"),
    linkUrl: text("link_url"),
    linkLabel: text("link_label"),
    audience: announcementAudienceEnum("audience").notNull().default("all"),
    width: integer("width").notNull().default(380),
    position: text("position").notNull().default("cascade"),
    priority: integer("priority").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("notice_popups_tenant_active_idx").on(t.tenantId, t.isActive, t.priority)],
);

// === notice_dismissals (공지 팝업 "N일간/다시 보지 않기" — **계정 단위**, 0162a) ===
// 원래 브라우저 localStorage였는데 origin(스킴+호스트+**포트**) 단위라 dev 포트·브라우저·PC마다 따로 놀았다
// ("다시 보지 않기를 눌렀는데 또 뜬다"). 사람 기준 1행 = (user_id, popup_id).
// version = dismiss 시점의 notice_popups.updated_at — 공지가 수정되면 값이 달라져 옛 설정을 무시하고 재노출한다.
export const noticeDismissals = pgTable(
  "notice_dismissals",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    popupId: uuid("popup_id")
      .notNull()
      .references(() => noticePopups.id, { onDelete: "cascade" }),
    version: timestamp("version", { withTimezone: true }).notNull(),
    until: timestamp("until", { withTimezone: true }), // null = 영구("다시 보지 않기")
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.popupId] }),
    index("notice_dismissals_tenant_idx").on(t.tenantId),
  ],
);

// === academy_documents (데이터베이스 — 학원 서식 저장소, 0067a) ===
// 업로드 파일(kind='file', GCS/Storage 경로)과 앱 작성 문서(kind='text', 인쇄 가능 본문)를 한 목록에서 관리.
// ⚠️ 향후(v2, 미구현): OCR 미처리 파일(이미지·스캔 PDF)을 AI OCR로 본문 추출→메타데이터·색인 저장해 검색 가능하게.
// 그때 `ocr_text text` + 필요 시 `metadata jsonb` 컬럼 추가(평면 테이블이라 ALTER 1번, pg_trgm GIN은 0024a 패턴 재사용).
// · provider = Gemini/OpenAI/Anthropic 중 가성비 비교로 선정 — **Upstage(Solar) vision/OCR 배제**(사용자 실측: 품질 처참, 2026-07-02 결정).
// · 실시간 불필요(업로드 후 백그라운드 캐싱)라 provider **비동기 Batch API(~50% 할인)** 사용이 정석.
// 지금은 title/description/file_name만 검색 대상(orphan 컬럼 금지 원칙 — 소비처 생길 때 컬럼 추가).
export const academyDocuments = pgTable(
  "academy_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    // 0161a — enum → text. 값은 `document_categories.key`(테넌트 소유, 학원장이 추가·삭제) 참조.
    // FK를 안 건 이유: 분류 삭제는 "다른 분류로 이동 후 삭제"(앱 액션)라 cascade/restrict 어느 쪽도 원하는
    // 동작이 아니고, 고아 키는 표시 시 라벨 폴백으로 흡수된다(과목 LEGACY_LABELS와 같은 취급).
    category: text("category").notNull().default("other"),
    kind: text("kind").notNull(), // 'file' | 'text' | 'form' | 'link'
    description: text("description"),
    // kind='file'
    filePath: text("file_path"),
    fileName: text("file_name"),
    fileSize: integer("file_size"),
    mimeType: text("mime_type"),
    // kind='text'
    body: text("body"),
    // kind='link' — 외부 문서(구글드라이브·노션 등) 링크. 사본을 만들지 않고 원본을 가리키기만 한다(0161a).
    linkUrl: text("link_url"),
    // kind='form' — 웹 작성 폼 문서(0072a). form_type='staff_resume' 등, form_data는 폼별 구조화 스키마
    // (직원 이력서 = src/features/staff/resume/resume.ts StaffResumeData). 작성 화면은 /staff?tab=resumes.
    formType: text("form_type"),
    formData: jsonb("form_data"),
    // 사무실 전용 열람(주민번호·급여 등 민감 HR 문서) — RLS restrictive 정책(0072a)이 DB 레벨에서도 강제.
    restricted: boolean("restricted").notNull().default(false),
    pinned: boolean("pinned").notNull().default(false), // 자주 쓰는 서식 상단 고정(목록 정렬 pinned→최신)
    uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    // 직원 이력서 ↔ 직원 연결(0147a) — form_type='staff_resume'가 가리키는 users.id. 직원 삭제 시 문서 보존.
    staffUserId: uuid("staff_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("academy_documents_tenant_category_idx").on(t.tenantId, t.category, t.createdAt)],
);

// === document_categories (0161a) — 서식 저장소 분류를 학원장이 관리 ===
// 0067a의 코드 고정 enum을 대체. 기본 6개는 is_system=true로 시드되며 **삭제 불가**(이력서→'hr',
// 환불요청서→'billing'처럼 코드가 직접 쓰는 고정 대상이 있다). 학원장이 추가한 분류는 key가 `cat_N`
// (앱이 자동 확정·불변 — 과목 `subject_N` 선례. 라벨을 바꿔도 key는 그대로라 기존 문서 연결이 안 끊긴다).
export const documentCategories = pgTable(
  "document_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    key: text("key").notNull(), // academy_documents.category가 참조하는 불변 식별자
    parentKey: text("parent_key"), // 상위 폴더. 동일 테넌트 FK·순환 방지는 0286a SQL.
    label: text("label").notNull(), // 화면 표시 이름(편집 가능)
    sortOrder: integer("sort_order").notNull().default(0),
    isSystem: boolean("is_system").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("document_categories_tenant_key_uq").on(t.tenantId, t.key),
    index("document_categories_tenant_sort_idx").on(t.tenantId, t.sortOrder, t.key),
  ],
);

// === super_admins (SaaS owner layer — academy 권한과 직교) ===
// PK = auth.users.id (1:1 sync). tenant 컬럼 없음 — 모든 tenant 위에 존재.
// 한 사람이 academy master + super_admin 둘 다 가능 (chrismathone 케이스).
export const superAdmins = pgTable("super_admins", {
  id: uuid("id").primaryKey(),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  grantedAt: timestamp("granted_at", { withTimezone: true }).defaultNow().notNull(),
  grantedBy: uuid("granted_by"),
});

// === tenant_licenses (지점별 기능 라이선스 — mathlab TenantLicense 패턴) ===
// feature별 좌석 제한(좌석형) 또는 On/Off(토글형). super_admin이 관리.
export const tenantLicenses = pgTable(
  "tenant_licenses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    feature: text("feature").notNull(), // student_seats(좌석형) / ai_analysis·google_sheets·meeting_recording(토글형)
    maxSeats: integer("max_seats"), // 좌석형만. null = 무제한/해당없음
    usedSeats: integer("used_seats").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("tenant_licenses_tenant_feature_idx").on(t.tenantId, t.feature)],
);

// 슈퍼관리자가 실험실에 배치한 메뉴. 지점별 허용은 tenant_licenses('laboratory')에서 따로 판정한다.
export const labMenuAssignments = pgTable("lab_menu_assignments", {
  menuKey: text("menu_key").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// Laboratory withdrawal reports. Only service transactions write these records.
export const withdrawalReportGroups = pgTable("withdrawal_report_groups", {
  id: uuid("id").primaryKey().defaultRandom(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  studentId: uuid("student_id").notNull().references(() => students.id), requestedBy: uuid("requested_by").notNull().references(() => users.id),
  teacherIds: uuid("teacher_ids").array().notNull(), managerIds: uuid("manager_ids").array().notNull(), directorIds: uuid("director_ids").array().notNull().default(sql`'{}'::uuid[]`),
  subjects: text("subjects").array().notNull(), effectiveDate: date("effective_date").notNull(), exitKind: text("exit_kind").notNull(), snapshot: jsonb("snapshot").notNull(),
  status: text("status").notNull().default("pending"), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), appliedAt: timestamp("applied_at", { withTimezone: true }),
}, t => [index("withdrawal_report_groups_open").on(t.tenantId, t.studentId).where(sql`status not in ('completed','canceled')`)]);
export const withdrawalReports = pgTable("withdrawal_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  studentId: uuid("student_id").notNull().references(() => students.id, { onDelete: "restrict" }),
  requestedBy: uuid("requested_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  teacherId: uuid("teacher_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  // 관리자 승인을 생략한 묶음(작성 강사가 과목 관리자 · s2_0020)은 null.
  managerId: uuid("manager_id").references(() => users.id, { onDelete: "restrict" }),
  directorId: uuid("director_id").references(() => users.id, { onDelete: "restrict" }),
  groupId: uuid("group_id").references(() => withdrawalReportGroups.id, { onDelete: "restrict" }), groupLeader: boolean("group_leader").notNull().default(false),
  managerIds: uuid("manager_ids").array(), directorIds: uuid("director_ids").array(),
  managerDecisions: jsonb("manager_decisions").notNull().default(sql`'{}'::jsonb`), directorDecisions: jsonb("director_decisions").notNull().default(sql`'{}'::jsonb`),
  exitKind: text("exit_kind").notNull(), subjects: text("subjects").array().notNull(),
  effectiveDate: date("effective_date").notNull(), requestNote: text("request_note").notNull().default(""),
  snapshot: jsonb("snapshot").notNull(), body: jsonb("body").notNull().default(sql`'{}'::jsonb`),
  status: text("status").notNull().default("requested"), revision: integer("revision").notNull().default(1),
  managerApprovedAt: timestamp("manager_approved_at", { withTimezone: true }),
  directorApprovedAt: timestamp("director_approved_at", { withTimezone: true }),
  appliedAt: timestamp("applied_at", { withTimezone: true }), lastComment: text("last_comment"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [index("withdrawal_reports_tenant_created").on(t.tenantId, t.createdAt),
  uniqueIndex("withdrawal_reports_one_pending").on(t.tenantId, t.studentId).where(sql`group_id is null and status not in ('completed','canceled')`),
  uniqueIndex("withdrawal_reports_group_teacher").on(t.groupId, t.teacherId).where(sql`group_id is not null`)]);
export const withdrawalReportEvents = pgTable("withdrawal_report_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  reportId: uuid("report_id").notNull().references(() => withdrawalReports.id, { onDelete: "cascade" }),
  actorId: uuid("actor_id").references(() => users.id, { onDelete: "restrict" }),
  action: text("action").notNull(), fromStatus: text("from_status"), toStatus: text("to_status").notNull(),
  body: jsonb("body"), comment: text("comment"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [index("withdrawal_report_events_report").on(t.tenantId, t.reportId, t.createdAt)]);
/** 퇴원보고서 데스크 환불 단계(s2_0020) — 보고서에서 만든 환불 요청서. 요청서(academy_documents)에는 외래키를 걸지 않는다(삭제를 막지 않는다 · 지운 요청서는 대기에서 빠진다). */
export const withdrawalReportRefunds = pgTable("withdrawal_report_refunds", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  reportId: uuid("report_id").notNull().references(() => withdrawalReports.id, { onDelete: "cascade" }),
  groupId: uuid("group_id").references(() => withdrawalReportGroups.id, { onDelete: "cascade" }),
  documentId: uuid("document_id").notNull().unique(),
  deskId: uuid("desk_id").references(() => users.id, { onDelete: "set null" }),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [index("withdrawal_report_refunds_group").on(t.tenantId, t.groupId), index("withdrawal_report_refunds_report").on(t.tenantId, t.reportId)]);

export const withdrawalReportSources = pgTable("withdrawal_report_sources", {
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }), spreadsheetId: text("spreadsheet_id").notNull(), sheetId: bigint("sheet_id", { mode: "number" }).notNull(),
  sheetTitle: text("sheet_title").notNull(), hidden: boolean("hidden").notNull(), grid: jsonb("grid").notNull(), importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.tenantId, t.spreadsheetId, t.sheetId] })]);
export const withdrawalReportArchives = pgTable("withdrawal_report_archives", {
  id: uuid("id").primaryKey().defaultRandom(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  spreadsheetId: text("spreadsheet_id").notNull(), sourceKey: text("source_key").notNull(), sheetId: bigint("sheet_id", { mode: "number" }).notNull(), sheetTitle: text("sheet_title").notNull(), sourceRange: text("source_range").notNull(),
  studentName: text("student_name").notNull(), schoolGrade: text("school_grade").notNull(), className: text("class_name").notNull(), subject: text("subject"), exitDate: date("exit_date"), rawExitDate: text("raw_exit_date").notNull(), teacherName: text("teacher_name").notNull(),
  fields: jsonb("fields").notNull(), signatures: jsonb("signatures").notNull(), rawGrid: jsonb("raw_grid").notNull(), mappedStudentId: uuid("mapped_student_id").references(() => students.id),
  mappingKind: text("mapping_kind").notNull().default("unmapped"), mappingEvidence: jsonb("mapping_evidence").notNull().default(sql`'{}'::jsonb`), revision: integer("revision").notNull().default(1), importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex("withdrawal_report_archives_source").on(t.tenantId, t.spreadsheetId, t.sourceKey), index("withdrawal_report_archives_tenant_date").on(t.tenantId, t.exitDate)]);
export const withdrawalReportArchiveMappings = pgTable("withdrawal_report_archive_mappings", {
  id: uuid("id").primaryKey().defaultRandom(), tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }), archiveId: uuid("archive_id").notNull().references(() => withdrawalReportArchives.id, { onDelete: "cascade" }),
  actorId: uuid("actor_id").notNull().references(() => users.id), previousStudentId: uuid("previous_student_id"), studentId: uuid("student_id"), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// === super_admin_audit_logs (SaaS owner 액션 추적) ===
// 모든 super-admin mutation을 INSERT-only로 기록. service_role로만 write.
export const superAdminAuditLogs = pgTable(
  "super_admin_audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id").notNull(),
    actorEmail: text("actor_email").notNull(),
    action: text("action").notNull(), // create_tenant / update_tenant / impersonate_view / ...
    targetTenantId: uuid("target_tenant_id"),
    targetLabel: text("target_label"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("sa_audit_created_idx").on(t.createdAt),
    index("sa_audit_target_idx").on(t.targetTenantId),
  ],
);

// === attendance_checkins (등하원 — 현관 출입, 시각 기록) ===
// 반별 출석(attendance_records)과 별개. 키오스크 셀프 체크인의 1차 기록처(학생×당일).
// 그날 첫 입력=등원(checked_in_at), 둘째 입력=하원(checked_out_at). recorded_by 없음(무인).
export const attendanceCheckins = pgTable(
  "attendance_checkins",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    checkinDate: date("checkin_date").notNull(),
    checkedInAt: timestamp("checked_in_at", { withTimezone: true }),
    checkedOutAt: timestamp("checked_out_at", { withTimezone: true }),
    accessMethod: attendanceAccessMethodEnum("access_method").notNull().default("kiosk"),
    deviceId: uuid("device_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("checkins_tenant_student_date_idx").on(t.tenantId, t.studentId, t.checkinDate),
  ],
);

// === kiosk_devices (키오스크 기기 등록 — 디바이스 토큰 바인딩) ===
// 원장이 1회 등록 → token_hash 저장 + 기기 쿠키에 평문 토큰. 체크인 API가 상수시간 검증.
// 분실/도난 시 is_active=false로 폐기.
export const kioskDevices = pgTable(
  "kiosk_devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    // 기기 메타 — 등록/최근 접속 IP + User-Agent(기기 종류 추정용). Vercel은 x-forwarded-for로 전달.
    registeredIp: text("registered_ip"),
    lastSeenIp: text("last_seen_ip"),
    userAgent: text("user_agent"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("kiosk_devices_tenant_idx").on(t.tenantId),
    uniqueIndex("kiosk_devices_token_hash_idx").on(t.tokenHash),
  ],
);

// === attendance_notifications (등하원 발송 로그 — 데모는 시뮬레이션) ===
// channel/status="simulated"가 기본(실발송 없음). 카카오 승인 후 "sent"/"failed"로 확장.
export const attendanceNotifications = pgTable(
  "attendance_notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    checkinId: uuid("checkin_id"),
    kind: text("kind").notNull(), // "checkin" | "checkout"
    recipientMasked: text("recipient_masked"),
    message: text("message").notNull(),
    channel: text("channel").notNull().default("simulated"), // simulated | kakao
    status: text("status").notNull().default("simulated"), // simulated | queued | sent | failed
    // 실발송 결과(카카오 연동 ON일 때만). 시뮬레이션 행은 모두 null.
    providerMessageId: text("provider_message_id"),
    error: text("error"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    retryCount: integer("retry_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("attendance_notifications_tenant_created_idx").on(t.tenantId, t.createdAt)],
);

// === kakao_channels (학원별 카카오 발신프로필 + 승인 템플릿 — 실발송 식별자) ===
// operator(AYWA) 단일 계정의 전역 키(solapi.ts)로 발송하되, 학원 식별은 여기 저장한 pfId(발신프로필
// 키)+승인 템플릿 ID로 한다. 이들은 비밀키가 아닌 식별자라 평문 저장(암호화 불필요). 테넌트당 1행.
export const kakaoChannels = pgTable(
  "kakao_channels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    pfId: text("pf_id"), // 발신프로필 키(채널 비즈인증 후 발급)
    checkinTemplateId: text("checkin_template_id"),
    checkoutTemplateId: text("checkout_template_id"),
    smsFallback: boolean("sms_fallback").notNull().default(true), // 알림톡 실패 시 SMS 대체발송
    isActive: boolean("is_active").notNull().default(true),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("kakao_channels_tenant_idx").on(t.tenantId)],
);

// === audit_logs (운영 감사로그 — 테넌트 스코프) ===
// super_admin_audit_logs의 academy 버전. 역할변경·삭제·청구·시험·급여 등 고가치 mutation 추적.
// /admin/audit(master)에서 열람. RLS = 테넌트 격리.
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    actorName: text("actor_name"),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetLabel: text("target_label"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("audit_logs_tenant_created_idx").on(t.tenantId, t.createdAt),
    index("audit_logs_tenant_action_idx").on(t.tenantId, t.action),
  ],
);

// === daily_briefings (운영실 일일 AI 브리핑 — 0114a 손수 alpha) ===
// 하루 1행(tenant×date 유니크 = upsert 타겟). payload=결정론 다이제스트, narrative=LLM 서술(가드 통과분만).
// ⚠️ RLS 정책 없음(select도) — payload가 master 관점 전신호라 서버(admin)가 역할 게이트 후에만 읽는다(#77).
export const dailyBriefings = pgTable(
  "daily_briefings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    briefingDate: date("briefing_date").notNull(), // KST 기준(kstToday)
    processingStatus: text("processing_status").notNull().default("idle"), // idle|analyzing|completed|failed
    processingError: text("processing_error"),
    payload: jsonb("payload"), // DailyBriefingPayload(briefing-digest.ts) — 결정론 전용(스포트라이트 포함)
    narrative: text("narrative"), // v1 단문 서술(하위호환 표시용) — 새 행은 team_report 사용
    teamReport: jsonb("team_report"), // TeamReport(briefing-team-report.ts) {headline, managers[]} — 0116a
    modelVersion: text("model_version"), // UI 미노출
    generatedAt: timestamp("generated_at", { withTimezone: true }),
    notifiedAt: timestamp("notified_at", { withTimezone: true }), // 알림 1회 게이트
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("daily_briefings_tenant_date_uq").on(t.tenantId, t.briefingDate),
    index("daily_briefings_tenant_date_idx").on(t.tenantId, t.briefingDate),
  ],
);

// === assistant_conversations (운영실 AI 비서 대화 — 0117a 손수 alpha) ===
// 🔴 **폐지된 기능의 잔존 표**(원장 2026-09-03: *"대화형 비서 제거. 필요없음."*) — 읽는 코드도 쓰는 코드도
// 이제 없다. 정의만 남긴 이유는 표가 프로덕션에 실재하기 때문이다(지우면 drizzle이 DROP을 만들어
// 과거 대화가 소실된다). 표를 실제로 없앨지는 원장 결정 사항이라 여기서 손대지 말 것.
// 대화 1건 = 1행. messages jsonb는 표시용 텍스트 턴만([{role,content,at}]).
// RLS = (tenant, 본인) own-row 전권 — 실행·저장 전부 사용자 세션(권한 자동 상속), service_role 불사용.
export const assistantConversations = pgTable(
  "assistant_conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title"), // 첫 질문 앞 60자(목록 표시용)
    messages: jsonb("messages").notNull().default([]), // StoredTurn[](turns.ts)
    modelVersion: text("model_version"), // 마지막 응답 모델 id(계측용, UI 미노출)
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("assistant_conversations_tenant_user_idx").on(t.tenantId, t.userId, t.updatedAt)],
);

// === notification_events (이벤트 알림 dedup 원장 — 0118a 손수 alpha, Phase 3) ===
// 한 행 = "이 이벤트를 1회 처리(발송/시드)했다". unique(tenant,event_type,subject_key,bucket)가 재발송 차단.
// write=서버(service_role)만(정책 없음), read=테넌트 select. 앱 표면 없음(부기용) — 알림은 기존 벨.
export const notificationEvents = pgTable(
  "notification_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(), // 'absence_alert' | 'followup_due'
    subjectKey: text("subject_key").notNull(), // 학생·상담 id
    bucket: text("bucket").notNull(), // 상태 전이 표현('3' / '2026-07-17:overdue')
    seeded: boolean("seeded").notNull().default(false), // true = 콜드스타트 무발송 시드
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("notification_events_tenant_type_subject_bucket_uq").on(
      t.tenantId,
      t.eventType,
      t.subjectKey,
      t.bucket,
    ),
    index("notification_events_tenant_type_idx").on(t.tenantId, t.eventType, t.createdAt),
  ],
);

// === ai_usage_logs (AI 호출 usage 계측 — 0113a 손수 alpha) ===
// generateJSON 1회 = 1행. write는 서버(service_role)만(insert 정책 없음), read는 테넌트 select 정책.
// tenant_id nullable: 컨텍스트를 안 넘기는 기존 호출부는 null(스레딩 점진 확장).
export const aiUsageLogs = pgTable(
  "ai_usage_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
    feature: text("feature").notNull(), // 'meeting_analysis' | 'enrollment_analysis' | 'classnote_ment' | 'daily_briefing' …
    provider: text("provider").notNull(), // 'anthropic' | 'upstage'
    model: text("model").notNull(), // 실사용 모델 id (UI 미노출 — 계측 전용)
    // 실제로 쓴 키 이름 — 2026-09-15부터 **기능 그룹**('ment'·'meeting'·'briefing'…)이 들어온다.
    // 'default'로 찍히면 그 기능의 그룹 키가 아직 없어 기본 키로 넘어갔다는 뜻이다(빠진 키가 표에서 드러난다).
    keyName: text("key_name").notNull(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    ok: boolean("ok").notNull().default(true),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("ai_usage_logs_tenant_created_idx").on(t.tenantId, t.createdAt)],
);

// === class_sheet_* (English Class Sheet — 반별 주간 수업계획서/출석부, 0157a 손수 alpha) ===
// 앵커 = 실날짜 plan_date + slot_start(time). class_schedules FK 금지(valid 교체·분절 시 소실), 교시번호 저장 금지.
// 🔒 4테이블 전부 RLS 정책 0개 + PUBLIC/anon/authenticated revoke — 서버 admin client(service_role) 전용.
//    역할 게이트는 앱 레이어 requireEcsClassAccess (src/features/class-sheets/server/access.ts).
// ⚠️ 위치 유니크(class_sheet_plan_lines_pos_uq)는 실제 DB에선 DEFERRABLE 제약(이동 RPC 재번호용) —
//    drizzle은 deferrable을 표현 못해 uniqueIndex로만 선언(문서용. db:generate 금지 저장소라 무해).
export const classSheetPlanLines = pgTable(
  "class_sheet_plan_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    classId: uuid("class_id").notNull(), // (tenant_id, class_id) 복합 FK → classes (0157a)
    planDate: date("plan_date").notNull(),
    slotStart: time("slot_start").notNull(),
    termMode: text("term_mode").notNull().default("regular"), // 'regular'(평시) | 'exam'(내신) — DB CHECK
    skillArea: text("skill_area").notNull(), // settings subjects[].skillAreas[].key — 일반 편집 컬럼(위치 키 아님)
    lineNo: smallint("line_no").notNull(), // 1..20 — 구조변경은 ecs_* RPC 전용(재번호 원자성)
    textbook: text("textbook"),
    pageRange: text("page_range"),
    progress: text("progress"),
    homework: text("homework"),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("class_sheet_plan_lines_pos_uq").on(
      t.tenantId,
      t.classId,
      t.planDate,
      t.slotStart,
      t.termMode,
      t.lineNo,
    ),
    index("class_sheet_plan_lines_class_date_idx").on(t.tenantId, t.classId, t.planDate),
  ],
);

export const classSheetGoals = pgTable(
  "class_sheet_goals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    classId: uuid("class_id").notNull(),
    scope: text("scope").notNull(), // 'month' | 'week' — DB CHECK(period_start 월1일/월요일 강제)
    periodStart: date("period_start").notNull(),
    role: text("role").notNull(), // 'homeroom'(담임) | 'assistant'(부담임)
    skillArea: text("skill_area").notNull(),
    textbook: text("textbook"),
    targetProgress: text("target_progress"),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("class_sheet_goals_uq").on(
      t.tenantId,
      t.classId,
      t.scope,
      t.periodStart,
      t.role,
      t.skillArea,
    ),
    index("class_sheet_goals_class_period_idx").on(t.tenantId, t.classId, t.periodStart),
  ],
);

export const classSheetStudentMarks = pgTable(
  "class_sheet_student_marks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    classId: uuid("class_id").notNull(),
    studentId: uuid("student_id").notNull(), // (tenant_id, student_id) 복합 FK → students (0157a)
    markDate: date("mark_date").notNull(),
    slotStart: time("slot_start").notNull(), // 교시 포함 — 같은 학생 하루 2교시 독립 기록
    status: text("status"), // '완'/'결석'/'안침' 등 자유 라벨(운영 어휘 진화 허용) — 출결 아님
    progressNote: text("progress_note"), // "PL 7, 20개 / PV 4" 등 개인 진도/과제 자유기입
    score: text("score"), // 점수 — 자유 입력('18/20'·'95'·'A'). 0202a, 형식이 제각각이라 숫자로 안 굳힌다
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("class_sheet_student_marks_uq").on(
      t.tenantId,
      t.classId,
      t.studentId,
      t.markDate,
      t.slotStart,
    ),
    index("class_sheet_student_marks_class_date_idx").on(t.tenantId, t.classId, t.markDate),
  ],
);

export const classSheetMemos = pgTable(
  "class_sheet_memos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    classId: uuid("class_id").notNull(),
    weekStart: date("week_start").notNull(), // 월요일 — DB CHECK
    memoKey: text("memo_key").notNull(), // 'week' | 'panel' | 'day:<date>' | 'slot:<date>:<HH:MM>' — DB CHECK(주 범위 검증)
    body: text("body").notNull().default(""),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("class_sheet_memos_uq").on(t.tenantId, t.classId, t.weekStart, t.memoKey),
  ],
);

// === tenant_settings (테넌트 단위 학원 설정 — owner 콘솔) ===
// 단일 행/테넌트. data jsonb에 전체 설정 문서(앱단 Zod + DEFAULT_SETTINGS merge). master가 관리.
export const tenantSettings = pgTable("tenant_settings", {
  tenantId: uuid("tenant_id")
    .primaryKey()
    .references(() => tenants.id, { onDelete: "cascade" }),
  data: jsonb("data").notNull().default({}),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// === class_delegations (반 임시 위임 — 결근 대체 수업, 0173a) ===
// 이 기간 이 반이 대체 강사의 원스크린 로스터에도 실린다. 담임(classes.teacher_id)은 **불변** —
// 영구 교체는 인수인계(classes.pending_teacher_*)가 담당한다(담임을 바꾸면 시간표·급여 splits·
// ECS 스코프가 전부 따라 움직여 되돌리기 어렵다).
// 🔒 RLS = SELECT 정책만(테넌트 내 읽기). 쓰기 정책 없음 → PostgREST 직접 쓰기 불가, 쓰기는 서버 액션
//    (반 쓰기 권한 OR 그 반 담임 본인) → admin client 전용. 게이트 단일 소스 = classes/server/delegation.ts.
export const classDelegations = pgTable(
  "class_delegations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    classId: uuid("class_id").notNull(), // (tenant_id, class_id) 복합 FK → classes (0173a)
    delegateUserId: uuid("delegate_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    fromDate: date("from_date").notNull(), // 포함 구간 [from_date, to_date] — 하루 위임이면 두 값이 같다
    toDate: date("to_date").notNull(),
    reason: text("reason"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    // 해제는 행 삭제가 아니라 revoked_at 기록 — "누가 언제 대신 맡았는지"는 감사 대상이라 지우지 않는다.
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedBy: uuid("revoked_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    index("class_delegations_for_delegate_idx").on(t.tenantId, t.delegateUserId, t.fromDate, t.toDate),
    index("class_delegations_for_class_idx").on(t.tenantId, t.classId, t.fromDate, t.toDate),
  ],
);

// === Type exports ===
export type ClassDelegation = typeof classDelegations.$inferSelect;
export type NewClassDelegation = typeof classDelegations.$inferInsert;
export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
export type TenantSettingsRow = typeof tenantSettings.$inferSelect;
export type NewTenantSettingsRow = typeof tenantSettings.$inferInsert;
export type SuperAdmin = typeof superAdmins.$inferSelect;
export type NewSuperAdmin = typeof superAdmins.$inferInsert;
export type SuperAdminAuditLog = typeof superAdminAuditLogs.$inferSelect;
export type NewSuperAdminAuditLog = typeof superAdminAuditLogs.$inferInsert;
export type TenantLicense = typeof tenantLicenses.$inferSelect;
export type NewTenantLicense = typeof tenantLicenses.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Classroom = typeof classrooms.$inferSelect;
export type NewClassroom = typeof classrooms.$inferInsert;
export type Class = typeof classes.$inferSelect;
export type NewClass = typeof classes.$inferInsert;
export type Student = typeof students.$inferSelect;
export type NewStudent = typeof students.$inferInsert;
export type Enrollment = typeof enrollments.$inferSelect;
export type NewEnrollment = typeof enrollments.$inferInsert;
export type AttendanceRecord = typeof attendanceRecords.$inferSelect;
export type NewAttendanceRecord = typeof attendanceRecords.$inferInsert;
export type ClassSheetPlanLine = typeof classSheetPlanLines.$inferSelect;
export type ClassSheetGoal = typeof classSheetGoals.$inferSelect;
export type ClassSheetStudentMark = typeof classSheetStudentMarks.$inferSelect;
export type ClassSheetMemo = typeof classSheetMemos.$inferSelect;
export type ClassSchedule = typeof classSchedules.$inferSelect;
export type NewClassSchedule = typeof classSchedules.$inferInsert;
export type EnglishLevel = typeof englishLevels.$inferSelect;
export type NewEnglishLevel = typeof englishLevels.$inferInsert;
export type TimetableSnapshot = typeof timetableSnapshots.$inferSelect;
export type NewTimetableSnapshot = typeof timetableSnapshots.$inferInsert;
export type TimetableImportLog = typeof timetableImportLogs.$inferSelect;
export type NewTimetableImportLog = typeof timetableImportLogs.$inferInsert;
export type EnrollmentConsultation = typeof enrollmentConsultations.$inferSelect;
export type NewEnrollmentConsultation = typeof enrollmentConsultations.$inferInsert;
export type ConsultationAiAnalysis = typeof consultationAiAnalysis.$inferSelect;
export type NewConsultationAiAnalysis = typeof consultationAiAnalysis.$inferInsert;
export type StudentConsultation = typeof studentConsultations.$inferSelect;
export type NewStudentConsultation = typeof studentConsultations.$inferInsert;
export type MeetingMinute = typeof meetingMinutes.$inferSelect;
export type NewMeetingMinute = typeof meetingMinutes.$inferInsert;
export type Invoice = typeof invoices.$inferSelect;
export type NewInvoice = typeof invoices.$inferInsert;
export type Announcement = typeof announcements.$inferSelect;
export type NewAnnouncement = typeof announcements.$inferInsert;
export type NoticePopup = typeof noticePopups.$inferSelect;
export type NewNoticePopup = typeof noticePopups.$inferInsert;
export type AcademyDocument = typeof academyDocuments.$inferSelect;
export type NewAcademyDocument = typeof academyDocuments.$inferInsert;
export type DocumentCategoryRow = typeof documentCategories.$inferSelect;
export type NewDocumentCategoryRow = typeof documentCategories.$inferInsert;
export type StudentGrade = typeof studentGrades.$inferSelect;
export type NewStudentGrade = typeof studentGrades.$inferInsert;
export type StudentMemo = typeof studentMemos.$inferSelect;
export type NewStudentMemo = typeof studentMemos.$inferInsert;
export type PayrollRecord = typeof payrollRecords.$inferSelect;
export type NewPayrollRecord = typeof payrollRecords.$inferInsert;
export type StaffLeave = typeof staffLeaves.$inferSelect;
export type NewStaffLeave = typeof staffLeaves.$inferInsert;
export type UserIntegration = typeof userIntegrations.$inferSelect;
export type NewUserIntegration = typeof userIntegrations.$inferInsert;
export type ReenrollmentCampaignTarget = typeof reenrollmentCampaignTargets.$inferSelect;
export type NewReenrollmentCampaignTarget = typeof reenrollmentCampaignTargets.$inferInsert;
export type AttendanceCheckin = typeof attendanceCheckins.$inferSelect;
export type NewAttendanceCheckin = typeof attendanceCheckins.$inferInsert;
export type KioskDevice = typeof kioskDevices.$inferSelect;
export type NewKioskDevice = typeof kioskDevices.$inferInsert;
export type AttendanceNotification = typeof attendanceNotifications.$inferSelect;
export type NewAttendanceNotification = typeof attendanceNotifications.$inferInsert;
export type KakaoChannel = typeof kakaoChannels.$inferSelect;
export type NewKakaoChannel = typeof kakaoChannels.$inferInsert;
export type AiUsageLog = typeof aiUsageLogs.$inferSelect;
export type NewAiUsageLog = typeof aiUsageLogs.$inferInsert;
export type DailyBriefing = typeof dailyBriefings.$inferSelect;
export type NewDailyBriefing = typeof dailyBriefings.$inferInsert;
export type AssistantConversation = typeof assistantConversations.$inferSelect;
export type NewAssistantConversation = typeof assistantConversations.$inferInsert;
export type NotificationEvent = typeof notificationEvents.$inferSelect;
export type NewNotificationEvent = typeof notificationEvents.$inferInsert;
