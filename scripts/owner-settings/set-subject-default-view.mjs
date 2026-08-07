// 과목의 '처음 보이는 시간표 뷰'(subjects[].defaultView)를 설정한다.
// 원장 지시 2026-08-06: *"영어과목 뷰 디폴트값을 통합뷰로 해줘. 기본뷰는 영어에서 잘 안쓰거든."*
//
//   node scripts/owner-settings/set-subject-default-view.mjs english integrated          # 드라이런
//   node scripts/owner-settings/set-subject-default-view.mjs english integrated --apply  # 적용
//
// 화면(학원 설정 → 운영 → 과목)에서도 같은 값을 고를 수 있다 — 이 스크립트는 최초 1회 세팅용.
// ⚠️ tenant_settings는 서버에서 캐시된다(B6 unstable_cache) — DB만 바꾸면 **다음 배포(또는 owner 콘솔
//    저장의 updateTag)까지 앱에 안 보일 수 있다**(narrow-staff-menu.mjs와 같은 함정, 2026-08-03 실측).
// ⚠️ 읽기-수정-쓰기라 **다른 세션이 같은 순간 설정을 저장하면 덮어쓸 수 있다** — 실행 직전 콘솔 저장이
//    없었는지 확인하고, 드라이런 출력의 '변경 전' 값이 예상과 같은지 보고 적용할 것.
// 쓰기는 service_role(0038a master-guard 트리거는 auth.uid() null → 통과 — 정당한 운영 경로).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes("--apply");
const [subjectKey, view] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const VIEWS = ["basic", "integrated", "teacher"];
if (!subjectKey || !VIEWS.includes(view)) {
  console.error(`사용법: node scripts/owner-settings/set-subject-default-view.mjs <과목키> <${VIEWS.join("|")}> [--apply]`);
  process.exit(1);
}

const env = Object.fromEntries(
  readFileSync(join(HERE, "../../.env.local"), "utf-8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    // ⚠️ 값이 따옴표로 감싸여 있을 수 있다(.env.local 관례) — 안 벗기면 URL 파싱이 깨진다.
    .map((l) => [
      l.slice(0, l.indexOf("=")).trim(),
      l.slice(l.indexOf("=") + 1).trim().replace(/^["'](.*)["']$/, "$1"),
    ]),
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

const rows = await rest(`tenant_settings?select=tenant_id,data`);
if (!rows?.length) throw new Error("tenant_settings 행이 없다");
if (rows.length > 1) throw new Error(`테넌트가 ${rows.length}개 — 이 스크립트는 단일 테넌트 전제다`);
const row = rows[0];
const subjects = row.data?.operations?.subjects;
if (!Array.isArray(subjects)) throw new Error("operations.subjects 배열이 없다");

const hit = subjects.filter((s) => s.key === subjectKey);
if (hit.length !== 1) throw new Error(`과목키 '${subjectKey}' 매칭 ${hit.length}개 — 1개여야 진행`);

console.log("=== 변경 전 (전 과목) ===");
for (const s of subjects) console.log(`  ${s.key.padEnd(12)} ${String(s.label).padEnd(10)} defaultView=${s.defaultView ?? "(미설정=기본뷰)"}`);

const nextSubjects = subjects.map((s) => (s.key === subjectKey ? { ...s, defaultView: view } : s));
const already = hit[0].defaultView === view;
console.log(`\n=== 계획 ===\n  ${subjectKey}: ${hit[0].defaultView ?? "(미설정)"} → ${view}${already ? "  (이미 같음 — 무동작)" : ""}`);

if (!APPLY) {
  console.log("\n드라이런입니다. 적용하려면 --apply 를 붙이세요.");
  process.exit(0);
}
if (already) {
  console.log("이미 반영돼 있어 쓰지 않습니다.");
  process.exit(0);
}

// 되돌릴 수 있게 이전 subjects 배열을 통째로 보존
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const logPath = join(HERE, `../../logs/set-subject-default-view-${stamp}.json`);
mkdirSync(dirname(logPath), { recursive: true });
writeFileSync(logPath, JSON.stringify({ tenant_id: row.tenant_id, subjectKey, view, before: subjects }, null, 2));
console.log(`이전 값 보존: ${logPath}`);

// ⚠️ operations 전체가 아니라 subjects만 갈아끼운 operations를 쓴다(다른 운영 설정 보존).
const nextData = { ...row.data, operations: { ...row.data.operations, subjects: nextSubjects } };
await rest(`tenant_settings?tenant_id=eq.${row.tenant_id}`, {
  method: "PATCH",
  headers: { ...H, Prefer: "return=minimal" },
  body: JSON.stringify({ data: nextData }),
});

const [after] = await rest(`tenant_settings?select=data&tenant_id=eq.${row.tenant_id}`);
const got = after.data.operations.subjects.find((s) => s.key === subjectKey)?.defaultView;
console.log(`\n적용 완료 — 재조회 defaultView=${got}${got === view ? " ✔" : " ❌ 불일치"}`);
console.log("⚠️ 서버 캐시 때문에 다음 배포(또는 owner 콘솔 저장) 전엔 화면에 안 보일 수 있습니다.");
