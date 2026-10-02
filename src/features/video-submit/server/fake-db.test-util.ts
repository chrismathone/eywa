/**
 * 테스트 전용 — 제출 링크 서버 코드가 쓰는 만큼만 흉내 내는 메모리 Supabase(admin) 클라이언트.
 * 지원: select(필드 무시·count head) · insert(유니크 → 23505) · update · delete · eq/is/in/gt/gte/lt/order/limit ·
 *       or(`열.like.%끝` · `열.ilike.%포함%` — 올리기 사이트의 전화 끝자리 조회) · maybeSingle/single.
 * 🔴 운영 코드에서 import하지 말 것(테스트 파일만).
 */
type Row = Record<string, unknown>;
type Filter = (row: Row) => boolean;

export type FakeDb = ReturnType<typeof createFakeDb>;

export function createFakeDb(seed: Record<string, Row[]>, unique: Record<string, string[][]> = {}) {
  const tables: Record<string, Row[]> = Object.fromEntries(Object.entries(seed).map(([k, v]) => [k, v.map((r) => ({ ...r }))]));
  const missing = new Set<string>();
  let seq = 0;

  function from(table: string) {
    const filters: Filter[] = [];
    let op: "select" | "insert" | "update" | "delete" = "select";
    let payload: Row[] = [];
    let patch: Row = {};
    let head = false;
    let returning = false;
    let limit = Infinity;
    const rows = () => (tables[table] ??= []);
    const run = (single: "none" | "maybe" | "one") => {
      if (missing.has(table)) return { data: null, error: { code: "PGRST205", message: "missing" }, count: null };
      if (op === "insert") {
        for (const r of payload) {
          const row: Row = { id: r.id ?? `id-${++seq}`, created_at: r.created_at ?? new Date().toISOString(), ...r };
          for (const cols of unique[table] ?? []) {
            if (rows().some((x) => cols.every((c) => x[c] === row[c] && row[c] != null)))
              return { data: null, error: { code: "23505", message: "duplicate" }, count: null };
          }
          rows().push(row);
          if (returning) return { data: single === "none" ? [row] : row, error: null, count: null };
        }
        return { data: null, error: null, count: null };
      }
      const hit = rows().filter((r) => filters.every((f) => f(r)));
      if (op === "update") {
        hit.forEach((r) => Object.assign(r, patch));
        return { data: returning ? hit : null, error: null, count: null };
      }
      if (op === "delete") {
        tables[table] = rows().filter((r) => !hit.includes(r));
        return { data: null, error: null, count: null };
      }
      if (head) return { data: null, error: null, count: hit.length };
      const out = hit.slice(0, limit);
      if (single === "none") return { data: out, error: null, count: null };
      if (single === "one" && out.length !== 1) return { data: null, error: { code: "PGRST116", message: "not one" }, count: null };
      return { data: out[0] ?? null, error: null, count: null };
    };
    const builder = {
      select(_cols?: string, opts?: { head?: boolean }) { if (op !== "select") returning = true; head = !!opts?.head; return builder; },
      insert(value: Row | Row[]) { op = "insert"; payload = Array.isArray(value) ? value : [value]; return builder; },
      update(value: Row) { op = "update"; patch = value; return builder; },
      delete() { op = "delete"; return builder; },
      // `route->>classId` 모양(jsonb 한 단계)도 받는다.
      in(col: string, values: unknown[]) {
        const [base, key] = col.split("->>");
        filters.push((r) => values.includes(key ? (r[base!] as Row | null | undefined)?.[key] : r[col]));
        return builder;
      },
      // `a.like.%1234`(끝자리) · `a.ilike.%1234%`(포함) 모양만 — 어느 한 열이 맞으면 통과.
      or(expr: string) {
        const parts = expr.split(",").map((part) => /^([a-z_]+)\.i?like\.%(.+?)(%?)$/.exec(part));
        filters.push((r) => parts.some((m) => {
          if (!m) return false;
          const value = String(r[m[1]!] ?? "");
          return m[3] ? value.includes(m[2]!) : value.endsWith(m[2]!);
        }));
        return builder;
      },
      eq(col: string, v: unknown) { filters.push((r) => r[col] === v); return builder; },
      is(col: string, v: unknown) { filters.push((r) => (r[col] ?? null) === v); return builder; },
      gt(col: string, v: string) { filters.push((r) => String(r[col]) > v); return builder; },
      gte(col: string, v: string) { filters.push((r) => String(r[col]) >= v); return builder; },
      lt(col: string, v: string) { filters.push((r) => String(r[col]) < v); return builder; },
      order() { return builder; },
      limit(n: number) { limit = n; return builder; },
      maybeSingle: async () => run("maybe"),
      single: async () => run("one"),
      then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) { return Promise.resolve(run("none")).then(resolve, reject); },
    };
    return builder;
  }
  return { from, tables, dropTable: (t: string) => missing.add(t) };
}
