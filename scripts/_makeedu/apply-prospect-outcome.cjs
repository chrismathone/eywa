/**
 * scripts/_makeedu/apply-prospect-outcome.cjs — makeedu 상세 동기화가 채운 `registration_status`를
 * `outcome` enum에 반영한다. (2026-08-04)
 *
 * 왜 별도 단계인가: `sync-prospects.cjs`는 상세에서 긁은 값을 **coalesce로 빈 칸만** 채우고
 * `outcome`은 건드리지 않는다(기존 판정 보존이 원칙). 그래서 상세를 받아와도 makeedu 이관분 268행은
 * `consulted`(=등록 여부 모름) 그대로라 **전환율 분모만 키운다** — 실측 2023년 25%가 이 상태였다.
 *
 * 실행(연동 PC에서 sync-prospects.cjs --apply 직후):
 *   node --env-file=.env.local scripts/_makeedu/apply-prospect-outcome.cjs          # dry-run
 *   node --env-file=.env.local scripts/_makeedu/apply-prospect-outcome.cjs --apply
 *
 * 🔴 **모르는 상태만 올린다.** 이미 enrolled/declined/no_show/ai_done인 행은 사람이 확인했거나 더 강한
 * 근거로 정해진 값이라 절대 덮지 않는다 — 되돌릴 수 없는 손실이고, 잘못 내려간 값은 아무도 눈치 못 챈다.
 */
const postgres = require("postgres");

const APPLY = process.argv.includes("--apply");
const TENANT_SLUG = (() => {
  const i = process.argv.indexOf("--tenant");
  return i >= 0 ? process.argv[i + 1] : "injaewon";
})();

// import-prospects.cjs의 등원가능성 매핑과 같은 규칙(두 곳이 갈리면 같은 사람이 화면마다 다른 상태가 된다).
function deriveOutcome(raw) {
  const s = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!s) return null;
  if (/거절|미등록|안 ?함/.test(s)) return "declined";
  if (/노쇼|불참/.test(s)) return "no_show";
  if (/등록 ?완료|등록함|등록$|^등록/.test(s)) return "enrolled";
  if (/상담 ?완료/.test(s)) return "consulted";
  if (/예약|예정/.test(s)) return "scheduled";
  return null; // "선택"·보류·해석 불가 → 건드리지 않는다
}

// 이 값들일 때만 갱신 대상 = "아직 모르는 상태".
const WEAK = new Set(["pending", "consulted", "scheduled"]);

(async () => {
  const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, idle_timeout: 10 });
  try {
    const [tenant] = await sql`select id from tenants where slug = ${TENANT_SLUG}`;
    if (!tenant) throw new Error(`tenant '${TENANT_SLUG}' 없음`);

    const rows = await sql`
      select id, prospect_name, outcome, registration_status
      from enrollment_consultations
      where tenant_id = ${tenant.id}
        and makeedu_id is not null
        and registration_status is not null`;
    console.log(`${APPLY ? "★ 적용" : "dry-run"} · registration_status 있는 makeedu 행 ${rows.length}개`);

    const plan = [];
    const skipped = { strong: 0, unparsed: 0, same: 0 };
    for (const r of rows) {
      const next = deriveOutcome(r.registration_status);
      if (!next) { skipped.unparsed++; continue; }
      if (!WEAK.has(r.outcome)) { skipped.strong++; continue; } // 이미 확정된 값은 보존
      if (next === r.outcome) { skipped.same++; continue; }
      plan.push({ ...r, next });
    }

    const tally = new Map();
    for (const p of plan) {
      const k = `${p.outcome} → ${p.next}`;
      tally.set(k, (tally.get(k) ?? 0) + 1);
    }
    console.log(`\n갱신 대상 ${plan.length}행`);
    [...tally].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${String(v).padStart(4)}  ${k}`));
    console.log(`건너뜀 — 이미 확정 ${skipped.strong} / 해석 불가 ${skipped.unparsed} / 동일 ${skipped.same}`);
    if (plan.length) {
      console.log("\n샘플 5:");
      plan.slice(0, 5).forEach((p) =>
        console.log(`  ${p.prospect_name}  "${p.registration_status}"  ${p.outcome} → ${p.next}`),
      );
    }

    if (!APPLY) { console.log("\n(dry-run — 쓰지 않았다. 반영하려면 --apply)"); return; }

    let done = 0;
    for (const p of plan) {
      const res = await sql`
        update enrollment_consultations set outcome = ${p.next}, updated_at = now()
        where id = ${p.id} and outcome = ${p.outcome}`; // 그 사이 사람이 바꿨으면 건너뛴다
      done += res.count;
    }
    console.log(`\n✅ ${done}행 갱신.`);
  } finally {
    await sql.end();
  }
})().catch((e) => { console.error(e); process.exit(1); });
