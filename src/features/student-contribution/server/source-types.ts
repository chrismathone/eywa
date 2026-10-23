import type { SnapshotClass, SnapshotEnrollment, SnapshotSchedule, SnapshotTransition, SnapshotUser } from "@/features/teacher-portfolio/model/types";
import type { Referral } from "../model/referrals";
import type { ContributionInvoice } from "../model/billing";

export type ContributionStudent = { id: string; name: string; school: string | null; grade: string | null; status: string;
  is_test: boolean; notes: string | null; parent_phone: string | null; makeedu_id: string | null; withdrawal_metadata: unknown };
export type ContributionConsultation = Referral & { referrer_name: string | null; consultation_path: string | null;
  parent_request: string | null; safety_notes: string | null; follow_up_content: string | null };
export type HistoryLink = { makeedu_no: string; student_id: string | null };
export type RawHistoryBill = { makeedu_no: string; bill_month: string; seq: number; item_kind: string; item_name: string | null;
  billed: number | string; paid: number | string; refunded: boolean };
export type CoreSources = { students: ContributionStudent[]; classes: SnapshotClass[]; enrollments: SnapshotEnrollment[];
  schedules: SnapshotSchedule[]; transitions: SnapshotTransition[]; users: (SnapshotUser & { english_name?: string | null })[];
  invoices: ContributionInvoice[]; consultations: ContributionConsultation[]; historyLinks: HistoryLink[];
  lessonTeachers?: import("../model/subject-evidence").LessonTeacher[] };
