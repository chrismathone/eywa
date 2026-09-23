// 성적관리(exams) 메뉴 열기 — 강사는 담임·부담임 반만, 부원장·관리자는 모든 반.
//
// 원장 2026-09-23: *"성적관리는 자기가 담임, 부담임반으로 되어있으면 나오고 부원장 관리자 직급은
// 모든반 볼 수있도록 수정해서 메뉴 오픈하자"*.
//
// 무엇을 바꾸나 — tenant_settings.data.permissions.overrides 에서
//   · `exams` 역할 override **6줄을 걷어낸다**(master·admin·manager·teacher·counselor·viewer 전부 none).
//     그러면 코드 기본값이 산다: master/admin/manager full · teacher scoped · counselor full · viewer readonly.
//   · 대신 `{exams, viewer→none}` **한 줄만 남긴다**. viewer 계정이 아르바이트·청소용역이라
//     성적 전건 열람은 의도가 아니다(원장 지시에도 viewer는 없었다). 되돌리려면 이 줄만 지우면 된다.
//
// 🔑 **"자기 반만"은 여기서 정하지 않는다** — 메뉴는 이 스크립트가 열고, 무엇이 보이는지는
//    [`src/features/grades/server/teacher-classes.ts`](담임 ∪ 부담임)와 `getGradeSheet`가 정한다.
//    둘 중 하나만 있으면 안 된다: 권한만 열면 과목 전체가 보이고, 필터만 넣으면 메뉴가 안 열린다.
//
// ⚠️ 반영 시점: tenant_settings는 서버에서 캐시된다(B6 unstable_cache) — DB만 바꾸면 **다음 배포
//    (또는 owner 콘솔 저장의 updateTag)까지 앱에 안 보일 수 있다**. 이 작업은 코드 배포와 함께 나간다.
// ⚠️ 부원장은 **직급이 아니라 역할로** 갈린다 — 실측 2026-09-23: 허은진·정유진 둘 다 `admin`이다.
//    직급(job_title)으로 판정하면 직급 이름이 바뀔 때 조용히 끊긴다.
//
// 사용:
//   node scripts/staff-access/open-exams-menu.mjs            # 드라이런
//   node scripts/staff-access/open-exams-menu.mjs --apply
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tenantSlugArg, resolveTenantSettingsRow } from "./_tenant-arg.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes("--apply");
const TENANT_SLUG = tenantSlugArg();

// ⚠️ 값의 감싸는 따옴표는 벗긴다 — 안 벗기면 URL이 `"https://…"`가 돼 fetch가 죽는다(narrow-staff-menu 선례).
const env = Object.fromEntries(
  readFileSync(join(HERE, "../../.env.local"), "utf-8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [
      l.slice(0, l.indexOf("=")).trim(),
      l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, ""),
    ]),
);
const SB = env.NEXT_PUBLIC_SUPABASE_URL;
const H = {
  apikey: env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json",
};

const MENU = "exams";
/** 걷어낸 뒤 **다시 넣는** 줄 — viewer만 잠근다(위 주석). */
const KEEP = [{ menu: MENU, role: "viewer", access: "none" }];

async function rest(path, init) {
  const res = await fetch(`${SB}/rest/v1/${path}`, { headers: H, ...init });
  const body = await res.text();
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}: ${body.slice(0, 300)}`);
  return body ? JSON.parse(body) : null;
}

const { row } = await resolveTenantSettingsRow(SB, H, TENANT_SLUG);
const perms = row.data?.permissions ?? { overrides: [] };
const overrides = Array.isArray(perms.overrides) ? perms.overrides : Object.values(perms.overrides ?? {});

const before = overrides.filter((o) => o.menu === MENU);
const nextOverrides = [...overrides.filter((o) => o.menu !== MENU), ...KEEP];
const nextPerms = { ...perms, overrides: nextOverrides };

console.log(`학원: ${row.tenant_id}`);
console.log(`  이전(${MENU}): ${JSON.stringify(before)}`);
console.log(`  이후(${MENU}): ${JSON.stringify(KEEP)}`);
console.log(
  "\n결과 — 성적관리: 원장·관리자·매니저 = 모든 반 · 강사 = 담임·부담임 반만 · 상담사 = 모든 반 · 뷰어·회계 = 차단",
);

if (!APPLY) {
  console.log("\n드라이런 — 변경 없음. 적용은 --apply.");
  process.exit(0);
}

const ts = new Date().toISOString().replace(/[:.]/g, "-");
const logDir = join(HERE, "logs");
mkdirSync(logDir, { recursive: true });
writeFileSync(
  join(logDir, `open-exams-menu-${ts}.json`),
  JSON.stringify({ tenantId: row.tenant_id, before: perms, after: nextPerms }, null, 2),
);

await rest(`tenant_settings?tenant_id=eq.${row.tenant_id}`, {
  method: "PATCH",
  body: JSON.stringify({ data: { ...row.data, permissions: nextPerms } }),
});

// 감사 로그 — owner 콘솔 저장과 같은 이벤트명(best-effort).
try {
  await rest(`audit_logs`, {
    method: "POST",
    body: JSON.stringify({
      tenant_id: row.tenant_id,
      actor_name: "system:open-exams-menu",
      action: "owner_settings_update",
      target_type: "tenant_settings",
      target_label: "권한 — 성적관리 열기",
      metadata: { menu: MENU, before, after: KEEP },
    }),
  });
} catch (e) {
  console.warn("감사 로그 기록 실패(무시):", String(e).slice(0, 120));
}

console.log("\n적용 완료.");
