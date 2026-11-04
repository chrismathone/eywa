import { expect, it } from "vitest";
import type postgres from "postgres";
import { applyClassTerms, prepareClassTerms, rollbackClassTerms } from "./class-term-store";

function database(
  options: {
    today?: string;
    staleClass?: boolean;
    staleEnrollment?: boolean;
    staleSchedule?: boolean;
    inactive?: boolean;
    schedules?: { id: string; valid_to: string | null }[];
    lastAttendance?: string | null;
  } = {},
) {
  const calls: { query: string; args: unknown[] }[] = [];
  const classes = [
    { id: "c", subject: "english", class_name: "PL2", is_active: !options.inactive, closed_at: null },
    {
      id: "old",
      subject: "english",
      class_name: "PL2 (~26.09.30)",
      is_active: false,
      closed_at: "2026-09-30",
    },
    {
      id: "math",
      subject: "math",
      class_name: "PL2 (~26.09.30) 2",
      is_active: false,
      closed_at: "2026-09-30",
    },
  ];
  const enrollments = [
    {
      id: "moved",
      student_id: "s1",
      start_date: "2026-09-01",
      end_date: null,
      withdrawal_reason: null,
    },
    {
      id: "remain",
      student_id: "s2",
      start_date: "2026-09-01",
      end_date: null,
      withdrawal_reason: null,
    },
    {
      id: "future",
      student_id: "s3",
      start_date: "2026-10-03",
      end_date: null,
      withdrawal_reason: null,
    },
  ];
  const tx = Object.assign(
    async (strings: TemplateStringsArray, ...args: unknown[]) => {
      const query = strings.join("?").replace(/\s+/g, " ");
      calls.push({ query, args });
      if (query.includes("as today")) return [{ today: options.today ?? "2026-10-01" }];
      if (query.includes("from classes")) return structuredClone(classes);
      if (query.includes("from enrollments"))
        return enrollments.filter((e) => !(args[2] as string[]).includes(e.id));
      if (query.includes("from attendance_records")) return [{ last: options.lastAttendance ?? null }];
      if (query.includes("from class_schedules")) return structuredClone(options.schedules ?? []);
      if (query.includes("update class_schedules"))
        return options.staleSchedule ? [] : (args[0] as unknown[]).map(() => ({ id: "s" }));
      if (query.includes("update classes")) return options.staleClass ? [] : [{ id: "c" }];
      if (query.includes("update enrollments"))
        return options.staleEnrollment ? [] : (args[0] as unknown[]).map(() => ({ id: "e" }));
      return [];
    },
    { json: (v: unknown) => v },
  ) as unknown as postgres.TransactionSql;
  return { tx, calls };
}
const actor = { tenantId: "tenant-a", id: "owner", displayName: "원장" };

it("이미 비활성인 반의 종료일 확정도 종강으로 기록한다", async () => {
  const db = database({ inactive: true });
  const terms = await prepareClassTerms(db.tx, actor.tenantId, [{ classId: "c", date: "2026-09-30" }]);
  await applyClassTerms(db.tx, actor, terms);
  expect(terms[0]!.after).toMatchObject({ is_active: false, closed_at: "2026-09-30" });
  expect(db.calls.find((c) => c.query.includes("insert into audit_logs"))!.args[3]).toBe("class_end_term");
});

it("종강 이름 충돌은 번호로 해결하고 이동 수강을 제외하며 미래 시작 수강을 유효하게 종료한다", async () => {
  const db = database();
  const terms = await prepareClassTerms(
    db.tx,
    actor.tenantId,
    [{ classId: "c", date: "2026-09-30" }],
    ["moved"],
  );
  expect(terms[0]!.after).toMatchObject({
    class_name: "PL2 (~26.09.30) 2",
    closed_at: "2026-09-30",
    is_active: true,
  });
  expect(terms[0]!.enrollments.map((e) => e.after)).toMatchObject([
    { id: "remain", end_date: "2026-09-30", withdrawal_reason: "종강" },
    { id: "future", end_date: "2026-10-03", withdrawal_reason: "종강" },
  ]);
  expect(
    db.calls
      .filter((c) => c.query.includes("select") && !c.query.includes("as today"))
      .every((c) => c.args[0] === actor.tenantId),
  ).toBe(true);
  await applyClassTerms(db.tx, actor, terms);
  expect(db.calls.some((c) => c.query.includes("update students"))).toBe(false);
});
it("폐지는 오늘 날짜 이름을 붙이고 종강일은 바꾸지 않아 재운영이 가능하다", async () => {
  const { tx, calls } = database();
  const [b] = await prepareClassTerms(tx, actor.tenantId, [
    { classId: "c", date: "2026-10-01", archive: true },
  ]);
  expect(b!.after).toMatchObject({
    class_name: "PL2 (~26.10.01)",
    closed_at: null,
    is_active: false,
  });
  expect(b!.enrollments[0]!.after.withdrawal_reason).toBe("반 폐지");
  await applyClassTerms(tx, actor, [b!]);
  expect(calls.find((c) => c.query.includes("insert into audit_logs"))!.args[3]).toBe("class_archive");
});
it("미래 종강은 이름·종강일을 예약하고 수강은 종료일까지 유지한다", async () => {
  const { tx, calls } = database();
  const [b] = await prepareClassTerms(tx, actor.tenantId, [{ classId: "c", date: "2026-10-20" }]);
  expect(b!.after.closed_at).toBe("2026-10-20");
  expect(b!.enrollments).toEqual([]);
  expect(calls.some((c) => c.query.includes("from enrollments"))).toBe(false);
});
it("미리보기 이후 종강 이름 점유가 바뀌면 저장을 거절한다", async () => {
  const { tx } = database();
  await expect(
    prepareClassTerms(tx, actor.tenantId, [
      { classId: "c", date: "2026-09-30", name: "PL2 (~26.09.30)" },
    ]),
  ).rejects.toThrow("다시 검사");
});
it("예약 취소는 종강 이름·상태·수강을 각각 정확한 이전 값으로 복원한다", async () => {
  const db = database();
  const terms = await prepareClassTerms(db.tx, actor.tenantId, [
    { classId: "c", date: "2026-09-30" },
  ]);
  await rollbackClassTerms(db.tx, actor, terms);
  expect(db.calls.find((c) => c.query.includes("update classes"))!.args.slice(0, 3)).toEqual([
    "PL2",
    null,
    true,
  ]);
  const data = db.calls.find((c) => c.query.includes("update enrollments"))!.args[0];
  expect(data).toEqual(terms[0]!.enrollments.map((e) => ({ before: e.after, after: e.before })));
  expect(db.calls.find((c) => c.query.includes("insert into audit_logs"))!.args[3]).toBe("class_reopen_term");
});
it.each(["staleClass", "staleEnrollment"] as const)(
  "변경 경합(%s)은 이력을 덮어쓰지 않는다",
  async (key) => {
    const db = database({ [key]: true });
    const terms = await prepareClassTerms(db.tx, actor.tenantId, [
      { classId: "c", date: "2026-09-30" },
    ]);
    await expect(applyClassTerms(db.tx, actor, terms)).rejects.toThrow("종강 처리를 중단");
    expect(db.calls.some((c) => c.query.includes("insert into audit_logs"))).toBe(false);
  },
);

const LIVE = [
  { id: "open", valid_to: null },
  { id: "later", valid_to: "2026-12-31" },
];
it("종강(배치 닫기)은 종강일 뒤로 남은 배치를 종강일로 닫고 그 목록을 종강 기록에 남긴다", async () => {
  const db = database({ schedules: LIVE });
  const terms = await prepareClassTerms(db.tx, actor.tenantId, [
    { classId: "c", date: "2026-09-30", closeSchedules: true },
  ]);
  expect(terms[0]!.schedules).toEqual([
    { id: "open", before: null, after: "2026-09-30" },
    { id: "later", before: "2026-12-31", after: "2026-09-30" },
  ]);
  const read = db.calls.find((c) => c.query.includes("from class_schedules"))!;
  expect(read.args.slice(0, 3)).toEqual([actor.tenantId, "c", "2026-09-30"]);
  expect(read.query).toContain("for update");
  await applyClassTerms(db.tx, actor, terms);
  expect(db.calls.find((c) => c.query.includes("update class_schedules"))!.args[0]).toEqual(terms[0]!.schedules);
  const log = db.calls.find((c) => c.query.includes("insert into audit_logs"))!;
  expect(log.args[3]).toBe("class_end_term");
  expect(log.args[5]).toMatchObject({ classId: "c", closedAt: "2026-09-30", schedules: terms[0]!.schedules });
});
it("배치 닫기를 켜지 않은 종강(영어 시트 반영)과 폐지는 배치를 건드리지 않는다", async () => {
  for (const request of [
    { classId: "c", date: "2026-09-30" },
    { classId: "c", date: "2026-10-01", archive: true, closeSchedules: true },
  ]) {
    const db = database({ schedules: LIVE });
    const terms = await prepareClassTerms(db.tx, actor.tenantId, [request]);
    expect(terms[0]!.schedules).toBeUndefined();
    await applyClassTerms(db.tx, actor, terms);
    expect(db.calls.some((c) => c.query.includes("class_schedules"))).toBe(false);
    expect(db.calls.find((c) => c.query.includes("insert into audit_logs"))!.args[5]).not.toHaveProperty("schedules");
  }
});
it("되돌리기는 닫은 배치를 원래 끝나는 날로, 그새 바뀐 배치가 있으면 종강을 중단한다", async () => {
  const db = database({ schedules: LIVE });
  const terms = await prepareClassTerms(db.tx, actor.tenantId, [
    { classId: "c", date: "2026-09-30", closeSchedules: true },
  ]);
  await rollbackClassTerms(db.tx, actor, terms);
  expect(db.calls.find((c) => c.query.includes("update class_schedules"))!.args[0]).toEqual([
    { id: "open", before: "2026-09-30", after: null },
    { id: "later", before: "2026-09-30", after: "2026-12-31" },
  ]);
  const stale = database({ schedules: LIVE, staleSchedule: true });
  const again = await prepareClassTerms(stale.tx, actor.tenantId, [
    { classId: "c", date: "2026-09-30", closeSchedules: true },
  ]);
  await expect(applyClassTerms(stale.tx, actor, again)).rejects.toThrow("종강 처리를 중단");
  expect(stale.calls.some((c) => c.query.includes("insert into audit_logs"))).toBe(false);
});
it("종강일 뒤 출결이 있으면 배치는 그 마지막 출결일까지 남긴다(강사 귀속 보존) — 종강일은 그대로", async () => {
  const db = database({ schedules: LIVE, lastAttendance: "2026-10-02" });
  const terms = await prepareClassTerms(db.tx, actor.tenantId, [
    { classId: "c", date: "2026-09-30", closeSchedules: true },
  ]);
  expect(terms[0]!.after.closed_at).toBe("2026-09-30");
  expect(terms[0]!.schedules!.map((s) => s.after)).toEqual(["2026-10-02", "2026-10-02"]);
  const att = db.calls.find((c) => c.query.includes("from attendance_records"))!;
  expect(att.args).toEqual([actor.tenantId, "c", "2026-09-30"]);
  expect(db.calls.find((c) => c.query.includes("from class_schedules"))!.args[2]).toBe("2026-10-02");
});
