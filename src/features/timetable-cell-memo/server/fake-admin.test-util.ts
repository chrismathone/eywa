/**
 * 칸 메모 서버 테스트용 **가짜 admin 클라이언트** — 어떤 표에 무엇을 어떤 조건(tenant_id 등)으로 했는지 기록한다.
 * 응답은 `respond(call)`이 정한다(표·동작·조건을 보고).
 */
export type FakeCall = { table: string; op: "select" | "insert" | "update" | "delete"; payload?: unknown; filters: [string, string, unknown][] };
type Res = { data: unknown; error: unknown };

export function fakeAdmin(respond: (call: FakeCall) => Res, calls: FakeCall[] = []) {
  const from = (table: string) => {
    const call: FakeCall = { table, op: "select", filters: [] };
    calls.push(call);
    const done = () => Promise.resolve(respond(call));
    const b: Record<string, unknown> = {};
    const chain = (fn: (...a: unknown[]) => void) => (...a: unknown[]) => (fn(...a), b);
    Object.assign(b, {
      select: chain(() => {}),
      insert: chain((p) => ((call.op = "insert"), (call.payload = p))),
      update: chain((p) => ((call.op = "update"), (call.payload = p))),
      delete: chain(() => (call.op = "delete")),
      eq: chain((c, v) => call.filters.push(["eq", String(c), v])),
      gte: chain((c, v) => call.filters.push(["gte", String(c), v])),
      lte: chain((c, v) => call.filters.push(["lte", String(c), v])),
      in: chain((c, v) => call.filters.push(["in", String(c), v])),
      order: chain(() => {}),
      limit: chain(() => {}),
      range: chain((a, z) => call.filters.push(["range", String(a), z])),
      maybeSingle: done,
      single: done,
      then: (ok: (r: Res) => unknown, bad: (e: unknown) => unknown) => done().then(ok, bad),
    });
    return b;
  };
  return { client: { from }, calls };
}

/** 이 호출이 그 지점으로 좁혀졌나. */
export const tenantOf = (call: FakeCall) => call.filters.find(([op, col]) => op === "eq" && col === "tenant_id")?.[2];
