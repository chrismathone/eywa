type Row = Record<string, unknown>;
type Filter = { op: string; key: string; value: unknown };
export function testDb(tables: Record<string, Row[]>) {
  const calls: { table: string; filters: Filter[]; from: number; to: number }[] = [];
  const failures = new Set<string>();
  return { tables, calls, failures, from(table: string) {
    const filters: Filter[] = [];
    const orders: { key: string; ascending: boolean }[] = [];
    let from = 0, to = 999, single = false;
    const builder = {
      select() { return builder; },
      eq(key: string, value: unknown) { filters.push({ op: "eq", key, value }); return builder; },
      gte(key: string, value: unknown) { filters.push({ op: "gte", key, value }); return builder; },
      lte(key: string, value: unknown) { filters.push({ op: "lte", key, value }); return builder; },
      is(key: string, value: unknown) { filters.push({ op: "eq", key, value }); return builder; },
      in(key: string, value: unknown[]) { filters.push({ op: "in", key, value }); return builder; },
      or(value: string) { filters.push({ op: "or", key: "", value }); return builder; },
      order(key: string, options?: { ascending?: boolean }) { orders.push({ key, ascending: options?.ascending !== false }); return builder; },
      range(a: number, b: number) { from = a; to = b; return builder; },
      maybeSingle() { single = true; return builder; },
      then(resolve: (v: { data: Row[] | Row | null; error: { message: string } | null }) => unknown) {
        calls.push({ table, filters: [...filters], from, to });
        if (failures.has(table)) return Promise.resolve(resolve({ data: null, error: { message: "fixture read failed" } }));
        const rows = (tables[table] ?? []).filter((row) => filters.every((filter) => {
          if (filter.op === "eq") return row[filter.key] === filter.value;
          if (filter.op === "in") return (filter.value as unknown[]).includes(row[filter.key]);
          if (filter.op === "gte") return String(row[filter.key]) >= String(filter.value);
          if (filter.op === "lte") return String(row[filter.key]) <= String(filter.value);
          if (filter.op === "or") {
            const floor = String(filter.value).split(".gte.")[1]!;
            return row.end_date == null || String(row.end_date) >= floor;
          }
          throw new Error("Unsupported test filter");
        })).sort((a, b) => {
          for (const order of orders) { const delta = String(a[order.key]).localeCompare(String(b[order.key])); if (delta) return order.ascending ? delta : -delta; }
          return 0;
        }).slice(from, to + 1);
        return Promise.resolve(resolve({ data: single ? rows[0] ?? null : rows, error: null }));
      },
    };
    return builder;
  } };
}
