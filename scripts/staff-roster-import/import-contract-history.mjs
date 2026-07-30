// 시트 '계약조건 history' → staff_contracts 이관(원장 지시 2026-07-29).
//
//   node scripts/staff-roster-import/import-contract-history.mjs <parsed.json>            # 드라이런
//   node scripts/staff-roster-import/import-contract-history.mjs <parsed.json> --apply    # 적용
//
// 입력 = 시트 '2026년직원명부' L열(계약조건 history)을 파싱한 JSON [{n:이름, h:입사일, c:[[시작,종료,조건,차수표기]]}].
// (구글 서비스계정 키가 죽어 API로 못 읽어 브라우저 세션으로 CSV를 받아 파싱했다 — 읽기 전용, 시트 무변경.)
//
// 규칙
//   · 같은 이름이 시트에 여러 블록(회사별)으로 나뉘어 있으면 **합쳐서** 한 사람의 이력으로 본다.
//   · seq(차수)는 **시작일 오름차순 1..N**으로 우리가 다시 매긴다 — 시트의 "N]" 번호는 입사 기록까지
//     세고 있어 계약 차수와 다르다(이상엽 4]=3차). 시트 본문의 "N차" 표기는 terms에 그대로 남는다.
//   · 시트에 실재하지 않는 날짜(예 2026-06-31)는 그 달 마지막 날로 보정하고 로그에 남긴다(버리지 않는다).
//   · 이미 같은 (직원, 차수)가 있으면 건너뛴다(재실행 안전).
// 원복: logs/contract-import-<ts>.json → revert-contract-history.mjs <로그> --apply
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes("--apply");
const src = process.argv.slice(2).find((a) => a !== "--apply");
if (!src) {
  console.error("사용법: node import-contract-history.mjs <parsed.json> [--apply]");
  process.exit(1);
}

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

/** 실재하지 않는 날짜는 그 달 마지막 날로 보정("2026-06-31" → "2026-06-30"). */
function fixDate(d) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d ?? "");
  if (!m) return { date: null, fixed: false };
  const y = +m[1], mo = +m[2], day = +m[3];
  if (mo < 1 || mo > 12) return { date: null, fixed: false };
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  if (day >= 1 && day <= last) return { date: d, fixed: false };
  return { date: `${m[1]}-${m[2]}-${String(last).padStart(2, "0")}`, fixed: true };
}

const raw = JSON.parse(readFileSync(isAbsolute(src) ? src : join(process.cwd(), src), "utf-8"));

// 같은 이름이 여러 블록에 있으면 합친다.
const byName = new Map();
for (const p of raw) {
  const name = String(p.n ?? "").trim();
  if (!name) continue;
  if (!byName.has(name)) byName.set(name, []);
  byName.get(name).push(...(p.c ?? []));
}

const users = await rest("users?select=id,display_name,tenant_id,hire_date&system_role=neq.student&limit=1000");
const userByName = new Map();
for (const u of users) {
  const n = String(u.display_name ?? "").trim();
  if (!userByName.has(n)) userByName.set(n, []);
  userByName.get(n).push(u);
}
const existing = await rest("staff_contracts?select=user_id,seq&limit=5000");
const haveKey = new Set(existing.map((r) => `${r.user_id}:${r.seq}`));

const plan = [];
const unmatched = [];
const fixes = [];
for (const [name, items] of byName) {
  const matches = userByName.get(name) ?? [];
  if (matches.length !== 1) {
    if (items.length > 0) unmatched.push(`${name} (계약 ${items.length}건) — ${matches.length === 0 ? "직원 없음" : `동명 ${matches.length}행`}`);
    continue;
  }
  const user = matches[0];
  const rows = [];
  for (const [s, e, terms] of items) {
    const a = fixDate(s), b = fixDate(e);
    if (!a.date || !b.date || b.date <= a.date) {
      unmatched.push(`${name} — 기간이 이상해 건너뜀 (${s}~${e})`);
      continue;
    }
    if (a.fixed) fixes.push(`${name} 시작 ${s} → ${a.date}`);
    if (b.fixed) fixes.push(`${name} 종료 ${e} → ${b.date}`);
    rows.push({ start: a.date, end: b.date, terms: String(terms ?? "").trim() || null });
  }
  if (rows.length === 0) continue;
  rows.sort((x, y) => (x.start < y.start ? -1 : x.start > y.start ? 1 : 0));
  const withSeq = rows.map((r, i) => ({ ...r, seq: i + 1 })).filter((r) => !haveKey.has(`${user.id}:${r.seq}`));
  if (withSeq.length > 0) plan.push({ name, user, rows: withSeq });
}

console.log(`\n=== 계약조건 히스토리 이관 ${APPLY ? "[적용]" : "[드라이런]"} ===`);
console.log(`시트 ${byName.size}명 · 이관 대상 ${plan.length}명 / 계약 ${plan.reduce((n, p) => n + p.rows.length, 0)}건\n`);
for (const p of plan) {
  console.log(`■ ${p.name} — ${p.rows.length}건`);
  for (const r of p.rows) console.log(`   ${r.seq}차 ${r.start} ~ ${r.end}  ${(r.terms ?? "").slice(0, 60)}`);
}
if (fixes.length) console.log(`\n날짜 보정(시트에 없는 날):\n  ${fixes.join("\n  ")}`);
if (unmatched.length) console.log(`\n건너뜀:\n  ${unmatched.join("\n  ")}`);

if (!APPLY) {
  console.log("\n적용하려면 --apply 를 붙여 다시 실행하세요.");
  process.exit(0);
}

const logDir = join(HERE, "logs");
if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const logPath = join(logDir, `contract-import-${stamp}.json`);
const inserted = [];
for (const p of plan) {
  const payload = p.rows.map((r) => ({
    tenant_id: p.user.tenant_id,
    user_id: p.user.id,
    seq: r.seq,
    start_date: r.start,
    end_date: r.end,
    terms: r.terms,
  }));
  const created = await rest("staff_contracts?select=id", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(payload),
  });
  inserted.push(...created.map((c) => c.id));
  console.log(`  ✓ ${p.name} ${payload.length}건`);
}
writeFileSync(logPath, JSON.stringify({ at: new Date().toISOString(), contractIds: inserted }, null, 2), "utf-8");
console.log(`\n적용 완료: ${inserted.length}건 · 원복 로그: ${logPath}`);
