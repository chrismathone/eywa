// 직원관리(/staff)를 원장 2명 + 개발팀 설현·이승엽 4인으로 좁힌다 (원장 지시 2026-08-01).
//
//   tenant_settings.data.permissions 를 이렇게 바꾼다:
//     overrides:      + {staff, admin→none} {staff, manager→none} {staff, accountant→none}
//                     - {staff, counselor, readonly}  (기본값이 none이라 제거만으로 잠김)
//     userOverrides:  + 설현(staff full) + 이승엽(staff full)   ← admin이지만 개별 허용
//   (master 원일·박소선은 기본 full이라 손대지 않는다. teacher·viewer·student는 원래 none.)
//
//   node scripts/staff-access/narrow-staff-menu.mjs            # 드라이런(변경 없음, 계획 출력)
//   node scripts/staff-access/narrow-staff-menu.mjs --apply    # 적용(이전 permissions를 로그로 보존)
//
// ⚠️ 반영 시점: tenant_settings는 서버에서 배포 시점까지 캐시된다(B6 unstable_cache) — 이 스크립트로
//    DB만 바꾸면 **다음 배포(또는 owner 콘솔 저장의 updateTag)까지 앱에 안 보일 수 있다**(2026-08-03 실측:
//    직접 PATCH한 override가 직전 배포 캐시에 가려짐). 적용 후 곧 배포가 없으면 owner 콘솔에서 아무
//    섹션이나 한 번 저장해 캐시를 밀어낼 것.
// ⚠️ 실행 순서: **새 코드(개인 예외 + 계약 admin-client 읽기) 배포 뒤에** 적용할 것 — 옛 코드는
//    userOverrides를 몰라 적용 즉시 설현·이승엽이 잠긴다(역할 override는 옛 코드도 읽는다).
//    0170a SQL은 보류 가능(코드가 계약 읽기를 admin client로 우회) — 접근 복구되면 실행해 DB 잔여 구멍을 닫는다.
// 원복: node scripts/staff-access/revert-narrow-staff-menu.mjs logs/narrow-staff-menu-<ts>.json --apply
//
// 대상 사용자는 이름+역할로 찾되 **정확히 1명씩** 매칭돼야 진행한다(동명이인·오타 방어).
// 쓰기는 service_role(0038a master-guard 트리거는 auth.uid() null → 통과 — 정당한 운영 경로).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes("--apply");

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

// 개인 허용 대상 — 이름·역할이 함께 맞아야 한다.
const GRANTEES = [
  { name: "설현", role: "admin" },
  { name: "이승엽", role: "admin" },
];
// 역할 잠금 대상(코드 기본값이 full인 역할만; counselor는 기존 readonly override 제거로 잠김).
const CLOSE_ROLES = ["admin", "manager", "accountant"];

async function rest(path, init) {
  const res = await fetch(`${SB}/rest/v1/${path}`, { headers: H, ...init });
  const body = await res.text();
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}: ${body.slice(0, 300)}`);
  return body ? JSON.parse(body) : null;
}

// 1) 대상 사용자 해석 — 정확히 1명씩
const users = await rest(`users?select=id,display_name,system_role,status&system_role=neq.student&limit=2000`);
const grants = GRANTEES.map(({ name, role }) => {
  const hits = users.filter((u) => u.display_name === name && u.system_role === role && u.status !== "inactive");
  if (hits.length !== 1) {
    throw new Error(`'${name}'(${role}) 매칭 ${hits.length}명 — 1명이어야 진행. 후보: ${JSON.stringify(hits)}`);
  }
  return { userId: hits[0].id, menu: "staff", access: "full", _name: name };
});

// 2) 현재 설정 로드
const [row] = await rest(`tenant_settings?select=tenant_id,data`);
if (!row) throw new Error("tenant_settings 행이 없다");
const perms = row.data?.permissions ?? { overrides: [] };
const overrides = Array.isArray(perms.overrides) ? perms.overrides : [];
const userOverrides = Array.isArray(perms.userOverrides) ? perms.userOverrides : [];

// 3) 새 값 계산(멱등 — 이미 반영돼 있으면 그대로)
const nextOverrides = [
  // counselor readonly 제거(기본 none으로 복귀), 기존 staff 행은 재구성하므로 걷어냄
  ...overrides.filter((o) => o.menu !== "staff"),
  ...CLOSE_ROLES.map((role) => ({ menu: "staff", role, access: "none" })),
];
const keepOthers = userOverrides.filter((o) => !(o.menu === "staff" && grants.some((g) => g.userId === o.userId)));
const nextUserOverrides = [...keepOthers, ...grants.map(({ _name, ...g }) => g)];

const nextPerms = { ...perms, overrides: nextOverrides, userOverrides: nextUserOverrides };

// 4) 계획 출력
console.log(`테넌트: ${row.tenant_id}`);
console.log(`\n[역할 override] staff 행 변경:`);
console.log(`  이전: ${JSON.stringify(overrides.filter((o) => o.menu === "staff"))}`);
console.log(`  이후: ${JSON.stringify(nextOverrides.filter((o) => o.menu === "staff"))}`);
console.log(`\n[개인 예외] (${nextUserOverrides.length}건):`);
for (const g of grants) console.log(`  + ${g._name} (${g.userId}) — staff: full`);
if (keepOthers.length) console.log(`  (기존 유지 ${keepOthers.length}건)`);
console.log(`\n결과 요약 — 직원관리 접근: master 전원(원일·박소선) + 설현·이승엽 / 그 외 역할 전부 차단`);

if (!APPLY) {
  console.log("\n드라이런 — 변경 없음. 적용은 --apply.");
  process.exit(0);
}

// 5) 적용 — 이전 상태를 로그로 보존 후 PATCH
const ts = new Date().toISOString().replace(/[:.]/g, "-");
const logDir = join(HERE, "logs");
mkdirSync(logDir, { recursive: true });
const logPath = join(logDir, `narrow-staff-menu-${ts}.json`);
writeFileSync(logPath, JSON.stringify({ tenantId: row.tenant_id, before: perms, after: nextPerms, grants }, null, 2));

await rest(`tenant_settings?tenant_id=eq.${row.tenant_id}`, {
  method: "PATCH",
  body: JSON.stringify({ data: { ...row.data, permissions: nextPerms } }),
});

// 감사 로그(있으면 best-effort — saveOwnerSection의 owner_settings_update와 동일 이벤트명)
try {
  await rest(`audit_logs`, {
    method: "POST",
    body: JSON.stringify({
      tenant_id: row.tenant_id,
      actor_name: "system:narrow-staff-menu",
      action: "owner_settings_update",
      target_type: "tenant_settings",
      target_label: "permissions",
      metadata: { via: "script:narrow-staff-menu", grants: grants.map((g) => g._name ?? g.userId) },
    }),
  });
} catch (e) {
  console.warn("audit_logs 기록 실패(무시):", String(e).slice(0, 120));
}

console.log(`\n적용 완료. 이전 상태 로그: ${logPath}`);
console.log("원복: node scripts/staff-access/revert-narrow-staff-menu.mjs " + logPath.replaceAll("\\", "/") + " --apply");
