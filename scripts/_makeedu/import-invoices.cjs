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
const OUT = process.env.MAKEEDU_OUT || path.resolve(__dirname, "..", "..", ".makeedu-tmp");
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
    // additive: makeedu 청구 라인의 학생을 이름(+학년)으로 ijw 전체 학생에 매칭(makeedu_id 백필 순서와 무관).
    // 동명+동학년이 2명 이상이면 모호 → tieredMatcher가 null 반환(오매칭 방지). 인라인 last-wins 금지.
    const studs = await sql`select id, name, grade from students where tenant_id = ${tenantId}`;
    const matchStudent = L.tieredMatcher(studs, [
      (s) => `${L.normalizeName(s.name)}|${s.grade || ""}`,
      (s) => L.normalizeName(s.name),
    ]);

    // (student_id, period)로 집계
    const inv = new Map();
    let unmatched = 0;
    for (const l of lines) {
      const sid = matchStudent({ name: l.name, grade: l.grade });
      if (!sid) { unmatched++; continue; }
      const key = `${sid}|${l.period}`;
      let a = inv.get(key);
      if (!a) { a = { student_id: sid, period: l.period, total: 0, discount: 0, point: 0, paid: 0, items: [], method: null, dueDay: l.dueDay, pdate: null }; inv.set(key, a); }
      a.total += l.total; a.discount += l.discount; a.point += l.point; a.paid += l.paid;
      // eywa/POC와 동일한 line_items 형태(description)로 통일 — name-only는 검색/표시에서
      // description 부재로 취급돼 500을 유발했었다(런타임 normalizeInvoiceLineItems가 기존 name-only도 흡수).
      a.items.push({ kind: "tuition", description: l.item, amount: l.total });
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

    // additive: ijw 기존 (학생,청구월) 인보이스는 보존(절대 덮어쓰지 않음). makeedu의 새 청구월만 추가.
    const existPer = new Set(
      (await sql`select student_id, period from invoices where tenant_id = ${tenantId}`).map((r) => `${r.student_id}|${r.period}`),
    );
    const fresh = invoices.filter((i) => !existPer.has(`${i.student_id}|${i.period}`));
    console.log(`[additive] ijw 기존 인보이스 ${existPer.size} | makeedu 집계 ${invoices.length} → 새 청구월만 추가: ${fresh.length} (기존 보존 ${invoices.length - fresh.length})`);
    console.log("새 청구월 표본:", [...new Set(fresh.map((i) => i.period))].sort().slice(-6));

    if (!APPLY) { console.log("\n[DRY-RUN] --apply 없이 종료 (DB write 0)."); return; }
    // ↻ 동기화 배지 = "지난 동기화가 새로 추가한 청구". 이 성공 실행 시작에 지난 신규 표시를 클리어(0062a).
    const cleared = await sql`update invoices set sync_added_at = null where tenant_id = ${tenantId} and sync_added_at is not null`;
    if (cleared.count) console.log(`  지난 동기화 라벨 클리어: ${cleared.count}`);
    let up = 0;
    for (const i of fresh) {
      await sql`
        insert into invoices (tenant_id, student_id, period, category, amount_total, amount_paid, amount_discount,
          points_used, status, line_items, payment_method, billed_at, due_date, paid_at, sync_added_at)
        values (${tenantId}, ${i.student_id}, ${i.period}, ${"tuition"}, ${i.total}, ${i.paid}, ${i.discount},
          ${i.point}, ${i.status}, ${JSON.stringify(i.items)}, ${i.method}, ${i.billed}, ${i.billed}, ${i.pdate}, now())
        on conflict (tenant_id, student_id, period) do nothing`;
      up++;
    }
    await L.recordSync(sql, tenantId, "invoices", up);
    console.log("inserted new invoices:", up);
  } finally {
    await sql.end();
  }
})().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
