/** Import decisions are pure; raw contact data stays in the gated import workflow. */
export type EventStudent = {
  id: string; tenantId: string; name: string; guardianName: string | null; guardianPhone: string | null;
  studentPhone?: string | null; school: string | null; grade: string | null; schoolAsOf: string | null; eligible: boolean;
};
export type EventSiblingLink = { student_a: string; student_b: string; linked: boolean };
export type EventIdentity = {
  tenantId: string | null; eventId: string; eventDate: string; sourceRef: string;
  studentName: string; guardianName: string; phones: readonly string[]; school: string; grade: string;
  gradeReference?: "current" | "next";
  /** Explicit date printed on the source's school/grade column, when different from the event date. */
  gradeAsOf?: string;
  /** A reviewer confirmed this is a distinct event/session sharing a date with another event. */
  sameDayReviewed?: boolean;
};
export type EventReason = "source_missing" | "event_missing" | "event_date_invalid" | "tenant_unknown"
  | "phone_missing" | "phone_invalid" | "student_not_found" | "name_phone_conflict" | "ambiguous_student"
  | "guardian_missing" | "guardian_conflict" | "household_conflict" | "school_conflict" | "grade_conflict"
  | "school_date_unknown" | "shared_phone";
export type EventIdentityMatch = {
  state: "matched" | "review"; studentIds: string[]; candidates: string[]; reasons: EventReason[];
  basis: "student" | "household" | null;
};
export type EventAttribution = { studentId: string; anchorId: string; basis: "direct" | "phone" | "explicit_sibling" };
export type EventMarker = { kind: "attendance" | "absence_checkbox" | "cancellation" | "confirmation" | "note" | "other_event_attendance"; value: string; targetEventIds?: string[] };
export type EventAttendance = {
  state: "recognized" | "cancelled" | "review" | "scheduled" | "excluded";
  basis: "explicit_attendance" | "registration_policy" | "cancellation" | "unconfirmed" | "future_event" | "not_registration";
  reasons: string[];
};
