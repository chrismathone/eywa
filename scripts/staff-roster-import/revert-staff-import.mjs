// 직원명부 이관 원복 스크립트 — import-staff-from-roster.mjs --apply가 남긴 로그를 그대로 되돌린다.
//   node scripts/staff-roster-import/revert-staff-import.mjs logs/import-<ts>.json          # 드라이런
//   node scripts/staff-roster-import/revert-staff-import.mjs logs/import-<ts>.json --apply  # 실제 원복
//
// 되돌리는 것: ① 생성된 계정(auth + public.users) 삭제 ② 병합 때 보강한 필드를 이전 값(대부분 null)으로 복원.
// ⚠️ 생성된 계정으로 이미 로그인·데이터 입력이 있었으면 삭제 전에 반드시 확인할 것.
import { readFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes("--apply");
const logArg = process.argv[2];
if (!logArg || logArg.startsWith("--")) throw new Error("사용법: node revert-staff-import.mjs <로그파일> [--apply]");
const logPath = isAbsolute(logArg) ? logArg : join(process.cwd(), logArg);
const log = JSON.parse(readFileSync(logPath, "utf-8"));

const env = Object.fromEntries(
  readFileSync(join(HERE, "../../.env.local"), "utf-8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const SB_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };

async function main() {
  console.log(`=== 이관 원복 (${APPLY ? "⚠️ 적용 모드" : "드라이런"}) — ${log.ranAt} 이관분 ===\n`);
  console.log(`삭제 대상 계정 ${log.created.length}개:`);
  for (const c of log.created) console.log(`  ${c.name} (${c.email}) ${c.userId}`);
  const restores = log.merged.filter((m) => Object.keys(m.fill ?? {}).length > 0);
  console.log(`\n보강 복원 대상 ${restores.length}명:`);
  for (const m of restores)
    console.log(`  ${m.name}: ${Object.keys(m.fill).map((k) => `${k}→${m.prev[k] ?? "null"}`).join(", ")}`);
  if (!APPLY) {
    console.log("\n드라이런 종료 — 변경 없음. 실제 원복은 --apply.");
    return;
  }

  for (const c of log.created) {
    const a = await fetch(`${SB_URL}/auth/v1/admin/users/${c.userId}`, { method: "DELETE", headers: H });
    // deleteUser는 public.users를 안 지우는 경우가 있어(트리거 정책) 양쪽 명시 삭제.
    const u = await fetch(`${SB_URL}/rest/v1/users?id=eq.${c.userId}`, { method: "DELETE", headers: H });
    console.log(`  ${a.ok || u.ok ? "✓" : "✗"} 삭제 ${c.name} (auth ${a.status} / users ${u.status})`);
  }
  for (const m of restores) {
    const res = await fetch(`${SB_URL}/rest/v1/users?id=eq.${m.userId}`, {
      method: "PATCH",
      headers: H,
      body: JSON.stringify(m.prev),
    });
    console.log(`  ${res.ok ? "✓" : "✗"} 복원 ${m.name} (${res.status})`);
  }
  await fetch(`${SB_URL}/rest/v1/audit_logs`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({
      tenant_id: log.tenantId,
      actor_id: null,
      actor_name: "직원명부 이관 스크립트",
      action: "staff_roster_import_revert",
      target_type: "users",
      target_label: `계정 삭제 ${log.created.length} · 보강 복원 ${restores.length}`,
      metadata: { revertedLog: logPath },
    }),
  });
  console.log("\n원복 완료.");
}

main().catch((e) => {
  console.error("실패:", e.message);
  process.exit(1);
});
