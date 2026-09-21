// 로그인 계정이 없는 직원에게 계정 만들어 주기(원장 지시 2026-07-29).
//
//   node scripts/staff-roster-import/create-logins-for-staff.mjs            # 드라이런
//   node scripts/staff-roster-import/create-logins-for-staff.mjs --apply    # 적용
//   (옵션) --include-inactive : 퇴사 직원까지 포함(기본은 재직만)
//
// aywa는 **직원 행 id = 로그인 계정 id**가 같아야 한다(미러 트리거 구조). 그런데 시트/POC 이관 행은
// 계정 없이 만들어져 id가 따로 논다 → 계정을 만들면 행이 하나 더 생긴다. 그래서 이 스크립트는
//   ① 이니셜 주소로 auth 계정 생성(초기 비밀번호 eywa123) → 미러 트리거가 새 users 행 생성
//   ② 옛 행의 정보 전부를 새 행으로 복사
//   ③ **users.id를 가리키는 외래키 54개 전수**를 옛 id → 새 id로 재지정(목록은 DB OpenAPI에서 추출)
//   ④ 남은 참조가 0인지 다시 확인하고 0일 때만 옛 행 삭제(하나라도 남으면 중단 — 조용한 유실 방지)
// 로그인한 본인이 '내 정보'에서 이메일·비밀번호를 자기 것으로 바꾸는 게 최종 단계(원장 방침).
//
// 원복: logs/create-logins-<ts>.json → node scripts/staff-roster-import/revert-create-logins.mjs <로그> --apply
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes("--apply");
const INCLUDE_INACTIVE = process.argv.includes("--include-inactive");
const INITIAL_PASSWORD = "eywa123";
const EMAIL_DOMAIN = "gmail.com"; // 원장 지시. 본인이 로그인 후 실제 주소로 바꾸는 전제의 임시 주소.

const env = Object.fromEntries(
  readFileSync(join(HERE, "../../.env.local"), "utf-8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const SB = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
const rest = async (path, init) => {
  const r = await fetch(`${SB}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init?.headers ?? {}) } });
  if (!r.ok) throw new Error(`${init?.method ?? "GET"} ${path} → ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json();
};
const auth = async (path, init) => {
  const r = await fetch(`${SB}/auth/v1/${path}`, { ...init, headers: { ...H, ...(init?.headers ?? {}) } });
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`auth ${path} → ${r.status} ${JSON.stringify(body)}`);
  return body;
};

// ── 한글 이름 → 이니셜 ───────────────────────────────────────────────
// 초성 로마자(관용 표기 기준: 김=K, 최=C). ㅇ은 소리가 없어 중성(모음) 첫 글자를 쓴다(육→y, 원→w).
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
    // 성씨 '이'는 관용상 L(Lee) — 규칙대로면 i가 되어 알아보기 어렵다.
    if (i === 0 && chars[i] === "이") letters.push("l");
    else letters.push(CHO[cho] || JUNG[jung]);
  }
  return letters.join("") || "staff";
}

// ── users.id 외래키 전수(DB OpenAPI에서 실시간 추출 — 코드에 박아두면 새 컬럼을 놓친다) ──
async function userForeignKeys() {
  const spec = await (await fetch(`${SB}/rest/v1/`, { headers: { ...H, Accept: "application/openapi+json" } })).json();
  const cols = [];
  for (const [table, def] of Object.entries(spec.definitions ?? {})) {
    for (const [col, c] of Object.entries(def.properties ?? {})) {
      const d = c.description ?? "";
      if (/Foreign Key to `?public\.users\.id/.test(d) || /<fk table='users' column='id'\/>/.test(d)) {
        cols.push([table, col]);
      }
    }
  }
  return cols;
}

const FK = await userForeignKeys();
const users = await rest(
  "users?select=*&system_role=neq.student&limit=1000",
);
const authIds = new Set();
for (let page = 1; page <= 10; page++) {
  const d = await auth(`admin/users?page=${page}&per_page=200`);
  const list = d.users ?? [];
  list.forEach((a) => authIds.add(a.id));
  if (list.length < 200) break;
}

const PLACEHOLDER = (e) => /imported\.local$/i.test(e ?? "") || !/^\S+@\S+\.\S+$/.test(e ?? "");
const targets = users.filter(
  (u) => !authIds.has(u.id) && PLACEHOLDER(u.email) && (INCLUDE_INACTIVE || u.status === "active"),
);

// 이메일 중복 방지 — 이미 쓰는 주소(users·auth) + 이번 배치 안에서도 유일하게.
const taken = new Set(users.map((u) => String(u.email ?? "").toLowerCase()));
const authEmails = new Set();
for (let page = 1; page <= 10; page++) {
  const d = await auth(`admin/users?page=${page}&per_page=200`);
  const list = d.users ?? [];
  list.forEach((a) => authEmails.add(String(a.email ?? "").toLowerCase()));
  if (list.length < 200) break;
}
function pickEmail(name) {
  const base = initialsOf(name);
  for (let n = 0; n < 50; n++) {
    const candidate = `${base}${n === 0 ? "" : n + 1}@${EMAIL_DOMAIN}`.toLowerCase();
    if (!taken.has(candidate) && !authEmails.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
  throw new Error(`${name} 이메일 후보 소진`);
}

// 참조 현황(표시·검증 공용)
async function refsOf(id) {
  const found = [];
  for (const [t, c] of FK) {
    let rows = [];
    try {
      rows = await rest(`${t}?select=${c}&${c}=eq.${id}&limit=1000`);
    } catch {
      continue;
    }
    if (rows.length) found.push({ table: t, column: c, count: rows.length });
  }
  return found;
}

console.log(`\n=== 로그인 계정 생성 ${APPLY ? "[적용]" : "[드라이런]"} — ${targets.length}명 ===`);
console.log(`외래키 ${FK.length}개 전수 재지정 · 초기 비밀번호 ${INITIAL_PASSWORD}\n`);

const plan = [];
for (const u of targets) {
  const email = pickEmail(u.display_name);
  const refs = await refsOf(u.id);
  plan.push({ user: u, email, refs });
  const refText = refs.length ? refs.map((r) => `${r.table}.${r.column}:${r.count}`).join(" ") : "없음";
  console.log(`  ${u.display_name.padEnd(7)} → ${email.padEnd(22)} [${u.system_role}/${u.status}] 옮길 참조: ${refText}`);
}

if (!APPLY) {
  console.log("\n적용하려면 --apply 를 붙여 다시 실행하세요.");
  process.exit(0);
}

const logDir = join(HERE, "logs");
if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const logPath = join(logDir, `create-logins-${stamp}.json`);
const done = [];
const writeLog = () => writeFileSync(logPath, JSON.stringify({ at: new Date().toISOString(), created: done }, null, 2), "utf-8");

for (const p of plan) {
  const old = p.user;
  console.log(`\n■ ${old.display_name}`);
  // ① auth 계정 — app_metadata에 role을 **명시**로 넣어 미러 트리거 강등([[#70]])을 원천 차단.
  const created = await auth("admin/users", {
    method: "POST",
    body: JSON.stringify({
      email: p.email,
      password: INITIAL_PASSWORD,
      email_confirm: true,
      app_metadata: { tenant_id: old.tenant_id, system_role: old.system_role },
    }),
  });
  const newId = created.id;
  console.log(`   계정 생성: ${p.email} (${newId})`);
  const entry = { name: old.display_name, oldId: old.id, newId, email: p.email, oldRow: old, moved: [], deleted: false };
  done.push(entry);
  writeLog(); // 중간에 죽어도 여기까지는 원복 가능하게 매 단계 기록

  // ② 미러 트리거가 만든 새 행에 옛 정보 복사(이메일·id는 새 것 유지).
  for (let i = 0; i < 20; i++) {
    const rows = await rest(`users?select=id&id=eq.${newId}`);
    if (rows.length) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  const carry = { ...old };
  delete carry.id;
  delete carry.email;
  delete carry.created_at;
  delete carry.updated_at;
  await rest(`users?id=eq.${newId}`, { method: "PATCH", body: JSON.stringify(carry) });
  console.log(`   정보 이관 완료`);

  // ③ 외래키 전수 재지정
  for (const r of p.refs) {
    const rows = await rest(`${r.table}?select=${r.column}&${r.column}=eq.${old.id}&limit=1000`);
    if (!rows.length) continue;
    await rest(`${r.table}?${r.column}=eq.${old.id}`, {
      method: "PATCH",
      body: JSON.stringify({ [r.column]: newId }),
    });
    entry.moved.push({ table: r.table, column: r.column, count: rows.length });
    console.log(`   ${r.table}.${r.column} ${rows.length}건 이동`);
  }
  writeLog();

  // ④ 남은 참조 0 확인 후에만 삭제
  const leftover = await refsOf(old.id);
  if (leftover.length) {
    console.log(`   ! 참조가 남아 옛 행을 삭제하지 않음: ${leftover.map((x) => `${x.table}.${x.column}:${x.count}`).join(" ")}`);
    continue;
  }
  await rest(`users?id=eq.${old.id}`, { method: "DELETE" });
  entry.deleted = true;
  console.log(`   옛 행 삭제 — 완료`);
  writeLog();
}

writeLog();
console.log(`\n원복 로그: ${logPath}`);
console.log(`\n안내: 각자 ${INITIAL_PASSWORD} 로 로그인 → '내 정보'에서 이메일·비밀번호를 본인 것으로 변경.`);
