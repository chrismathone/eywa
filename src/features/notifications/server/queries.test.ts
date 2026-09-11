import { beforeEach, describe, expect, it, vi } from "vitest";
import { getMyNotifications } from "./queries";

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
});
