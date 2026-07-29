// 로그인 계정 생성 원복 — create-logins-for-staff.mjs 로그를 역순으로 되감는다.
//   ① 삭제했던 옛 users 행을 **같은 id로** 다시 insert(계정이 없던 행이라 auth와 무관)
//   ② 옮긴 외래키를 새 id → 옛 id로 되돌린다
//   ③ 새로 만든 auth 계정 삭제(연결된 users 행도 함께 사라진다)
//
//   node scripts/staff-roster-import/revert-create-logins.mjs logs/create-logins-<ts>.json           # 드라이런
//   node scripts/staff-roster-import/revert-create-logins.mjs logs/create-logins-<ts>.json --apply   # 적용
//
// ⚠️ 그 사람이 이미 로그인해 이메일·비밀번호를 바꿨거나 새 데이터를 만들었다면 되돌리면 안 된다 —
// 새 계정에 **로그인 기록(last_sign_in_at)이 있으면 건너뛴다**(사람이 쓰기 시작한 계정은 안 지운다).
import { readFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes("--apply");
const arg = process.argv.slice(2).find((a) => a !== "--apply");
if (!arg) {
  console.error("사용법: node revert-create-logins.mjs logs/create-logins-<ts>.json [--apply]");
  process.exit(1);
}
const logPath = isAbsolute(arg) ? arg : join(process.cwd(), arg);

const env = Object.fromEntries(
  readFileSync(join(HERE, "../../.env.local"), "utf-8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const SB = env.NEXT_PUBLIC_SUPABASE_URL;
const H = {
  apikey: env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json",
};
const rest = async (path, init) => {
  const r = await fetch(`${SB}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init?.headers ?? {}) } });
  if (!r.ok) throw new Error(`${init?.method ?? "GET"} ${path} → ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json();
};

const { created } = JSON.parse(readFileSync(logPath, "utf-8"));
console.log(`\n=== 로그인 계정 생성 원복 ${APPLY ? "[적용]" : "[드라이런]"} — ${created.length}명 ===\n`);

for (const c of created) {
  console.log(`■ ${c.name} (${c.email})`);
  // 사람이 이미 쓰기 시작한 계정은 건드리지 않는다.
  const r = await fetch(`${SB}/auth/v1/admin/users/${c.newId}`, { headers: H });
  const account = r.ok ? await r.json() : null;
  if (account?.last_sign_in_at) {
    console.log(`   ! 이미 로그인한 적 있음(${account.last_sign_in_at}) — 건너뜀`);
    continue;
  }
  if (account && account.email !== c.email) {
    console.log(`   ! 이메일이 ${account.email}로 바뀜(본인이 수정) — 건너뜀`);
    continue;
  }

  if (c.deleted) {
    const exists = await rest(`users?select=id&id=eq.${c.oldId}`);
    console.log(`   옛 행 복구: ${c.oldRow.email}`);
    if (APPLY && exists.length === 0) await rest("users", { method: "POST", body: JSON.stringify(c.oldRow) });
  }
  for (const m of c.moved ?? []) {
    console.log(`   ${m.table}.${m.column} ${m.count}건 되돌림`);
    if (APPLY) {
      await rest(`${m.table}?${m.column}=eq.${c.newId}`, {
        method: "PATCH",
        body: JSON.stringify({ [m.column]: c.oldId }),
      });
    }
  }
  console.log(`   새 계정 삭제: ${c.newId}`);
  if (APPLY) {
    await fetch(`${SB}/auth/v1/admin/users/${c.newId}`, { method: "DELETE", headers: H });
    const left = await rest(`users?select=id&id=eq.${c.newId}`);
    if (left.length) await rest(`users?id=eq.${c.newId}`, { method: "DELETE" });
  }
}
console.log(APPLY ? "\n원복 완료" : "\n적용하려면 --apply 를 붙이세요.");
