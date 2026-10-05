import { describe, expect, it } from "vitest";
import { additionalReserveBlock } from "./additional";
import { effectMayTouchAttendance, mappedParticipationSend, participationCommandPayload, planMappedAttendanceUnits, participationStatusOf } from "./attendance-effect";
import { dayOccurrenceKey, freezeOccurrence, linkAlias, rejectFakeAbsence } from "./occurrence";
import { decideMakeupAction } from "./permissions";
import { decideSameDayNative, mappedSameDayDecision } from "./participation";
import { judgeProjectionEvidence, type ProjectionEvidence } from "./projection-evidence";
import { decideReportUpsert } from "./report-decision";
import { splitLegacyBatch } from "./legacy-plan";
import { addedClassPairs, nativeLessonDraft, rosterOriginLabel } from "./roster-merge";
import { parseMakeupCommand, REVISION_REQUIRED } from "./schemas";

const assignment = { owner: false, teaching: false, conducting: false, desk: false };

describe("사건·권한·참여", () => {
  it("고정 키는 다시 만들지 않고, 같은 출처가 다른 사건이면 충돌이다", () => {
    expect(freezeOccurrence("day:frozen", "day:new", false).key).toBe("day:frozen");
    expect(freezeOccurrence(null, "", true).conflict).toBe(true);
    const key = dayOccurrenceKey({ tenantId: "t", studentId: "s", originalClassId: "c", originalDate: "2026-10-05" });
    expect(linkAlias({ occurrenceKey: "other", sourceKind: "attendance", sourceId: "a", aliases: [{ occurrenceKey: key, sourceKind: "attendance", sourceId: "a" }] }).conflict).toBe(true);
    expect(rejectFakeAbsence({ cause: "additional", originalDate: "2026-10-01" })).toBeTruthy();
  });

  it("실시한 사람은 보호 계정이어도 검토하지 못하고, 매니저는 승인하지 못한다", () => {
    expect(decideMakeupAction({ role: "admin", access: "full", action: "verify", assignment: { ...assignment, conducting: true }, actorId: "u", conductorId: "u", unrestricted: true }).ok).toBe(false);
    expect(decideMakeupAction({ role: "manager", access: "full", action: "approve", assignment, actorId: "u", conductorId: null }).ok).toBe(false);
    expect(decideMakeupAction({ role: "teacher", access: "scoped", action: "submit", assignment: { ...assignment, teaching: true }, actorId: "u", conductorId: null }).ok).toBe(true);
    expect(decideMakeupAction({ role: "teacher", access: "readonly", action: "submit", assignment: { ...assignment, teaching: true }, actorId: "u", conductorId: null }).ok).toBe(false);
  });

  it("같은 담당의 정규+보강 1회만 허용하고 둘째 참여는 거절한다", () => {
    const common = { subjectKey: "math", pilotSubjects: ["math"], addingNative: true, nativeCount: 0, hasRegularSameAnchor: true };
    expect(decideSameDayNative({ ...common, regularTeacherId: "t", makeupTeacherId: "t" })).toBeNull();
    expect(decideSameDayNative({ ...common, regularTeacherId: "t", makeupTeacherId: "o" })).toBeTruthy();
    expect(decideSameDayNative({ ...common, nativeCount: 1, regularTeacherId: "t", makeupTeacherId: "t" })).toBeTruthy();
    expect(decideSameDayNative({ ...common, subjectKey: "english", regularTeacherId: null, makeupTeacherId: null })).toBeTruthy();
    const live = { mode: "on" as const, subjectKey: "math", pilotSubjects: ["math"], nativeCount: 1, hasRegularSameAnchor: true, regularTeacherId: "t", makeupTeacherId: "t" };
    expect(mappedSameDayDecision(live)).toBeNull();
    expect(mappedSameDayDecision({ ...live, makeupTeacherId: "o" })).toBeTruthy();
    expect(mappedSameDayDecision({ ...live, regularTeacherId: null })).toBeTruthy();
    expect(mappedSameDayDecision({ ...live, nativeCount: 2 })).toBeTruthy();
    expect(mappedSameDayDecision({ ...live, mode: "off", makeupTeacherId: "o" })).toBeNull();
    expect(mappedSameDayDecision({ ...live, subjectKey: "english", nativeCount: 0, makeupTeacherId: "o" })).toBeNull();
  });

  it("반 없는 보고서는 연결된 참여만 갱신하고, 조회 실패면 저장하지 않는다", () => {
    const row = { makeup: true, classId: null, subjectKey: "math", mode: "on" as const, pilotSubjects: ["math"], creating: false, existingReportId: "r1", participants: [{ id: "p", reportId: "r1" }] };
    expect(decideReportUpsert({ ...row, lookup: "ok" })).toBeNull();
    expect(decideReportUpsert({ ...row, lookup: "ok", existingReportId: "r2" })).toBeTruthy();
    expect(decideReportUpsert({ ...row, lookup: "failed" })).toBeTruthy();
    expect(decideReportUpsert({ ...row, mode: "off", lookup: "ok", existingReportId: "r2" })).toBeNull();
    expect(decideReportUpsert({ ...row, lookup: "schema_missing", existingReportId: "r2" })).toBeNull();
    expect(decideReportUpsert({ ...row, classId: "class", lookup: "failed" })).toBeNull();
  });

  it("연결이 둘이면 둘 다 멈추고, 없는 연결만 옛 이행을 탄다", () => {
    const split = splitLegacyBatch([
      { id: "a", studentId: "s", mapped: true },
      { id: "b", studentId: "s", mapped: true },
      { id: "c", studentId: "s", mapped: false },
      { id: "d", studentId: "o", mapped: true },
    ]);
    expect(split.hold.map((row) => row.id)).toEqual(["a", "b"]);
    expect(split.fulfil.map((row) => row.id)).toEqual(["c"]);
    expect(split.project.map((row) => row.id)).toEqual(["d"]);
  });

  it("추가 지도는 정책 전에는 예약만 막고 결석일을 만들지 않는다", () => {
    expect(additionalReserveBlock({ cause: "additional", originalDate: null, allowAdditional: false, billingPolicy: "undecided", anchorClassId: null })).toBeTruthy();
    expect(additionalReserveBlock({ cause: "additional", originalDate: "2026-10-01", allowAdditional: true, billingPolicy: "minutes", anchorClassId: "c" })).toBeTruthy();
    expect(additionalReserveBlock({ cause: "absence", originalDate: "2026-10-01", allowAdditional: false, billingPolicy: null, anchorClassId: null })).toBeNull();
  });

  it("연결 시수는 한 번만 더하고, 정규일 출석은 참여 증거가 아니다", () => {
    const first = { unitsExplicit: false, created: true, storedUnits: null, makeupUnits: 0.5, dayWide: true, regularAttendee: true, classMinutes: 80 };
    const opened = planMappedAttendanceUnits(first);
    expect(opened.writeUnits).toBe(1.5);
    expect(opened.regularDay).toBe(true);
    expect(planMappedAttendanceUnits({ ...first, created: false, storedUnits: 1.5 }).writeUnits).toBeUndefined();
    expect(planMappedAttendanceUnits({ ...first, storedUnits: 1.5 }).writeUnits).toBe(1.5);
    expect(planMappedAttendanceUnits({ ...first, unitsExplicit: true, storedUnits: 2 }).writeUnits).toBeUndefined();
    expect(planMappedAttendanceUnits({ ...first, classMinutes: null }).writeUnits).toBeUndefined();
    expect(planMappedAttendanceUnits({ ...first, dayWide: false }).writeUnits).toBeUndefined();
    const onlyMakeup = planMappedAttendanceUnits({ ...first, regularAttendee: false, classMinutes: 0 });
    expect(onlyMakeup).toMatchObject({ writeUnits: 0.5, regularDay: false });
    expect(effectMayTouchAttendance("participation")).toBe(false);
    expect(mappedParticipationSend({ regularDay: true, mark: "present", slotMinutes: 60 })).toMatchObject({ send: false, reason: "regular_day" });
    expect(mappedParticipationSend({ regularDay: false, mark: "present", slotMinutes: 60 })).toMatchObject({ send: true, status: "present", actualMinutes: 60 });
    expect(mappedParticipationSend({ regularDay: false, mark: "present", slotMinutes: 0 })).toMatchObject({ send: false, reason: "unknown_actual" });
    expect(mappedParticipationSend({ regularDay: false, mark: "early_leave", slotMinutes: 60 })).toMatchObject({ send: false, reason: "unknown_actual" });
    expect(mappedParticipationSend({ regularDay: false, mark: "absent", slotMinutes: 60 })).toMatchObject({ send: true, status: "no_show", actualMinutes: 0 });
    expect(planMappedAttendanceUnits({ ...first, created: false, storedUnits: 2 }).writeUnits).toBeUndefined();
    expect(participationStatusOf("late")).toBe("present");
    const payload = participationCommandPayload({
      participantId: "p", studentId: "s", subjectKey: "math", sessionDate: "2026-10-05", classId: "c",
      status: "present", attendanceRecordId: "a", effectKey: "att:p", actualMinutes: 60,
      manualUnits: null, expectedMakeupUnits: 0.5, expectedTotalUnits: 1.5, reportId: null,
    });
    expect(Object.keys(payload).sort()).toEqual([
      "actual_minutes", "attendance_record_id", "class_id", "effect_key", "expected_makeup_units",
      "expected_total_units", "manual_units", "participant_id", "session_date", "status", "student_id", "subject_key",
    ]);
    expect(participationCommandPayload({ ...{
      participantId: "p", studentId: "s", subjectKey: "math", sessionDate: "2026-10-05", classId: "c",
      status: "present" as const, attendanceRecordId: "a", effectKey: "att:p", actualMinutes: 60,
      manualUnits: null, expectedMakeupUnits: 0.5, expectedTotalUnits: 1.5, reportId: "r",
    } }).report_id).toBe("r");
    const evidence: ProjectionEvidence = {
      attendanceRecordId: "a", sessionUnits: null, sessionUnitsRead: true, taughtBy: null, taughtByRead: true,
      reportId: "r", actualTeacherId: "t",
    };
    expect(judgeProjectionEvidence({ commandSent: true, commandAccepted: true, commandError: null, evidence }).state).toBe("done");
    expect(judgeProjectionEvidence({ commandSent: true, commandAccepted: true, commandError: null, evidence: { ...evidence, reportId: null } }).state).toBe("pending");
    expect(judgeProjectionEvidence({ commandSent: true, commandAccepted: false, commandError: "fail", evidence }).state).toBe("failed");
    expect(judgeProjectionEvidence({ commandSent: false, commandAccepted: false, commandError: null, evidence }).state).toBe("pending");
  });

  it("반이 없는 참여는 명단에 올리지 않고, 시각이 없으면 시수를 만들지 않는다", () => {
    expect(addedClassPairs(new Set(["s|c"]), [{ studentId: "s", classId: "c", status: "present" }, { studentId: "n", classId: null, status: "present" }])).toEqual([]);
    expect(nativeLessonDraft({ studentId: "s", classId: "c", sessionDate: "2026-10-05", startTime: null, endTime: null, status: "present" })).toMatchObject({ review: expect.any(String) });
  });

  it("명령은 확정된 필수값만 받고 정책 버전은 승인에서 빼도 된다", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(parseMakeupCommand({ command_id: id, action: "approve", expected_revision: null, payload: { case_id: "c" } }).ok).toBe(false);
    expect(parseMakeupCommand({ command_id: id, action: "approve", expected_revision: 3, payload: { case_id: "c" } }).ok).toBe(true);
    expect(parseMakeupCommand({ command_id: id, action: "approve", expected_revision: 3, payload: { case_id: "c", quantity_unit: "sessions" } }).ok).toBe(false);
    expect(parseMakeupCommand({ command_id: id, action: "assign", expected_revision: 1, payload: { case_id: "c", owner_id: null } }).ok).toBe(true);
    expect(parseMakeupCommand({ command_id: id, action: "assign", expected_revision: 1, payload: { case_id: "c", due_date: "2026-11-30" } }).ok).toBe(true);
    expect(parseMakeupCommand({ command_id: id, action: "assign", expected_revision: 1, payload: { case_id: "c" } }).ok).toBe(false);
    const alloc = [{ case_id: "k", minutes: 40 }];
    expect(parseMakeupCommand({ command_id: id, action: "reserve", expected_revision: null, payload: { student_id: "s", session_id: "sess" } }).ok).toBe(false);
    expect(parseMakeupCommand({ command_id: id, action: "reserve", expected_revision: null, payload: { student_id: "s", session_id: "sess", allocations: alloc } }).ok).toBe(true);
    expect(parseMakeupCommand({ command_id: id, action: "participation", expected_revision: null, payload: { participant_id: "p", status: "present" } }).ok).toBe(false);
    expect(parseMakeupCommand({ command_id: id, action: "participation", expected_revision: null, payload: { participant_id: "p", status: "present", actual_minutes: 60, attendance_record_id: "a" } }).ok).toBe(true);
    expect(parseMakeupCommand({ command_id: id, action: "participation", expected_revision: null, payload: { participant_id: "p", status: "no_show", actual_minutes: 0 } }).ok).toBe(true);
    expect(parseMakeupCommand({ command_id: id, action: "participation", expected_revision: null, payload: { participant_id: "p", status: "partial", actual_minutes: 30 } }).ok).toBe(false);
    expect(parseMakeupCommand({ command_id: id, action: "participation", expected_revision: null, payload: { participant_id: "p", status: "partial", actual_minutes: 30, learning_summary: "교재 12쪽을 같이 풀었다" } }).ok).toBe(true);
    expect(REVISION_REQUIRED.has("participation")).toBe(false);
    expect(REVISION_REQUIRED.has("reserve")).toBe(false);
    expect(REVISION_REQUIRED.has("cancel")).toBe(true);
    expect(rosterOriginLabel("native", "en")).toBe("participation");
    expect(rosterOriginLabel("additional", "ko")).toBe("추가 지도");
    expect(rosterOriginLabel("reservation", "ko")).toBe("보강 예약");
  });

  it("대사는 지점 전체 운영만, 수기 시수 인정과 자기검토는 열지 않는다", () => {
    const base = { access: "full" as const, assignment, actorId: "u", conductorId: "t" };
    expect(decideMakeupAction({ ...base, role: "manager", action: "reconcile" }).ok).toBe(true);
    expect(decideMakeupAction({ ...base, role: "manager", action: "resolve_reconciliation" }).ok).toBe(true);
    expect(decideMakeupAction({ ...base, role: "manager", access: "scoped", action: "reconcile" }).ok).toBe(false);
    expect(decideMakeupAction({ ...base, role: "teacher", action: "reconcile" }).ok).toBe(false);
    expect(decideMakeupAction({ ...base, role: "manager", action: "approve" }).ok).toBe(false);
    expect(decideMakeupAction({ ...base, role: "manager", action: "verify" }).ok).toBe(false);
    expect(decideMakeupAction({ ...base, role: "manager", action: "resolve_reconciliation", manualUnitsAcceptance: true }).ok).toBe(false);
    expect(decideMakeupAction({ ...base, role: "admin", action: "resolve_reconciliation", manualUnitsAcceptance: true }).ok).toBe(true);
    expect(decideMakeupAction({ ...base, role: "admin", action: "resolve_reconciliation", actorId: "u", conductorId: "u", unrestricted: true }).ok).toBe(false);
    const id = "11111111-1111-4111-8111-111111111111";
    expect(parseMakeupCommand({ command_id: id, action: "reconcile", expected_revision: null, payload: {} }).ok).toBe(false);
    expect(parseMakeupCommand({ command_id: id, action: "reconcile", expected_revision: null, payload: { reason: "월말 대사" } }).ok).toBe(true);
    expect(parseMakeupCommand({ command_id: id, action: "reconcile", expected_revision: 2, payload: { reason: "월말 대사" } }).ok).toBe(true);
    expect(REVISION_REQUIRED.has("reconcile")).toBe(false);
  });
});
