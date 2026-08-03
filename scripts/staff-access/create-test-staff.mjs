// 계약서 PDF 테스트용 직원 계정(원장 지시 2026-08-03) — 실직원 아님, 언제든 삭제 가능.
//   node scripts/staff-access/create-test-staff.mjs --apply
// 원복(계정+연결 문서+스토리지 정리):
//   node scripts/staff-access/delete-test-staff.mjs --apply
// role=viewer(강사 드롭다운·수업 배정에 안 낌), 이름 '테스트직원(계약서)'로 실직원과 확실히 구분.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
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

const EMAIL = "test.contract@eywa.local";
const PASSWORD = "eywa123";

const [tenant] = await rest(`tenants?select=id&limit=1`);
const dup = await rest(`users?select=id,display_name&email=eq.${EMAIL}`);
if (dup.length) { console.log("이미 존재:", dup[0]); process.exit(0); }

console.log(`생성 예정 → 이름 테스트직원(계약서) · ${EMAIL} / ${PASSWORD} · role viewer · 입사일 오늘`);
if (!APPLY) { console.log("(드라이런 — --apply로 실행)"); process.exit(0); }

// ① auth 계정 — app_metadata role 명시(#70 미러 트리거 강등 차단)
const r = await fetch(`${SB}/auth/v1/admin/users`, {
  method: "POST", headers: H,
  body: JSON.stringify({
    email: EMAIL, password: PASSWORD, email_confirm: true,
    app_metadata: { tenant_id: tenant.id, system_role: "viewer" },
  }),
});
const created = await r.json();
if (!r.ok) throw new Error(`auth 생성 실패: ${JSON.stringify(created).slice(0, 200)}`);
console.log("auth 계정:", created.id);

// ② 미러 트리거 행 대기 → 보강
for (let i = 0; i < 20; i++) {
  const rows = await rest(`users?select=id&id=eq.${created.id}`);
  if (rows.length) break;
  await new Promise((res) => setTimeout(res, 250));
}
const today = new Date().toISOString().slice(0, 10);
await rest(`users?id=eq.${created.id}`, {
  method: "PATCH",
  body: JSON.stringify({
    display_name: "테스트직원(계약서)", system_role: "viewer", status: "active",
    department: "경영지원팀", job_title: "테스트", hire_date: today,
  }),
});
console.log("users 행 보강 완료 (입사일", today + ")");

// ③ 감사 로그
await rest(`audit_logs`, { method: "POST", body: JSON.stringify({
  tenant_id: tenant.id, actor_name: "system:create-test-staff", action: "staff_create",
  target_type: "user", target_label: "테스트직원(계약서)",
  metadata: { via: "script", purpose: "계약서 PDF 테스트(원장 지시 2026-08-03)", email: EMAIL },
}) });

const logDir = join(HERE, "logs");
if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
writeFileSync(join(logDir, `test-staff-${Date.now()}.json`), JSON.stringify({ id: created.id, email: EMAIL }, null, 2));
console.log(`\n완료 — 직원관리 목록에서 '테스트직원(계약서)' 확인. 로그인: ${EMAIL} / ${PASSWORD}`);
