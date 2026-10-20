export type Source<T> = { state: "ready" | "failed" | "restricted"; rows: T[] };
export const ready = <T>(rows: T[]): Source<T> => ({ state: "ready", rows });
export type Enrollment = {
  id: string; start_date: string | null; end_date: string | null;
  on_hold: boolean | null; is_transferred: boolean | null;
};
export type Report = { id: string; report_date: string; subject: string | null; homework_score: string | null;
  class?: { subject: string | null } | { subject: string | null }[] | null };
export type Grade = {
  id: string; subject: string; exam_name: string; taken_on: string;
  score: number | string | null; max_score: number | string | null;
};
export type Level = { id: string; subject: string; test_type: string; tested_on: string; level: string | null };
export type Attendance = {
  id: string; student_id: string; class_id: string; slot_start: string | null;
  session_date: string; recorded_at: string; status: string;
};
export type Consultation = {
  id: string; consulted_at: string; audience: string | null; summary: string | null;
  follow_up_date: string | null; follow_up_done: boolean; follow_up_action: string | null;
};
export type Invoice = { id: string; period: string; status: string; amount_paid: number | string; line_items: unknown };
export type CareRaw = {
  studentId: string; enrolledAt: string | null; today: string; canWriteConsultation: boolean;
  subjectLabels: Record<string, string>;
  enrollments: Source<Enrollment>; reports: Source<Report>; grades: Source<Grade>;
  levels: Source<Level>; attendance: Source<Attendance>; consultations: Source<Consultation>;
  invoices: Source<Invoice>;
};
export type CareSection = {
  key: string; title: string; href: string; state: Source<unknown>["state"];
  summary: string; details: string[];
};
export type CareCard = {
  studentId: string; today: string; canWriteConsultation: boolean; sections: CareSection[];
  followupsState: Source<Consultation>["state"];
  assessment: { label: "집중 관리" | "관찰" | "안정" | "판단 보류"; reasons: string[]; missing: string[] };
  followups: { id: string; date: string; action: string; overdue: boolean }[];
};
