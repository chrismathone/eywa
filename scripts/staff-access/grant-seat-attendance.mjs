// 🔴 2026-10-06: 원장 지시로 개인별 메뉴 권한을 전부 거뒀다 — 이 스크립트를 다시 돌리면 그때의 명단이 되살아난다.
//    다시 줄 땐 학원 설정 → 역할·권한 → 개인별 메뉴 권한에서 원장이 직접 준다(docs/decisions/staff.md).
// 랩실·JJ실 출석부(seat_attendance) — 자리 담당자 개인 예외 부여(원장 지시 2026-08-14
//   "랩실 아르바이트 선생님이 출결 체크").
//   드라이런: node scripts/staff-access/grant-seat-attendance.mjs --tenant cs
//   적용:     node scripts/staff-access/grant-seat-attendance.mjs --tenant cs --apply
//   회수:     node scripts/staff-access/grant-seat-attendance.mjs --tenant cs --revoke --apply
// 🔴 --tenant 필수(2026-09-22) — 지점이 둘 이상이라 '첫 설정 행'을 집으면 남의 지점 권한을 고친다(_tenant-arg.mjs).
//
// 🔴 역할 승격이 아니라 **개인 예외**다. viewer를 teacher/admin으로 올리면 급여·직원명부·담임
//    드롭다운·알림 수신자에 따라 붙는다(LAB 가짜 강사 사고와 같은 종류).
// 🔴 이 예외는 `seat_attendance` **한 키만** 연다 — 출석부(attendance) 전체가 아니라 자리 화면뿐이고,
//    서버는 그 위에 "그날 그 자리 명단에 있는 학생만" 화이트리스트를 한 겹 더 건다.
// ⚠️ 반영 시점: tenant_settings 캐시가 있어 즉시 안 보일 수 있다(재로그인·다음 배포 후 확실).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tenantSlugArg, resolveTenantSettingsRow } from "./_tenant-arg.mjs";
const HERE = dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes("--apply");
const REVOKE = process.argv.includes("--revoke");
const TENANT_SLUG = tenantSlugArg();
const env = Object.fromEntries(
  readFileSync(join(HERE, "../../.env.local"), "utf-8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    // ⚠️ .env.local의 값은 따옴표로 감싸여 있을 수 있다 — 벗기지 않으면 URL 파싱이 깨진다.
    .map((l) => [
      l.slice(0, l.indexOf("=")).trim(),
      l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, ""),
    ]),
);
const SB = env.NEXT_PUBLIC_SUPABASE_URL;
const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" };

// 이주희 — viewer / 직급 'LAP실 아르바이트'(활성). 랩실 자리 담당.
const SEAT_STAFF = [{ id: "771473c9-7b6d-49f8-9080-172d0e10bc47", name: "이주희" }];
const MENU = "seat_attendance";

const { row: ts } = await resolveTenantSettingsRow(SB, H, TENANT_SLUG);
const perms = ts.data.permissions ?? {};
const ids = new Set(SEAT_STAFF.map((s) => s.id));
const cur = (perms.userOverrides ?? []).filter((o) => !(ids.has(o.userId) && o.menu === MENU));
const next = REVOKE ? cur : [...cur, ...SEAT_STAFF.map((s) => ({ userId: s.id, menu: MENU, access: "full" }))];

console.log(REVOKE ? "회수 예정" : "부여 예정", `— ${SEAT_STAFF.map((s) => s.name).join(", ")} / ${MENU} full`);
console.log("기존 userOverrides:", JSON.stringify(perms.userOverrides ?? []));
console.log("적용 후 userOverrides:", JSON.stringify(next));
if (!APPLY) { console.log("(드라이런 — --apply로 실행)"); process.exit(0); }

const r = await fetch(`${SB}/rest/v1/tenant_settings?tenant_id=eq.${ts.tenant_id}`, {
  method: "PATCH", headers: H,
  body: JSON.stringify({ data: { ...ts.data, permissions: { ...perms, userOverrides: next } } }),
});
if (!r.ok) throw new Error(`저장 실패 ${r.status} ${await r.text()}`);
await fetch(`${SB}/rest/v1/audit_logs`, { method: "POST", headers: H, body: JSON.stringify({
  tenant_id: ts.tenant_id, actor_name: "system:grant-seat-attendance", action: "owner_settings_update",
  target_type: "tenant_settings", target_label: "permissions",
  metadata: { note: `랩실·JJ실 출석부(${MENU}) ${SEAT_STAFF.map((s) => s.name).join(", ")} 개인 예외 ${REVOKE ? "회수" : "부여"}(원장 지시 2026-08-14)` },
}) });
console.log("적용 완료 ✓");
