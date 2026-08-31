/**
 * scripts/_makeedu/reconcile-invoices.cjs — **묵은 미납 재대조**(주 1회 권장).
 *
 * 매일 도는 동기화는 최근 3개 청구월만 긁는다(`MAKEEDU_INVOICE_MONTHS`). 그 **창 밖**의 청구는 최초
 * 임포트 값에서 얼어붙어, makeedu에서 금액을 고치거나 지워도 eywa는 옛 값을 계속 미수로 들고 있다
 * (실측 2026-08-31: 윤나연 3월 654,000 ↔ makeedu 277,000 · 4월 163,500 ↔ 133,500 · 김시윤 2월 30,000 ↔ 15,000).
 *
 * 전 기간을 매번 긁는 것은 낭비이자 위험이라(범위를 넓힌 첫 실행에서 17건이 한 번에 무효 처리된 전례)
 * **대상을 좁혀** 본다 — 규칙은 [`reconcile-plan.cjs`](./reconcile-plan.cjs)(순수 · Vitest):
 *   ① 창 밖에 **미수가 남은** (학생,월)   ② 최근 퇴원·휴원자의 최근 몇 달 청구(환불 반영 — 완납도 본다)
 *
 * 부재는 바로 지우지 않는다 — **3회는 대기, 4회째에 무효**(원장 2026-08-31). 매 회차는 그 청구서 메모에
 * 남는다(수납 이력에서 사람이 읽는다). ⚠️ 관측을 못 믿는 실행(스크랩 절단·그 달 0행)에서는 **세지도 않는다**.
 *
 * 반영은 **직접 하지 않는다** — 금액 재집계는 `import-invoices.cjs`에 `--only-pairs`로 위임한다
 * (돈 계산을 두 벌로 만들지 않기 위해서다). 이 스크립트가 직접 쓰는 것은 메모·무효뿐.
 *
 *   node --env-file=.env.local scripts/_makeedu/reconcile-invoices.cjs            # 드라이런(기본)
 *   node --env-file=.env.local scripts/_makeedu/reconcile-invoices.cjs --apply
 *   node --env-file=.env.local scripts/_makeedu/reconcile-invoices.cjs --no-scrape --apply   # 기존 JSON으로
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const postgres = require("postgres");
const L = require("./lib.cjs");
const P = require("./reconcile-plan.cjs");

const APPLY = process.argv.includes("--apply");
const SKIP_SCRAPE = process.argv.includes("--no-scrape");
const HERE = __dirname;
// 매일 도는 동기화와 **다른 폴더**에 스크랩한다 — 같은 파일을 쓰면 옛 달 스크랩이 그날의 정상 스크랩을 덮어써
// 뒤이어 도는 일반 동기화가 옛 범위로 반영된다(창 안 청구가 통째로 '부재'로 보인다).
const OUT = path.join(process.env.MAKEEDU_OUT || path.resolve(HERE, "..", "..", ".makeedu-tmp"), "reconcile");
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
const won = (n) => `${Number(n || 0).toLocaleString("ko-KR")}원`;

(async () => {
  const sql = postgres(process.env.DATABASE_URL, { prepare: false });
  try {
    const tenantId = await L.resolveTenantId(sql);

    // 매일 도는 동기화가 이미 보는 범위 — 그 안은 재대조 대상이 아니다(중복 낭비).
    const months = Number(process.env.MAKEEDU_INVOICE_MONTHS || 3);
    const windowFrom = L.billingMonthRange({ anchor: null, months, today: new Date() }).from;

    const [invoices, students] = await Promise.all([
      sql`select i.id, i.student_id, i.period, i.status::text as status, i.amount_total,
                 i.amount_discount, i.amount_paid, i.notes
          from invoices i where i.tenant_id = ${tenantId} and i.status <> 'void'`,
      sql`select id, status::text as status, makeedu_id,
                 coalesce(withdrawn_at::date::text, updated_at::date::text) as changed_on
          from students where tenant_id = ${tenantId}`,
    ]);
    const studentById = new Map(students.map((s) => [s.id, s]));

    const { pairs, from, to } = P.pickTargets({ invoices, students, today, windowFrom });
    console.log(`대상: ${pairs.length}건 (창 밖 = ${from ?? "-"} ~ ${to ?? "-"} · 매일 동기화는 ${windowFrom}부터)`);
    for (const t of pairs.slice(0, 20)) {
      const s = studentById.get(t.student_id);
      console.log(`  · ${t.period} ${t.reason} 미수 ${won(P.outstanding(t))} (원생번호 ${s?.makeedu_id ?? "없음"})`);
    }
    if (pairs.length === 0) {
      console.log("재대조할 것이 없습니다.");
      return;
    }

    // ── 스크랩(그 범위만) ─────────────────────────────────────────────
    fs.mkdirSync(OUT, { recursive: true });
    if (!SKIP_SCRAPE) {
      const r = spawnSync(process.execPath, [path.join(HERE, "scrape.cjs"), "--lists=invoices"], {
        stdio: "inherit",
        env: { ...process.env, MAKEEDU_OUT: OUT, MAKEEDU_INVOICE_FROM: from, MAKEEDU_INVOICE_TO: to },
      });
      if (r.status !== 0) {
        console.error("✖ 스크랩 실패 — 이번 회차는 아무것도 세지 않습니다(관측 없음 = 부재 아님).");
        process.exitCode = 1;
        return;
      }
    }

    const file = path.join(OUT, "invoices.json");
    if (!fs.existsSync(file)) {
      console.error(`✖ ${file} 가 없습니다 — 스크랩을 먼저 돌리세요.`);
      process.exitCode = 1;
      return;
    }
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    const H = data.headers || [];
    const at = (name) => H.findIndex((h) => (h || "").includes(name));
    const ci = { mkid: at("원생고유번호"), month: at("청구월") };
    const ym = (v) => {
      const m = String(L.txt(v) || "").match(/(\d{4})[.\-/]?(\d{2})/);
      return m ? `${m[1]}-${m[2]}` : null;
    };
    const present = new Set();
    const linesByPeriod = new Map();
    let lineCount = 0;
    for (const row of data.rows || []) {
      const period = ym(row[ci.month]);
      if (!period) continue;
      lineCount++;
      linesByPeriod.set(period, (linesByPeriod.get(period) || 0) + 1);
      const mkid = L.txt(row[ci.mkid]);
      if (mkid) present.add(`${mkid}|${period}`);
    }
    // 🔴 조용한 절단 — 화면이 말한 총건수와 수집이 다르면 '부재'는 관측이 아니다(빠진 학생이 삭제로 오판된다).
    const truncated = data.totalReported != null && data.totalReported !== lineCount;
    console.log(
      `스크랩: ${lineCount}행 · 월별 ${[...linesByPeriod.entries()].map(([p, n]) => `${p}:${n}`).join(" ")}` +
        (truncated ? ` ⚠️ 절단 의심(화면 ${data.totalReported}건)` : ""),
    );

    // 대상 → 그 학생의 원생번호로 존재 확인. **원생번호가 없으면 판정하지 않는다**(이름 매칭으로 남의 돈을 지우지 않는다).
    const coverage = {};
    for (const p of new Set(pairs.map((t) => t.period))) coverage[p] = linesByPeriod.get(p) ? 1 : 0;
    const scrapedKeys = new Set();
    const noMkid = [];
    for (const t of pairs) {
      const s = studentById.get(t.student_id);
      if (!s?.makeedu_id) {
        noMkid.push(t);
        coverage[t.period] = 0; // 판정 불가 → 이 회차엔 세지 않는다
        continue;
      }
      if (present.has(`${s.makeedu_id}|${t.period}`)) scrapedKeys.add(`${t.student_id}|${t.period}`);
    }

    const plan = P.planOutcomes({
      targets: pairs,
      scrapedKeys,
      coverage,
      unmatchedRatio: truncated ? 1 : 0, // 절단은 관측 불신과 같은 취급(전건 보류)
      today,
    });

    console.log(
      `\n판정 — makeedu에 있음 ${plan.upsert.length} · 미확인 누적 ${plan.bump.length} · 무효 대상 ${plan.voidable.length} · 보류 ${plan.hold.length}` +
        (noMkid.length ? ` (원생번호 없음 ${noMkid.length})` : ""),
    );
    for (const b of plan.bump) console.log(`  대기 ${b.count}/${P.MISS_LIMIT}: ${b.period} 미수 ${won(P.outstanding(b))}`);
    for (const v of plan.voidable) console.log(`  🔴 무효: ${v.period} 미수 ${won(P.outstanding(v))} — ${v.marker}`);
    for (const h of plan.hold) console.log(`  보류: ${h.period} (${h.why})`);

    if (!APPLY) {
      console.log("\n[DRY-RUN] --apply 없이 종료 (DB write 0).");
      return;
    }

    // ① 있는 것 — 금액 재집계는 import-invoices에 위임(돈 계산 단일 소스).
    if (plan.upsert.length) {
      const pairsFile = path.join(OUT, "only-pairs.json");
      fs.writeFileSync(pairsFile, JSON.stringify(plan.upsert.map((t) => `${t.student_id}|${t.period}`)), "utf8");
      const r = spawnSync(
        process.execPath,
        [path.join(HERE, "import-invoices.cjs"), "--apply", "--no-void-stale", `--only-pairs=${pairsFile}`],
        { stdio: "inherit", env: { ...process.env, MAKEEDU_OUT: OUT } },
      );
      if (r.status !== 0) console.error("⚠️ 갱신 실행이 실패했습니다 — 메모·무효는 계속 진행합니다.");
      // 다시 나타난 청구의 '미확인' 메모는 지운다(self-healing) — import-invoices는 void 행만 지운다.
      for (const t of plan.upsert.filter((x) => x.clearMarker)) {
        await sql`update invoices set notes = ${P.stripMarker(t.notes)}, updated_at = now() where id = ${t.id}`;
      }
    }

    // ② 없는 것 — 메모만(3회까지)
    for (const b of plan.bump) {
      await sql`update invoices set notes = ${P.withMarker(b.marker, b.notes)}, updated_at = now()
                where id = ${b.id} and status = ${b.status}::invoice_status`;
    }
    // ③ 4회째 — 무효 + 메모(직전 상태·금액은 메모에 남는다)
    let voided = 0;
    for (const v of plan.voidable) {
      const r = await sql`update invoices set status = 'void', notes = ${P.withMarker(v.marker, v.notes)}, updated_at = now()
                          where id = ${v.id} and status = ${v.status}::invoice_status`;
      voided += r.count;
    }
    console.log(`\n반영: 갱신 ${plan.upsert.length} · 메모 ${plan.bump.length} · 무효 ${voided}/${plan.voidable.length}`);

    fs.writeFileSync(
      path.join(OUT, "reconcile-report.json"),
      JSON.stringify({ ranAt: new Date().toISOString(), from, to, windowFrom, plan, noMkid: noMkid.length }, null, 2),
      "utf8",
    );
  } finally {
    await sql.end();
  }
})().catch((e) => {
  console.error("ERR", e.message);
  process.exitCode = 1;
});
