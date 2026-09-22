// placeholder 이메일 직원의 로그인 정상화(원장 지시 2026-08-14: "둘다 ID는 이니셜@gmail 로 해주고
// 비밀번호 초기비밀번호로 변경").
//
//   node scripts/staff-access/fix-placeholder-logins.mjs            # 드라이런
//   node scripts/staff-access/fix-placeholder-logins.mjs --apply    # 적용
//   node scripts/staff-access/fix-placeholder-logins.mjs --revert <로그경로> --apply   # 원복(이메일만)
//
// 배경: 이관으로 만들어진 두 계정이 `@imported.local` 주소로 남아 **로그인 자체가 불가**했다.
//   · 이다교  `daniella@imported.local`      — 존재하지 않는 도메인
//   · 김태건  `sam 김태건@imported.local`     — 공백+한글이라 **이메일 형식 자체가 무효**
// 둘 다 last_sign_in_at 없음(한 번도 못 들어옴).
//
// ⚠️ 계정 생성이 아니라 **기존 auth 계정의 email/password 갱신**이다 — id가 그대로라 외래키 재지정
//    (create-logins-for-staff.mjs의 54개 FK 이동)이 전혀 필요 없다. 그 스크립트와 헷갈리지 말 것.
// ⚠️ app_metadata는 **건드리지 않는다** — 미러 트리거가 metadata 갱신에서 system_role을 stale 값으로
//    되덮는 함정이 있다([[#70]]). 두 계정 모두 meta.system_role='teacher'로 users와 일치함을 확인했다.
// ⚠️ 이니셜 규칙은 create-logins-for-staff.mjs와 **같은 함수**를 복제한다(신재민→sjm 재현 검증함).
//    성씨 '이'는 관용상 L(Lee).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes("--apply");
const REVERT = process.argv.includes("--revert") ? process.argv[process.argv.indexOf("--revert") + 1] : null;
const INITIAL_PASSWORD = "eywa123";
const EMAIL_DOMAIN = "gmail.com";

const env = Object.fromEntries(
  readFileSync(join(HERE, "../../.env.local"), "utf-8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const SB = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
const rest = async (p, init) => {
  const r = await fetch(`${SB}/rest/v1/${p}`, { ...init, headers: { ...H, ...(init?.headers ?? {}) } });
  if (!r.ok) throw new Error(`${init?.method ?? "GET"} ${p} → ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json();
};
const auth = async (p, init) => {
  const r = await fetch(`${SB}/auth/v1/${p}`, { ...init, headers: { ...H, ...(init?.headers ?? {}) } });
  const b = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`auth ${p} → ${r.status} ${JSON.stringify(b)}`);
  return b;
};

const CHO = ["k","k","n","d","d","r","m","b","b","s","s","","j","j","c","k","t","p","h"];
const JUNG = ["a","a","y","y","e","e","y","y","o","w","w","o","y","u","w","w","w","y","e","e","i"];
function initialsOf(name) {
  const out = [];
  const chars = [...name.replace(/\s+/g, "")];
  for (let i = 0; i < chars.length; i++) {
    const code = chars[i].charCodeAt(0) - 0xac00;
    if (code < 0 || code > 11171) {
      if (/[a-zA-Z]/.test(chars[i])) out.push(chars[i].toLowerCase());
      continue;
    }
    const cho = Math.floor(code / 588);
    const jung = Math.floor((code % 588) / 28);
    if (i === 0 && chars[i] === "이") out.push("l");
    else out.push(CHO[cho] || JUNG[jung]);
  }
  return out.join("") || "staff";
}

// ── 원복 ──────────────────────────────────────────────────────────────
if (REVERT) {
  const log = JSON.parse(readFileSync(REVERT, "utf-8"));
  console.log(`원복 ${APPLY ? "[적용]" : "[드라이런]"} — ${log.changed.length}건 (이메일만; 비밀번호는 되돌리지 않는다)`);
  for (const c of log.changed) {
    console.log(`  ${c.name}: ${c.newEmail} → ${c.oldEmail}`);
    if (!APPLY) continue;
    await auth(`admin/users/${c.id}`, { method: "PUT", body: JSON.stringify({ email: c.oldEmail, email_confirm: true }) });
    await rest(`users?id=eq.${c.id}`, { method: "PATCH", body: JSON.stringify({ email: c.oldEmail }) });
  }
  console.log(APPLY ? "원복 완료 ✓" : "(--apply 필요)");
  process.exit(0);
}

// ── 대상 = 재직 중인데 이메일이 placeholder/무효 형식 ───────────────────
const PLACEHOLDER = (e) => /imported\.local$/i.test(e ?? "") || !/^\S+@\S+\.\S+$/.test(e ?? "");
const users = await rest("users?select=id,display_name,email,system_role,status&status=eq.active&system_role=neq.student&limit=1000");
const targets = users.filter((u) => PLACEHOLDER(u.email));

// 주소 충돌은 **기존 전원 + 이번 배치**를 함께 본다(동명이인 이니셜 충돌 방지 — 겹치면 숫자를 붙인다).
const taken = new Set(users.map((u) => (u.email ?? "").toLowerCase()));
const plan = [];
for (const u of targets) {
  let base = initialsOf(u.display_name);
  let email = `${base}@${EMAIL_DOMAIN}`;
  for (let n = 2; taken.has(email); n++) email = `${base}${n}@${EMAIL_DOMAIN}`;
  taken.add(email);
  plan.push({ id: u.id, name: u.display_name, oldEmail: u.email, newEmail: email, role: u.system_role });
}

console.log(`\n=== placeholder 로그인 정상화 ${APPLY ? "[적용]" : "[드라이런]"} — ${plan.length}명 ===`);
console.log(`초기 비밀번호 ${INITIAL_PASSWORD}\n`);
for (const p of plan) console.log(`  ${p.name}  ${JSON.stringify(p.oldEmail)}\n      → ${p.newEmail}  (${p.role})`);
if (!plan.length) { console.log("대상 없음"); process.exit(0); }
if (!APPLY) { console.log("\n(드라이런 — --apply로 실행)"); process.exit(0); }

const changed = [];
for (const p of plan) {
  // app_metadata는 일부러 안 보낸다(#70).
  await auth(`admin/users/${p.id}`, {
    method: "PUT",
    body: JSON.stringify({ email: p.newEmail, password: INITIAL_PASSWORD, email_confirm: true }),
  });
  await rest(`users?id=eq.${p.id}`, { method: "PATCH", body: JSON.stringify({ email: p.newEmail }) });
  changed.push(p);
  console.log(`적용 ✓ ${p.name} → ${p.newEmail}`);
}

const dir = join(HERE, "logs");
if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
const logPath = join(dir, `fix-placeholder-logins-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(logPath, JSON.stringify({ at: new Date().toISOString(), changed }, null, 2));
console.log(`\n원복 로그: ${logPath}`);

// ── 사후 검증: 실제로 로그인이 되는지 토큰 발급으로 확인하고 세션은 즉시 폐기 ──
console.log("\n=== 로그인 검증(토큰 발급 → 즉시 폐기) ===");
for (const p of changed) {
  const r = await fetch(`${SB}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email: p.newEmail, password: INITIAL_PASSWORD }),
  });
  const b = await r.json().catch(() => null);
  if (r.ok && b?.access_token) {
    await fetch(`${SB}/auth/v1/logout`, {
      method: "POST",
      headers: { apikey: KEY, Authorization: `Bearer ${b.access_token}` },
    }).catch(() => {});
    console.log(`  ✅ ${p.name} (${p.newEmail}) 로그인 성공 — 세션 폐기함`);
  } else {
    console.log(`  ❌ ${p.name} (${p.newEmail}) 로그인 실패: ${r.status} ${JSON.stringify(b)}`);
  }
}

// users 행이 실제로 갱신됐는지(미러/PATCH) 되읽기
const after = await rest(`users?select=display_name,email,system_role,status&id=in.(${changed.map((c) => c.id).join(",")})`);
console.log("\n=== users 행 최종 상태 ===");
for (const u of after) console.log(`  ${u.display_name}  ${u.email}  ${u.system_role} ${u.status}`);
