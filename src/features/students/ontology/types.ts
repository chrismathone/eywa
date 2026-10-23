/** 학생 중심 연결 계약. 원본 표를 복제하거나 도메인별 접근 권한을 넓히지 않는다. */
export type EntityKind = "student" | "guardian" | "teacher" | "class" | "subject" | "academy";
export type EntityRef = { kind: EntityKind; id: string };
export type StudentSource = "students" | "enrollments" | "enrollment_consultations" | "invoices"
  | "makeedu_history_bills" | "attendance_records" | "student_homework_videos" | "student_grades"
  | "classnote_parent_messages" | "classnote_parent_replies" | "student_positive_signals" | "lesson_reports" | "class_schedules" | "audit_logs";
export type EvidenceRef = { source: StudentSource; id: string; /** 원본 학생(병합 전도 보존). */ studentId: string };
export type StudentFact<Value = unknown> = {
  tenantId: string;
  /** 병합을 해석한 현재 학생. evidence.studentId와 구분한다. */
  studentId: string;
  id: string;
  /** 출결 상태·청구 순액 등 원본별 타입은 해당 어댑터가 정의한다. */
  value: Value;
  kind: "consulted" | "referred" | "enrolled" | "tuition" | "attendance" | "homework" | "exam" | "observation";
  /** 발생 시점과 확인 시점은 다르다. 월 원자료를 날짜로 꾸미지 않는다. */
  occurred: { precision: "day" | "month"; value: string };
  recordedAt: string;
  related: readonly EntityRef[];
  evidence: readonly EvidenceRef[];
  basis: "recorded" | "rule" | "ai";
  /** 이 표식은 권한 판정을 대체하지 않는다. 반환 전에 각 원본 권한을 확인한다. */
  access: "student" | "billing" | "contribution";
  ruleVersion?: string;
  state: "active" | "cancelled" | "pending";
};

/** 수강·담당·소개 등 시간에 따라 달라지는 관계. 겸임·복수 수강을 허용한다. */
export type StudentRelation = {
  tenantId: string; from: EntityRef; to: EntityRef;
  kind: "guardian" | "sibling" | "referred" | "taughtBy" | "enrolledIn" | "subjectOf" | "belongsTo";
  validFrom: string | null; validTo: string | null;
  evidence: readonly EvidenceRef[];
};

export type SourceCoverage = {
  source: StudentSource; from: string | null; through: string | null;
  state: "ready" | "pending" | "unavailable"; note?: string;
};
