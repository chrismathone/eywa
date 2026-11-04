import { beforeEach, expect, it, vi } from "vitest";
import type postgres from "postgres";
const fake = vi.hoisted(() => ({ sql: {} as unknown }));
vi.mock("postgres", () => ({ default: () => fake.sql }));
import { finishEndedClassNames } from "./class-period-names";

beforeEach(() => {
  process.env.DATABASE_URL = "postgres://test";
});
it("기간 만료·종강일 도래는 날짜 이름으로 정리하고 보강용 반·미래 종강은 건드리지 않는다", async () => {
  const calls: { query: string; args: unknown[] }[] = [];
  const base = { subject: "english", is_active: true, is_makeup_pool: false, closed_at: null };
  const classes = [
    { ...base, id: "ended", class_name: "PL2", end_date: "2026-09-30" },
    {
      ...base,
      id: "term",
      class_name: "LS5 (~26.09.30)",
      closed_at: "2026-09-30",
      end_date: "2026-09-30",
    },
    {
      ...base,
      id: "future",
      class_name: "LT6 (~26.10.20)",
      closed_at: "2026-10-20",
      end_date: null,
    },
    { ...base, id: "pool", class_name: "보강", is_makeup_pool: true, end_date: "2026-09-30" },
  ];
  const tx = Object.assign(
    async (strings: TemplateStringsArray, ...args: unknown[]) => {
      const query = strings.join("?").replace(/\s+/g, " ");
      calls.push({ query, args });
      if (query.includes("distinct c.tenant_id")) return [{ tenant_id: "tenant" }];
      if (query.includes("as today")) return [{ today: "2026-10-01" }];
      if (query.includes("from classes")) return structuredClone(classes);
      if (query.includes("from enrollments"))
        return [
          {
            id: "e",
            student_id: "s",
            start_date: "2026-09-01",
            end_date: null,
            withdrawal_reason: null,
          },
        ];
      if (query.includes("update classes") || query.includes("update enrollments"))
        return [{ id: "changed" }];
      return [];
    },
    { json: (v: unknown) => v },
  ) as unknown as postgres.TransactionSql;
  fake.sql = {
    begin: async (_: string, run: (tx: postgres.TransactionSql) => unknown) => run(tx),
    end: async () => {},
  };
  await expect(finishEndedClassNames()).resolves.toBe(2);
  const updates = calls.filter((c) => c.query.includes("update classes"));
  expect(updates.map((c) => c.args[0])).toEqual(["PL2 (~26.09.30)", "LS5 (~26.09.30)"]);
  expect(updates.every((c) => c.args.includes("tenant"))).toBe(true);
  expect(calls.find((c) => c.query.includes("update enrollments"))!.args[0]).toMatchObject([
    { after: { end_date: "2026-09-30", withdrawal_reason: "종강" } },
  ]);
});

it("이름·수강이 이미 정리된 종강 반도 종강일 뒤로 남은 배치가 있으면 그날로 닫는다", async () => {
  const calls: { query: string; args: unknown[] }[] = [];
  const classes = [
    {
      id: "ls4b",
      subject: "english",
      class_name: "LS4b (~26.09.30)",
      is_active: true,
      is_makeup_pool: false,
      closed_at: "2026-09-30",
      end_date: "2026-09-30",
    },
  ];
  const tx = Object.assign(
    async (strings: TemplateStringsArray, ...args: unknown[]) => {
      const query = strings.join("?").replace(/\s+/g, " ");
      calls.push({ query, args });
      if (query.includes("distinct c.tenant_id")) return [{ tenant_id: "tenant" }];
      if (query.includes("as today")) return [{ today: "2026-11-03" }];
      if (query.includes("from classes")) return structuredClone(classes);
      if (query.includes("from enrollments")) return [];
      if (query.includes("from class_schedules")) return [{ id: "slot", valid_to: null }];
      if (query.includes("update classes") || query.includes("update class_schedules")) return [{ id: "changed" }];
      return [];
    },
    { json: (v: unknown) => v },
  ) as unknown as postgres.TransactionSql;
  fake.sql = {
    begin: async (_: string, run: (tx: postgres.TransactionSql) => unknown) => run(tx),
    end: async () => {},
  };
  await expect(finishEndedClassNames()).resolves.toBe(1);
  expect(calls.find((c) => c.query.includes("update class_schedules"))!.args[0]).toEqual([
    { id: "slot", before: null, after: "2026-09-30" },
  ]);
  expect(calls.find((c) => c.query.includes("insert into audit_logs"))!.args[5]).toMatchObject({
    classId: "ls4b",
    schedules: [{ id: "slot", before: null, after: "2026-09-30" }],
  });
});
