/**
 * 테스트 전용 — 제출 링크 서버 코드가 쓰는 만큼만 흉내 내는 메모리 Supabase(admin) 클라이언트.
 * 지원: select(필드 무시·count head) · insert(유니크 → 23505) · update · delete · eq/is/in/gt/gte/lt/order/limit ·
 *       or(`열.like.%끝` · `열.ilike.%포함%` — 올리기 사이트의 전화 끝자리 조회 · `열.eq.값`) · maybeSingle/single.
 *       rpc(등록한 함수만 — 없으면 PGRST202 = 그 SQL이 아직 없는 DB) · dropColumn(없는 칸을 고르면 42703 = 칸이 아직 없는 DB).
 * 🔴 운영 코드에서 import하지 말 것(테스트 파일만).
 */
type Row = Record<string, unknown>;
type Filter = (row: Row) => boolean;

export type FakeDb = ReturnType<typeof createFakeDb>;

export function createFakeDb(seed: Record<string, Row[]>, unique: Record<string, string[][]> = {}) {
  const tables: Record<string, Row[]> = Object.fromEntries(Object.entries(seed).map(([k, v]) => [k, v.map((r) => ({ ...r }))]));
  const missing = new Set<string>();
  const missingColumns: Record<string, Set<string>> = {};
  const rpcs: Record<string, (args: Record<string, unknown>) => unknown> = {};
  const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
  let seq = 0;

  function from(table: string) {
    const filters: Filter[] = [];
    let op: "select" | "insert" | "update" | "delete" = "select";
    let payload: Row[] = [];
    let patch: Row = {};
    let head = false;
    let returning = false;
    let limit = Infinity;
    let offset = 0;
    let selected = "";
    const rows = () => (tables[table] ??= []);
    const run = (single: "none" | "maybe" | "one") => {
      if (missing.has(table) || (table === "homework_video_ledger_videos" && !tables[table])) return { data: null, error: { code: "PGRST205", message: "missing" }, count: null };
      if (selected.split(",").some((col) => missingColumns[table]?.has(col.trim())))
        return { data: null, error: { code: "42703", message: "missing column" }, count: null };
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
      const out = hit.slice(offset, offset + limit);
      if (single === "none") return { data: out, error: null, count: null };
      if (single === "one" && out.length !== 1) return { data: null, error: { code: "PGRST116", message: "not one" }, count: null };
      return { data: out[0] ?? null, error: null, count: null };
    };
    const builder = {
      select(cols?: string, opts?: { head?: boolean }) { if (op !== "select") returning = true; selected = cols ?? ""; head = !!opts?.head; return builder; },
      insert(value: Row | Row[]) { op = "insert"; payload = Array.isArray(value) ? value : [value]; return builder; },
      update(value: Row) { op = "update"; patch = value; return builder; },
      delete() { op = "delete"; return builder; },
      // `route->>classId` 모양(jsonb 한 단계)도 받는다.
      in(col: string, values: unknown[]) {
        const [base, key] = col.split("->>");
        filters.push((r) => values.includes(key ? (r[base!] as Row | null | undefined)?.[key] : r[col]));
        return builder;
      },
      // `a.like.%1234`(끝자리) · `a.ilike.%1234%`(포함) · `a.eq.false`(같음 — 칸이 없는 행은 안 맞는다) — 어느 한 조건이 맞으면 통과.
      or(expr: string) {
        const parts = expr.split(",").map((part) => ({ like: /^([a-z_]+)\.i?like\.%(.+?)(%?)$/.exec(part), eq: /^([a-z_]+)\.eq\.(.+)$/.exec(part), compare: /^(.+?)\.(gte|eq)\.(.+)$/.exec(part) }));
        filters.push((r) => parts.some(({ like, eq, compare }) => {
          if (eq) return r[eq[1]!] !== undefined && String(r[eq[1]!]) === eq[2];
          if (compare) { const [base, key] = compare[1]!.split("->>"); const value = key ? (r[base!] as Row | undefined)?.[key] : r[base!]; return value !== undefined && (compare[2] === "gte" ? String(value) >= compare[3]! : String(value) === compare[3]); }
          if (!like) return false;
          const value = String(r[like[1]!] ?? "");
          return like[3] ? value.includes(like[2]!) : value.endsWith(like[2]!);
        }));
        return builder;
      },
      eq(col: string, v: unknown) { filters.push((r) => r[col] === v); return builder; },
      neq(col: string, v: unknown) { filters.push((r) => r[col] != null && r[col] !== v); return builder; },
      is(col: string, v: unknown) { filters.push((r) => (r[col] ?? null) === v); return builder; },
      not(col: string, operator: string, v: unknown) {
        if (operator !== "is") throw new Error(`Unsupported fake-db not operator: ${operator}`);
        filters.push((r) => (r[col] ?? null) !== v);
        return builder;
      },
      gt(col: string, v: string) { filters.push((r) => String(r[col]) > v); return builder; },
      gte(col: string, v: string) { filters.push((r) => String(r[col]) >= v); return builder; },
      lt(col: string, v: string) { filters.push((r) => String(r[col]) < v); return builder; },
      order() { return builder; },
      limit(n: number) { limit = n; return builder; },
      range(from: number, to: number) { offset = from; limit = to - from + 1; return builder; },
      maybeSingle: async () => run("maybe"),
      single: async () => run("one"),
      then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) { return Promise.resolve(run("none")).then(resolve, reject); },
    };
    return builder;
  }
  /** 등록한 함수만 답한다. 함수가 던지면 `{ code, message }`를 오류로 돌려준다(코드 없으면 P0001 — DB가 한글 사유로 거절한 경우). */
  async function rpc(name: string, args: Record<string, unknown> = {}) {
    rpcCalls.push({ name, args });
    const fn = rpcs[name];
    if (!fn) return { data: null, error: { code: "PGRST202", message: "missing function" } };
    try {
      return { data: (await fn(args)) ?? null, error: null };
    } catch (thrown) {
      const error = thrown as { code?: string; message?: string };
      return { data: null, error: { code: error.code ?? "P0001", message: error.message ?? "" } };
    }
  }
  return {
    from, rpc, rpcCalls, tables, dropTable: (t: string) => missing.add(t),
    dropColumn: (t: string, column: string) => (missingColumns[t] ??= new Set()).add(column),
    defineRpc: (name: string, fn: (args: Record<string, unknown>) => unknown) => { rpcs[name] = fn; },
  };
}
