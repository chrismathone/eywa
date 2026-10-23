import { CONTRIBUTION_PILOT_TENANT } from "./access";
import { lessonKey } from "./subject-evidence";

/** Student-specific confirmations require the exact bill; course-wide owner confirmations remain campus-scoped. */
type Review = { name: string; subject: string; number: string; month: string; seq: number; billed: number; source: string; owner?: boolean };
const ownerDecision = "원장 확인 2026-10-23 · docs/decisions/student-contribution-subjects.md";
const special = "https://docs.google.com/spreadsheets/d/1sf6lEWVGmOssGiKwtW0o8CSjbssZTcweTDJsAO25WvQ/edit#gid=500997994&range=C2:C11";
const math2024 = "https://docs.google.com/spreadsheets/d/1d9s9VLzepBjoIC72_TTZM6C0g5WPgSM8CRG8vniykZ0/edit#gid=1513612170&range=N146:N164";
const math2025 = "https://docs.google.com/spreadsheets/d/1wrZlws2x2s4RqZoneSeRQ9q_0awyVcraOPKdKUvcNMY/edit#gid=778171235&range=H315:AJ336";
const rows: readonly Review[] = [
  { number: "10903", month: "2022-08", seq: 1, billed: 20000, name: "(재원생여름특강)", subject: "english", source: special },
  { number: "11869", month: "2022-08", seq: 6, billed: 20000, name: "(재원생여름특강)", subject: "english", source: special },
  { number: "10147", month: "2024-02", seq: 7, billed: 200000, name: "중등2T 화금", subject: "math", source: math2024 },
  { number: "10147", month: "2024-02", seq: 10, billed: 140000, name: "중등2T 화금", subject: "math", source: math2024 },
  { number: "12835", month: "2025-01", seq: 4, billed: 288000, name: "중등3T 월수목", subject: "math", source: math2025 },
  { number: "09417", month: "2024-02", seq: 5, billed: 278000, name: "중등3T 월수목", subject: "math", source: ownerDecision, owner: true },
  { number: "12303", month: "2024-02", seq: 6, billed: 268000, name: "중등3T 화수금", subject: "math", source: ownerDecision, owner: true },
  { number: "12303", month: "2024-02", seq: 9, billed: 20000, name: "중등3T 화수금", subject: "math", source: ownerDecision, owner: true },
  { number: "13360", month: "2023-09", seq: 5, billed: 120000, name: "중등2T 월목", subject: "math", source: ownerDecision, owner: true },
];

export function reviewedHistoricalSubject(tenant: string, bill: { makeedu_no: string; bill_month: string; seq: number; item_name: string | null; billed: number | string }) {
  if (tenant !== CONTRIBUTION_PILOT_TENANT) return null;
  const month = bill.bill_month.slice(0, 7), name = lessonKey(bill.item_name ?? "");
  if (name === lessonKey("중등내신특강(토)")) return { subject: "math", basis: "owner_confirmed", reference: ownerDecision };
  const exact = rows.find(r => r.number === bill.makeedu_no && r.month === month && r.seq === bill.seq && r.billed === Number(bill.billed) && lessonKey(r.name) === name);
  if (exact) return { subject: exact.subject, basis: exact.owner ? "owner_confirmed" : "reviewed_source", reference: exact.source };
  // The two original bills name Sik; the same historical student also has explicit '초등수학1T 수 Sik'.
  // 2022 timetable L920:L921 records hyun-sik teaching 수학. Do not export this alias to other periods/campuses.
  if (bill.makeedu_no === "11869" && bill.seq === 1 && name === lessonKey("인재원 초등TOP특반1T 수 Sik")
    && ((month === "2022-09" && Number(bill.billed) === 75000) || (month === "2022-10" && Number(bill.billed) === 93750))) {
    return { subject: "math", basis: "reviewed_source", reference: "https://docs.google.com/spreadsheets/d/1ICDydJRqMfpsOawuwo016DQsCxrTdEO8VRwPY24VUNI/edit#gid=2028102955&range=L920:L921" };
  }
  return null;
}
