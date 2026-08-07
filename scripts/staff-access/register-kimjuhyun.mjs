// 김주현 직원 계정 생성 + 이력서 연결 + 중복 이력서 정리(원장 지시 2026-08-07).
//   배경: 이력서만 3회 저장되고 '계정 등록' 단계가 안 탐 — 계정을 수동으로 만들어 최신 이력서에 연결.
//   이메일 = 이니셜 자동생성(create-logins-for-staff와 동일 규칙: 초성 로마자 + gmail.com, 중복 시 숫자),
//   비밀번호 = eywa123(제품 초기 비밀번호와 동일), 역할 = teacher(강사 — 아니면 직원 상세 > 역할 변경).
//   node scripts/staff-access/register-kimjuhyun.mjs           # 드라이런
//   node scripts/staff-access/register-kimjuhyun.mjs --apply   # 적용
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

const NAME = "김주현";
const PASSWORD = "eywa123";
const ROLE = "teacher";

// 이니셜 규칙 — create-logins-for-staff.mjs와 동일(초성 로마자, '이'씨는 l, ㅇ은 모음 첫 글자).
const CHO = ["k", "k", "n", "d", "d", "r", "m", "b", "b", "s", "s", "", "j", "j", "c", "k", "t", "p", "h"];
const JUNG = ["a","a","y","y","e","e","y","y","o","w","w","o","y","u","w","w","w","y","e","e","i"];
function initialsOf(name) {
  const letters = [];
  const chars = [...name.replace(/\s+/g, "")];
  for (let i = 0; i < chars.length; i++) {
    const code = chars[i].charCodeAt(0) - 0xac00;
    if (code < 0 || code > 11171) {
      if (/[a-zA-Z]/.test(chars[i])) letters.push(chars[i].toLowerCase());
      continue;
    }
    const cho = Math.floor(code / 588);
    const jung = Math.floor((code % 588) / 28);
    if (i === 0 && chars[i] === "이") letters.push("l");
    else letters.push(CHO[cho] || JUNG[jung]);
  }
  return letters.join("") || "staff";
}

const [tenant] = await rest(`tenants?select=id&limit=1`);

// 0) 이미 있으면 중단(멱등)
const dupUser = await rest(`users?select=id,display_name,email&display_name=eq.${encodeURIComponent(NAME)}`);
if (dupUser.length) { console.log("이미 직원 계정 존재:", JSON.stringify(dupUser)); process.exit(0); }

// 1) 김주현 이력서 3건 → 최신 1건만 남긴다
const resumes = (await rest(`academy_documents?select=id,created_at,form_data,staff_user_id&form_type=eq.staff_resume&order=created_at.desc`))
  .filter((d) => d.form_data?.personal?.name === NAME);
if (!resumes.length) throw new Error("김주현 이력서가 없다 — 중단");
const keep = resumes[0];
const dupes = resumes.slice(1);
console.log(`이력서 ${resumes.length}건 — 유지 ${keep.id.slice(0, 8)}(${String(keep.created_at).slice(0, 19)}) / 삭제 ${dupes.length}건`);

// 2) 이메일 자동생성(이니셜 + 중복 회피)
const allUsers = await rest(`users?select=email&limit=2000`);
const taken = new Set(allUsers.map((u) => String(u.email ?? "").toLowerCase()));
for (let page = 1; page <= 10; page++) {
  const r = await fetch(`${SB}/auth/v1/admin/users?page=${page}&per_page=200`, { headers: H });
  const d = await r.json();
  (d.users ?? []).forEach((a) => taken.add(String(a.email ?? "").toLowerCase()));
  if ((d.users ?? []).length < 200) break;
}
const base = initialsOf(NAME);
let email = null;
for (let n = 0; n < 50; n++) {
  const candidate = `${base}${n === 0 ? "" : n + 1}@gmail.com`.toLowerCase();
  if (!taken.has(candidate)) { email = candidate; break; }
}
if (!email) throw new Error("이메일 후보 소진");
console.log(`계정 예정 → ${NAME} · ${email} / ${PASSWORD} · role ${ROLE}`);
if (!APPLY) { console.log("(드라이런 — --apply로 실행)"); process.exit(0); }

// 3) auth 계정 생성(미러 트리거가 users 최소 행 생성) → 보강
const r = await fetch(`${SB}/auth/v1/admin/users`, {
  method: "POST", headers: H,
  body: JSON.stringify({ email, password: PASSWORD, email_confirm: true, app_metadata: { tenant_id: tenant.id, system_role: ROLE } }),
});
const created = await r.json();
if (!r.ok) throw new Error(`auth 생성 실패: ${JSON.stringify(created).slice(0, 200)}`);
for (let i = 0; i < 20; i++) {
  const rows = await rest(`users?select=id&id=eq.${created.id}`);
  if (rows.length) break;
  await new Promise((res) => setTimeout(res, 250));
}
await rest(`users?id=eq.${created.id}`, {
  method: "PATCH",
  body: JSON.stringify({ display_name: NAME, system_role: ROLE, status: "active" }),
});
console.log("users 행 보강 완료:", created.id);

// 4) 최신 이력서 연결 + 중복 삭제
await rest(`academy_documents?id=eq.${keep.id}`, { method: "PATCH", body: JSON.stringify({ staff_user_id: created.id }) });
for (const d of dupes) await rest(`academy_documents?id=eq.${d.id}`, { method: "DELETE" });
console.log(`이력서 연결 1건 · 중복 삭제 ${dupes.length}건`);

// 5) 감사 로그
await rest(`audit_logs`, { method: "POST", body: JSON.stringify({
  tenant_id: tenant.id, actor_name: "system:register-kimjuhyun", action: "staff_create_from_resume",
  target_type: "user", target_label: NAME,
  metadata: { via: "script(원장 지시 2026-08-07)", userId: created.id, email, role: ROLE, resumeId: keep.id, removedDuplicates: dupes.map((d) => d.id) },
}) });

const logDir = join(HERE, "logs");
if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
writeFileSync(join(logDir, `register-kimjuhyun-${Date.now()}.json`), JSON.stringify({ userId: created.id, email, keep: keep.id, removed: dupes.map((d) => d.id) }, null, 2));
console.log(`\n완료 — 로그인: ${email} / ${PASSWORD} (역할 강사 — 다르면 직원 상세 > 역할 변경)`);
