// 동명 중복 병합 원복 — merge-duplicate-staff.mjs 로그를 그대로 되감는다.
//   ① 삭제했던 행을 **같은 id로** 다시 insert(로그인 계정이 없던 행이라 auth와 무관)
//   ② 옮긴 이력서(academy_documents.staff_user_id)를 되돌린다
//   ③ 남긴 행에 채워 넣은 칸을 병합 전 값으로 복원
//
//   node scripts/staff-roster-import/revert-merge-duplicate.mjs logs/merge-dup-<ts>.json           # 드라이런
//   node scripts/staff-roster-import/revert-merge-duplicate.mjs logs/merge-dup-<ts>.json --apply   # 적용
//
// ⚠️ 병합 후 사람이 그 칸을 다시 손봤다면 그 값이 진실이므로, **현재 값이 병합이 넣은 값과 다르면 그 칸은 건드리지 않는다.**
import { readFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes("--apply");
const arg = process.argv.slice(2).find((a) => a !== "--apply");
if (!arg) {
  console.error("사용법: node revert-merge-duplicate.mjs logs/merge-dup-<ts>.json [--apply]");
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
const api = async (path, init) => {
  const r = await fetch(`${SB}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init?.headers ?? {}) } });
  if (!r.ok) throw new Error(`${init?.method ?? "GET"} ${path} → ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json();
};

const { merges } = JSON.parse(readFileSync(logPath, "utf-8"));
console.log(`\n=== 병합 원복 ${APPLY ? "[적용]" : "[드라이런]"} — ${merges.length}건 ===\n`);

for (const m of merges) {
  console.log(`■ ${m.name}`);
  if (m.deleted) {
    console.log(`   행 복구: ${m.deletedRow.email}`);
    if (APPLY) {
      const exists = await api(`users?select=id&id=eq.${m.deletedRow.id}`);
      if (exists.length === 0) await api("users", { method: "POST", body: JSON.stringify(m.deletedRow) });
    }
  }
  for (const docId of m.movedDocs ?? []) {
    console.log(`   이력서 되돌림: ${docId} → ${m.deletedRow?.id ?? "(원래 행)"}`);
    if (APPLY && m.deletedRow) {
      await api(`academy_documents?id=eq.${docId}`, {
        method: "PATCH",
        body: JSON.stringify({ staff_user_id: m.deletedRow.id }),
      });
    }
  }
  if (m.filled && Object.keys(m.filled).length > 0) {
    const [cur] = await api(`users?select=*&id=eq.${m.keeperId}`);
    const restore = {};
    for (const [k, v] of Object.entries(m.filled)) {
      if (!cur) continue;
      if (JSON.stringify(cur[k]) !== JSON.stringify(v)) {
        console.log(`   ${k}: 병합 후 수정됨 → 건너뜀`);
        continue;
      }
      restore[k] = m.keeperBefore?.[k] ?? null;
    }
    if (Object.keys(restore).length > 0) {
      console.log(`   칸 복원: ${JSON.stringify(restore)}`);
      if (APPLY) await api(`users?id=eq.${m.keeperId}`, { method: "PATCH", body: JSON.stringify(restore) });
    }
  }
}
console.log(APPLY ? "\n원복 완료" : "\n적용하려면 --apply 를 붙이세요.");
