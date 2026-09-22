/**
 * scripts/_oneoff/backfill-ai-usage-tenant.mjs — `ai_usage_logs.tenant_id` 빈칸을 **유일한 지점**으로 채운다.
 *
 * 원장 2026-09-21: *"AI 및 워커도 전부 지점 분리 가능하면 분리"*. 실측 같은 날: 3,499행 중 **2,794행이 지점 빈칸**
 * (호출부 8곳이 `meta.tenantId`를 안 넘겼다 — 앱 쪽은 같은 날 전 호출부 배선 + 가드 `key-groups.test.ts`).
 *
 * 🔴 **지점이 정확히 1개일 때만 돈다.** 빈칸 행엔 "어느 지점 호출이었나"를 되짚을 단서가 없다(기능 이름·모델·토큰뿐) —
 *    지점이 하나뿐인 동안엔 전부 그 지점 것이 확실하지만, 둘이 된 뒤엔 누구 것인지 **알 수 없다**. 그래서:
 *    · 둘째 지점을 만들기 **전에** 이 스크립트를 한 번 더 돌릴 것(앱 배선이 main에 들어가기 전까지 빈칸은 계속 쌓인다 —
 *      런북 `docs/domain-cutover.md` "지점을 하나 더 만드는 날" 0번).
 *    · 지점이 2개 이상이면 **아무것도 안 하고 멈춘다**(추측해 채우지 않는다).
 * 🔴 **드라이런이 기본**(읽기만). `--apply`일 때만 UPDATE. 멱등(두 번째 실행은 0건).
 * ⚠️ 비용 계측 표다 — 학생·수납 데이터가 아니고, 채워도 기존 집계(기능별 합계)는 안 바뀐다(지점 축이 새로 생길 뿐).
 *
 * 사용(이 워크트리엔 메인 체크아웃의 .env.local을 지정):
 *   node --env-file=D:/eywa_refactoring/.env.local scripts/_oneoff/backfill-ai-usage-tenant.mjs            # 드라이런
 *   node --env-file=D:/eywa_refactoring/.env.local scripts/_oneoff/backfill-ai-usage-tenant.mjs --apply    # 적용
 * env: DATABASE_URL
 */
import postgres from "postgres";

const APPLY = process.argv.includes("--apply");

(async () => {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL이 없습니다 — node --env-file=<.env.local 경로> 로 실행하세요.");
    process.exit(1);
  }
  const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, connect_timeout: 20 });
  try {
    const tenants = await sql`select id, slug, name from tenants order by created_at limit 3`;
    if (tenants.length !== 1) {
      console.error(
        `지점이 ${tenants.length}개입니다 — 빈칸 행이 어느 지점 호출이었는지 되짚을 단서가 없어 채우지 않습니다(추측 금지).`,
      );
      process.exit(2);
    }
    const tenant = tenants[0];

    const [before] = await sql`
      select count(*)::int as total,
             count(*) filter (where tenant_id is null)::int as nulls,
             count(*) filter (where tenant_id = ${tenant.id})::int as tagged,
             min(created_at) filter (where tenant_id is null) as first_null,
             max(created_at) filter (where tenant_id is null) as last_null
      from ai_usage_logs`;
    const byFeature = await sql`
      select feature, count(*)::int as n from ai_usage_logs
      where tenant_id is null group by feature order by n desc`;

    console.log(`지점: ${tenant.name} (${tenant.slug}) ${tenant.id}`);
    console.log(`ai_usage_logs 전체 ${before.total}행 · 지점 빈칸 ${before.nulls}행 · 이 지점 ${before.tagged}행`);
    if (before.nulls > 0) {
      console.log(`빈칸 구간: ${before.first_null?.toISOString?.() ?? before.first_null} ~ ${before.last_null?.toISOString?.() ?? before.last_null}`);
      console.log("빈칸 — 기능별:");
      for (const r of byFeature) console.log(`  ${String(r.n).padStart(6)}  ${r.feature}`);
    }

    if (!APPLY) {
      console.log(`\n(드라이런) --apply 를 붙이면 빈칸 ${before.nulls}행을 ${tenant.slug}로 채웁니다.`);
      return;
    }
    if (before.nulls === 0) {
      console.log("\n채울 빈칸이 없습니다(0건).");
      return;
    }

    await sql.begin(async (tx) => {
      // 트랜잭션 안에서 지점 수를 다시 본다 — 드라이런과 적용 사이에 둘째 지점이 생겼으면 멈춘다.
      const [{ n }] = await tx`select count(*)::int as n from tenants`;
      if (n !== 1) throw new Error(`적용 직전 지점이 ${n}개 — 중단`);
      const updated = await tx`
        update ai_usage_logs set tenant_id = ${tenant.id}
        where tenant_id is null
        returning id`;
      console.log(`\n✓ UPDATE ${updated.length}행 → ${tenant.slug}`);
    });

    const [after] = await sql`
      select count(*) filter (where tenant_id is null)::int as nulls from ai_usage_logs`;
    console.log(`남은 빈칸 ${after.nulls}행`);
  } finally {
    await sql.end({ timeout: 5 });
  }
})().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
