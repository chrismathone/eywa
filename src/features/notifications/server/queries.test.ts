import { beforeEach, describe, expect, it, vi } from "vitest";
import { clampNotificationLimit, getMyNotifications } from "./queries";

type Row = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  archived_at: string | null;
  created_at: string;
};
const mocks = vi.hoisted(() => ({ rows: [] as Row[] }));
vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: async () => ({ id: "me" }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => {
      const filters: ((row: Row) => boolean)[] = [];
      let limit = Infinity;
      let countOnly = false;
      const query = {
        select: (_: string, options?: { head?: boolean }) => {
          countOnly = !!options?.head;
          return query;
        },
        neq: (key: keyof Row, value: string) => {
          filters.push((row) => row[key] !== value);
          return query;
        },
        eq: (key: keyof Row, value: string) => {
          filters.push((row) => row[key] === value);
          return query;
        },
        // `col.op.value,col.op.value` — 하나라도 맞으면(eq · neq만).
        or: (expr: string) => {
          const parts = expr.split(",").map((p) => { const [k, op, ...v] = p.split("."); return { k: k as keyof Row, op, v: v.join(".") }; });
          filters.push((row) => parts.some(({ k, op, v }) => (op === "eq" ? String(row[k]) === v : String(row[k]) !== v)));
          return query;
        },
        maybeSingle: () => ({
          then: (resolve: (value: unknown) => void) =>
            Promise.resolve({ data: mocks.rows.filter((row) => filters.every((filter) => filter(row)))[0] ?? null, error: null }).then(resolve),
        }),
        is: (key: keyof Row, value: null) => {
          filters.push((row) => row[key] === value);
          return query;
        },
        not: (key: keyof Row, _: string, value: null) => {
          filters.push((row) => row[key] !== value);
          return query;
        },
        order: () => query,
        limit: (value: number) => {
          limit = value;
          return query;
        },
        then: (resolve: (value: unknown) => void) => {
          const rows = mocks.rows.filter((row) =>
            filters.every((filter) => filter(row)),
          );
          return Promise.resolve({
            data: countOnly ? null : rows.slice(0, limit),
            count: rows.length,
          }).then(resolve);
        },
      };
      return query;
    },
  }),
}));

const row = (id: string, type: string, extra: Partial<Row> = {}): Row => ({
  id,
  type,
  title: "알림",
  body: null,
  link: null,
  read_at: null,
  archived_at: null,
  created_at: "2026-09-11T00:00:00Z",
  ...extra,
});
beforeEach(() => {
  mocks.rows = [];
});
describe("notification list and badge", () => {
  it("옛 브리핑 20건이 최신이어도 필요한 알림을 밀어내거나 배지를 남기지 않는다", async () => {
    mocks.rows = [
      ...Array.from({ length: 20 }, (_, i) => row(`old${i}`, "daily_briefing")),
      row("current", "absence_alert"),
    ];
    const result = await getMyNotifications();
    expect(result.unread).toBe(1);
    expect(result.items.map((item) => item.id)).toEqual(["current"]);
  });
  it("보관함에서도 폐지된 알림을 숨기고 배지는 받은함만 센다", async () => {
    mocks.rows = [
      row("old", "daily_briefing", { archived_at: "2026-09-11" }),
      row("archive", "followup_due", { archived_at: "2026-09-11" }),
      row("inbox", "followup_due"),
    ];
    const result = await getMyNotifications("archived");
    expect(result.items.map((item) => item.id)).toEqual(["archive"]);
    expect(result.unread).toBe(1);
  });
  it("기한 초과 업무 요약은 가장 최근 한 장만 받은함 · 배지에(지난 요약은 지우지 않고 받은함에서만 가린다)", async () => {
    mocks.rows = [
      row("digest-today", "staff_task_digest", { created_at: "2026-11-02T22:00:00Z" }),
      row("digest-yesterday", "staff_task_digest", { created_at: "2026-11-01T22:00:00Z" }),
      row("digest-old", "staff_task_digest", { created_at: "2026-10-31T22:00:00Z", read_at: "2026-11-01" }),
      row("other", "followup_due"),
    ];
    const result = await getMyNotifications();
    expect(result.items.map((item) => item.id)).toEqual(["digest-today", "other"]);
    expect(result.unread).toBe(2);
    mocks.rows = [row("other", "followup_due")];
    expect((await getMyNotifications()).items.map((item) => item.id)).toEqual(["other"]);
  });
  it("최근 요약을 읽었으면 읽은 줄 자리에 · 배지에는 안 든다 · 보관함에는 요약이 모두 그대로", async () => {
    mocks.rows = [
      row("digest-read", "staff_task_digest", { created_at: "2026-11-02T22:00:00Z", read_at: "2026-11-03" }),
      row("digest-hidden", "staff_task_digest", { created_at: "2026-11-01T22:00:00Z" }),
      row("other-read", "followup_due", { created_at: "2026-11-03T01:00:00Z", read_at: "2026-11-03" }),
      row("other", "followup_due"),
      row("digest-archived", "staff_task_digest", { archived_at: "2026-11-01" }),
    ];
    const result = await getMyNotifications();
    expect(result.items.map((item) => item.id)).toEqual(["other", "other-read", "digest-read"]);
    expect(result.unread).toBe(1);
    const archived = await getMyNotifications("archived");
    expect(archived.items.map((item) => item.id)).toEqual(["digest-archived"]);
    // 배지는 어느 화면의 응답이든 이 수로 덮인다 — 보관함 화면에서도 받은함과 같은 수(가린 지난 요약은 세지 않는다).
    expect(archived.unread).toBe(result.unread);
  });
  it("목록 크기는 요청값을 따르되 20~100으로 자른다(F17 더 보기)", async () => {
    mocks.rows = Array.from({ length: 50 }, (_, i) => row(`n${i}`, "followup_due"));
    expect((await getMyNotifications("active", 40)).items).toHaveLength(40);
    expect((await getMyNotifications()).items).toHaveLength(20);
    expect(clampNotificationLimit(5)).toBe(20);
    expect(clampNotificationLimit(999)).toBe(100);
    expect(clampNotificationLimit("x")).toBe(20);
    expect(clampNotificationLimit(33.7)).toBe(33);
  });
});
