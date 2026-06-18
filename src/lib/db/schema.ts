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
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("schedules_tenant_class_idx").on(t.tenantId, t.classId),
    index("schedules_tenant_day_idx").on(t.tenantId, t.dayOfWeek),
  ],
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
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("sc_tenant_student_idx").on(t.tenantId, t.studentId),
    index("sc_tenant_date_idx").on(t.tenantId, t.consultedAt),
    index("sc_tenant_followup_idx").on(t.tenantId, t.followUpDate),
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
    aiSpeakerRoles: jsonb("ai_speaker_roles"),
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
// 학생 교재 신청 → 주문 → 배부 → 청구 → 납부 라이프사이클. 수납관리 창의 '교재' 책갈피 면.
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
    status: text("status").notNull().default("requested"), // requested/ordered/delivered/billed/paid
    requestDate: date("request_date"),
    orderedAt: timestamp("ordered_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    billedAt: timestamp("billed_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
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
    channel: text("channel").notNull().default("simulated"),
    status: text("status").notNull().default("simulated"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("attendance_notifications_tenant_created_idx").on(t.tenantId, t.createdAt)],
);

// === Type exports ===
export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
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
