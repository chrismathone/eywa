// narrow-staff-menu 원복 — 적용 시 저장한 로그의 before 스냅샷으로 permissions 섹션을 되돌린다.
//   node scripts/staff-access/revert-narrow-staff-menu.mjs logs/narrow-staff-menu-<ts>.json          # 드라이런
//   node scripts/staff-access/revert-narrow-staff-menu.mjs logs/narrow-staff-menu-<ts>.json --apply  # 적용
// ⚠️ 로그 시점 이후 원장이 역할·권한 면에서 저장했다면 그 변경도 함께 되돌아간다(섹션 통째 복원) —
//    적용 전에 아래 diff 출력을 확인할 것.
import { readFileSync } from "node:fs";
import { dirname, join, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes("--apply");
const logArg = process.argv[2];
if (!logArg || logArg.startsWith("--")) throw new Error("사용법: revert-narrow-staff-menu.mjs <로그파일> [--apply]");
const logPath = isAbsolute(logArg) ? logArg : join(process.cwd(), logArg);
const log = JSON.parse(readFileSync(logPath, "utf-8"));

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

async function rest(path, init) {
  const res = await fetch(`${SB}/rest/v1/${path}`, { headers: H, ...init });
  const body = await res.text();
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}: ${body.slice(0, 300)}`);
  return body ? JSON.parse(body) : null;
}

const [row] = await rest(`tenant_settings?select=tenant_id,data&tenant_id=eq.${log.tenantId}`);
if (!row) throw new Error(`tenant_settings ${log.tenantId} 행이 없다`);

console.log("현재 permissions:", JSON.stringify(row.data?.permissions ?? null).slice(0, 400));
console.log("복원 대상(before):", JSON.stringify(log.before).slice(0, 400));

if (!APPLY) {
  console.log("\n드라이런 — 변경 없음. 적용은 --apply.");
  process.exit(0);
}

await rest(`tenant_settings?tenant_id=eq.${log.tenantId}`, {
  method: "PATCH",
  body: JSON.stringify({ data: { ...row.data, permissions: log.before } }),
});
console.log("원복 완료 — permissions 섹션을 로그의 before로 되돌렸다.");
