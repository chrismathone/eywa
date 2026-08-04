// 대량 이관(2026-07-28~31) 이후 직원들이 자기 정보를 고쳤는지 현황 조회(읽기 전용).
//   node scripts/staff-roster-import/check-self-updates.mjs [기준일 YYYY-MM-DD, 기본 2026-08-01]
// 근거 3종: ① 이력서 문서 updated_at(누가인지는 모름 — 관리자 대리 수정 포함)
//          ② audit_logs self_email_change/self_password_change(본인 확정)
//          ③ auth last_sign_in_at(로그인 여부)
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const CUTOFF = /^\d{4}-\d{2}-\d{2}$/.test(process.argv[2] ?? "") ? process.argv[2] : "2026-08-01";
const env = Object.fromEntries(
  readFileSync(join(HERE, "../../.env.local"), "utf-8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const SB = env.NEXT_PUBLIC_SUPABASE_URL;
const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` };
const rest = async (p) => (await fetch(`${SB}/rest/v1/${p}`, { headers: H })).json();

const users = await rest(`users?select=id,display_name,system_role&system_role=neq.student&status=neq.inactive&order=display_name&limit=200`);
const resumes = await rest(`academy_documents?select=staff_user_id,updated_at&form_type=eq.staff_resume&limit=300`);
const audits = await rest(`audit_logs?select=actor_id,action&action=in.(self_email_change,self_password_change)&limit=500`);
const authList = await (await fetch(`${SB}/auth/v1/admin/users?page=1&per_page=200`, { headers: H })).json();
const lastSignIn = new Map((authList.users ?? []).map((u) => [u.id, u.last_sign_in_at]));
const resumeBy = new Map(resumes.map((r) => [r.staff_user_id, r]));
const auditBy = new Map();
for (const a of audits) auditBy.set(a.actor_id, [...(auditBy.get(a.actor_id) ?? []), a.action]);

const rows = users.filter((u) => u.display_name !== "테스트직원(계약서)").map((u) => {
  const r = resumeBy.get(u.id);
  const resumeAt = r?.updated_at && r.updated_at >= CUTOFF ? r.updated_at.slice(0, 16).replace("T", " ") : null;
  const acts = auditBy.get(u.id) ?? [];
  const signIn = lastSignIn.get(u.id);
  return {
    name: u.display_name, role: u.system_role,
    resumeAt, emailChanged: acts.includes("self_email_change"), pwChanged: acts.includes("self_password_change"),
    signedInSince: !!(signIn && signIn >= CUTOFF), signIn: signIn ? signIn.slice(0, 10) : null,
  };
});
const acted = rows.filter((r) => r.resumeAt || r.emailChanged || r.pwChanged);
const loggedOnly = rows.filter((r) => !acted.includes(r) && r.signedInSince);
const silent = rows.filter((r) => !acted.includes(r) && !r.signedInSince);

console.log(`기준 ${CUTOFF} 이후 · 직원 ${rows.length}명\n`);
console.log(`■ 수정함 (${acted.length}명)`);
for (const r of acted) {
  const what = [r.resumeAt ? `이력서 ${r.resumeAt}` : null, r.emailChanged ? "이메일" : null, r.pwChanged ? "비밀번호" : null].filter(Boolean).join(" · ");
  console.log(`  ${r.name} [${r.role}] — ${what}`);
}
console.log(`\n■ 로그인만 하고 안 고침 (${loggedOnly.length}명): ${loggedOnly.map((r) => `${r.name}(${r.signIn})`).join(", ") || "없음"}`);
console.log(`\n■ 로그인 기록 없음 (${silent.length}명): ${silent.map((r) => r.name).join(", ") || "없음"}`);
console.log("\n⚠️ 이력서 수정 시각은 '누가'를 안 남긴다 — 관리자 대리 수정도 포함. 이메일·비밀번호는 본인 확정(감사로그).");
