// 이름 표기가 달라 자동 병합에서 빠진 중복 직원 합치기(원장 지시 2026-07-29).
//   크리스틴 ↔ KRISTINE DRIVER · 플로렌스 ↔ Florence Park 처럼 **같은 사람인데 표기가 다른** 쌍.
//
//   node scripts/staff-roster-import/merge-staff-pair.mjs            # 드라이런
//   node scripts/staff-roster-import/merge-staff-pair.mjs --apply    # 적용
//
// 규칙(merge-duplicate-staff.mjs와 동일 안전장치):
//   ① 남길 행 = **실제 이메일을 가진 쪽**(로그인 정체성이 진짜인 쪽). 흡수 = 플레이스홀더 쪽.
//   ② 남길 행의 **빈 칸만** 채운다(기존 값 불가침)
//   ③ users.id 외래키 **전수**(DB OpenAPI에서 실시간 추출)를 흡수 → 남길 행으로 재지정
//   ④ 남은 참조가 0일 때만 흡수 행 삭제 + 그 auth 계정도 삭제(users 없는 로그인은 들어와도 튕긴다)
// 원복: logs/merge-pair-<ts>.json (삭제 행 전체 + 옮긴 참조 + 계정 정보 보존)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes("--apply");

// [남길 이메일, 흡수할 이메일] — 원장이 "같은 사람"으로 확인한 쌍만 명시.
const PAIRS = [
  ["krissi@thewritehustle.com", "kristine@imported.local"],
  ["injaewon.eie.et@gmail.com", "florence@imported.local"],
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
const rest = async (path, init) => {
  const r = await fetch(`${SB}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init?.headers ?? {}) } });
  if (!r.ok) throw new Error(`${init?.method ?? "GET"} ${path} → ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json();
};

const spec = await (await fetch(`${SB}/rest/v1/`, { headers: { ...H, Accept: "application/openapi+json" } })).json();
const FK = [];
for (const [t, def] of Object.entries(spec.definitions ?? {})) {
  for (const [c, cc] of Object.entries(def.properties ?? {})) {
    const d = cc.description ?? "";
    if (/Foreign Key to `?public\.users\.id/.test(d) || /<fk table='users' column='id'\/>/.test(d)) FK.push([t, c]);
  }
}
const refsOf = async (id) => {
  const out = [];
  for (const [t, c] of FK) {
    let rows = [];
    try {
      rows = await rest(`${t}?select=${c}&${c}=eq.${id}&limit=1000`);
    } catch {
      continue;
    }
    if (rows.length) out.push({ table: t, column: c, count: rows.length });
  }
  return out;
};

const FILL = ["phone", "hire_date", "department", "employment_type", "job_title", "english_name", "default_classroom", "memo", "bg_color", "text_color"];
const isBlank = (v) => v === null || v === undefined || String(v).trim() === "";

const plan = [];
for (const [keepEmail, dropEmail] of PAIRS) {
  const [keep] = await rest(`users?select=*&email=eq.${encodeURIComponent(keepEmail)}`);
  const [drop] = await rest(`users?select=*&email=eq.${encodeURIComponent(dropEmail)}`);
  if (!keep || !drop) {
    console.log(`  ! 건너뜀 — ${keepEmail} / ${dropEmail} 중 하나를 못 찾음`);
    continue;
  }
  if (keep.tenant_id !== drop.tenant_id) {
    console.log(`  ! 건너뜀 — 테넌트 다름 (${keepEmail})`);
    continue;
  }
  const fill = {};
  for (const f of FILL) if (isBlank(keep[f]) && !isBlank(drop[f])) fill[f] = drop[f];
  const ks = Array.isArray(keep.subjects) ? keep.subjects : [];
  const ds = Array.isArray(drop.subjects) ? drop.subjects : [];
  if (ks.length === 0 && ds.length > 0) fill.subjects = ds;
  plan.push({ keep, drop, fill, refs: await refsOf(drop.id) });
}

console.log(`\n=== 표기 다른 중복 병합 ${APPLY ? "[적용]" : "[드라이런]"} — ${plan.length}쌍 ===\n`);
for (const p of plan) {
  console.log(`■ ${p.drop.display_name} → ${p.keep.display_name}`);
  console.log(`   남김: ${p.keep.email} [${p.keep.system_role}/${p.keep.status}] 부서 ${p.keep.department ?? "-"}`);
  console.log(`   흡수: ${p.drop.email} — 옮길 참조 ${p.refs.map((r) => `${r.table}.${r.column}:${r.count}`).join(" ") || "없음"}`);
  console.log(`   채울 칸: ${Object.keys(p.fill).length ? JSON.stringify(p.fill) : "(없음)"}`);
}

if (!APPLY) {
  console.log("\n적용하려면 --apply 를 붙여 다시 실행하세요.");
  process.exit(0);
}

const logDir = join(HERE, "logs");
if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const logPath = join(logDir, `merge-pair-${stamp}.json`);
const done = [];

for (const p of plan) {
  console.log(`\n■ ${p.drop.display_name} → ${p.keep.display_name}`);
  const entry = {
    keepId: p.keep.id,
    keepBefore: Object.fromEntries(Object.keys(p.fill).map((k) => [k, p.keep[k] ?? null])),
    filled: p.fill,
    droppedRow: p.drop,
    moved: [],
    deleted: false,
  };
  done.push(entry);
  for (const r of p.refs) {
    await rest(`${r.table}?${r.column}=eq.${p.drop.id}`, {
      method: "PATCH",
      body: JSON.stringify({ [r.column]: p.keep.id }),
    });
    entry.moved.push(r);
    console.log(`   ${r.table}.${r.column} ${r.count}건 이동`);
  }
  if (Object.keys(p.fill).length > 0) {
    await rest(`users?id=eq.${p.keep.id}`, { method: "PATCH", body: JSON.stringify(p.fill) });
    console.log(`   빈 칸 ${Object.keys(p.fill).length}개 채움`);
  }
  const leftover = await refsOf(p.drop.id);
  if (leftover.length) {
    console.log(`   ! 참조가 남아 삭제 안 함: ${leftover.map((x) => `${x.table}.${x.column}:${x.count}`).join(" ")}`);
    continue;
  }
  await rest(`users?id=eq.${p.drop.id}`, { method: "DELETE" });
  // users 행 없는 auth 계정은 로그인해도 곧바로 튕긴다 → 함께 정리.
  await fetch(`${SB}/auth/v1/admin/users/${p.drop.id}`, { method: "DELETE", headers: H });
  entry.deleted = true;
  console.log(`   흡수 행 + 로그인 계정 삭제 — 완료`);
}

writeFileSync(logPath, JSON.stringify({ at: new Date().toISOString(), merges: done }, null, 2), "utf-8");
console.log(`\n원복 로그: ${logPath}`);
