/**
 * **테스트 전용** 가짜 PostgREST 클라이언트 — 기록 범위(`record-coverage.ts`)·'지난 기록' 밤 집계(`server/history.ts`) 테스트가 쓰는 꼴만
 * 흉내 낸다: select(건수 head) · eq · in · not(is null · in (...)) · gte · lte · lt · like · order · limit · range · maybeSingle ·
 * delete · upsert(onConflict). 앱 코드는 import하지 않는다.
 */
type Row = Record<string, unknown>;
type Filter = (r: Row) => boolean;

export type FakeTables = Record<string, Row[]>;

const likeToRegExp = (pattern: string) => new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/_/g, ".").replace(/%/g, ".*")}$`);

export function fakePostgrest(tables: FakeTables, opts: { fail?: (table: string) => boolean } = {}) {
  const calls: { table: string; op: "select" | "delete" | "upsert" }[] = [];
  const db = {
    from(table: string) {
      const filters: Filter[] = [];
      let mode: "select" | "delete" = "select";
      let head = false;
      let range: [number, number] | null = null;
      let limit: number | null = null;
      let single = false;
      const failed = () => opts.fail?.(table) ?? false;
      const q = {
        select: (_cols?: string, o?: { head?: boolean }) => ((head = !!o?.head), q),
        eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), q),
        in: (k: string, v: unknown[]) => (filters.push((r) => v.includes(r[k])), q),
        not: (k: string, op: string, v: unknown) => {
          if (op === "is") filters.push((r) => r[k] !== null && r[k] !== undefined);
          else if (op === "in") {
            const list = String(v).replace(/^\(|\)$/g, "").split(",");
            filters.push((r) => !list.includes(String(r[k])));
          } else throw new Error(`fake: not.${op}`);
          return q;
        },
        gte: (k: string, v: string) => (filters.push((r) => String(r[k]) >= v), q),
        lte: (k: string, v: string) => (filters.push((r) => String(r[k]) <= v), q),
        lt: (k: string, v: string) => (filters.push((r) => String(r[k]) < v), q),
        like: (k: string, p: string) => (filters.push((r) => likeToRegExp(p).test(String(r[k]))), q),
        order: () => q,
        limit: (n: number) => ((limit = n), q),
        range: (a: number, b: number) => ((range = [a, b]), q),
        maybeSingle: () => ((single = true), q),
        delete: () => ((mode = "delete"), q),
        upsert: (input: Row | Row[], o?: { onConflict?: string }) => {
          calls.push({ table, op: "upsert" });
          if (failed()) return Promise.resolve({ error: { message: "boom" } });
          const keys = (o?.onConflict ?? "id").split(",");
          const list = (tables[table] ??= []);
          for (const r of Array.isArray(input) ? input : [input]) {
            const i = list.findIndex((x) => keys.every((k) => x[k] === r[k]));
            if (i >= 0) list[i] = { ...list[i], ...r };
            else list.push({ ...r });
          }
          return Promise.resolve({ error: null });
        },
        then(resolve: (v: unknown) => void) {
          calls.push({ table, op: mode });
          if (failed()) return resolve({ data: null, error: { message: "boom" }, count: null });
          const list = tables[table] ?? [];
          const hit = (r: Row) => filters.every((f) => f(r));
          if (mode === "delete") {
            tables[table] = list.filter((r) => !hit(r));
            return resolve({ error: null });
          }
          let rows = list.filter(hit);
          if (head) return resolve({ data: null, error: null, count: rows.length });
          if (range) rows = rows.slice(range[0], range[1] + 1);
          if (limit !== null) rows = rows.slice(0, limit);
          return resolve(single ? { data: rows[0] ?? null, error: null } : { data: rows, error: null });
        },
      };
      return q;
    },
  };
  return { db: db as never, calls };
}
