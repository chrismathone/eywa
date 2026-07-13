/**
 * scripts/_makeedu/import-invoices.cjs — makeedu 상세수납(라인) → eywa `invoices`.
 * makeedu는 (학생×월×항목) 라인 단위 → eywa는 (학생×월) 1행으로 **집계**(line_items jsonb, 항목별 kind=구분 보존).
 *
 * ⚠️ 2026-07-08 재작성 — additive(건너뛰기) → **upsert(makeedu 우선)**. 배경: additive는 월 중 추가된 교재/특강
 * 청구가 기존 인보이스에 반영 안 돼 eywa 수납이 makeedu보다 적게 표시됐다(2026-07 교재 11건 중 10건 누락 실측).
 * 이제 매 sync가 현재 스크랩(현재 청구월 슬라이스)으로 그 달 인보이스를 **재집계·덮어쓰기**해 항상 makeedu와 일치.
 * (과거 전 기간 1회 정합은 replace-invoices-from-excel.cjs로 이미 수행.)
 * 함께 고친 잠재버그: line_items 스키마({kind,description,amount})·sql.json 바인딩(문자열 스칼라 저장 방지)·
 * category(구분 도출)·makeedu_id 우선 매칭.
 *
 * ⚠️ 2026-07-13 구조적 사각 2건 보완(머지 적대 리뷰 I4 — 분류·리포트는 invoice-stale.cjs):
 * ① 삭제 미반영 — upsert는 스크랩에 있는 (학생,월)만 만지므로, makeedu에서 그 달 라인이 전부 삭제된 학생의
 *   eywa 인보이스가 영구 stale(유령 미수)로 남았다(2026-07 실측 36건·미완납 잔액 ₩7.6M). 이제 스크랩이 커버한
 *   청구월에서 eywa에만 남은 행을 감지해 **기본은 리포트만**, `--void-stale`(또는 env MAKEEDU_VOID_STALE=true)
 *   + --apply일 때만 **미완납(unpaid/partial)을 status='void'**로 전환(notes 앞에 한글 마커 = 근거·직전 상태 보존).
 *   완납/환불(수납 기록 보존)·수동 청구 추정(라인에 paid 필드 없음)·미매칭 의심(같은 이름이 미매칭 라인에 존재)·
 *   커버리지 80% 미만 월(부분 스크랩 의심)은 **항상 보류**(오탐-void 방지). void 행은 미수 집계 제외(billing/calc.ts),
 *   makeedu에 라인이 재등장하면 아래 upsert가 status 복원 + [동기화] 마커 자동 제거(self-healing).
 *   ⚠️ 과거 월(스크랩 밖)의 삭제는 여기서 못 본다 — 전 기간 정합은 replace-invoices-from-excel.cjs.
 * ② 미매칭 조용한 스킵 — 학생 매칭 실패 라인이 카운트만 남고 증발했다. 이제 라인 상세(이름/학년/금액/월)를
 *   $MAKEEDU_OUT/import-invoices-report.json(최신 상세) + import-invoices-issues.log(한 줄 히스토리)로 남기고
 *   makeedu_sync_state.error에 요약 기록(성공이어도 이슈 추적 가능. 위험군 = students.makeedu_id 누락 학생뿐).
 *
 *   node --env-file=.env.local scripts/_makeedu/import-invoices.cjs [--apply] [--void-stale]
 */
const fs = require("fs");
const path = require("path");
const postgres = require("postgres");
const L = require("./lib.cjs");
const S = require("./invoice-stale.cjs");

const APPLY = process.argv.includes("--apply");
const VOID_STALE = process.argv.includes("--void-stale") || process.env.MAKEEDU_VOID_STALE === "true";
const OUT = process.env.MAKEEDU_OUT || path.resolve(__dirname, "..", "..", ".makeedu-tmp");
const idx = (H) => (s) => H.findIndex((h) => (h || "").includes(s));
const ym = (v) => { const s = L.txt(v) || ""; const m = s.match(/(\d{4})[.\-/]?(\d{2})/); return m ? `${m[1]}-${m[2]}` : null; };
// makeedu 구분 → eywa category(대표 분류). 라인별 상세는 line_items.kind에 보존.
const KIND_CAT = { 수업: "tuition", 교재: "material", 차량비: "other", 기타: "other", 원복: "other" };

(async () => {
  const data = JSON.parse(fs.readFileSync(path.join(OUT, "invoices.json"), "utf8"));
  const H = idx(data.headers);
  const ci = { mkid: H("원생고유번호"), name: H("이름"), grade: H("학년"), gubun: H("구분"), month: H("청구월"),
    due: H("청구일"), item: H("수납명"), total: H("청구액"), disc: H("할인액"), point: H("적립"),
    paid: H("실제낸"), unpaid: H("미납"), method: H("결제수단"), card: H("카드사"), receipt: H("현금영수증"),
    discReason: H("할인사유"), pdate: H("수납일") };
  const lines = [];
  for (const r of data.rows) {
    const name = L.txt(r[ci.name]); const period = ym(r[ci.month]);
    if (!name || !period) continue;
    lines.push({
      mkid: L.txt(r[ci.mkid]), name, grade: L.gradeNorm(r[ci.grade]), gubun: L.txt(r[ci.gubun]) || "수업", period,
      dueDay: parseInt(L.txt(r[ci.due]) || "0", 10) || null,
      item: L.txt(r[ci.item]) || "수납",
      total: L.parseAmount(r[ci.total]), discount: L.parseAmount(r[ci.disc]),
      point: L.parseAmount(r[ci.point]), paid: L.parseAmount(r[ci.paid]), unpaid: L.parseAmount(r[ci.unpaid]),
      method: L.paymentMethod(r[ci.method]), card: L.txt(r[ci.card]), receipt: L.txt(r[ci.receipt]),
      discReason: L.txt(r[ci.discReason]), pdate: L.parseDate(r[ci.pdate]),
    });
  }
  console.log("file: invoices.json  lines:", lines.length, "| periods:", [...new Set(lines.map((l) => l.period))].sort().slice(-6));

  const sql = postgres(process.env.DATABASE_URL, { prepare: false });
  try {
    const tenantId = await L.resolveTenantId(sql);
    // 스크랩이 커버한 청구월 — "eywa에만 남은 행" 판정은 이 범위 안에서만(과거 월은 스크랩 밖 = 판정 불가).
    const scrapedPeriods = [...new Set(lines.map((l) => l.period))].sort();
    const [studs, existing] = await Promise.all([
      sql`select id, name, grade, makeedu_id from students where tenant_id = ${tenantId}`,
      scrapedPeriods.length
        ? sql`select i.id, i.student_id, i.period, i.status, i.amount_total, i.amount_paid, i.amount_discount,
                     i.notes, i.line_items, s.name, s.grade, s.makeedu_id
              from invoices i join students s on s.id = i.student_id
              where i.tenant_id = ${tenantId} and i.period = any(${scrapedPeriods}) and i.status <> 'void'`
        : Promise.resolve([]),
    ]);
    const byMkid = new Map();
    for (const s of studs) if (s.makeedu_id) byMkid.set(String(s.makeedu_id), s.id);
    // 동명+동학년 2명 이상은 모호 → null(오매칭 방지). makeedu_id 우선 → (이름·학년) 폴백.
    const matchNameGrade = L.tieredMatcher(studs, [
      (s) => `${L.normalizeName(s.name)}|${s.grade || ""}`,
      (s) => L.normalizeName(s.name),
    ]);
    const resolve = (l) =>
      (l.mkid && byMkid.get(String(l.mkid))) || matchNameGrade({ name: l.name, grade: l.grade }) || null;

    // (student_id, period)로 집계
    const inv = new Map();
    const unmatchedLines = []; // (b) 매칭 실패 라인 상세 — 리포트로 가시화(조용한 증발 방지)
    for (const l of lines) {
      const sid = resolve(l);
      if (!sid) {
        unmatchedLines.push({ name: l.name, grade: l.grade, mkid: l.mkid, period: l.period,
          kind: l.gubun, item: l.item, total: l.total, paid: l.paid, unpaid: l.unpaid });
        continue;
      }
      const key = `${sid}|${l.period}`;
      let a = inv.get(key);
      if (!a) {
        a = { student_id: sid, period: l.period, total: 0, discount: 0, point: 0, paid: 0, unpaid: 0,
          items: [], kindAmt: {}, method: null, card: null, receipt: null, discReason: null, dueDay: l.dueDay, pdate: null };
        inv.set(key, a);
      }
      a.total += l.total; a.discount += l.discount; a.point += l.point; a.paid += l.paid; a.unpaid += l.unpaid;
      // 라인 단위 표(makeedu 동일)를 위해 항목별 금액·결제정보를 모두 보존.
      // (main 4bbc8f9의 description 통일 픽스는 이 상위집합에 포함 — name-only 500 방어는 normalize가 계속 흡수.)
      a.items.push({
        kind: l.gubun, description: l.item, amount: l.total, discount: l.discount, points: l.point,
        paid: l.paid, unpaid: l.unpaid, method: l.method, paidDate: l.pdate, receipt: l.receipt, dueDay: l.dueDay,
      });
      a.kindAmt[l.gubun] = (a.kindAmt[l.gubun] || 0) + l.total;
      if (l.paid > 0 || l.method) {
        if (!a.method && l.method) a.method = l.method;
        if (!a.card && l.card) a.card = l.card;
        if (!a.receipt && l.receipt) a.receipt = l.receipt;
        if (!a.pdate && l.pdate) a.pdate = l.pdate;
      }
      if (!a.discReason && l.discReason) a.discReason = l.discReason;
    }
    const invoices = [...inv.values()].map((a) => {
      // 완납 판정은 makeedu 미납 합(할인·적립 반영). 미납<=0=완납 / 실납<=0=미수 / 그 외 부분.
      const status = a.paid <= 0 ? "unpaid" : a.unpaid <= 0 ? "paid" : "partial";
      const topKind = Object.entries(a.kindAmt).sort((x, y) => y[1] - x[1])[0]?.[0];
      const category = KIND_CAT[topKind] || "tuition";
      const billed = a.dueDay ? `${a.period}-${String(a.dueDay).padStart(2, "0")}` : `${a.period}-01`;
      return { ...a, status, category, billed };
    });
    console.log(`lines→invoices(학생×월): ${invoices.length} | unmatched lines: ${unmatchedLines.length}`);
    console.log("status dist:", invoices.reduce((x, i) => ((x[i.status] = (x[i.status] || 0) + 1), x), {}));

    // (a) 삭제 미반영 감지 — 스크랩 커버 월에서 eywa에만 남은 (학생,월) 분류(무효 후보/보존/보류).
    const stale = S.classifyStale({
      existing,
      scrapedKeys: new Set(inv.keys()),
      unmatchedNameKeys: new Set(unmatchedLines.map((u) => `${L.normalizeName(u.name)}|${u.period}`)),
      normalizeName: L.normalizeName,
    });
    S.printIssues({ stale, unmatchedLines });
    let voided = 0;
    const writeReport = () => {
      const p = S.writeReport(OUT, { ranAt: new Date().toISOString(), apply: APPLY, voidStale: VOID_STALE,
        scrapedPeriods, unmatchedLines, stale, voidedCount: voided });
      console.log(`리포트: ${p.jsonPath}`);
    };

    if (!APPLY) { writeReport(); console.log("\n[DRY-RUN] --apply 없이 종료 (DB write 0)."); return; }
    // ↻ 동기화 배지 = "지난 동기화가 새로 추가한 청구". 이 성공 실행 시작에 지난 신규 표시를 클리어(0062a).
    // upsert라 신규(insert)만 배지, 기존월 갱신(update)은 배지 없음(위에서 이미 null 처리됨).
    const cleared = await sql`update invoices set sync_added_at = null where tenant_id = ${tenantId} and sync_added_at is not null`;
    if (cleared.count) console.log(`  지난 동기화 라벨 클리어: ${cleared.count}`);
    let upserted = 0, inserted = 0;
    for (const i of invoices) {
      const res = await sql`
        insert into invoices (tenant_id, student_id, period, category, amount_total, amount_paid, amount_discount,
          points_used, status, line_items, payment_method, card_company, cash_receipt_number, discount_reason,
          billed_at, due_date, paid_at, sync_added_at)
        values (${tenantId}, ${i.student_id}, ${i.period}, ${i.category}, ${i.total}, ${i.paid}, ${i.discount},
          ${i.point}, ${i.status}::invoice_status, ${sql.json(i.items)}, ${i.method}, ${i.card}, ${i.receipt},
          ${i.discReason}, ${i.billed}, ${i.billed}, ${i.pdate}, now())
        on conflict (tenant_id, student_id, period) do update set
          category = excluded.category, amount_total = excluded.amount_total, amount_paid = excluded.amount_paid,
          amount_discount = excluded.amount_discount, points_used = excluded.points_used, status = excluded.status,
          line_items = excluded.line_items, payment_method = excluded.payment_method, card_company = excluded.card_company,
          cash_receipt_number = excluded.cash_receipt_number, discount_reason = excluded.discount_reason,
          billed_at = excluded.billed_at, due_date = excluded.due_date, paid_at = excluded.paid_at,
          -- void였던 행이 makeedu에 재등장 = 복원 — notes 맨 앞의 [동기화] 무효 마커 1줄만 제거(사용자 메모 보존).
          notes = case when invoices.status = 'void'
                       then nullif(regexp_replace(coalesce(invoices.notes, ''), '^\\[동기화\\][^\\n]*\\n?', ''), '')
                       else invoices.notes end,
          sync_added_at = invoices.sync_added_at, updated_at = now()
        returning (xmax = 0) as inserted`;
      upserted++;
      if (res[0] && res[0].inserted) inserted++;
    }
    // (a) --void-stale: makeedu 부재가 확실한 미완납만 무효 전환. 직전 상태·금액은 notes 마커 + 리포트 JSON에 보존.
    if (VOID_STALE && stale.voidable.length) {
      const today = new Date().toISOString().slice(0, 10);
      for (const e of stale.voidable) {
        const marker = S.voidMarker(e, today);
        const r = await sql`update invoices
          set status = 'void', notes = ${e.notes ? `${marker}\n${e.notes}` : marker}, updated_at = now()
          where id = ${e.id} and status = ${e.status}::invoice_status`; // 조회 후 동시 변경된 행은 건너뜀(낙관적)
        voided += r.count;
      }
      console.log(`makeedu 부재 미완납 void 전환: ${voided}/${stale.voidable.length}건.`);
    }
    writeReport();
    await L.recordSync(sql, tenantId, "invoices", inserted, "ok",
      S.issueSummary({ stale, unmatchedLines, voidStale: VOID_STALE, voided }));
    console.log(`upsert ${upserted}건 (신규 ${inserted} · 갱신 ${upserted - inserted}).`);
  } finally {
    await sql.end();
  }
})().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
