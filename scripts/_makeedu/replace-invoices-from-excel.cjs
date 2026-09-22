/**
 * scripts/_makeedu/replace-invoices-from-excel.cjs
 *
 * makeedu '수납 상세내역' 엑셀(전 기간)로 aywa `invoices`를 **전면 교체**(makeedu 우선, 사용자 확정 2026-07-08).
 * 배경: 기존 additive 임포트는 이미 임포트된 (학생,청구월)을 안 갱신 → 월 중 추가된 교재/특강 청구가 aywa에 누락
 * (2026-07 교재 11건 중 10건 누락 실측). 엑셀은 makeedu 완전 기록이라 이걸 소스로 재집계·upsert한다.
 *
 * 규칙:
 * - 집계 단위 = (학생, 청구월) 1행(aywa invoices UNIQUE 제약). 라인은 line_items에 **kind(구분: 교재/수업/차량비…) 보존**.
 * - 금액 = SUM(청구액/실제낸금액/할인액/적립금). status = 미납 SUM 기준(할인·적립 반영): 실납<=0 미수 / 미납<=0 완납 / 그 외 부분.
 * - category = 최대금액 라인의 구분 매핑(수업→tuition, 교재→material, 차량비/기타/원복→other).
 * - 결제수단·카드사·현금영수증·할인사유·수납일·청구일도 엑셀에서 채움(makeedu 우선).
 * - 매칭 = makeedu_id(원생고유번호) 우선 → (이름,학년) 폴백. 모호(동명+동학년 2명↑)·미존재 = 스킵(오매칭 방지).
 * - **upsert**: on conflict (tenant,student,period) DO UPDATE(makeedu-소스 필드 덮어씀). id·notes·teacher_snapshot_id·sync_added_at 보존.
 * - **교재요청서(textbook_orders)는 절대 안 건드림** — 그건 aywa 우선(신청은 aywa 소스, 자동 등록/납부 체크는 별도).
 * - dry-run 기본(DB write 0). --apply로 반영.
 *
 *   node --env-file=.env.local scripts/_makeedu/replace-invoices-from-excel.cjs [--apply]
 * 입력 엑셀 경로는 아래 FILES (repo/data). 필요시 --files=a.xlsx,b.xlsx 로 재정의.
 */
const path = require("path");
const postgres = require("postgres");
const ExcelJS = require("exceljs");
const L = require("./lib.cjs");

const APPLY = process.argv.includes("--apply");
const filesArg = (process.argv.find((a) => a.startsWith("--files=")) || "").slice(8);
const REPO = path.resolve(__dirname, "..", "..");
const FILES = filesArg
  ? filesArg.split(",")
  : [
      path.join(REPO, "data", "수납상세내역_20260708195823.xlsx"), // 01~03
      path.join(REPO, "data", "수납상세내역_20260708195735.xlsx"), // 04~07
    ];

const num = (v) => Number(String(v ?? "").replace(/[^0-9-]/g, "")) || 0;
const cell = (v) => {
  if (v == null) return "";
  if (typeof v === "object" && "text" in v) return String(v.text).trim();
  return String(v).trim();
};
// 구분 → aywa category
const KIND_CAT = { 수업: "tuition", 교재: "material", 차량비: "other", 기타: "other", 원복: "other" };

async function readLines() {
  const lines = [];
  for (const f of FILES) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(f);
    const ws = wb.worksheets[0];
    const hdr = ws.getRow(1).values.slice(1).map((v) => cell(v));
    const H = (s) => hdr.findIndex((h) => h.includes(s));
    const ci = {
      mkid: H("원생고유번호"), name: H("이름"), grade: H("학년"), gubun: H("구분"),
      month: H("청구월"), day: H("청구일"), item: H("수납명"), total: H("청구액"),
      disc: H("할인액"), point: H("적립"), paid: H("실제낸"), unpaid: H("미납"),
      method: H("결제수단"), card: H("카드사"), receipt: H("현금영수증"), payDate: H("수납일"),
      discReason: H("할인사유"),
    };
    for (let r = 2; r <= ws.rowCount; r++) {
      const v = ws.getRow(r).values;
      const g = (i) => cell(v[i + 1]);
      const name = g(ci.name);
      const mo = g(ci.month);
      const period = mo.length >= 6 ? `${mo.slice(0, 4)}-${mo.slice(4, 6)}` : mo;
      if (!name || !/^\d{4}-\d{2}$/.test(period)) continue;
      lines.push({
        mkid: g(ci.mkid), name, grade: L.gradeNorm(g(ci.grade)), gubun: g(ci.gubun), period,
        day: parseInt(g(ci.day) || "0", 10) || null, item: g(ci.item) || "수납",
        total: num(g(ci.total)), disc: num(g(ci.disc)), point: num(g(ci.point)),
        paid: num(g(ci.paid)), unpaid: num(g(ci.unpaid)),
        method: L.paymentMethod(g(ci.method)), card: g(ci.card) || null,
        receipt: g(ci.receipt) || null, payDate: L.parseDate(g(ci.payDate)),
        discReason: g(ci.discReason) || null,
      });
    }
  }
  return lines;
}

(async () => {
  const lines = await readLines();
  const periods = [...new Set(lines.map((l) => l.period))].sort();
  console.log(`엑셀 라인 ${lines.length} | 청구월 ${periods.join(", ")} ${APPLY ? "(APPLY)" : "(DRY-RUN)"}`);

  const sql = postgres(process.env.DATABASE_URL, { prepare: false });
  try {
    const tenantId = await L.resolveTenantId(sql);
    const studs = await sql`select id, name, grade, makeedu_id from students where tenant_id = ${tenantId}`;
    const byMkid = new Map();
    for (const s of studs) if (s.makeedu_id) byMkid.set(String(s.makeedu_id), s.id);
    const matchNameGrade = L.tieredMatcher(studs, [
      (s) => `${L.normalizeName(s.name)}|${s.grade || ""}`,
      (s) => L.normalizeName(s.name),
    ]);
    const resolve = (l) =>
      (l.mkid && byMkid.get(String(l.mkid))) || matchNameGrade({ name: l.name, grade: l.grade }) || null;

    // (student, period)로 집계
    const inv = new Map();
    let unmatched = 0;
    const unmatchedNames = new Set();
    for (const l of lines) {
      const sid = resolve(l);
      if (!sid) { unmatched++; unmatchedNames.add(`${l.name}(${l.grade})`); continue; }
      const key = `${sid}|${l.period}`;
      let a = inv.get(key);
      if (!a) {
        a = { student_id: sid, period: l.period, total: 0, paid: 0, disc: 0, point: 0, unpaid: 0,
          items: [], kindAmt: {}, method: null, card: null, receipt: null, discReason: null, day: null, payDate: null };
        inv.set(key, a);
      }
      a.total += l.total; a.paid += l.paid; a.disc += l.disc; a.point += l.point; a.unpaid += l.unpaid;
      // 라인 단위 표(makeedu 동일)를 위해 항목별 금액·결제정보를 모두 보존.
      a.items.push({
        kind: l.gubun, description: l.item, amount: l.total, discount: l.disc, points: l.point,
        paid: l.paid, unpaid: l.unpaid, method: l.method, paidDate: l.payDate, receipt: l.receipt, dueDay: l.day,
      });
      a.kindAmt[l.gubun] = (a.kindAmt[l.gubun] || 0) + l.total;
      if (!a.day && l.day) a.day = l.day;
      // 대표 결제정보 = 실납 있는 라인 우선(첫 등장 유지)
      if (l.paid > 0 || l.method) {
        if (!a.method && l.method) a.method = l.method;
        if (!a.card && l.card) a.card = l.card;
        if (!a.receipt && l.receipt) a.receipt = l.receipt;
        if (!a.payDate && l.payDate) a.payDate = l.payDate;
      }
      if (!a.discReason && l.discReason) a.discReason = l.discReason;
    }

    const rows = [...inv.values()].map((a) => {
      const status = a.paid <= 0 ? "unpaid" : a.unpaid <= 0 ? "paid" : "partial";
      const topKind = Object.entries(a.kindAmt).sort((x, y) => y[1] - x[1])[0]?.[0];
      const category = KIND_CAT[topKind] || "tuition";
      const billed = a.day ? `${a.period}-${String(a.day).padStart(2, "0")}` : `${a.period}-01`;
      return { ...a, status, category, billed };
    });
    const statusDist = rows.reduce((x, r) => ((x[r.status] = (x[r.status] || 0) + 1), x), {});
    console.log(`집계 인보이스 ${rows.length}(학생×월) | status ${JSON.stringify(statusDist)} | 미매칭 라인 ${unmatched} (학생 ${unmatchedNames.size}명)`);
    if (unmatchedNames.size) console.log(`  미매칭 표본: ${[...unmatchedNames].slice(0, 12).join(", ")}`);

    // 기존 aywa invoices와 대조(dry-run 리포트)
    const existing = await sql`
      select student_id, period, id, amount_total, amount_paid, amount_discount, status,
             case when jsonb_typeof(line_items) = 'array' then jsonb_array_length(line_items) else 0 end nli
      from invoices where tenant_id = ${tenantId} and period >= ${periods[0]} and period <= ${periods[periods.length - 1]}`;
    const exMap = new Map(existing.map((e) => [`${e.student_id}|${e.period}`, e]));
    let inserts = 0, updates = 0, changedAmt = 0, changedStatus = 0;
    for (const r of rows) {
      const e = exMap.get(`${r.student_id}|${r.period}`);
      if (!e) { inserts++; continue; }
      updates++;
      if (Number(e.amount_total) !== r.total || Number(e.amount_paid) !== r.paid || Number(e.amount_discount) !== r.disc || e.nli !== r.items.length) changedAmt++;
      if (e.status !== r.status) changedStatus++;
    }
    // 엑셀에 없는 aywa 인보이스(교차 기간) = orphan 후보(makeedu에 없음)
    const excelKeys = new Set(rows.map((r) => `${r.student_id}|${r.period}`));
    const orphans = existing.filter((e) => !excelKeys.has(`${e.student_id}|${e.period}`));
    console.log(`\n대조: 신규 insert ${inserts} / update ${updates} (금액·항목 변경 ${changedAmt} · status 변경 ${changedStatus}) / 엑셀에 없는 기존행(orphan) ${orphans.length}`);
    if (orphans.length) console.log(`  ⚠️ orphan ${orphans.length}건은 makeedu 엑셀에 없음 — 이번 upsert는 이들을 삭제하지 않음(안전). 필요시 별도 검토.`);

    if (!APPLY) {
      console.log("\n[DRY-RUN] --apply 없이 종료 (DB write 0).");
      return;
    }

    let done = 0;
    for (const r of rows) {
      await sql`
        insert into invoices (tenant_id, student_id, period, category, amount_total, amount_paid, amount_discount,
          points_used, status, line_items, payment_method, card_company, cash_receipt_number, discount_reason, billed_at, due_date, paid_at)
        values (${tenantId}, ${r.student_id}, ${r.period}, ${r.category}, ${r.total}, ${r.paid}, ${r.disc},
          ${r.point}, ${r.status}::invoice_status, ${sql.json(r.items)}, ${r.method}, ${r.card}, ${r.receipt},
          ${r.discReason}, ${r.billed}, ${r.billed}, ${r.payDate})
        on conflict (tenant_id, student_id, period) do update set
          category = excluded.category, amount_total = excluded.amount_total, amount_paid = excluded.amount_paid,
          amount_discount = excluded.amount_discount, points_used = excluded.points_used, status = excluded.status,
          line_items = excluded.line_items, payment_method = excluded.payment_method, card_company = excluded.card_company,
          cash_receipt_number = excluded.cash_receipt_number, discount_reason = excluded.discount_reason,
          billed_at = excluded.billed_at, due_date = excluded.due_date, paid_at = excluded.paid_at, updated_at = now()`;
      done++;
    }
    console.log(`\n✅ [APPLY] upsert ${done}건 완료 (교재요청서 미변경).`);
  } finally {
    await sql.end();
  }
})().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
