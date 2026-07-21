// 일회성 마이그레이션: tenant_settings.data.profile.brandColor 를 옛 기본 그린 → v3 Injaewon Navy 로 정리.
//
// 배경(2026-07-20): 팔레트 v3 전환 후에도 injaewon 저장값이 옛 기본색 `#1a5f3c`(그린) 그대로였다.
// color-utils의 LEGACY_DEFAULT_BRAND_COLORS가 이를 "기본색"으로 간주해 주입을 생략하므로 **화면은 이미
// 네이비**였고, 이 스크립트는 시각적 변화를 만들지 않는다. 목적은 /owner 색상 스와치가 실제 화면과
// 어긋나 보이던 것(그린 스와치 ↔ 네이비 화면)을 데이터 차원에서 없애는 것.
//
// ⚠️ 옛 기본색을 **의도적인 브랜드색으로 쓰는 테넌트**는 건드리면 안 되므로, 정확히 LEGACY 목록에 있는
// 값일 때만 교체한다(그 외 커스텀 색은 그대로 둔다). 멱등 — 이미 네이비면 "변경 없음".
//
// ⚠️ 직접 DB 쓰기는 tenant_settings 트리거(0080a)를 auth.uid() null 경로로 통과한다. 앱의 정식 경로
// (saveOwnerSection)를 우회하므로 audit_logs를 여기서 직접 남기고, unstable_cache(tag tenant-settings:<id>,
// TTL 300s)는 무효화하지 못한다 → 최대 5분간 옛 값이 보일 수 있다(자가 회복). 즉시 반영이 필요하면
// /owner에서 아무 섹션이나 저장하면 된다.
//
// 사용: node scripts/_poc_migration/migrate-brand-color-navy.cjs           (dry-run, 쓰기 없음)
//       node scripts/_poc_migration/migrate-brand-color-navy.cjs --apply   (실제 UPDATE)
const fs = require("fs");
const postgres = require("postgres");

const APPLY = process.argv.includes("--apply");
// color-utils.ts와 동일해야 한다(리스킨 시 함께 갱신). 소문자 비교.
const NAVY = "#153e75";
const LEGACY_GREENS = new Set(["#1a5f3c", "#0e7c46"]);

let url = process.env.DATABASE_URL;
if (!url) {
  const e = fs.readFileSync("D:/eywa_refactoring/.env.local", "utf8");
  url = e.split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="))?.slice(13).trim().replace(/^["']|["']$/g, "");
}
if (!url) throw new Error("DATABASE_URL not found");

const sql = postgres(url, { prepare: false });

(async () => {
  console.log(`[${APPLY ? "APPLY" : "DRY-RUN"}] brandColor 옛 기본 그린 → ${NAVY}\n`);

  const rows = await sql`
    select ts.tenant_id, t.name, ts.data->'profile'->>'brandColor' as brand_color
    from tenant_settings ts join tenants t on t.id = ts.tenant_id`;

  let changed = 0;
  for (const r of rows) {
    const cur = (r.brand_color ?? "").trim().toLowerCase();
    if (cur === NAVY) {
      console.log(`  · ${r.name}: 이미 ${NAVY} — 변경 없음`);
      continue;
    }
    if (!LEGACY_GREENS.has(cur)) {
      // 커스텀 브랜드색(또는 빈 값) — 원장이 고른 색일 수 있어 절대 덮지 않는다.
      console.log(`  · ${r.name}: "${r.brand_color ?? "(빈 값)"}" = 커스텀/미설정 — 건너뜀`);
      continue;
    }
    console.log(`  ✎ ${r.name}: ${cur} → ${NAVY}`);
    changed++;
    if (!APPLY) continue;

    // jsonb_set으로 profile.brandColor만 교체 — 다른 섹션·필드 보존(앱의 섹션 머지 upsert와 동일 의도).
    // profile 키가 없으면 jsonb_set이 무동작이라 create_missing=true로 명시.
    // ⚠️ 값은 반드시 `to_jsonb(<param>::text)` — `${JSON.stringify(v)}::jsonb`로 쓰면 postgres.js의
    //   파라미터 인코딩과 겹쳐 **이중 인코딩**된다(실측: `"#153e75"` 9자가 저장돼 hex 검증 실패 →
    //   brandColorVars가 null 반환 → 설정이 조용히 무시됨). 2026-07-20에 실제로 밟은 함정.
    await sql`
      update tenant_settings
      set data = jsonb_set(coalesce(data, '{}'::jsonb), '{profile,brandColor}', to_jsonb(${NAVY}::text), true),
          updated_at = now()
      where tenant_id = ${r.tenant_id}`;
    // 앱 정식 경로(saveOwnerSection)가 남기는 것과 같은 감사 흔적 — 누가·언제 바꿨는지 추적 가능하게.
    // actor는 사람이 아니라 마이그레이션이므로 null(시스템 이벤트 규약).
    // ⚠️ jsonb 파라미터는 **객체를 그대로** 넘긴다(sql.json) — 위와 같은 이중 인코딩 함정.
    //   `${JSON.stringify(obj)}::jsonb`로 넣으면 jsonb_typeof가 'object'가 아니라 'string'이 돼
    //   앱이 남긴 감사로그와 모양이 달라진다(조회·집계에서 조용히 어긋남).
    await sql`
      insert into audit_logs (tenant_id, actor_id, action, target_type, target_label, metadata)
      values (${r.tenant_id}, null, 'owner_settings_update', 'tenant_settings', '학원 정보',
              ${sql.json({ section: "profile", field: "brandColor", from: cur, to: NAVY, via: "migrate-brand-color-navy" })})`;
  }

  // 검증 — APPLY 후 실제 저장값 재조회(썼다고 믿지 말고 읽어서 확인).
  // 길이까지 본다: 이중 인코딩되면 `"#153e75"` 9자로 저장되는데 눈으로는 구분이 잘 안 된다(위 함정).
  if (APPLY && changed > 0) {
    const after = await sql`
      select t.name, ts.data->'profile'->>'brandColor' as brand_color,
             length(ts.data->'profile'->>'brandColor') as len
      from tenant_settings ts join tenants t on t.id = ts.tenant_id`;
    console.log("\n[검증] 저장된 값 재조회:");
    let bad = 0;
    for (const a of after) {
      const ok = a.brand_color === NAVY && a.len === 7;
      if (!ok && a.brand_color != null) bad++;
      console.log(`  · ${a.name}: ${a.brand_color} (${a.len}자) ${ok ? "✅" : a.brand_color == null ? "(미설정)" : "⚠️ 형식 이상"}`);
    }
    if (bad > 0) {
      console.error(`\n⚠️ ${bad}건이 기대 형식(#rrggbb 7자)과 다릅니다 — 이중 인코딩 여부를 확인하세요.`);
      process.exitCode = 1;
    }
  }

  console.log(`\n대상 ${changed}건${APPLY ? " 적용 완료" : " (dry-run — --apply 로 실제 반영)"}`);
  await sql.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
