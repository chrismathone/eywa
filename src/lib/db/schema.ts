import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
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
    // 급여 정산용. 외부 노출은 master + 본인만 (RLS).
    hourlyRate: numeric("hourly_rate", { precision: 10, scale: 0 }).notNull().default("0"),
    monthlyBase: numeric("monthly_base", { precision: 10, scale: 0 }).notNull().default("0"),
    // 주간 근무 시간표 — { mon: ["09:00-12:00", …], … } 요일별 시간대 배열. null = 미설정.
    workSchedule: jsonb("work_schedule"),
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
    notes: text("notes"),
    // Cell color (ijw bgColor/textColor). Stored as #RRGGBB; ARGB normalized on import.
    bgColor: text("bg_color"),
    textColor: text("text_color"),
    // 강사 인수인계(담임 교체) 예약 — ijw TeacherHandover 경량 이식(0044a). NULL=예약 없음.
    pendingTeacherId: uuid("pending_teacher_id").references(() => users.id, { onDelete: "set null" }),
    pendingTeacherDate: date("pending_teacher_date"),
    pendingTeacherReason: text("pending_teacher_reason"),
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
    name: text("name").notNull(),
    englishName: text("english_name"),
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
    primaryTeacherId: uuid("primary_teacher_id").references(() => users.id, {
      onDelete: "set null",
    }),
    secondaryTeacherId: uuid("secondary_teacher_id").references(() => users.id, {
      onDelete: "set null",
    }),
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
    index("students_tenant_primary_teacher_idx").on(t.tenantId, t.primaryTeacherId),
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
    status: attendanceStatusEnum("status").notNull(),
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
    // QR 공개접수 출처(0047a)
    fromPublicIntake: boolean("from_public_intake").notNull().default(false),
    intakeTokenId: uuid("intake_token_id").references(() => intakeTokens.id, { onDelete: "set null" }),
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
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("lesson_reports_student_idx").on(t.studentId, t.reportDate),
    index("lesson_reports_tenant_idx").on(t.tenantId),
  ],
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
    notes: text("notes"),
    dueDate: date("due_date"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
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
    teacherName: text("teacher_name"),
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
    statusByName: text("status_by_name"), // 마지막 변경자(이름 denormalize)
    statusAt: timestamp("status_at", { withTimezone: true }), // 마지막 변경 시각
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
    amount: numeric("amount", { precision: 12, scale: 0 }).notNull().default("0"),
    expenseDate: date("expense_date").notNull(),
    vendor: text("vendor"),
    department: text("department"),
    author: text("author"),
    paymentMethod: text("payment_method"),
    approvalStatus: text("approval_status").notNull().default("pending"), // pending/approved
    lineItems: jsonb("line_items"),
    memo: text("memo"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("expenses_tenant_date_idx").on(t.tenantId, t.expenseDate),
    index("expenses_tenant_category_idx").on(t.tenantId, t.category),
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
// operator(EYWA) 단일 계정의 전역 키(solapi.ts)로 발송하되, 학원 식별은 여기 저장한 pfId(발신프로필
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

// === Type exports ===
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
