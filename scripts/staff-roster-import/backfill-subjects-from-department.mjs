// 담당 과목 백필(원장 지시 2026-07-29) — 부서와 과목은 같은 축인데 두 번 입력해야 했던 문제의 데이터 정리.
//   users.department 에서 담당 과목을 도출해 **subjects가 비어 있는 직원만** 채운다.
//   ('영어과'→영어 · '수학과'→수학 · '국어과'→국어 · '수학/과학과'→수학·과학 / EIE·경영팀·차량팀 등은 대상 아님)
//
//   node scripts/staff-roster-import/backfill-subjects-from-department.mjs            # 드라이런
//   node scripts/staff-roster-import/backfill-subjects-from-department.mjs --apply    # 적용
//
// 과목 목록은 코드에 박지 않는다 — tenant_settings.operations.subjects 라벨을 읽어 매칭(운영 enum 단일 소스).
// **이미 과목이 있는 직원은 절대 안 건드린다**(겸임 수동 지정 보존). 학생 계정 제외.
// 원복: logs/subjects-backfill-<ts>.json 에 직원별 이전 subjects 보존.
//   node scripts/staff-roster-import/revert-subjects-backfill.mjs logs/subjects-backfill-<ts>.json --apply
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
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
const SB_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const H = {
  apikey: env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json",
};

const api = async (path, init) => {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init?.headers ?? {}) } });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
};

/** 부서명에 이름이 들어간 과목 key — src/features/staff/department/department-subjects.ts 와 같은 규칙(1글자 라벨 무시). */
function subjectsFromDepartment(department, options) {
  const dept = (department ?? "").trim();
  if (!dept) return [];
  const keys = [];
  for (const o of options) {
    const label = (o.label ?? "").trim();
    if (label.length < 2 || !dept.includes(label)) continue;
    if (!keys.includes(o.key)) keys.push(o.key);
  }
  return keys;
}

const settings = await api("tenant_settings?select=tenant_id,data");
const users = await api(
  "users?select=id,tenant_id,display_name,department,subjects,system_role,status&system_role=neq.student&limit=2000",
);

const optionsByTenant = new Map(
  settings.map((r) => [r.tenant_id, (r.data?.operations?.subjects ?? []).map((s) => ({ key: s.key, label: s.label }))]),
);

const plan = [];
const skipped = { 부서없음: 0, 교과아님: 0, 이미있음: 0 };
for (const u of users) {
  const options = optionsByTenant.get(u.tenant_id) ?? [];
  const derived = subjectsFromDepartment(u.department, options);
  const has = Array.isArray(u.subjects) && u.subjects.length > 0;
  if (!u.department) skipped.부서없음++;
  else if (derived.length === 0) skipped.교과아님++;
  else if (has) skipped.이미있음++;
  else
    plan.push({
      id: u.id,
      name: u.display_name,
      status: u.status,
      department: u.department,
      before: u.subjects ?? [],
      after: derived,
      labels: derived.map((k) => options.find((o) => o.key === k)?.label ?? k),
    });
}

console.log(`\n=== 담당 과목 백필 ${APPLY ? "[적용]" : "[드라이런]"} ===`);
console.log(`대상 ${plan.length}명 / 검사 ${users.length}명`);
for (const p of plan) {
  console.log(`  + ${p.name.padEnd(6)} ${String(p.department).padEnd(10)} → ${p.labels.join("·")} (${p.status})`);
}
console.log(
  `\n건너뜀 — 부서 없음 ${skipped.부서없음} · 교과 부서 아님 ${skipped.교과아님} · 이미 과목 있음 ${skipped.이미있음}`,
);

if (!APPLY) {
  console.log("\n적용하려면 --apply 를 붙여 다시 실행하세요.");
  process.exit(0);
}
if (plan.length === 0) {
  console.log("\n변경할 대상이 없습니다.");
  process.exit(0);
}

const logDir = join(HERE, "logs");
if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const logPath = join(logDir, `subjects-backfill-${stamp}.json`);
writeFileSync(logPath, JSON.stringify({ at: new Date().toISOString(), changes: plan }, null, 2), "utf-8");
console.log(`\n원복 로그: ${logPath}`);

let ok = 0;
for (const p of plan) {
  await api(`users?id=eq.${p.id}`, { method: "PATCH", body: JSON.stringify({ subjects: p.after }) });
  ok++;
}
console.log(`적용 완료: ${ok}명`);
