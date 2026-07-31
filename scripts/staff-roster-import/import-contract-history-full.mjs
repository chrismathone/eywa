// 시트 '계약조건 history' 셀 **전체 줄** 이관(원장 지적 2026-07-31: "히스토리가 한 줄만 들어가 있음").
//
//   node scripts/staff-roster-import/import-contract-history-full.mjs <full.json>            # 드라이런
//   node scripts/staff-roster-import/import-contract-history-full.mjs <full.json> --apply    # 적용
//
// 1차 이관(import-contract-history.mjs)은 **기간이 있는 줄만** 계약으로 넣어 58줄을 버렸다.
// 버린 것 중엔 입사·재입사·퇴사, 인센티브 수당 조항, 부서 이전, 시급 전환,
// 그리고 연도 오타(`202.09.01~`)로 기간 인식이 안 된 **실제 계약 한 건**까지 있었다.
// 이제 셀의 모든 줄을 남긴다 — 기간이 온전하면 kind='contract'(차수 부여), 아니면 kind='note'(원문 그대로).
//
// **멱등**: 사람마다 시트에서 온 행(created_by is null)을 지우고 다시 넣는다.
// ⚠️ 화면에서 사람이 넣은 계약(created_by 있음)은 건드리지 않는다.
// 원복: logs/history-full-<ts>.json (지운 행 전체 + 새로 넣은 id)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes("--apply");
const src = process.argv.slice(2).find((a) => a !== "--apply");
if (!src) {
  console.error("사용법: node import-contract-history-full.mjs <full.json> [--apply]");
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
  if (!m) return null;
  const y = +m[1], mo = +m[2], day = +m[3];
  if (mo < 1 || mo > 12) return null;
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return day >= 1 && day <= last ? d : `${m[1]}-${m[2]}-${String(last).padStart(2, "0")}`;
}

const raw = JSON.parse(readFileSync(isAbsolute(src) ? src : join(process.cwd(), src), "utf-8"));

// 같은 이름이 여러 회사 블록에 있으면 합친다(줄 순서는 블록 순서대로 이어붙임).
const byName = new Map();
for (const p of raw) {
  const name = String(p.n ?? "").trim();
  if (!name) continue;
  if (!byName.has(name)) byName.set(name, []);
  const base = byName.get(name).length;
  for (const it of p.items ?? []) byName.get(name).push({ ...it, i: base + it.i });
}

const users = await rest("users?select=id,display_name,tenant_id&system_role=neq.student&limit=1000");
const userByName = new Map();
for (const u of users) {
  const n = String(u.display_name ?? "").trim();
  if (!userByName.has(n)) userByName.set(n, []);
  userByName.get(n).push(u);
}

const plan = [];
const skipped = [];
for (const [name, items] of byName) {
  const matches = userByName.get(name) ?? [];
  if (matches.length !== 1) {
    skipped.push(`${name} (${items.length}줄) — ${matches.length === 0 ? "직원 없음" : `동명 ${matches.length}행`}`);
    continue;
  }
  const user = matches[0];
  const rows = [];
  let seq = 0;
  // 차수는 **시작일 오름차순**으로 매긴다(시트 번호는 입사 기록까지 세고 있어 계약 차수와 다르다).
  const contracts = items
    .filter((x) => x.kind === "contract")
    .map((x) => ({ ...x, s: fixDate(x.s), e: fixDate(x.e) }))
    .filter((x) => x.s && x.e && x.e > x.s)
    .sort((a, b) => (a.s < b.s ? -1 : a.s > b.s ? 1 : 0));
  const seqById = new Map(contracts.map((c) => [c.i, ++seq]));
  for (const it of items) {
    const isContract = seqById.has(it.i);
    rows.push({
      tenant_id: user.tenant_id,
      user_id: user.id,
      seq: isContract ? seqById.get(it.i) : 0,
      kind: isContract ? "contract" : "note",
      start_date: isContract ? fixDate(it.s) : (fixDate(it.s) ?? null),
      end_date: isContract ? fixDate(it.e) : null,
      terms: String(it.t ?? "").trim() || String(it.raw ?? "").trim() || null,
      line_no: it.i,
    });
  }
  plan.push({ name, user, rows });
}

const totals = plan.reduce(
  (acc, p) => {
    acc.contract += p.rows.filter((r) => r.kind === "contract").length;
    acc.note += p.rows.filter((r) => r.kind === "note").length;
    return acc;
  },
  { contract: 0, note: 0 },
);
console.log(`\n=== 히스토리 전체 줄 이관 ${APPLY ? "[적용]" : "[드라이런]"} ===`);
console.log(`${plan.length}명 · 계약 ${totals.contract}건 + 이력 줄 ${totals.note}건 = ${totals.contract + totals.note}줄\n`);
for (const p of plan.slice(0, 6)) {
  console.log(`■ ${p.name}`);
  for (const r of [...p.rows].sort((a, b) => a.line_no - b.line_no)) {
    const head = r.kind === "contract" ? `${r.seq}차 ${r.start_date}~${r.end_date}` : `기록 ${r.start_date ?? "-"}`;
    console.log(`   ${head}  ${(r.terms ?? "").slice(0, 56)}`);
  }
}
if (plan.length > 6) console.log(`   … 외 ${plan.length - 6}명`);
if (skipped.length) console.log(`\n건너뜀:\n  ${skipped.join("\n  ")}`);

if (!APPLY) {
  console.log("\n적용하려면 --apply 를 붙여 다시 실행하세요.");
  process.exit(0);
}

const logDir = join(HERE, "logs");
if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const logPath = join(logDir, `history-full-${stamp}.json`);
const removed = [];
const inserted = [];

for (const p of plan) {
  // 시트에서 온 행만 교체 — 화면에서 사람이 넣은 계약(created_by 있음)은 보존.
  const old = await rest(`staff_contracts?select=*&user_id=eq.${p.user.id}&created_by=is.null`);
  if (old.length) {
    removed.push(...old);
    await rest(`staff_contracts?user_id=eq.${p.user.id}&created_by=is.null`, { method: "DELETE" });
  }
  const created = await rest("staff_contracts?select=id", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(p.rows),
  });
  inserted.push(...created.map((c) => c.id));
  console.log(`  ✓ ${p.name} — 이전 ${old.length}행 교체 → ${p.rows.length}줄`);
}

writeFileSync(logPath, JSON.stringify({ at: new Date().toISOString(), removed, inserted }, null, 2), "utf-8");
console.log(`\n적용 완료: ${inserted.length}줄 · 원복 로그: ${logPath}`);
