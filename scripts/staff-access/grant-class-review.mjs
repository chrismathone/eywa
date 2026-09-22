// 수업 평가 체크리스트(class_review) 접근 개방 — 테스트 단계 명단 관리(원장 지시).
//   node scripts/staff-access/grant-class-review.mjs --tenant cs            # 드라이런(현재↔목표 비교만)
//   node scripts/staff-access/grant-class-review.mjs --tenant cs --apply     # 적용
//   node scripts/staff-access/grant-class-review.mjs --tenant cs --revoke --apply  # 아래 명단 전부 회수(코드 기본값=전원 차단으로 복귀)
// 🔴 --tenant 필수(2026-09-22) — 지점이 둘 이상이라 '첫 설정 행'을 집으면 남의 지점 권한을 고친다(_tenant-arg.mjs).
//
// 코드 기본값(permissions.ts MENU_ACCESS.class_review)은 **전 역할 none** — 테스트 단계라 일부러 닫아 뒀다.
// 그래서 개방은 전부 tenant_settings 데이터로만 한다(배포 불필요):
//   · 원장직급 = **역할 override**(permissions.overrides) — master 전원.
//   · 개인 = **개인 예외**(permissions.userOverrides) — "같은 역할인데 이 사람만"의 정석(CLAUDE.md 결정 로그).
//     ⚠️ 정유진·김동후는 admin, 송지혜는 manager다. 역할로 열면 그 역할 전원(오은진·설현·김예원 등)이
//     따라 열리므로 **개인 예외로만** 준다. 명단을 늘릴 땐 GRANTEES에 한 줄 추가.
//
// 개인 예외는 `full`이라 CRUD 전부 + **실명 열람·문항 세트 편집**까지 열린다(getReviewPrivileges) —
// 익명화(평가자 A/B/C)가 풀리는 것이니 명단은 필요한 사람만.
//
// ⚠️ 반영 시점: tenant_settings 캐시 TTL 300초 → **최대 5분 내 자동 반영**(배포 불필요, 로그아웃 불필요).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tenantSlugArg, resolveTenantSettingsRow } from "./_tenant-arg.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes("--apply");
const REVOKE = process.argv.includes("--revoke");
const TENANT_SLUG = tenantSlugArg();
const MENU = "class_review";

/** 개인 예외 대상 — 이름은 감사로그·출력용, 판정은 id. */
const GRANTEES = [
  { id: "477950d4-9cb0-4c02-9ac4-f00d42754d55", name: "이승엽", note: "개발팀 대리(2026-08-04 최초 개방)" },
  { id: "d3e9bcd1-f30e-4f5b-9e78-2ad509f1d06b", name: "정유진", note: "영어과 부원장(2026-08-13 테스트)" },
  { id: "64aafc9c-aed3-4be3-8d24-899a20498eb9", name: "김동후", note: "영어과 교수부장(2026-08-13 테스트)" },
  // ⚠️ 동명이인 주의 — '오은진'(admin)이 아니라 **허은진**(수학과 부원장·경영팀)이다(원장 지시 2026-08-14).
  { id: "deff8b0b-29cf-461e-8eea-a6196dc2a126", name: "허은진", note: "수학과 부원장·경영팀(2026-08-14 테스트)" },
  { id: "8bb70f71-a8c3-450c-9236-561e9b43ca4f", name: "김예원", note: "데스크 admin(2026-08-21 원장 지시로 추가)" },
];
/**
 * 명단에서 **빠진** 사람 — 아래에 두면 이 스크립트가 매번 회수 대상으로 잡아 되살아나지 않는다.
 * (GRANTEES에서 지우기만 하면 이미 저장된 예외가 그대로 남아 조용히 계속 열려 있다.)
 */
const REVOKED = [
  { id: "04a91fe9-f353-49f2-b5bb-4190d7b034d9", name: "송지혜", note: "강사 — 2026-08-14 원장 지시로 제외" },
];
/**
 * 역할 개방 — 원장직급(master). 코드 기본값이 none이라 이 행이 없으면 원장도 메뉴에 못 들어간다.
 *
 * **강사(teacher) = `scoped`**(원장 지시 2026-08-19: *"강사직급의 경우 … 자기자신 평가만 할 수 있도록"*).
 * 강사에게 열어도 남의 평가지·평가자 점수는 **코드가 조회 초크포인트에서 잘라 낸다**
 * ([`self-only.ts`](../../src/features/class-review/self-only.ts) — 목록·상세·채점·생성·삭제 전부):
 * 보이는 것은 **본인 평가지의 본인 채점 한 장**뿐이고 실명 열람·문항 편집·종합 보기는 직급으로 막힌다.
 * ⚠️ 그래서 강사만은 개인 예외가 아니라 **역할로** 연다(전 강사가 자기 것만 쓰는 게 목적).
 * 되돌리기 = 이 줄을 지우고 `--apply`(그 역할 override만 걷힌다).
 */
const ROLE_GRANTS = [
  { role: "master", access: "full" },
  { role: "teacher", access: "scoped" },
];

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

const { row: ts } = await resolveTenantSettingsRow(SB, H, TENANT_SLUG);
const perms = ts.data.permissions ?? {};

// class_review 행만 걷어내고 다시 쌓는다 — 다른 메뉴 override는 절대 건드리지 않는다.
// 걷어내는 대상은 GRANTEES + REVOKED 둘 다이고, 다시 쌓는 건 GRANTEES뿐이라 REVOKED는 지워진다.
const MANAGED = [...GRANTEES, ...REVOKED];
const keepUser = (perms.userOverrides ?? []).filter(
  (o) => !(o.menu === MENU && MANAGED.some((g) => g.id === o.userId)),
);
const keepRole = (perms.overrides ?? []).filter(
  (o) => !(o.menu === MENU && ROLE_GRANTS.some((r) => r.role === o.role)),
);
const nextUser = REVOKE ? keepUser : [...keepUser, ...GRANTEES.map((g) => ({ userId: g.id, menu: MENU, access: "full" }))];
const nextRole = REVOKE ? keepRole : [...keepRole, ...ROLE_GRANTS.map((r) => ({ menu: MENU, role: r.role, access: r.access }))];

const hadUser = new Set((perms.userOverrides ?? []).filter((o) => o.menu === MENU).map((o) => o.userId));
const hadRole = new Set((perms.overrides ?? []).filter((o) => o.menu === MENU).map((o) => o.role));

console.log(`수업 평가(${MENU}) ${REVOKE ? "회수" : "개방"} — tenant ${ts.tenant_id}`);
console.log("\n[역할]");
for (const r of ROLE_GRANTS) {
  console.log(`  ${r.role.padEnd(8)} ${hadRole.has(r.role) ? "이미 열림" : "→ 신규 개방"}${REVOKE ? " (회수)" : ` = ${r.access}`}`);
}
console.log("\n[개인 예외]");
for (const g of GRANTEES) {
  console.log(`  ${g.name}  ${hadUser.has(g.id) ? "이미 열림" : "→ 신규 개방"}${REVOKE ? " (회수)" : ""}  ${g.note}`);
}
for (const g of REVOKED) {
  console.log(`  ${g.name}  ${hadUser.has(g.id) ? "→ 제외(회수)" : "이미 없음"}  ${g.note}`);
}
console.log(`\n적용 후 ${MENU} — 역할 ${nextRole.filter((o) => o.menu === MENU).length}건 / 개인 ${nextUser.filter((o) => o.menu === MENU).length}건`);
console.log(
  `다른 메뉴 override 보존 — 역할 ${keepRole.filter((o) => o.menu !== MENU).length}건 / 개인 ${keepUser.filter((o) => o.menu !== MENU).length}건`,
);

if (!APPLY) {
  console.log("\n(드라이런 — --apply로 실행)");
  process.exit(0);
}

const r = await fetch(`${SB}/rest/v1/tenant_settings?tenant_id=eq.${ts.tenant_id}`, {
  method: "PATCH",
  headers: H,
  body: JSON.stringify({
    data: { ...ts.data, permissions: { ...perms, overrides: nextRole, userOverrides: nextUser } },
  }),
});
if (!r.ok) throw new Error(`저장 실패 ${r.status} ${await r.text()}`);

await fetch(`${SB}/rest/v1/audit_logs`, {
  method: "POST",
  headers: H,
  body: JSON.stringify({
    tenant_id: ts.tenant_id,
    actor_name: "system:grant-class-review",
    action: "owner_settings_update",
    target_type: "tenant_settings",
    target_label: "permissions",
    metadata: {
      note: `수업 평가(class_review) ${REVOKE ? "회수" : "개방"} — 원장직급(master) + 개인 ${GRANTEES.map((g) => g.name).join("·")}(원장 지시 2026-08-13 테스트)`,
      menu: MENU,
      roles: ROLE_GRANTS.map((x) => x.role),
      users: GRANTEES.map((g) => g.name),
      revoke: REVOKE,
    },
  }),
});

// 저장 직후 상태를 되읽어 실제 반영을 확인(눈으로 못 보는 jsonb라 길이까지 확인 — #82류 방지).
const [after] = await (await fetch(`${SB}/rest/v1/tenant_settings?select=data&tenant_id=eq.${ts.tenant_id}`, { headers: H })).json();
const ap = after.data.permissions ?? {};
console.log("\n적용 완료 ✓");
console.log("  역할:", JSON.stringify((ap.overrides ?? []).filter((o) => o.menu === MENU)));
console.log("  개인:", JSON.stringify((ap.userOverrides ?? []).filter((o) => o.menu === MENU)));
console.log("  ⏱  캐시 TTL 300초 — 최대 5분 내 화면 반영(배포·로그아웃 불필요)");
