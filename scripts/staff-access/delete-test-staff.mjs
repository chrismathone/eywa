// 테스트직원(계약서) 정리 — 계정·연결 문서 행·스토리지 원본·계약 행까지 전부 제거.
//   node scripts/staff-access/delete-test-staff.mjs --apply
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes("--apply");
const env = Object.fromEntries(
  readFileSync(join(HERE, "../../.env.local"), "utf-8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const SB = env.NEXT_PUBLIC_SUPABASE_URL;
const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" };
const rest = async (p, init) => {
  const r = await fetch(`${SB}/rest/v1/${p}`, { headers: { ...H, Prefer: "return=representation" }, ...init });
  const b = await r.text();
  if (!r.ok) throw new Error(`${p} → ${r.status}: ${b.slice(0, 300)}`);
  return b ? JSON.parse(b) : null;
};

const EMAIL = "test.contract@aywa.local";
const [u] = await rest(`users?select=id,tenant_id,display_name&email=eq.${EMAIL}`);
if (!u) { console.log("테스트 계정 없음 — 정리할 것 없음"); process.exit(0); }
const docs = await rest(`academy_documents?select=id,file_path&staff_user_id=eq.${u.id}`);
const contracts = await rest(`staff_contracts?select=id&user_id=eq.${u.id}`);
console.log(`삭제 예정: 계정 ${u.display_name}(${u.id.slice(0, 8)}) · 문서 ${docs.length}건 · 계약 행 ${contracts.length}건`);
if (!APPLY) { console.log("(드라이런 — --apply로 실행)"); process.exit(0); }

for (const d of docs) {
  if (d.file_path) {
    await fetch(`${SB}/storage/v1/object/academy-documents/${d.file_path}`, { method: "DELETE", headers: H }).catch(() => {});
  }
}
await rest(`academy_documents?staff_user_id=eq.${u.id}`, { method: "DELETE" });
await rest(`staff_contracts?user_id=eq.${u.id}`, { method: "DELETE" });
await rest(`users?id=eq.${u.id}`, { method: "DELETE" });
const r = await fetch(`${SB}/auth/v1/admin/users/${u.id}`, { method: "DELETE", headers: H });
console.log(`정리 완료 (auth 삭제 ${r.status})`);
await rest(`audit_logs`, { method: "POST", body: JSON.stringify({
  tenant_id: u.tenant_id, actor_name: "system:delete-test-staff", action: "staff_delete",
  target_type: "user", target_label: u.display_name, metadata: { via: "script", docs: docs.length },
}) });
