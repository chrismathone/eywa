import type { MenuKey } from "@/lib/permissions";

/** Subscribe only to source areas the server has authorized. Payloads are never used as metrics. */
export const OVERVIEW_TABLES: { table: string; menu: MenuKey }[] = [
  { table: "students", menu: "students" },
  { table: "enrollments", menu: "students" },
  { table: "classes", menu: "classes" },
  { table: "class_schedules", menu: "timetable" },
  { table: "attendance_records", menu: "attendance" },
  { table: "invoices", menu: "billing" },
  { table: "expenses", menu: "billing" },
  { table: "enrollment_consultations", menu: "enrollment" },
  { table: "student_consultations", menu: "consultations" },
  { table: "student_onboarding_checks", menu: "newcomers" },
  { table: "lesson_reports", menu: "lesson_reports" },
  { table: "users", menu: "staff" },
  { table: "announcements", menu: "dashboard" },
  { table: "meeting_minutes", menu: "meetings" },
  { table: "academy_documents", menu: "documents" },
  { table: "approval_documents", menu: "approvals" },
  { table: "approval_steps", menu: "approvals" },
  { table: "inventory_assets", menu: "inventory" },
  { table: "inventory_supplies", menu: "inventory" },
  { table: "calendar_events", menu: "calendar" },
  { table: "leave_forms", menu: "calendar" },
  { table: "class_sheet_plan_lines", menu: "ecs" },
  { table: "class_sheet_student_marks", menu: "ecs" },
  { table: "shuttle_vehicles", menu: "shuttle" },
  { table: "exams", menu: "exams" },
];

export function overviewTables(allowed: readonly MenuKey[]) {
  return OVERVIEW_TABLES.filter(({ menu }) => allowed.includes(menu)).map(
    ({ table }) => table,
  );
}

/** Burst coalescing, with a ceiling so continuous edits cannot indefinitely postpone a refresh. */
export function refreshDelay(firstSignal: number, now: number) {
  return Math.min(1200, Math.max(0, 5000 - (now - firstSignal)));
}
