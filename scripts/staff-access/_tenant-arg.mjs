// staff-access 스크립트 공용 — 대상 학원(지점)을 **반드시** 인자로 받는다.
//
// 🔴 2026-09-22 둘째 지점(demo)이 생긴 뒤로 `tenant_settings?select=…`의 **첫 행**을 집는 방식은 남의 지점
//    권한을 고칠 수 있다(행 순서는 보장되지 않는다). 그래서 `--tenant <slug>`가 없으면 멈추고, 학원이
//    정확히 하나로 풀릴 때만 그 학원의 설정 행을 돌려준다.

/** `--tenant cs` 또는 `--tenant=cs`. 없으면 사용법을 찍고 종료. */
export function tenantSlugArg(argv = process.argv) {
  const eq = argv.find((a) => a.startsWith("--tenant="));
  let slug = eq ? eq.slice("--tenant=".length) : null;
  if (!slug) {
    const i = argv.indexOf("--tenant");
    if (i !== -1) slug = argv[i + 1] ?? null;
  }
  slug = slug?.trim() || null;
  if (!slug || slug.startsWith("--")) {
    console.error("대상 학원을 지정하세요: --tenant <slug>  (예: --tenant cs)");
    process.exit(2);
  }
  return slug;
}

/** slug → 학원 한 곳 + 그 학원의 설정 행. 못 찾거나 둘 이상이면 throw. */
export async function resolveTenantSettingsRow(SB, H, slug) {
  const tRes = await fetch(`${SB}/rest/v1/tenants?select=id,slug,name&slug=eq.${encodeURIComponent(slug)}`, { headers: H });
  if (!tRes.ok) throw new Error(`학원 조회 실패 HTTP ${tRes.status}`);
  const tenants = await tRes.json();
  if (!Array.isArray(tenants) || tenants.length !== 1) {
    throw new Error(`'${slug}' 학원이 정확히 하나가 아니다(${Array.isArray(tenants) ? tenants.length : "?"}곳)`);
  }
  const tenant = tenants[0];
  const sRes = await fetch(`${SB}/rest/v1/tenant_settings?select=tenant_id,data&tenant_id=eq.${tenant.id}`, { headers: H });
  if (!sRes.ok) throw new Error(`설정 조회 실패 HTTP ${sRes.status}`);
  const rows = await sRes.json();
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error(`'${slug}' 학원의 tenant_settings 행이 없다`);
  return { tenant, row: rows[0] };
}
