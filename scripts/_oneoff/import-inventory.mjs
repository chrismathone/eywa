/**
 * scripts/_oneoff/import-inventory.mjs — 시안 표(inventory-2026-07.json)를 재고 관리 표(0242a)에 넣는다.
 *
 * 원장 2026-09-02: *"<자산관리대장 개편 시안> 참고한 다음 '재고 관리 탭'으로"*. 입력은 리포 안에 커밋한
 * `scripts/_oneoff/inventory-2026-07.json`(시안 표에서 그대로 뽑은 96·7·9·11행 — 손으로 고치지 않는다).
 * 변환 규칙은 `inventory-import-rules.mjs` **한 벌**(Vitest가 같은 파일로 시안 숫자 94·75·4·15·2를 잠근다).
 *
 * 🔴 **드라이런이 기본**이다(`--apply` 없으면 아무것도 안 쓴다). 드라이런은 "무엇이 몇 건 들어가고 무엇이
 *    이미 있어 건너뛰는지"를 사람이 눈으로 읽게 출력한다(작업 선호: 데이터 마이그레이션은 드라이런 먼저).
 * 🔴 **멱등** — `(tenant_id, asset_code)` / `loan_code` / `audit_code` / `item_code`가 이미 있으면 건너뛴다(덮어쓰지 않는다).
 * 🔴 테넌트 `injaewon`은 **프로덕션 실데이터**다 — 읽기는 자유, 쓰기는 `--apply` 없이 절대 하지 않는다.
 * ⚠️ 0242a가 아직 안 걸려 있으면(표 없음) **적용은 멈추고** 드라이런은 계획만 보여 준다 — 원장이 SQL을 손으로 적용한 뒤 --apply([[#95]]).
 * ⚠️ 대여자·확인자는 `users.display_name`과 **정확히 일치하고 유일**할 때만 계정을 연결한다(동명이인이면 비운다).
 *
 * 사용(이 워크트리엔 .env.local이 없다 — 메인 체크아웃의 것을 지정):
 *   node --env-file=D:/eywa_refactoring/.env.local scripts/_oneoff/import-inventory.mjs            # 드라이런
 *   node --env-file=D:/eywa_refactoring/.env.local scripts/_oneoff/import-inventory.mjs --apply    # 실제 INSERT
 *   옵션: --tenant=<slug> (기본 injaewon)
 * env: DATABASE_URL
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { isScrapeNoise, toAssetRow, toAuditRow, toLoanRow, toSupplyRow, uniqueNameMap } from "./inventory-import-rules.mjs";

const APPLY = process.argv.includes("--apply");
const tenantSlug = (process.argv.find((a) => a.startsWith("--tenant=")) ?? "--tenant=injaewon").slice("--tenant=".length);
const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = JSON.parse(readFileSync(join(HERE, "inventory-2026-07.json"), "utf8"));

function section(title) {
  console.log(`\n── ${title} ${"─".repeat(Math.max(4, 60 - title.length))}`);
}

/** 원본에서 걷어낸 시트 UI 꼬리("N / N 행 표시")를 사람이 보게 적는다 — 값을 고친 게 아니라 잡음 제거임을 확인시킨다. */
function reportNoise() {
  const hits = [];
  for (const a of SRC.assets) if (isScrapeNoise(a.note)) hits.push(`자산 ${a.assetId} 비고 "${a.note}"`);
  for (const l of SRC.loans) if (isScrapeNoise(l.note)) hits.push(`대여 ${l.loanId} 비고 "${l.note}"`);
  for (const d of SRC.audits) if (isScrapeNoise(d.action)) hits.push(`실사 ${d.auditId} 조치 "${d.action}"`);
  if (hits.length) {
    section("스크랩 잡음 → null (시트 화면의 행 수 표시가 마지막 행에 딸려 들어온 것)");
    for (const h of hits) console.log("  ·", h);
  }
}

(async () => {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL이 없습니다 — node --env-file=D:/eywa_refactoring/.env.local … 로 실행하세요");
    process.exit(1);
  }
  const sql = postgres(process.env.DATABASE_URL, { prepare: false });
  try {
    console.log(`모드: ${APPLY ? "APPLY(실제 INSERT)" : "DRY-RUN(쓰기 없음)"} · 테넌트 slug=${tenantSlug}`);

    const [tenant] = await sql`select id, name from tenants where slug = ${tenantSlug}`;
    if (!tenant) throw new Error(`테넌트 ${tenantSlug}를 찾지 못했습니다`);
    console.log(`테넌트: ${tenant.name} (${tenant.id})`);

    // 표가 있는가(0242a) — 없으면 여기서 멈춘다(원장이 SQL을 손으로 적용한다).
    const [{ n: tableCount }] = await sql`
      select count(*)::int as n from information_schema.tables
       where table_schema = 'public' and table_name in ('inventory_assets','inventory_loans','inventory_audits','inventory_supplies')`;
    const tablesReady = tableCount === 4;
    if (!tablesReady) {
      const msg = `재고 관리 표가 ${tableCount}/4개뿐입니다 — supabase/migrations/0242a_inventory.sql을 먼저 적용하세요`;
      if (APPLY) throw new Error(msg);
      // 드라이런은 계획을 보여 준다(기존 행 = 0으로 본다). 실제 적용은 표가 생긴 뒤에만.
      console.log(`\n⚠️ ${msg}\n   (드라이런이라 "이미 있는 행 = 0"으로 가정하고 계획만 보여 줍니다)`);
    }
    /** 표가 없으면 빈 결과 — 드라이런 전용 폴백. */
    const rowsOr = async (q) => (tablesReady ? await q() : []);

    // 이름 → 계정(유일한 것만). 대여자·확인자 연결에 쓴다.
    const staff = await sql`select id, display_name from users where tenant_id = ${tenant.id}`;
    const users = uniqueNameMap(staff);

    reportNoise();

    // ── 1) 자산 ────────────────────────────────────────────────────
    section("자산(inventory_assets)");
    const existingAssets = await rowsOr(() => sql`select id, asset_code from inventory_assets where tenant_id = ${tenant.id}`);
    const assetIdByCode = new Map(existingAssets.map((r) => [r.asset_code, r.id]));
    const assetRows = SRC.assets.map((a, i) => toAssetRow(a, i, users));
    const bad = assetRows.filter((r) => r._check);
    if (bad.length) {
      for (const r of bad) console.log(`  !! ${r.asset_code}: ${r._check}`);
      throw new Error("원본 자산 표에 상태/폐기일이 어긋난 행이 있습니다 — 사람이 확인한 뒤 다시 돌리세요");
    }
    const newAssets = assetRows.filter((r) => !assetIdByCode.has(r.asset_code));
    const skipAssets = assetRows.length - newAssets.length;
    const byStatus = {};
    for (const r of newAssets) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    console.log(`  입력 예정 ${newAssets.length}건 · 이미 있어 건너뜀 ${skipAssets}건`);
    console.log(`  상태별: ${Object.entries(byStatus).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
    const linked = newAssets.filter((r) => r.holder_user_id);
    const unlinked = newAssets.filter((r) => r.holder_name && !r.holder_user_id);
    console.log(`  보유자 계정 연결 ${linked.length}건${linked.length ? ` (${linked.map((r) => `${r.asset_code}:${r.holder_name}`).join(", ")})` : ""}`);
    if (unlinked.length) console.log(`  보유자 이름만(계정 없음/동명이인) ${unlinked.length}건: ${unlinked.map((r) => `${r.asset_code}:${r.holder_name}`).join(", ")}`);

    if (APPLY && newAssets.length) {
      const inserted = await sql`
        insert into inventory_assets ${sql(
          newAssets.map((r) => ({ tenant_id: tenant.id, ...Object.fromEntries(Object.entries(r).filter(([k]) => k !== "_check")) })),
          "tenant_id", "asset_code", "category", "maker", "model", "serial_no", "acquired_on", "status",
          "location", "holder_user_id", "holder_name", "last_audited_on", "disposed_on", "note", "sort_order",
        )} returning id, asset_code`;
      for (const r of inserted) assetIdByCode.set(r.asset_code, r.id);
      console.log(`  ✓ INSERT ${inserted.length}건`);
    } else {
      // 드라이런에도 아래 대여·실사가 자산을 찾을 수 있게 가짜 id를 채워 둔다(쓰지 않는다).
      for (const r of newAssets) if (!assetIdByCode.has(r.asset_code)) assetIdByCode.set(r.asset_code, `(new:${r.asset_code})`);
    }

    // ── 2) 대여이력 ────────────────────────────────────────────────
    section("대여이력(inventory_loans)");
    const existingLoans = new Set((await rowsOr(() => sql`select loan_code from inventory_loans where tenant_id = ${tenant.id}`)).map((r) => r.loan_code));
    const loanRows = SRC.loans.map((l) => toLoanRow(l, assetIdByCode, users));
    const newLoans = loanRows.filter((r) => !existingLoans.has(r.loan_code));
    console.log(`  입력 예정 ${newLoans.length}건 · 이미 있어 건너뜀 ${loanRows.length - newLoans.length}건`);
    for (const r of newLoans) {
      const code = [...assetIdByCode.entries()].find(([, id]) => id === r.asset_id)?.[0];
      console.log(`  · ${r.loan_code} ${code} ${r.borrower_name}${r.dept ? `(${r.dept})` : ""} ${r.status}` +
        ` ${r.lent_on ?? "미기재"} ~ ${r.due_on ?? r.due_note ?? "미기재"}${r.returned_on ? ` 반납 ${r.returned_on}` : ""}` +
        `${r.borrower_user_id ? " [계정 연결]" : ""}`);
    }
    // 열린 대여가 자산당 둘이면 DB 부분 유니크가 막는다 — 미리 잡는다.
    const openByAsset = new Map();
    for (const r of newLoans) if (r.status === "out") openByAsset.set(r.asset_id, (openByAsset.get(r.asset_id) ?? 0) + 1);
    const dupOpen = [...openByAsset.entries()].filter(([, n]) => n > 1);
    if (dupOpen.length) throw new Error(`한 자산에 '대여중'이 둘입니다: ${dupOpen.map(([id]) => id).join(", ")}`);
    if (APPLY && newLoans.length) {
      const inserted = await sql`insert into inventory_loans ${sql(
        newLoans.map((r) => ({ tenant_id: tenant.id, ...r })),
        "tenant_id", "asset_id", "loan_code", "borrower_user_id", "borrower_name", "dept", "lent_on", "due_on", "due_note",
        "returned_on", "status", "prev_status", "note",
      )} returning id`;
      console.log(`  ✓ INSERT ${inserted.length}건`);
    }

    // ── 3) 실사이력 ────────────────────────────────────────────────
    section("실사이력(inventory_audits)");
    const existingAudits = new Set((await rowsOr(() => sql`select audit_code from inventory_audits where tenant_id = ${tenant.id}`)).map((r) => r.audit_code));
    const auditRows = SRC.audits.map((d) => toAuditRow(d, assetIdByCode, users));
    const newAudits = auditRows.filter((r) => !existingAudits.has(r.audit_code));
    console.log(`  입력 예정 ${newAudits.length}건 · 이미 있어 건너뜀 ${auditRows.length - newAudits.length}건`);
    const auditors = new Map();
    for (const r of newAudits) auditors.set(r.auditor_name, r.auditor_user_id ? "계정 연결" : "이름만");
    console.log(`  확인자: ${[...auditors.entries()].map(([n, s]) => `${n}(${s})`).join(" · ")}`);
    if (APPLY && newAudits.length) {
      const inserted = await sql`insert into inventory_audits ${sql(
        newAudits.map((r) => ({ tenant_id: tenant.id, ...r })),
        "tenant_id", "asset_id", "audit_code", "audited_on", "result", "location", "auditor_user_id", "auditor_name", "action", "note",
      )} returning id`;
      console.log(`  ✓ INSERT ${inserted.length}건`);
    }

    // ── 4) 소모품 ──────────────────────────────────────────────────
    section("소모품(inventory_supplies)");
    const existingSupplies = new Set((await rowsOr(() => sql`select item_code from inventory_supplies where tenant_id = ${tenant.id}`)).map((r) => r.item_code));
    const supplyRows = SRC.supplies.map((s, i) => toSupplyRow(s, i));
    const newSupplies = supplyRows.filter((r) => !existingSupplies.has(r.item_code));
    console.log(`  입력 예정 ${newSupplies.length}건 · 이미 있어 건너뜀 ${supplyRows.length - newSupplies.length}건`);
    for (const r of newSupplies) console.log(`  · ${r.item_code} ${r.name} ${r.maker_model ?? "미기재"} ×${r.qty} @${r.location ?? "—"}`);
    if (APPLY && newSupplies.length) {
      const inserted = await sql`insert into inventory_supplies ${sql(
        newSupplies.map((r) => ({ tenant_id: tenant.id, ...r })),
        "tenant_id", "item_code", "name", "maker_model", "qty", "location", "checked_on", "checker_name", "note", "sort_order",
      )} returning id`;
      console.log(`  ✓ INSERT ${inserted.length}건`);
    }

    if (!APPLY) console.log("\n(드라이런 — 아무것도 쓰지 않았습니다. 실제 적용은 --apply)");
  } finally {
    await sql.end();
  }
})().catch((e) => {
  console.error("\n!! 중단:", e.message);
  process.exit(1);
});
