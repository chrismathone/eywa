// 이관 2차 원복 — phase2-skipped-and-resumes.mjs --apply 로그를 되돌린다.
//   node scripts/staff-roster-import/revert-phase2.mjs logs/phase2-<ts>.json [--apply]
// 되돌리는 것: ① 생성한 이력서 문서 삭제 ② 추가한 users 행 삭제(계정 없음 — public만).
import { readFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes("--apply");
const logArg = process.argv[2];
if (!logArg || logArg.startsWith("--")) throw new Error("사용법: node revert-phase2.mjs <로그파일> [--apply]");
const log = JSON.parse(readFileSync(isAbsolute(logArg) ? logArg : join(process.cwd(), logArg), "utf-8"));

const env = Object.fromEntries(
  readFileSync(join(HERE, "../../.env.local"), "utf-8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const SB_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` };

async function main() {
  console.log(`=== 2차 원복 (${APPLY ? "⚠️ 적용" : "드라이런"}) — 이력서 ${log.createdResumes.length}건 · 직원 행 ${log.addedUsers.length}건 ===`);
  for (const c of log.createdResumes) console.log(`  이력서 삭제 예정: ${c.name} (${c.docId})`);
  for (const a of log.addedUsers) console.log(`  직원 행 삭제 예정: ${a.name} (${a.userId})`);
  if (!APPLY) {
    console.log("드라이런 종료 — 변경 없음.");
    return;
  }
  for (const c of log.createdResumes) {
    const r = await fetch(`${SB_URL}/rest/v1/academy_documents?id=eq.${c.docId}`, { method: "DELETE", headers: H });
    console.log(`  ${r.ok ? "✓" : "✗"} 이력서 삭제 ${c.name} (${r.status})`);
  }
  for (const a of log.addedUsers) {
    const r = await fetch(`${SB_URL}/rest/v1/users?id=eq.${a.userId}`, { method: "DELETE", headers: H });
    console.log(`  ${r.ok ? "✓" : "✗"} 직원 행 삭제 ${a.name} (${r.status})`);
  }
  console.log("원복 완료.");
}
main().catch((e) => {
  console.error("실패:", e.message);
  process.exit(1);
});
