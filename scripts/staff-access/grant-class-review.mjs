// 수업 평가 체크리스트(class_review) — 이승엽 개인 예외 부여(원장 지시 2026-08-04, 테스트 단계).
//   node scripts/staff-access/grant-class-review.mjs --apply
// 회수: userOverrides에서 해당 항목 제거(이 스크립트 --revoke) 또는 owner 권한 매트릭스에서 역할 개방.
// ⚠️ 반영 시점: tenant_settings 캐시는 다음 배포까지 유지될 수 있음(narrow-staff-menu 헤더 참조).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes("--apply");
const REVOKE = process.argv.includes("--revoke");
const env = Object.fromEntries(
  readFileSync(join(HERE, "../../.env.local"), "utf-8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const SB = env.NEXT_PUBLIC_SUPABASE_URL;
const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" };

const LSY = "477950d4-9cb0-4c02-9ac4-f00d42754d55"; // 이승엽(개발팀 대리)
const MENU = "class_review";

const [ts] = await (await fetch(`${SB}/rest/v1/tenant_settings?select=tenant_id,data`, { headers: H })).json();
const perms = ts.data.permissions ?? {};
const cur = (perms.userOverrides ?? []).filter((o) => !(o.userId === LSY && o.menu === MENU));
const next = REVOKE ? cur : [...cur, { userId: LSY, menu: MENU, access: "full" }];
console.log(REVOKE ? "회수 예정" : "부여 예정", "— 이승엽 class_review full");
console.log("적용 후 userOverrides:", JSON.stringify(next));
if (!APPLY) { console.log("(드라이런 — --apply로 실행)"); process.exit(0); }

const r = await fetch(`${SB}/rest/v1/tenant_settings?tenant_id=eq.${ts.tenant_id}`, {
  method: "PATCH", headers: H,
  body: JSON.stringify({ data: { ...ts.data, permissions: { ...perms, userOverrides: next } } }),
});
if (!r.ok) throw new Error(`저장 실패 ${r.status}`);
await fetch(`${SB}/rest/v1/audit_logs`, { method: "POST", headers: H, body: JSON.stringify({
  tenant_id: ts.tenant_id, actor_name: "system:grant-class-review", action: "owner_settings_update",
  target_type: "tenant_settings", target_label: "permissions",
  metadata: { note: `수업 평가(class_review) 이승엽 개인 예외 ${REVOKE ? "회수" : "부여"}(원장 지시 2026-08-04)` },
}) });
console.log("적용 완료 ✓");
