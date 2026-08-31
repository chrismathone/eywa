/**
 * scripts/_makeedu/reconcile-invoices.cjs — **묵은 미납 재대조**(주 1회 권장).
 *
 * 매일 도는 동기화는 최근 3개 청구월만 긁는다(`MAKEEDU_INVOICE_MONTHS`). 그 **창 밖**의 청구는 최초
 * 임포트 값에서 얼어붙어, makeedu에서 금액을 고치거나 지워도 eywa는 옛 값을 계속 미수로 들고 있다
 * (실측 2026-08-31: 윤나연 3월 654,000 ↔ makeedu 277,000 · 4월 163,500 ↔ 133,500 · 김시윤 2월 30,000 ↔ 15,000).
 *
 * 전 기간을 매번 긁는 것은 낭비이자 위험이라(범위를 넓힌 첫 실행에서 17건이 한 번에 무효 처리된 전례)
 * **대상을 좁혀** 본다 — 규칙은 [`reconcile-plan.cjs`](./reconcile-plan.cjs)(순수 · Vitest):
 *   ① 창 밖에 **미수가 남은** (학생,월)   ② 최근 퇴원·휴원자의 그 달·직전 달(환불 반영 — 완납도 본다)
 *
 * 부재는 바로 지우지 않는다 — **3회는 대기, 4회째에 무효**(원장 2026-08-31). 매 회차는 그 청구서 메모에
 * 남는다(수납 이력에서 사람이 읽는다). ⚠️ 관측을 못 믿는 실행에서는 **세지도 않는다**.
 *
 * 🔴 **한 달씩 따로 긁는다**(2026-08-31 첫 실행에서 잡힌 것). makeedu 목록은 페이지 번호가 10개씩만
 *    보여서 스크래퍼가 **10페이지(≈5,000행)에서 멈춘다** — 5개월치 6,227행을 한 번에 요청했더니 5,012행만
 *    걷히고 뒤쪽 달(2026-06)이 33행으로 잘렸다. 한 달이면 1,300행 안쪽이라 한도에 닿지 않는다.
 *    (그 회차는 절단 가드가 전건 보류로 막아 아무것도 안 지웠다 — 가드가 제 몫을 했다.)
 *
 * 🔴 **학생 매칭은 이름+학년이다**(같은 실행에서 잡힌 것). 화면 표엔 `원생고유번호` 열이 **없다**
 *    (엑셀 내보내기에만 있다). 그래서 임포터와 **같은 매처**(`L.tieredMatcher`)를 쓰고, 동명+동학년으로
 *    갈리는 학생은 판정하지 않는다(이름만으로 남의 돈을 지우지 않는다).
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

/** 한 달치 스크랩 파일을 읽어 라인으로 편다. 없으면 null(그 달은 관측 없음). */
function readMonth(dir) {
  const file = path.join(dir, "invoices.json");
  if (!fs.existsSync(file)) return null;
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  const H = data.headers || [];
  const at = (name) => H.findIndex((h) => (h || "").includes(name));
  const ci = { mkid: at("원생고유번호"), name: at("이름"), grade: at("학년"), month: at("청구월") };
  const ym = (v) => {
    const m = String(L.txt(v) || "").match(/(\d{4})[.\-/]?(\d{2})/);
    return m ? `${m[1]}-${m[2]}` : null;
  };
  const lines = [];
  for (const row of data.rows || []) {
    const period = ym(row[ci.month]);
    const name = ci.name >= 0 ? L.txt(row[ci.name]) : "";
    if (!period || !name) continue;
    lines.push({
      period,
      name,
      grade: ci.grade >= 0 ? L.gradeNorm(row[ci.grade]) : "",
      mkid: ci.mkid >= 0 ? L.txt(row[ci.mkid]) : "",
    });
  }
  // 🔴 화면이 스스로 말하는 총건수와 다르면 그 달의 '부재'는 관측이 아니다.
  return { lines, totalReported: data.totalReported ?? null };
}

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
      sql`select id, name, grade, makeedu_id, status::text as status,
                 coalesce(withdrawn_at::date::text, updated_at::date::text) as changed_on
          from students where tenant_id = ${tenantId}`,
    ]);
    const studentById = new Map(students.map((s) => [s.id, s]));

    const { pairs, from, to } = P.pickTargets({ invoices, students, today, windowFrom });
    console.log(`대상: ${pairs.length}건 (창 밖 = ${from ?? "-"} ~ ${to ?? "-"} · 매일 동기화는 ${windowFrom}부터)`);
    for (const t of pairs.slice(0, 20)) {
      const s = studentById.get(t.student_id);
      console.log(`  · ${t.period} ${t.reason} ${s?.name ?? "?"} 미수 ${won(P.outstanding(t))}`);
    }
    if (pairs.length === 0) {
      console.log("재대조할 것이 없습니다.");
      return;
    }

    // ── 스크랩 — **한 달씩 따로**(10페이지 한도 회피) ────────────────────
    const targetMonths = [...new Set(pairs.map((t) => t.period))].sort();
    fs.mkdirSync(OUT, { recursive: true });
    if (!SKIP_SCRAPE) {
      console.log(`\n스크랩(월별 ${targetMonths.length}회): ${targetMonths.join(" ")}`);
      for (const m of targetMonths) {
        const dir = path.join(OUT, m);
        fs.mkdirSync(dir, { recursive: true });
        const r = spawnSync(process.execPath, [path.join(HERE, "scrape.cjs"), "--list=invoices"], {
          stdio: "inherit",
          env: { ...process.env, MAKEEDU_OUT: dir, MAKEEDU_INVOICE_FROM: m, MAKEEDU_INVOICE_TO: m },
        });
        // 한 달이 실패해도 나머지는 계속한다 — 실패한 달은 파일이 없어 **그 달만 보류**된다(부재로 안 센다).
        if (r.status !== 0) console.error(`  ✖ ${m} 스크랩 실패 — 그 달은 이번 회차에서 보류합니다.`);
      }
    }

    // ── 읽기·매칭 ───────────────────────────────────────────────────────
    // 🔴 화면 표엔 원생고유번호가 없다 → 임포터와 **같은 매처**로 (이름·학년) 매칭. 갈리면 null(판정 안 함).
    const byMkid = new Map();
    for (const s of students) if (s.makeedu_id) byMkid.set(String(s.makeedu_id), s.id);
    const matchNameGrade = L.tieredMatcher(students, [
      (s) => `${L.normalizeName(s.name)}|${s.grade || ""}`,
      (s) => L.normalizeName(s.name),
    ]);
    const resolve = (l) =>
      (l.mkid && byMkid.get(String(l.mkid))) || matchNameGrade({ name: l.name, grade: l.grade }) || null;

    const present = new Set();
    const unmatchedNames = new Set();
    const coverage = {};
    let lineTotal = 0;
    let unmatched = 0;
    const monthLog = [];
    for (const m of targetMonths) {
      const got = readMonth(path.join(OUT, m));
      if (!got || got.lines.length === 0) {
        coverage[m] = 0; // 관측 없음 — 이 달 대상은 보류
        monthLog.push(`${m}:없음`);
        continue;
      }
      const inMonth = got.lines.filter((l) => l.period === m);
      const short = got.totalReported != null && got.lines.length < got.totalReported;
      coverage[m] = short ? 0 : 1; // 절단된 달은 판정하지 않는다
      monthLog.push(`${m}:${inMonth.length}${short ? `(절단 ${got.totalReported})` : ""}`);
      lineTotal += got.lines.length;
      for (const l of got.lines) {
        const sid = resolve(l);
        if (sid) present.add(`${sid}|${l.period}`);
        else {
          unmatched++;
          unmatchedNames.add(L.normalizeName(l.name));
        }
      }
    }
    const unmatchedRatio = lineTotal > 0 ? unmatched / lineTotal : 0;
    console.log(
      `\n스크랩 결과: ${monthLog.join(" · ")} · 매칭 실패 ${unmatched}/${lineTotal}(${(unmatchedRatio * 100).toFixed(1)}%)`,
    );

    // 이름이 매칭 실패 목록에 있는 학생은 **이 회차에 판정하지 않는다** — 못 받은 것과 지워진 것을 못 가른다.
    for (const t of pairs) {
      const s = studentById.get(t.student_id);
      if (s && unmatchedNames.has(L.normalizeName(s.name))) coverage[t.period] = 0;
    }

    const plan = P.planOutcomes({ targets: pairs, scrapedKeys: present, coverage, unmatchedRatio, today });

    console.log(
      `\n판정 — makeedu에 있음 ${plan.upsert.length} · 미확인 누적 ${plan.bump.length} · 무효 대상 ${plan.voidable.length} · 보류 ${plan.hold.length}`,
    );
    const nameOf = (t) => studentById.get(t.student_id)?.name ?? "?";
    for (const b of plan.bump)
      console.log(`  대기 ${b.count}/${P.MISS_LIMIT}: ${b.period} ${nameOf(b)} 미수 ${won(P.outstanding(b))}`);
    for (const v of plan.voidable)
      console.log(`  🔴 무효: ${v.period} ${nameOf(v)} 미수 ${won(P.outstanding(v))}`);
    if (plan.hold.length)
      console.log(`  보류 ${plan.hold.length}건 — ${[...new Set(plan.hold.map((h) => `${h.period}(${h.why})`))].join(" · ")}`);

    if (!APPLY) {
      console.log("\n[DRY-RUN] --apply 없이 종료 (DB write 0).");
      return;
    }

    // ① 있는 것 — 금액 재집계는 import-invoices에 위임(돈 계산 단일 소스). 스크랩 파일이 월별이라 **월별로** 부른다.
    let updated = 0;
    for (const m of targetMonths) {
      const mine = plan.upsert.filter((t) => t.period === m);
      if (mine.length === 0) continue;
      const dir = path.join(OUT, m);
      const pairsFile = path.join(dir, "only-pairs.json");
      fs.writeFileSync(pairsFile, JSON.stringify(mine.map((t) => `${t.student_id}|${t.period}`)), "utf8");
      const r = spawnSync(
        process.execPath,
        [path.join(HERE, "import-invoices.cjs"), "--apply", "--no-void-stale", `--only-pairs=${pairsFile}`],
        { stdio: "inherit", env: { ...process.env, MAKEEDU_OUT: dir } },
      );
      if (r.status !== 0) console.error(`  ⚠️ ${m} 갱신 실행 실패 — 메모·무효는 계속 진행합니다.`);
      else updated += mine.length;
    }
    // 다시 나타난 청구의 '미확인' 메모는 지운다(self-healing) — import-invoices는 void 행만 지운다.
    for (const t of plan.upsert.filter((x) => x.clearMarker)) {
      await sql`update invoices set notes = ${P.stripMarker(t.notes)}, updated_at = now() where id = ${t.id}`;
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
    console.log(`\n반영: 갱신 ${updated}/${plan.upsert.length} · 메모 ${plan.bump.length} · 무효 ${voided}/${plan.voidable.length}`);

    fs.writeFileSync(
      path.join(OUT, "reconcile-report.json"),
      JSON.stringify(
        { ranAt: new Date().toISOString(), from, to, windowFrom, months: targetMonths, unmatchedRatio, plan },
        null,
        2,
      ),
      "utf8",
    );
  } finally {
    await sql.end();
  }
})().catch((e) => {
  console.error("ERR", e.message);
  process.exitCode = 1;
});
