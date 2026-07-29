// 담당 과목 백필 원복 — backfill-subjects-from-department.mjs 가 남긴 로그의 `before` 값으로 되돌린다.
//
//   node scripts/staff-roster-import/revert-subjects-backfill.mjs logs/subjects-backfill-<ts>.json           # 드라이런
//   node scripts/staff-roster-import/revert-subjects-backfill.mjs logs/subjects-backfill-<ts>.json --apply   # 적용
//
// 백필 이후 사람이 손으로 과목을 바꿨다면 그 값이 진실이므로 **현재 값이 after와 다르면 건너뛴다**(수기 수정 보호).
import { readFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes("--apply");
const argPath = process.argv.slice(2).find((a) => a !== "--apply");
if (!argPath) {
  console.error("사용법: node revert-subjects-backfill.mjs logs/subjects-backfill-<ts>.json [--apply]");
  process.exit(1);
}
const logPath = isAbsolute(argPath) ? argPath : join(process.cwd(), argPath);

const env = Object.fromEntries(
  readFileSync(join(HERE, "../../.env.local"), "utf-8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const SB_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const H = {
  apikey: env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json",
};
const api = async (path, init) => {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init?.headers ?? {}) } });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
};

const same = (a, b) => JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
const { changes } = JSON.parse(readFileSync(logPath, "utf-8"));
console.log(`\n=== 담당 과목 백필 원복 ${APPLY ? "[적용]" : "[드라이런]"} — ${changes.length}건 ===`);

let done = 0;
let skip = 0;
for (const c of changes) {
  const [cur] = await api(`users?id=eq.${c.id}&select=id,display_name,subjects`);
  if (!cur) {
    console.log(`  ? ${c.name} — 직원 없음(삭제됨) 건너뜀`);
    skip++;
    continue;
  }
  if (!same(cur.subjects, c.after)) {
    console.log(`  ! ${c.name} — 백필 후 수정됨(현재 ${JSON.stringify(cur.subjects)}) 건너뜀`);
    skip++;
    continue;
  }
  console.log(`  - ${c.name} ${JSON.stringify(c.after)} → ${JSON.stringify(c.before)}`);
  if (APPLY) await api(`users?id=eq.${c.id}`, { method: "PATCH", body: JSON.stringify({ subjects: c.before }) });
  done++;
}
console.log(`\n${APPLY ? "원복 완료" : "원복 예정"} ${done}건 · 건너뜀 ${skip}건`);
if (!APPLY) console.log("적용하려면 --apply 를 붙이세요.");
