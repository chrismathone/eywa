import { expect, it } from "vitest";
import { contact, hash } from "../../../../../scripts/student-contribution/parent-events/source-values";
import { parseSource } from "../../../../../scripts/student-contribution/parent-events/parse-source";
import { evaluateRegistrations } from "../../../../../scripts/student-contribution/parent-events/evaluate";
import type { SourceProfile, SourceSheet } from "../../../../../scripts/student-contribution/parent-events/source-types";
import { decideEventAttendance } from "./attendance";
const header = ["학생", "전화", "학년", "학교", "회차"];
const source: SourceSheet = { fileId: "file", title: "설명회", sheet: "신청", gid: 1, url: "https://docs.google.com/spreadsheets/d/file/edit",
  values: [header, ["가학생", "010 - 2345 - 6789", "가람초3", "가람초", "2026/7/1 11:00"]] };
const profile: SourceProfile = { fileId: "file", sheet: "신청", gid: 1, blocks: [{ start: 0, end: 5, firstRow: 1, headerRow: 0,
  headerHash: hash(header), eventKey: "event", seriesKey: "series", title: "설명회", date: "2026-07-01", tenantId: "t", eligibleList: true,
  name: 0, phone: 1, grade: 2, school: 3, dateColumn: 4, sessionColumn: 4, sessionMap: { "2026/7/1 11:00": "" }, markers: [], issues: [] }] };
it("reads full phone digits with spreadsheet spacing or a missing leading zero, never partial narrative digits", () => {
  expect(contact("010 - 2345 - 6789").phones).toEqual(["01023456789"]);
  expect(contact("010. 2345. 6789").phones).toEqual(["01023456789"]);
  expect(contact("1023456789").phones).toEqual(["01023456789"]);
  expect(contact("가보호 1023456789").invalid).toBe(true);
  expect(contact("23456789").phones).toEqual([]);
  expect(contact("01023456789 / 1234").invalid).toBe(true);
  expect(contact("가보호")).toEqual({ phones: [], guardian: "가보호", invalid: false });
  expect(contact("가보호. 01023456789").guardian).toBe("가보호");
});
it("allows an appointment-time confirmation but still holds a time plus absence", () => {
  const check=(value:string)=>decideEventAttendance({eligibleList:true,eventDate:"2026-07-01",today:"2026-10-26",markers:[{kind:"confirmation",value}]}).state;
  expect(check("14:30 설명회 참석 확인")).toBe("recognized");
  expect(check("14:30 설명회 불참")).toBe("review");
});
it("reads a combined school-grade cell and an explicitly reviewed empty session without ignoring conflicts", () => {
  const row = parseSource(source, profile)[0]!;
  expect(row).toMatchObject({ school: "가람초", grade: "초3", eventDate: "2026-07-01", session: "", issues: [] });
  const conflict = structuredClone(source); conflict.values[1]![3] = "다른초";
  expect(parseSource(conflict, profile)[0]!.issues).toContain("school_conflict");
  const multiple = structuredClone(source); multiple.values[1]![2] = "가람초3,4";
  expect(parseSource(multiple, profile)[0]!.issues).toContain("grade_unstructured");
});
it.each(["△(못올수도)", "설명회 전 상담하고 등록해서 참여 X", "안올수도", "참석 X", "5/25 참석날짜 변경"])("holds %s before corrected dates can accidentally turn it into attendance", value => {
  expect(decideEventAttendance({ eligibleList: true, eventDate: "2026-07-01", today: "2026-10-26", markers: [{kind:"note",value}] }).state).toBe("review");
});
it("holds multiple alternate-date applications, deduplicates same-date copies, and keeps separate seminars", () => {
  const row = parseSource(source, profile)[0]!;
  const students = [{ id:"s", tenantId:"t", name:"가학생", guardianPhone:"01023456789", guardianName:"가보호", school:"가람초", grade:"초3", schoolAsOf:"2026-10-26", eligible:true }];
  const evaluate = (rows:typeof row[]) => evaluateRegistrations({tenantId:"t",today:"2026-10-26",rows,students,links:[],canonical:id=>id});
  expect(evaluate([row,{...row,sourceId:"copy"}]).credits).toHaveLength(1);
  const repeat={...row,eventId:"second",eventDate:"2026-07-02",sourceId:"second"};
  const held=evaluate([row,repeat]); expect(held.credits).toHaveLength(0);
  expect(held.outcomes.every(d=>d.reasons.includes("event_series_repeat"))).toBe(true);
  expect(evaluate([row,{...repeat,seriesKey:"different"}]).credits).toHaveLength(2);
});
