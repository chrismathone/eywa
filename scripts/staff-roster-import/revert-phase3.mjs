// 이관 3차 원복 — phase3-backfill-resume-fields.mjs --apply 로그의 이전 form_data로 되돌린다.
//   node scripts/staff-roster-import/revert-phase3.mjs logs/phase3-<ts>.json [--apply]
// ⚠️ 백필 이후 화면에서 수기 수정한 이력서는 그 수정까지 함께 사라진다(문서 전체 복원) — 적용 전 확인.
import { readFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes("--apply");
const logArg = process.argv[2];
if (!logArg || logArg.startsWith("--")) throw new Error("사용법: node revert-phase3.mjs <로그파일> [--apply]");
const log = JSON.parse(readFileSync(isAbsolute(logArg) ? logArg : join(process.cwd(), logArg), "utf-8"));

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

async function main() {
  console.log(`=== 3차 백필 원복 (${APPLY ? "⚠️ 적용" : "드라이런"}) — ${log.updated.length}건 ===`);
  for (const u of log.updated) console.log(`  ${u.name} ← ${u.changes.join(", ")} 이전으로`);
  if (!APPLY) {
    console.log("드라이런 종료 — 변경 없음.");
    return;
  }
  for (const u of log.updated) {
    const res = await fetch(`${SB_URL}/rest/v1/academy_documents?id=eq.${u.docId}`, {
      method: "PATCH",
      headers: H,
      body: JSON.stringify({ form_data: u.prevFormData, updated_at: new Date().toISOString() }),
    });
    console.log(`  ${res.ok ? "✓" : "✗"} ${u.name} (${res.status})`);
  }
  console.log("원복 완료.");
}
main().catch((e) => {
  console.error("실패:", e.message);
  process.exit(1);
});
