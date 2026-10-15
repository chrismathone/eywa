import { describe, expect, it } from "vitest";
import { enrollmentHistoryTimeline, type EnrollmentActivity, type EnrollmentAudit } from "./enrollment-history";
import type { TimelineEnrollment } from "./enrollment/enrollment-timeline";

const studentId = "student";
const friday: TimelineEnrollment = { id: "friday", classId: "tp4e", className: "고등M 개별 TP4E", subject: "math", startDate: "2026-06-09", endDate: null, isTransferred: false, reason: null };
const saturday: TimelineEnrollment = { ...friday, id: "saturday", classId: "sat", className: "고등M 개별 토", startDate: "2026-03-23", endDate: "2026-10-06", isTransferred: true, reason: "반 이동" };
const change = (patch: Partial<EnrollmentActivity> = {}): EnrollmentActivity => ({ id: "days", row_id: "friday", op: "UPDATE", target_label: "권영준 · 고등M 개별 TP4E", actor_name: "박소선", changed: { attendance_days: { old: ["fri"], new: [] } }, created_at: "2026-10-06T09:18:54.717Z", ...patch });
const build = (activity: EnrollmentActivity[], audit: EnrollmentAudit[] = []) => enrollmentHistoryTimeline({ studentId, enrollments: [friday, saturday], activity, audit, currentClassDays: new Map([["tp4e", ["fri", "tue"]]]) });

describe("학생 수강 변경 타임라인", () => {
  it("금요일만 등원하다 전체 요일로 바꾼 기록의 전후 값·처리자·시각을 보존한다", () => {
    expect(build([change()])).toContainEqual(expect.objectContaining({ kind: "enrollment_schedule", date: "2026-10-06", title: "고등M 개별 TP4E 등원 요일 변경", description: "금 → 반 전체 요일\n현재 반 전체 요일: 화·금", registrant: "박소선", recordedAt: "2026-10-06T09:18:54.717Z" }));
  });
  it("변경 당시 요일 스냅샷이 있으면 현재 반 시간이 달라져도 당시 금→화금을 표시한다", () => {
    const audit: EnrollmentAudit = { id: "audit", action: "enrollment_days_update", actor_name: "박소선", created_at: "2026-10-06T09:18:54.858Z", metadata: { edits: [{ enrollmentId: "friday", beforeEffectiveDays: ["fri"], effectiveDays: ["tue", "fri"] }] } };
    const events = enrollmentHistoryTimeline({ studentId, enrollments: [friday], activity: [change()], audit: [audit], currentClassDays: new Map([["tp4e", ["mon", "thu"]]]) });
    expect(events.find((e) => e.kind === "enrollment_schedule")?.description).toBe("금 → 화·금");
  });
  it("동시 수정으로 감사 스냅샷의 이전 값이 실제 변경과 달라지면 DB 변경 전 값을 우선한다", () => {
    const audit: EnrollmentAudit = { id: "audit", action: "enrollment_days_update", actor_name: "박소선", created_at: "2026-10-06T09:18:54.858Z", metadata: { edits: [{ enrollmentId: "friday", beforeDays: ["mon"], days: [], beforeEffectiveDays: ["mon"], effectiveDays: ["tue", "fri"] }] } };
    expect(build([change()], [audit]).find((e) => e.kind === "enrollment_schedule")?.description).toBe("금 → 화·금");
  });
  it("여러 수강의 배치 로그가 늦게 저장되어도 각 변경 처리 시각으로 요일 스냅샷을 연결한다", () => {
    const audit: EnrollmentAudit = { id: "batch", action: "enrollment_days_update", actor_name: "박소선", created_at: "2026-10-06T09:20:54Z", metadata: { edits: [{ enrollmentId: "friday", recordedAt: "2026-10-06T09:18:54.800Z", beforeDays: ["fri"], days: [], beforeEffectiveDays: ["fri"], effectiveDays: ["tue", "fri"] }] } };
    expect(build([change()], [audit]).find((e) => e.kind === "enrollment_schedule")?.description).toBe("금 → 화·금");
  });
  it("같은 학생이 아닌 배치 수정이나 다른 수강의 로그를 섞지 않는다", () => {
    const other = change({ id: "other", row_id: "other", op: "INSERT", changed: { student_id: "other-student", class_id: "other", attendance_days: ["mon"] } });
    expect(build([other, change({ id: "other-update", row_id: "other" })]).some((e) => e.kind === "enrollment_schedule")).toBe(false);
  });
  it("삭제된 수강은 수강 시작으로 되살리지 않고 삭제 사건·기간만 표시한다", () => {
    const snapshot = { id: "deleted", student_id: studentId, class_id: "ms2r", start_date: "2026-10-06", end_date: "2026-10-06", is_transferred: false };
    const removed = change({ id: "delete", row_id: "deleted", op: "DELETE", changed: snapshot, target_label: "권영준 · 고등M 중등 MS2R", actor_name: null, created_at: "2026-10-06T09:29:21.957Z" });
    const audit: EnrollmentAudit = { id: "delete-audit", action: "enrollment_delete", actor_name: "시스템(사용자 요청 수강 이력 정정)", created_at: removed.created_at, metadata: { studentId, className: "고등M 중등 MS2R", snapshot, deletedDraftSnapshots: [{ secretDraft: "비공개 초안" }] } };
    const events = build([removed, removed], [audit]);
    expect(events.filter((e) => e.kind === "enrollment_delete")).toEqual([expect.objectContaining({ title: "고등M 중등 MS2R 수강 이력 삭제", description: "삭제된 수강 기간: 2026-10-06 ~ 2026-10-06\n연결된 미확정 일지 초안 1건 함께 삭제", registrant: "시스템 처리" })]);
    expect(events.some((e) => e.kind === "enrollment_start" && e.title.includes("MS2R"))).toBe(false);
    expect(JSON.stringify(events)).not.toContain("비공개 초안");
  });
  it("급여 단가 변경은 일반 학생 화면에 표시하지 않는다", () => {
    const events = build([change({ changed: { salary_tier: { old: null, new: "급여정보" } } })]);
    expect(events).toHaveLength(3);
    expect(JSON.stringify(events)).not.toContain("급여정보");
  });
  it("전입 수강이 삭제되어도 마지막 수강일과 실제 종료 처리 시각은 남는다", () => {
    const events = build([change({ row_id: "saturday", changed: { end_date: { old: null, new: "2026-10-06" }, is_transferred: { old: false, new: true } }, created_at: "2026-10-06T08:21:09.410Z", actor_name: "허주연" })]);
    expect(events.find((e) => e.kind === "enrollment_end")).toMatchObject({ date: "2026-10-05", title: "고등M 개별 토 수강 종료", recordedAt: "2026-10-06T08:21:09.410Z", registrant: "허주연" });
    expect(events.filter((e) => e.kind === "enrollment_end")).toHaveLength(1);
  });
  it("동일 날짜의 여러 편집은 처리 시각의 최신순으로 표시한다", () => {
    const older = change({ id: "older", created_at: "2026-10-06T02:00:00Z", changed: { attendance_days: { old: [], new: ["fri"] } } });
    expect(build([older, change()]).filter((e) => e.kind === "enrollment_schedule").map((e) => e.id)).toEqual(["activity:days:days", "activity:older:days"]);
  });
  it("트리거 기록이 빠져도 작업 감사로그의 전후 요일 기록은 보인다", () => {
    const log: EnrollmentAudit = { id: "fallback", action: "enrollment_days_update", actor_name: "박소선", created_at: "2026-10-06T09:18:54.858Z", metadata: { edits: [{ enrollmentId: "friday", beforeDays: ["fri"], days: [], beforeEffectiveDays: ["fri"], effectiveDays: ["tue", "fri"] }] } };
    expect(build([], [log])).toContainEqual(expect.objectContaining({ kind: "enrollment_schedule", description: "금 → 화·금", registrant: "박소선" }));
  });
  it("같은 값을 다시 저장해 감사로그만 남은 기록(변경 전 값 없음)은 요일 변경으로 적지 않는다", () => {
    const first: EnrollmentAudit = { id: "first", action: "enrollment_days_update", actor_name: "박소선", created_at: "2026-10-06T09:18:54.766Z", metadata: { edits: [{ enrollmentId: "friday", days: [] }] } };
    const again: EnrollmentAudit = { ...first, id: "again", created_at: "2026-10-06T09:19:03.000Z" };
    const schedule = build([change()], [first, again]).filter((e) => e.kind === "enrollment_schedule");
    expect(schedule.map((e) => e.id)).toEqual(["activity:days:days"]);
  });
  it("수강과 트리거 로그가 모두 없어도 해당 학생의 삭제 감사로그는 남는다", () => {
    const log: EnrollmentAudit = { id: "fallback", action: "enrollment_delete", actor_name: "박소선", created_at: "2026-10-06T09:29:21Z", metadata: { studentId, className: "MS2R", snapshot: { id: "deleted", startDate: "2026-10-06", endDate: "2026-10-06", isTransferred: false } } };
    expect(build([], [log])).toContainEqual(expect.objectContaining({ kind: "enrollment_delete", title: "MS2R 수강 이력 삭제" }));
    expect(build([], [{ ...log, metadata: { ...log.metadata as object, studentId: "other-student" } }]).some((e) => e.kind === "enrollment_delete")).toBe(false);
  });
  it("심야 편집도 UTC 전날 대신 한국 날짜로 표시한다", () => {
    expect(build([change({ created_at: "2026-10-05T16:30:00Z" })]).find((e) => e.kind === "enrollment_schedule")?.date).toBe("2026-10-06");
  });
  it("수강 날짜 정정과 휴원·재개 기록도 전후 값을 표시한다", () => {
    const events = build([change({ changed: { start_date: { old: "2026-06-09", new: "2026-06-10" }, on_hold: { old: false, new: true } } })]);
    expect(events).toContainEqual(expect.objectContaining({ title: "고등M 개별 TP4E 시작일 정정", description: "2026-06-09 → 2026-06-10" }));
    expect(events).toContainEqual(expect.objectContaining({ title: "고등M 개별 TP4E 수강 휴원" }));
  });
  it("종료를 취소한 변경에는 종료 방식 정정을 따로 적지 않는다(끝나지 않은 수강이 '일반 수강 종료'로 읽히지 않게)", () => {
    const events = enrollmentHistoryTimeline({ studentId, enrollments: [{ ...saturday, endDate: null, isTransferred: false }],
      activity: [change({ row_id: "saturday", changed: { end_date: { old: "2026-10-06", new: null }, is_transferred: { old: true, new: false } } })] });
    expect(events).toContainEqual(expect.objectContaining({ title: "고등M 개별 토 종료일 정정", description: "2026-10-05 → 미지정" }));
    expect(events.some((e) => e.title.includes("종료 방식 정정"))).toBe(false);
  });
  it("삭제된 수강의 반 이름은 먼저 읽힌 로그 줄에 없어도 뒤 줄·반의 지금 이름에서 찾는다", () => {
    const snapshot = { id: "gone", student_id: studentId, class_id: "jj1h", start_date: "2026-10-07", end_date: null, is_transferred: false };
    const created = change({ id: "gone-insert", row_id: "gone", op: "INSERT", changed: snapshot, target_label: null, created_at: "2026-09-20T01:00:00Z" });
    const removed = change({ id: "gone-delete", row_id: "gone", op: "DELETE", changed: snapshot, target_label: "권영준 · 초등M 개별 JJ1H", created_at: "2026-10-06T08:16:48Z" });
    expect(build([created, removed]).find((e) => e.kind === "enrollment_delete")?.title).toBe("초등M 개별 JJ1H 수강 이력 삭제");
    const unlabeled = [created, { ...removed, target_label: null }];
    const withClass = enrollmentHistoryTimeline({ studentId, enrollments: [friday], activity: unlabeled, classNames: new Map([["jj1h", "초등M 개별 JJ1H"]]) });
    expect(withClass.find((e) => e.kind === "enrollment_delete")?.title).toBe("초등M 개별 JJ1H 수강 이력 삭제");
    expect(build(unlabeled).find((e) => e.kind === "enrollment_delete")?.title).toBe("수업 수강 이력 삭제");
  });
  it("삭제된 수강의 반 이름: 당시 기록이 지금 이름보다 먼저고, 같은 반의 지금 수강에서도 찾으며, 도착 반이 바뀐 예약은 삭제 줄의 반을 따른다", () => {
    const snap = (class_id: string) => ({ id: "gone", student_id: studentId, class_id, start_date: "2026-10-07", end_date: null, is_transferred: false });
    const row = (op: "INSERT" | "DELETE", class_id: string, target_label: string | null) =>
      change({ id: `gone-${op}`, row_id: "gone", op, changed: snap(class_id), target_label, created_at: op === "INSERT" ? "2026-09-20T01:00:00Z" : "2026-10-06T08:16:48Z" });
    const titleOf = (activity: EnrollmentActivity[], classNames = new Map<string, string>()) =>
      enrollmentHistoryTimeline({ studentId, enrollments: [friday], activity, classNames }).find((e) => e.kind === "enrollment_delete")?.title;
    // 먼저 읽힌 줄에 이름이 없어 지금 이름으로 채워질 뻔해도, 뒤 줄에 남은 당시 이름이 먼저다.
    expect(titleOf([row("INSERT", "jj1h", null), row("DELETE", "jj1h", "권영준 · 당시 이름")], new Map([["jj1h", "지금 이름"]]))).toBe("당시 이름 수강 이력 삭제");
    // 같은 반에 지금 수강이 남아 있으면(서버는 그 반 이름을 따로 읽지 않는다) 그 수강의 반 이름을 쓴다.
    expect(titleOf([row("INSERT", "tp4e", null), row("DELETE", "tp4e", null)])).toBe("고등M 개별 TP4E 수강 이력 삭제");
    // 예약 수강의 도착 반을 B → C로 바꾼 뒤 취소: 지워진 것은 C반이다(생성 줄의 B반 이름을 쓰지 않는다).
    expect(titleOf([row("INSERT", "b", "권영준 · B반"), row("DELETE", "c", null)], new Map([["c", "C반"]]))).toBe("C반 수강 이력 삭제");
  });
  it("종료일은 그대로 두고 이동 표식만 뒤에 바뀐 수강도 종료 사건에 처리자·시각이 남는다", () => {
    const rows = [
      change({ id: "set", row_id: "saturday", changed: { end_date: { old: null, new: "2026-10-06" } }, created_at: "2026-10-06T08:21:09.410Z", actor_name: "허주연" }),
      change({ id: "flag", row_id: "saturday", changed: { is_transferred: { old: false, new: true } }, created_at: "2026-10-06T08:30:00Z", actor_name: "허주연" }),
    ];
    expect(build(rows).find((e) => e.kind === "enrollment_end")).toMatchObject({ date: "2026-10-05", registrant: "허주연", recordedAt: "2026-10-06T08:21:09.410Z" });
  });
  it("두 저장이 겹쳐 뒤 저장이 아무것도 안 바꾼 경우(감사 기록만 남음) 요일 변경을 한 줄 더 적지 않는다", () => {
    const edit = { enrollmentId: "friday", beforeDays: ["fri"], days: [], beforeEffectiveDays: ["fri"], effectiveDays: ["tue", "fri"] };
    const mine: EnrollmentAudit = { id: "mine", action: "enrollment_days_update", actor_name: "박소선", created_at: "2026-10-06T09:18:54.858Z", metadata: { edits: [{ ...edit, recordedAt: "2026-10-06T09:18:54.800Z" }] } };
    const other: EnrollmentAudit = { id: "other", action: "enrollment_days_update", actor_name: "허주연", created_at: "2026-10-06T09:18:55.100Z", metadata: { edits: [{ ...edit, recordedAt: "2026-10-06T09:18:55.000Z" }] } };
    expect(build([change()], [mine, other]).filter((e) => e.kind === "enrollment_schedule").map((e) => e.id)).toEqual(["activity:days:days"]);
  });
  it("종료일 정정은 그 로그가 쓰인 때의 종료 방식으로 날짜를 읽는다(뒤에 반이동된 수강의 옛 정정이 하루 어긋나지 않게)", () => {
    // 일반 종료(7/8) → 재원 복구(7/10) → 나중에 반이동(9/1). 지금 값(반이동)으로 읽으면 7/8이 7/7로 나온다.
    const rows = [
      change({ id: "a", row_id: "saturday", changed: { end_date: { old: null, new: "2026-07-08" } }, created_at: "2026-07-08T01:00:00Z" }),
      change({ id: "b", row_id: "saturday", changed: { end_date: { old: "2026-07-08", new: null } }, created_at: "2026-07-10T01:00:00Z" }),
      change({ id: "c", row_id: "saturday", changed: { end_date: { old: null, new: "2026-09-01" }, is_transferred: { old: false, new: true } }, created_at: "2026-09-01T01:00:00Z" }),
    ];
    const events = enrollmentHistoryTimeline({ studentId, enrollments: [{ ...saturday, endDate: "2026-09-01", isTransferred: true }], activity: rows });
    expect(events).toContainEqual(expect.objectContaining({ id: "activity:b:end_date", description: "2026-07-08 → 미지정" }));
    // 예약 이동의 날짜를 고쳤다가 취소: 같은 10/13이 두 줄에서 같은 날짜(마지막 수강일 10/12)로 읽혀야 한다.
    const booked = [
      change({ id: "d", row_id: "saturday", changed: { end_date: { old: null, new: "2026-10-06" }, is_transferred: { old: false, new: true } }, created_at: "2026-10-01T01:00:00Z" }),
      change({ id: "e", row_id: "saturday", changed: { end_date: { old: "2026-10-06", new: "2026-10-13" } }, created_at: "2026-10-02T01:00:00Z" }),
      change({ id: "f", row_id: "saturday", changed: { end_date: { old: "2026-10-13", new: null }, is_transferred: { old: true, new: false } }, created_at: "2026-10-03T01:00:00Z" }),
    ];
    const cancelled = enrollmentHistoryTimeline({ studentId, enrollments: [{ ...saturday, endDate: null, isTransferred: false }], activity: booked });
    expect(cancelled).toContainEqual(expect.objectContaining({ id: "activity:e:end_date", description: "2026-10-05 → 2026-10-12" }));
    expect(cancelled).toContainEqual(expect.objectContaining({ id: "activity:f:end_date", description: "2026-10-12 → 미지정" }));
  });
  it("종료일이 없는 수강의 이동 표식만 풀린 변경은 종료 방식 정정으로 적지 않는다", () => {
    expect(build([change({ changed: { is_transferred: { old: true, new: false } } })]).some((e) => e.title.includes("종료 방식 정정"))).toBe(false);
  });
  it("응답이 늦어 처리 시각이 5초 넘게 벌어져도 전후 값이 같은 감사 기록은 같은 저장으로 묶는다(같은 변경 두 줄 금지)", () => {
    const slow: EnrollmentAudit = { id: "slow", action: "enrollment_days_update", actor_name: "박소선", created_at: "2026-10-06T09:19:02Z", metadata: { edits: [{ enrollmentId: "friday", recordedAt: "2026-10-06T09:19:01.000Z", beforeDays: ["fri"], days: [], beforeEffectiveDays: ["fri"], effectiveDays: ["tue", "fri"] }] } };
    const schedule = build([change()], [slow]).filter((e) => e.kind === "enrollment_schedule");
    expect(schedule.map((e) => e.description)).toEqual(["금 → 화·금"]);
  });
  it("당시 실제 요일로 풀면 앞뒤가 같아지는 변경은 지정값으로 적고 당시 요일을 덧붙인다", () => {
    const fridayOnly: EnrollmentAudit = { id: "same", action: "enrollment_days_update", actor_name: "박소선", created_at: "2026-10-06T09:18:54.858Z", metadata: { edits: [{ enrollmentId: "friday", beforeDays: ["fri"], days: [], beforeEffectiveDays: ["fri"], effectiveDays: ["fri"] }] } };
    expect(build([change()], [fridayOnly]).find((e) => e.kind === "enrollment_schedule")?.description).toBe("금 → 반 전체 요일 (당시 반 전체 요일: 금)");
  });
  it("이동 경계를 일반 종료로 고쳐도 마지막 수강일이 같으면 날짜 대신 종료 방식 정정을 표시한다", () => {
    const events = enrollmentHistoryTimeline({ studentId, enrollments: [{ ...saturday, endDate: "2026-10-05", isTransferred: false }],
      activity: [change({ row_id: "saturday", changed: { end_date: { old: "2026-10-06", new: "2026-10-05" }, is_transferred: { old: true, new: false } } })] });
    expect(events).toContainEqual(expect.objectContaining({ title: "고등M 개별 토 수강 종료 방식 정정", description: "반 이동 종료 → 일반 수강 종료" }));
    expect(events.some((e) => e.description === "2026-10-05 → 2026-10-05")).toBe(false);
  });
});
