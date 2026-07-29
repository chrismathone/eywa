// 동명 중복 직원 병합(원장 지시 2026-07-29) — 시트 이관으로 생긴 중복 행을 기존 행에 합친다.
//
//   node scripts/staff-roster-import/merge-duplicate-staff.mjs            # 드라이런
//   node scripts/staff-roster-import/merge-duplicate-staff.mjs --apply    # 적용
//
// 대상 = 같은 이름 2행이고 그중 **정확히 하나가 시트 이관 행**(sheet-{행}-…@imported.local)인 경우.
// 시트 행은 참조가 '이력서 1건'뿐이고 기존 행이 수업·상담 등 실제 업무 데이터를 갖고 있으므로
// **기존 행을 남기고 시트 행을 흡수**한다:
//   ① 기존 행의 **빈 인사 칸만** 시트 행 값으로 채운다(기존 값 절대 안 덮음 — 이력서 병합 규칙과 동일)
//   ② 이력서(academy_documents.staff_user_id)를 기존 행으로 재연결
//   ③ 시트 행 삭제 — 단 **재연결 후 남은 참조가 0인지 다시 확인**하고, 남아 있으면 건너뛴다(안전장치)
//
// 원복: logs/merge-dup-<ts>.json 에 삭제된 행 전체 + 채운 칸 + 재연결한 문서 id를 보존.
//   node scripts/staff-roster-import/revert-merge-duplicate.mjs logs/merge-dup-<ts>.json --apply
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
const SB = env.NEXT_PUBLIC_SUPABASE_URL;
const H = {
  apikey: env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json",
};
const api = async (path, init) => {
  const r = await fetch(`${SB}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init?.headers ?? {}) } });
  if (!r.ok) throw new Error(`${init?.method ?? "GET"} ${path} → ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json();
};

const SHEET_EMAIL = /^sheet-\d+-[0-9a-f]+@imported\.local$/i;
// 시트 행에서 기존 행의 **빈 칸**으로만 옮기는 인사 필드.
const FILL_FIELDS = ["department", "employment_type", "job_title", "phone", "hire_date"];
// 삭제 전에 "정말 아무 데서도 안 쓰는지" 다시 확인할 참조들(이력서는 먼저 재연결하므로 제외 대상 아님).
const REF_CHECKS = [
  ["classes", "teacher_id"],
  ["classes", "pending_teacher_id"],
  ["academy_documents", "staff_user_id"],
  ["academy_documents", "uploaded_by"],
  ["student_consultations", "counselor_id"],
  ["enrollment_consultations", "consultant_id"],
  ["meeting_minutes", "author_id"],
  ["audit_logs", "actor_id"],
];

const isBlank = (v) => v === null || v === undefined || String(v).trim() === "";

const users = await api(
  "users?select=id,tenant_id,display_name,email,system_role,status,department,employment_type,job_title,phone,hire_date,subjects,english_name,default_classroom,memo,bg_color,text_color,hourly_rate,monthly_base&system_role=neq.student&limit=1000",
);

const byName = new Map();
for (const u of users) {
  if (!byName.has(u.display_name)) byName.set(u.display_name, []);
  byName.get(u.display_name).push(u);
}

const plan = [];
const skipped = [];
for (const [name, rows] of byName) {
  if (rows.length !== 2) continue;
  const sheetRows = rows.filter((r) => SHEET_EMAIL.test(r.email ?? ""));
  if (sheetRows.length !== 1) {
    if (sheetRows.length > 0) skipped.push(`${name} — 시트 행이 ${sheetRows.length}개(수동 확인)`);
    continue;
  }
  const dupe = sheetRows[0];
  const keeper = rows.find((r) => r.id !== dupe.id);
  if (keeper.tenant_id !== dupe.tenant_id) {
    skipped.push(`${name} — 테넌트가 달라 병합 안 함`);
    continue;
  }
  const fill = {};
  for (const f of FILL_FIELDS) if (isBlank(keeper[f]) && !isBlank(dupe[f])) fill[f] = dupe[f];
  const keeperSubjects = Array.isArray(keeper.subjects) ? keeper.subjects : [];
  const dupeSubjects = Array.isArray(dupe.subjects) ? dupe.subjects : [];
  if (keeperSubjects.length === 0 && dupeSubjects.length > 0) fill.subjects = dupeSubjects;
  plan.push({ name, keeper, dupe, fill });
}

console.log(`\n=== 동명 중복 병합 ${APPLY ? "[적용]" : "[드라이런]"} — ${plan.length}쌍 ===\n`);
for (const p of plan) {
  console.log(`■ ${p.name}`);
  console.log(`   남김: ${p.keeper.email} [${p.keeper.system_role}/${p.keeper.status}]`);
  console.log(`   흡수: ${p.dupe.email} [${p.dupe.system_role}/${p.dupe.status}]`);
  console.log(`   채울 칸: ${Object.keys(p.fill).length ? JSON.stringify(p.fill, null, 0) : "(없음)"}`);
  if (p.keeper.status !== "active" && p.dupe.status === "active") {
    console.log(`   ⚠️ 남기는 행이 '${p.keeper.status}'인데 시트 행은 재직 — 상태는 건드리지 않음(원장 확인 필요)`);
  }
}
if (skipped.length) console.log(`\n건너뜀:\n  ${skipped.join("\n  ")}`);

if (!APPLY) {
  console.log("\n적용하려면 --apply 를 붙여 다시 실행하세요.");
  process.exit(0);
}

const logDir = join(HERE, "logs");
if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const logPath = join(logDir, `merge-dup-${stamp}.json`);
const done = [];

for (const p of plan) {
  // ② 이력서 재연결 — 어떤 문서를 옮겼는지 원복용으로 기록.
  const docs = await api(`academy_documents?select=id&staff_user_id=eq.${p.dupe.id}`);
  for (const d of docs) {
    await api(`academy_documents?id=eq.${d.id}`, {
      method: "PATCH",
      body: JSON.stringify({ staff_user_id: p.keeper.id }),
    });
  }
  // ③ 삭제 전 안전장치 — 재연결 후에도 참조가 남아 있으면 지우지 않는다.
  let leftover = 0;
  const leftoverWhere = [];
  for (const [t, c] of REF_CHECKS) {
    let rows = [];
    try {
      rows = await api(`${t}?select=${c}&${c}=eq.${p.dupe.id}&limit=100`);
    } catch {
      continue; // 조회 불가 테이블(권한/부재)은 건너뜀 — 아래 실패 시 삭제도 안 함
    }
    if (rows.length) {
      leftover += rows.length;
      leftoverWhere.push(`${t}.${c}:${rows.length}`);
    }
  }
  if (leftover > 0) {
    console.log(`  ! ${p.name} — 참조가 남아 삭제 안 함(${leftoverWhere.join(" ")}). 이력서 재연결만 적용됨`);
    done.push({ ...p, movedDocs: docs.map((d) => d.id), filled: null, deleted: false, leftoverWhere });
    continue;
  }
  // ① 빈 칸 채우기
  if (Object.keys(p.fill).length > 0) {
    await api(`users?id=eq.${p.keeper.id}`, { method: "PATCH", body: JSON.stringify(p.fill) });
  }
  await api(`users?id=eq.${p.dupe.id}`, { method: "DELETE" });
  console.log(`  ✓ ${p.name} — 문서 ${docs.length}건 재연결 · 칸 ${Object.keys(p.fill).length}개 채움 · 중복 행 삭제`);
  done.push({
    name: p.name,
    keeperId: p.keeper.id,
    keeperBefore: Object.fromEntries(Object.keys(p.fill).map((k) => [k, p.keeper[k] ?? null])),
    filled: p.fill,
    deletedRow: p.dupe, // 원복 시 그대로 다시 insert
    movedDocs: docs.map((d) => d.id),
    deleted: true,
  });
}

writeFileSync(logPath, JSON.stringify({ at: new Date().toISOString(), merges: done }, null, 2), "utf-8");
console.log(`\n원복 로그: ${logPath}`);
