/**
 * scripts/_makeedu/import-invoices.cjs — makeedu 상세수납(라인) → eywa `invoices` (자연키 tenant+student+period).
 * makeedu는 (학생×월×항목) 라인 단위 → eywa는 (학생×월) 1행으로 **집계**(line_items jsonb). 학생 매칭((이름·학년)→makeedu_id).
 * 입력: $MAKEEDU_OUT/invoices.json (989). 결제수단 카카오페이/지역화폐→other.
 *   node --env-file=.env.local scripts/_makeedu/import-invoices.cjs [--apply]
 */
const fs = require("fs");
const path = require("path");
const postgres = require("postgres");
const L = require("./lib.cjs");

const APPLY = process.argv.includes("--apply");
const OUT = process.env.MAKEEDU_OUT || "D:/tmp/makeedu";
const idx = (H) => (s) => H.findIndex((h) => (h || "").includes(s));
const ym = (v) => { const s = L.txt(v) || ""; const m = s.match(/(\d{4})[.\-/]?(\d{2})/); return m ? `${m[1]}-${m[2]}` : null; };

(async () => {
  const data = JSON.parse(fs.readFileSync(path.join(OUT, "invoices.json"), "utf8"));
  const H = idx(data.headers);
  const ci = { name: H("이름"), grade: H("학년"), month: H("청구월"), due: H("청구일"), item: H("수납명"),
    total: H("청구액"), disc: H("할인액"), point: H("적립금"), paid: H("실제낸금액"), unpaid: H("미납"), method: H("결제수단"), pdate: H("수납일") };
  const lines = [];
  for (const r of data.rows) {
    const name = L.txt(r[ci.name]); const period = ym(r[ci.month]);
    if (!name || !period) continue;
    lines.push({
      name, grade: L.gradeNorm(r[ci.grade]), period,
      dueDay: parseInt(L.txt(r[ci.due]) || "0", 10) || null,
      item: L.txt(r[ci.item]) || "수납",
      total: L.parseAmount(r[ci.total]), discount: L.parseAmount(r[ci.disc]),
      point: L.parseAmount(r[ci.point]), paid: L.parseAmount(r[ci.paid]), unpaid: L.parseAmount(r[ci.unpaid]),
      method: L.paymentMethod(r[ci.method]), pdate: L.parseDate(r[ci.pdate]),
    });
  }
  console.log("file: invoices.json  lines:", lines.length, "| periods:", [...new Set(lines.map((l) => l.period))].sort().slice(-6));

  const sql = postgres(process.env.DATABASE_URL, { prepare: false });
  try {
    const tenantId = await L.resolveTenantId(sql);
    const studs = await sql`select id, name, grade from students where tenant_id = ${tenantId} and makeedu_id is not null`;
    const m2 = new Map(), m1 = new Map();
    for (const s of studs) { const n = L.normalizeName(s.name); m2.set(`${n}|${s.grade || ""}`, s.id); if (!m1.has(n)) m1.set(n, s.id); else m1.set(n, null); }

    // (student_id, period)로 집계
    const inv = new Map();
    let unmatched = 0;
    for (const l of lines) {
      const n = L.normalizeName(l.name);
      const sid = m2.get(`${n}|${l.grade || ""}`) || m1.get(n) || null;
      if (!sid) { unmatched++; continue; }
      const key = `${sid}|${l.period}`;
      let a = inv.get(key);
      if (!a) { a = { student_id: sid, period: l.period, total: 0, discount: 0, point: 0, paid: 0, items: [], method: null, dueDay: l.dueDay, pdate: null }; inv.set(key, a); }
      a.total += l.total; a.discount += l.discount; a.point += l.point; a.paid += l.paid;
      a.items.push({ name: l.item, amount: l.total });
      if (!a.method && l.method) a.method = l.method;
      if (!a.pdate && l.pdate) a.pdate = l.pdate;
    }
    const invoices = [...inv.values()].map((a) => {
      const status = a.paid <= 0 ? "unpaid" : a.paid >= a.total - a.discount ? "paid" : "partial";
      const billed = a.dueDay ? `${a.period}-${String(a.dueDay).padStart(2, "0")}` : null;
      return { ...a, status, billed };
    });
    console.log(`lines→invoices(학생×월): ${invoices.length} | unmatched lines: ${unmatched}`);
    console.log("status dist:", invoices.reduce((x, i) => ((x[i.status] = (x[i.status] || 0) + 1), x), {}));
    console.log("sample:", JSON.stringify({ ...invoices[0], items: invoices[0]?.items?.slice(0, 2) }));

    if (!APPLY) { console.log("[DRY-RUN] --apply 없이 종료 (DB write 0)."); return; }
    let up = 0;
    for (const i of invoices) {
      await sql`
        insert into invoices (tenant_id, student_id, period, category, amount_total, amount_paid, amount_discount,
          points_used, status, line_items, payment_method, billed_at, due_date, paid_at)
        values (${tenantId}, ${i.student_id}, ${i.period}, ${"tuition"}, ${i.total}, ${i.paid}, ${i.discount},
          ${i.point}, ${i.status}, ${JSON.stringify(i.items)}, ${i.method}, ${i.billed}, ${i.billed}, ${i.pdate})
        on conflict (tenant_id, student_id, period)
        do update set amount_total = excluded.amount_total, amount_paid = excluded.amount_paid,
          amount_discount = excluded.amount_discount, points_used = excluded.points_used, status = excluded.status,
          line_items = excluded.line_items, payment_method = excluded.payment_method,
          billed_at = excluded.billed_at, paid_at = excluded.paid_at, updated_at = now()`;
      up++;
    }
    await L.recordSync(sql, tenantId, "invoices", up);
    console.log("upserted invoices:", up);
  } finally {
    await sql.end();
  }
})().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
