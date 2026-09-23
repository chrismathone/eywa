import type { HelpManual } from "../types";
import { workspace } from "./workspace";
import { dashboard } from "./dashboard";
import { onescreen } from "./onescreen";
import { timetable } from "./timetable";
import { attendance } from "./attendance";
import { attendanceLive } from "./attendance-live";
import { attendanceQuick } from "./attendance-quick";
import { attendanceSeat } from "./attendance-seat";
import { ecs } from "./ecs";
import { mcs } from "./mcs";
import { classes } from "./classes";
import { lessonReports } from "./lesson-reports";
import { students } from "./students";
import { studentDetail } from "./student-detail";
import { exams } from "./exams";
import { enrollment } from "./enrollment";
import { consultations } from "./consultations";
import { retention } from "./retention";
import { newcomers } from "./newcomers";
import { withdrawals } from "./withdrawals";
import { staff } from "./staff";
import { billing } from "./billing";
import { textbookRequests } from "./textbook-requests";
import { expenseRequests } from "./expense-requests";
import { meetings } from "./meetings";
import { documents } from "./documents";
import { inventory } from "./inventory";
import { textbooks } from "./textbooks";
import { shuttle } from "./shuttle";
import { calendar } from "./calendar";
import { approvals } from "./approvals";
import { classReview } from "./class-review";
import { owner } from "./owner";
import { kioskSettings } from "./kiosk-settings";
import { help } from "./help";

export const MANUALS: HelpManual[] = [
  workspace,
  dashboard,
  onescreen,
  timetable,
  attendance,
  attendanceLive,
  attendanceQuick,
  attendanceSeat,
  ecs,
  mcs,
  classes,
  lessonReports,
  students,
  studentDetail,
  exams,
  enrollment,
  consultations,
  retention,
  newcomers,
  withdrawals,
  staff,
  billing,
  textbookRequests,
  expenseRequests,
  meetings,
  documents,
  inventory,
  textbooks,
  shuttle,
  calendar,
  approvals,
  classReview,
  owner,
  kioskSettings,
  help,
];

export function manualBySlug(slug: string): HelpManual | undefined {
  return MANUALS.find((m) => m.slug === slug);
}

export const HELP_SLUGS = MANUALS.map((m) => m.slug);
