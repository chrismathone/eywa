/**
 * 영어 반 **레벨업 개명** — 학생을 옮기지 않고 **반 이름을 올린다**(원장 지시 2026-08-04
 * *"8월 시트 참고해서 반명을 레벨업시켜"*). 반 id가 그대로라 수강·성적·보고서·ECS 이력이 통째로 따라온다.
 *
 * 짝은 **추측이 아니라 명단 겹침으로 확정**했다(`level-up-match.mts`, 실측 2026-08-04):
 *   DP5→DP6(8/8) JP1→JP2(3/3) KW1→KW2(4/4) **KW6→PJ1(5/5)** LT2→LT3(6/6) LT4→LT5(9/9)
 *   MEC1-3→MEC1-4(5/5) PJ5→PJ6(5/5) PL2→PL3(9/9) RTT2→RTT4(8/8) LS2a→LS3a(3/4) LS2b→LS3b(4/5)
 *   **LS5→LS6(9/9) · LS4→LS5(9/9)**
 * ⚠️ 이름 규칙으로 유추하면 틀린다 — 레벨 사다리가 트랙을 넘나든다(Kopi Wang → Pre Junior라 `KW6→PJ1`),
 *    번호가 둘 뛰기도 한다(`RTT2→RTT4`). 사람 명단만이 진실.
 * ⚠️⚠️ **LS4→LS5→LS6은 연쇄**다. LS4를 먼저 바꾸면 살아 있는 LS5와 **이름이 충돌**한다 → 사다리 위에서부터.
 *
 * 절차(순서 고정):
 *   ① 8/3 컷오버 스냅샷 롤백 — 새로 만든 반에 붙은 슬롯을 걷어낸다(깨끗한 출발점).
 *   ② 컷오버가 만든 신설 13반 삭제(수강 0·슬롯 0 확인 후).
 *   ③ 개명(사다리 위에서부터).
 *   ④ 컷오버 재실행(멱등) — 이제 시트 이름 = 기존 반이라 슬롯이 **이력을 가진 그 반**에 붙는다.
 *      (④는 master-cutover.mts를 다시 돌리면 된다 — 이 스크립트는 ①~③까지.)
 *
 * 실행: node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/_english_sync/level-up-rename.mts [--apply]
 *
 * 되돌리기: `RENAMES`를 **거꾸로**(from↔to 뒤집고 배열도 역순 — 연쇄 때문에 순서가 중요) 돌리면 된다.
 *   짝 정보가 이 파일에 있으므로 언두 json이 없어도 복구된다(json은 반 id까지 적어두는 보조 기록).
 *   삭제된 신설 13반은 **수강 0·슬롯 0인 빈 껍데기**라 복구 가치가 없다(컷오버가 다시 만든다).
 */
import postgres from "postgres";
import { writeFileSync } from "node:fs";

const TENANT = "becaa316-e636-42e9-9d09-08b133e0b094";
const ACTOR = "fcf735fa-edf7-4095-8fa6-724285a018ed"; // 박소선(master) — RPC가 security invoker라 클레임 필요
const SNAPSHOT = "9d28c23c-7765-48bd-af70-ab46c6386e59"; // 2026-08-03 컷오버
const APPLY = process.argv.includes("--apply");

/** 사다리 위에서부터. `expect` = 개명 시점에 그 반에 있어야 할 수강생 수(안전 가드). */
const RENAMES: { from: string; to: string; expect: number }[] = [
  { from: "LS5", to: "LS6", expect: 9 }, // ⚠️ LS4보다 **먼저** — 안 그러면 LS5 이름 충돌
  { from: "LS4", to: "LS5", expect: 9 },
  { from: "DP5", to: "DP6", expect: 8 },
  { from: "JP1", to: "JP2", expect: 3 },
  { from: "KW1", to: "KW2", expect: 4 },
  { from: "KW6", to: "PJ1", expect: 5 },
  { from: "LS2a", to: "LS3a", expect: 4 },
  { from: "LS2b", to: "LS3b", expect: 5 },
  { from: "LT2", to: "LT3", expect: 6 },
  { from: "LT4", to: "LT5", expect: 9 },
  { from: "MEC1-3", to: "MEC1-4", expect: 5 },
  { from: "PJ5", to: "PJ6", expect: 5 },
  { from: "PL2", to: "PL3", expect: 9 },
  { from: "RTT2", to: "RTT4", expect: 8 },
];
/** 컷오버가 만든 빈 반 — 개명이 그 이름을 가져가므로 먼저 지운다. */
const CREATED = ["DP6", "JP2", "KW2", "LS3a", "LS3b", "LS6", "LT3", "LT5", "MEC1-4", "PJ1", "PJ6", "PL3", "RTT4"];

const sql = postgres(process.env.DATABASE_URL!, { ssl: "require", max: 1 });

type Row = { id: string; class_name: string; enr: number; slots: number; created: string };
const load = () => sql<Row[]>`
  select c.id, c.class_name, c.created_at::date::text created,
         (select count(*)::int from enrollments e where e.class_id = c.id and (e.end_date is null or e.end_date >= current_date)) enr,
         (select count(*)::int from class_schedules s where s.class_id = c.id and s.valid_to is null) slots
    from classes c where c.tenant_id = ${TENANT} and c.subject = 'english' and c.is_active`;

let rows = await load();
const byName = (n: string) => rows.find((r) => r.class_name.replace(/\s+/g, "") === n.replace(/\s+/g, ""));

// ── 사전 검증 ────────────────────────────────────────────────────────────────
const problems: string[] = [];
for (const r of RENAMES) {
  const src = byName(r.from);
  if (!src) { problems.push(`옛 반 "${r.from}" 없음`); continue; }
  if (src.enr !== r.expect) problems.push(`"${r.from}" 수강생 ${src.enr}명 (기대 ${r.expect}명) — 명단이 바뀌었으니 짝을 다시 확인할 것`);
}
for (const n of CREATED) {
  const c = byName(n);
  if (!c) { problems.push(`신설 반 "${n}"을 못 찾음(이미 지웠나?)`); continue; }
  if (c.enr > 0) problems.push(`🔴 "${n}"에 수강생 ${c.enr}명 — 빈 반이 아니라 삭제 금지`);
}
// 충돌 검사는 **순서대로 시뮬레이션**해야 한다 — 연쇄(LS4→LS5→LS6)에선 앞 개명이 이름을 비워주므로
// 최종 상태만 보고 판정하면 정상인 것을 충돌로 오판한다(반대로 순서를 안 지키면 진짜 충돌이 난다).
{
  const livenames = new Set(rows.map((r) => r.class_name.replace(/\s+/g, "")));
  for (const n of CREATED) livenames.delete(n.replace(/\s+/g, "")); // ②에서 지워진다
  for (const r of RENAMES) {
    const to = r.to.replace(/\s+/g, ""), from = r.from.replace(/\s+/g, "");
    if (livenames.has(to)) problems.push(`🔴 "${r.from}→${r.to}" 시점에 "${r.to}"가 아직 살아 있다 — 순서를 사다리 위에서부터로`);
    livenames.delete(from);
    livenames.add(to);
  }
}
console.log(`활성 영어반 ${rows.length}개 · 개명 ${RENAMES.length}건 · 삭제 예정 ${CREATED.length}건  ${APPLY ? "【적용】" : "(dry-run)"}\n`);
for (const r of RENAMES) {
  const src = byName(r.from);
  console.log(`  ${r.from.padEnd(8)} → ${r.to.padEnd(8)} 수강 ${String(src?.enr ?? "?").padStart(2)}명 · 슬롯 ${src?.slots ?? "?"} · ${src?.id.slice(0, 8) ?? "-"}`);
}
if (problems.length) {
  console.log("\n🔴 사전 검증 실패:");
  for (const p of problems) console.log(`   · ${p}`);
  await sql.end();
  process.exit(1);
}
console.log("\n사전 검증 통과.");
if (!APPLY) {
  console.log("(dry-run — 쓰기 없음. 실제 반영은 --apply)");
  await sql.end();
  process.exit(0);
}

// ── ① 컷오버 롤백 ────────────────────────────────────────────────────────────
const undo = { snapshot: SNAPSHOT, deletedClasses: [] as { id: string; name: string }[], renames: [] as { id: string; from: string; to: string }[] };
const [rb] = await sql.begin(async (tx) => {
  await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: ACTOR, role: "authenticated" })}, true)`;
  return tx`select public.rollback_english_structure(${SNAPSHOT}::uuid) as r`;
});
console.log(`① 컷오버 롤백: ${JSON.stringify((rb as { r: unknown }).r)}`);

// ── ② 신설 빈 반 삭제 ────────────────────────────────────────────────────────
rows = await load();
for (const n of CREATED) {
  const c = rows.find((r) => r.class_name === n);
  if (!c) { console.log(`   ⏭ "${n}" 없음`); continue; }
  const [chk] = await sql<{ enr: number; slots: number }[]>`
    select (select count(*)::int from enrollments e where e.class_id = ${c.id}) enr,
           (select count(*)::int from class_schedules s where s.class_id = ${c.id}) slots`;
  if (chk!.enr > 0) { console.log(`   🔴 "${n}" 수강 ${chk!.enr}건 — 건너뜀`); continue; }
  await sql`delete from class_schedules where class_id = ${c.id} and tenant_id = ${TENANT}`;
  await sql`delete from classes where id = ${c.id} and tenant_id = ${TENANT}`;
  undo.deletedClasses.push({ id: c.id, name: n });
  console.log(`② 삭제: "${n}" (슬롯 ${chk!.slots}행 포함)`);
}

// ── ③ 개명 (사다리 위에서부터) ───────────────────────────────────────────────
rows = await load();
for (const r of RENAMES) {
  const src = rows.find((x) => x.class_name.replace(/\s+/g, "") === r.from.replace(/\s+/g, ""));
  if (!src) { console.log(`   ⏭ "${r.from}" 없음`); continue; }
  await sql`update classes set class_name = ${r.to} where id = ${src.id} and tenant_id = ${TENANT}`;
  undo.renames.push({ id: src.id, from: r.from, to: r.to });
  console.log(`③ 개명: ${r.from} → ${r.to}  (${src.id.slice(0, 8)}, 수강 ${src.enr}명)`);
}

const path = `${process.cwd()}/LEVELUP_UNDO_2026-08-04.json`;
writeFileSync(path, JSON.stringify(undo, null, 1));
console.log(`\n✅ ①~③ 완료. 언두: ${path}`);
console.log("   다음: master-cutover.mts를 --apply로 다시 돌려 8/3 배치를 붙일 것(멱등).");
await sql.end();
