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
]);

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
    systemRole: systemRoleEnum("system_role").notNull().default("viewer"),
    status: userStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("users_tenant_email_idx").on(t.tenantId, t.email),
    index("users_tenant_role_idx").on(t.tenantId, t.systemRole),
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
    school: text("school"),
    grade: text("grade"),
    parentPhone: text("parent_phone"),
    parentName: text("parent_name"),
    status: studentStatusEnum("status").notNull().default("prospect"),
    primaryTeacherId: uuid("primary_teacher_id").references(() => users.id, {
      onDelete: "set null",
    }),
    secondaryTeacherId: uuid("secondary_teacher_id").references(() => users.id, {
      onDelete: "set null",
    }),
    enrolledAt: date("enrolled_at"),
    withdrawnAt: date("withdrawn_at"),
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
    recordedBy: uuid("recorded_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
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
    amountTotal: numeric("amount_total", { precision: 12, scale: 0 }).notNull(),
    amountPaid: numeric("amount_paid", { precision: 12, scale: 0 }).notNull().default("0"),
    status: invoiceStatusEnum("status").notNull().default("unpaid"),
    lineItems: jsonb("line_items").notNull(),
    dueDate: date("due_date"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("invoices_tenant_student_period_idx").on(t.tenantId, t.studentId, t.period),
    index("invoices_tenant_status_idx").on(t.tenantId, t.status),
    index("invoices_tenant_period_idx").on(t.tenantId, t.period),
  ],
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

// === Type exports ===
export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
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
