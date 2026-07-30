// 계약조건 히스토리 이관 원복 — import-contract-history.mjs 가 넣은 행만 id로 지운다.
//   node scripts/staff-roster-import/revert-contract-history.mjs logs/contract-import-<ts>.json           # 드라이런
//   node scripts/staff-roster-import/revert-contract-history.mjs logs/contract-import-<ts>.json --apply   # 적용
//
// ⚠️ 이관 뒤 사람이 화면에서 고친 행은 되돌리면 안 된다 — **updated_at이 created_at보다 뒤면 건너뛴다.**
import { readFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes("--apply");
const arg = process.argv.slice(2).find((a) => a !== "--apply");
if (!arg) {
  console.error("사용법: node revert-contract-history.mjs logs/contract-import-<ts>.json [--apply]");
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

const { contractIds } = JSON.parse(readFileSync(isAbsolute(arg) ? arg : join(process.cwd(), arg), "utf-8"));
console.log(`\n=== 계약 이관 원복 ${APPLY ? "[적용]" : "[드라이런]"} — ${contractIds.length}건 ===`);

let removed = 0;
let skipped = 0;
for (const id of contractIds) {
  const [row] = await rest(`staff_contracts?select=id,seq,created_at,updated_at,user_id&id=eq.${id}`);
  if (!row) {
    skipped++;
    continue;
  }
  if (row.updated_at && row.created_at && row.updated_at > row.created_at) {
    console.log(`  ! ${id} — 이관 후 수정됨, 건너뜀`);
    skipped++;
    continue;
  }
  if (APPLY) await rest(`staff_contracts?id=eq.${id}`, { method: "DELETE" });
  removed++;
}
console.log(`\n${APPLY ? "삭제" : "삭제 예정"} ${removed}건 · 건너뜀 ${skipped}건`);
if (!APPLY) console.log("적용하려면 --apply 를 붙이세요.");
