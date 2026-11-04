/**
 * 반 이름 충돌 테스트용 **작은 메모리 DB** — `classes` 표의 유니크 인덱스
 * `(tenant_id, class_name, subject)`를 흉내 낸다(술어 없음 = 폐지 반도 이름을 쥔다, [[#120]]).
 * 필터(eq·neq·or·limit)를 실제로 적용해, 다른 지점·다른 과목 반을 잘못 건드리는지까지 볼 수 있다.
 * 테스트 전용 — 앱 코드에서 import하지 말 것.
 */
export type FakeClassRow = {
  id: string;
  tenant_id: string;
  subject: string;
  class_name: string;
  is_active: boolean;
  closed_at: string | null;
  teacher_id?: string | null;
  classroom_id?: string | null;
  /** 반 수정 감사로그의 켜고 끄는 칸(class-flag-changes.ts) — 없으면 꺼짐으로 읽힌다. */
  is_special?: boolean;
  report_optout?: boolean;
};

type Result = { data: unknown; error: unknown };

export function fakeClassesDb(seed: FakeClassRow[]) {
  const rows = seed.map((r) => ({ ...r }));
  const writes: { table: string; op: string; patch?: unknown }[] = [];

  const violates = (row: FakeClassRow, name: string) =>
    rows.some(
      (o) => o.id !== row.id && o.tenant_id === row.tenant_id && o.subject === row.subject && o.class_name === name,
    );

  function from(table: string) {
    const filters: ((r: Record<string, unknown>) => boolean)[] = [];
    let op: "select" | "update" | "insert" | "delete" = "select";
    let patch: Record<string, unknown> | null = null;
    let insertRows: Record<string, unknown>[] = [];
    let max: number | null = null;
    let single = false;

    const run = (): Result => {
      if (table !== "classes") {
        if (op !== "select") writes.push({ table, op, patch: patch ?? insertRows });
        return { data: op === "select" ? [] : null, error: null };
      }
      if (op === "insert") {
        for (const r of insertRows) {
          const row = { id: `new-${rows.length + 1}`, is_active: true, closed_at: null, ...r } as FakeClassRow;
          if (violates(row, row.class_name)) return { data: null, error: { code: "23505" } };
          rows.push(row);
          writes.push({ table, op, patch: r });
          return { data: single ? { id: row.id } : [{ id: row.id }], error: null };
        }
      }
      const matched = rows.filter((r) => filters.every((f) => f(r as unknown as Record<string, unknown>)));
      if (op === "update" && patch) {
        const nextName = patch.class_name as string | undefined;
        if (nextName !== undefined && matched.some((r) => violates(r, nextName))) {
          return { data: null, error: { code: "23505" } };
        }
        for (const r of matched) Object.assign(r, patch);
        writes.push({ table, op, patch });
        return { data: matched.map((r) => ({ id: r.id })), error: null };
      }
      if (op === "delete") {
        for (const r of matched) rows.splice(rows.indexOf(r), 1);
        return { data: null, error: null };
      }
      const out = max === null ? matched : matched.slice(0, max);
      if (single) return { data: out[0] ? { ...out[0] } : null, error: null };
      return { data: out.map((r) => ({ ...r })), error: null };
    };

    const q = {
      select: () => q,
      update: (p: Record<string, unknown>) => ((op = "update"), (patch = p), q),
      insert: (r: Record<string, unknown> | Record<string, unknown>[]) => (
        (op = "insert"), (insertRows = Array.isArray(r) ? r : [r]), q
      ),
      delete: () => ((op = "delete"), q),
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
      neq: (c: string, v: unknown) => (filters.push((r) => r[c] !== v), q),
      in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), q),
      // PostgREST `or=(a.eq.x,b.lte.y)` — 이 테스트가 쓰는 두 연산(eq·lte)만.
      or: (expr: string) => {
        const parts = expr.split(",").map((p) => {
          const [col, operator, ...rest] = p.split(".");
          const raw = rest.join(".");
          const val = raw === "true" ? true : raw === "false" ? false : raw;
          return (r: Record<string, unknown>) =>
            operator === "eq" ? r[col!] === val : operator === "lte" ? r[col!] != null && String(r[col!]) <= String(val) : false;
        });
        filters.push((r) => parts.some((f) => f(r)));
        return q;
      },
      order: () => q,
      limit: (n: number) => ((max = n), q),
      single: () => ((single = true), q),
      maybeSingle: () => ((single = true), q),
      then: (resolve: (v: Result) => unknown, reject?: (e: unknown) => unknown) => {
        try {
          return Promise.resolve(resolve(run()));
        } catch (e) {
          return reject ? Promise.resolve(reject(e)) : Promise.reject(e);
        }
      },
    };
    return q;
  }

  return { rows, writes, from };
}

export const byId = (db: { rows: FakeClassRow[] }, id: string) => db.rows.find((r) => r.id === id)!;
