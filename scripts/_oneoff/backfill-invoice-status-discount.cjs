/**
 * scripts/_oneoff/backfill-invoice-status-discount.cjs
 *
 * 인보이스 status를 "할인 차감 후 완납 판정"(paid >= 청구−할인)으로 재계산해 정정한다.
 * 배경: 초기 ijw 복원(transform.ts `mapInvoiceStatus`)이 할인을 안 빼고 `paid >= total`로 판정 →
 * 할인받고 완납한 학생이 전부 'partial'로 저장됨(2026-07 실측 848건, 가짜 미수 = 할인 합계).
 *
 * - refunded/void는 절대 안 건드림(사람이 지정한 상태).
 * - paid/partial/unpaid만 재계산해 **바뀌는 행만** UPDATE(전이 행렬을 먼저 출력).
 * - 기본 dry-run(DB write 0). 실제 반영은 --apply.
 *
 *   node --env-file=.env.local scripts/_oneoff/backfill-invoice-status-discount.cjs          # dry-run
 *   node --env-file=.env.local scripts/_oneoff/backfill-invoice-status-discount.cjs --apply  # 반영
 */
const postgres = require("postgres");
const APPLY = process.argv.includes("--apply");

// status는 enum(invoice_status)이라 CASE(text) 결과를 enum으로 캐스팅해야 비교/대입이 된다.
const NEW_STATUS = `
  (case when amount_paid <= 0 then 'unpaid'
        when amount_paid >= amount_total - amount_discount then 'paid'
        else 'partial' end)::invoice_status`;

(async () => {
  const sql = postgres(process.env.DATABASE_URL, { prepare: false });
  try {
    // 1) 전이 행렬(할인/void 제외한 paid·partial·unpaid만 재계산, 바뀌는 것만)
    const matrix = await sql.unsafe(`
      with c as (
        select status as old_status, (${NEW_STATUS}) as new_status
        from invoices where status in ('paid','partial','unpaid')
      )
      select old_status, new_status, count(*)::int n
      from c where old_status <> new_status
      group by 1,2 order by n desc`);
    console.log("=== 재계산으로 바뀌는 전이 (old → new) ===");
    if (!matrix.length) console.log("  (없음 — 모든 status가 이미 정확)");
    else console.table(matrix.map((r) => ({ ...r })));

    const total = matrix.reduce((s, r) => s + r.n, 0);
    // 표본 몇 건(학생명 포함)
    const sample = await sql.unsafe(`
      select s.name, i.period, i.amount_total, i.amount_paid, i.amount_discount,
             i.status as old_status, (${NEW_STATUS}) as new_status
      from invoices i join students s on s.id = i.student_id
      where i.status in ('paid','partial','unpaid') and i.status <> (${NEW_STATUS})
      order by i.period desc limit 8`);
    console.log("=== 표본 ===");
    console.table(sample.map((r) => ({ ...r })));

    if (!APPLY) {
      console.log(`\n[DRY-RUN] 총 ${total}행이 정정 대상. 반영하려면 --apply. (DB write 0)`);
      return;
    }

    const res = await sql.unsafe(`
      update invoices set status = (${NEW_STATUS})
      where status in ('paid','partial','unpaid') and status <> (${NEW_STATUS})`);
    console.log(`\n✅ [APPLY] ${res.count}행 status 정정 완료.`);
  } finally {
    await sql.end();
  }
})().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
