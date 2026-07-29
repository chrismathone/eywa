/**
 * `textbook_orders.teacher_name` 별칭 정규화 — 한 사람이 여러 표기로 저장돼 있던 것을 표시명으로 통일.
 *
 * 🔴 왜 필요한가(2026-07-29): 교재 요청의 소유 판정이 `teacher_name === users.display_name`
 * ([`ownsTextbookRequest`](../../src/features/billing/textbook-ownership.ts))이 된 뒤, 별칭으로 저장된
 * 요청이 **본인에게도 읽기 전용**이 됐다. 느슨한 이름 매칭으로 코드에서 풀면 남의 요청을 내 것으로
 * 오판해 원래 버그(영어 강사가 수학 요청을 수정·발송)가 되돌아오므로, **데이터를 한 번 고친다.**
 *
 * 매핑 근거(원장 확인 2026-07-29: *"김은정선생님은 이름을 김정은으로 쓰기도하고 닉네임을 셀린으로
 * 하기도해서 다 본인이 맞음"*) + 실측 교차검증:
 *   · `users`에 `김정은`·`셀린` 이름을 가진 **다른 사람이 없다**(퇴직 포함 0명). `김은정.english_name = "Celine"`.
 *   · 셀린 계열 61/63행·김정은 계열 14/16행이 **김은정이 지금 가르치는 학생**의 요청(나머지는 반 이동·퇴원).
 *   · `lesson_reports`엔 별칭이 0건이고 `김은정` 2,734건뿐 — 별칭은 교재요청 폼의 자유입력 칸에서만 생긴 습관.
 *
 * ⚠️ **애매한 값은 일부러 건드리지 않는다**: `신입`(6) `""`(4) `김`(1) `윤하t`(1) — 사람을 특정할 수 없다.
 *    그 12건은 계속 읽기 전용이며 사무실(master/accountant)은 그대로 처리할 수 있다.
 *
 * 사용법:
 *   node scripts/_poc_migration/normalize-textbook-teacher-names.mjs            # dry-run(기본, 아무것도 안 씀)
 *   node scripts/_poc_migration/normalize-textbook-teacher-names.mjs --apply    # 적용 + undo 파일 생성
 *   node scripts/_poc_migration/normalize-textbook-teacher-names.mjs --undo <undo.json>   # 되돌리기
 *
 * 멱등: 이미 정규화된 행은 후보에 안 잡힌다(별칭 목록에만 매칭). 재실행 안전.
 */
import postgres from "postgres";
import fs from "fs";
import path from "path";

/** 표시명 → 그 사람이 쓴 다른 표기들. 공백은 btrim으로 흡수하므로 여기엔 순수 문자열만. */
const ALIASES = {
  김은정: ["셀린T", "셀린t", "셀린", "김정은", "김정은T"],
};

const args = process.argv.slice(2);
const undoPath = args.includes("--undo") ? args[args.indexOf("--undo") + 1] : null;
const apply = args.includes("--apply");

const url = fs.readFileSync(".env.local", "utf8").match(/^DATABASE_URL="(.+)"$/m)?.[1];
if (!url) throw new Error(".env.local에서 DATABASE_URL을 찾지 못했습니다");
const sql = postgres(url, { ssl: "require" });

async function main() {
  if (undoPath) return undo();

  // 1) 대상 조회 — btrim 비교(저장값에 후행 공백이 섞여 있다: "셀린T " 1건 실측).
  const all = [];
  for (const [canonical, aliases] of Object.entries(ALIASES)) {
    const rows = await sql`
      select id, teacher_name, student_name, book_name
      from textbook_orders
      where btrim(teacher_name) = any(${aliases})`;
    for (const r of rows) all.push({ ...r, canonical });
  }

  if (all.length === 0) {
    console.log("정규화할 행이 없습니다 (이미 적용됐거나 대상 없음).");
    return;
  }

  const byAlias = new Map();
  for (const r of all) {
    const k = `${JSON.stringify(r.teacher_name)} → ${r.canonical}`;
    byAlias.set(k, (byAlias.get(k) ?? 0) + 1);
  }
  console.log(`대상 ${all.length}행`);
  for (const [k, n] of [...byAlias].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(24)} ${n}건`);
  console.log("\n샘플 5건:");
  for (const r of all.slice(0, 5))
    console.log(`  ${JSON.stringify(r.teacher_name)} | ${r.student_name ?? "-"} | ${r.book_name}`);

  if (!apply) {
    console.log("\n[dry-run] 아무것도 쓰지 않았습니다. 적용하려면 --apply 를 붙이세요.");
    return;
  }

  // 2) undo 파일 먼저 — 쓰기 **전에** 원본을 남긴다(별칭들이 한 값으로 접히면 복원 불가).
  const stamp = (await sql`select to_char(now() at time zone 'Asia/Seoul','YYYYMMDD-HH24MISS') as s`)[0].s;
  const file = path.resolve(`textbook-teacher-normalize.undo.${stamp}.json`);
  fs.writeFileSync(
    file,
    JSON.stringify(all.map((r) => ({ id: r.id, teacher_name: r.teacher_name })), null, 2),
    "utf8",
  );
  console.log(`\nundo 파일: ${file}`);

  // 3) 적용 — 별칭별로 한 문장씩(원자적, 행 수 반환으로 실제 반영 확인).
  let total = 0;
  for (const [canonical, aliases] of Object.entries(ALIASES)) {
    const res = await sql`
      update textbook_orders set teacher_name = ${canonical}, updated_at = now()
      where btrim(teacher_name) = any(${aliases})`;
    console.log(`  ${canonical}: ${res.count}행 갱신`);
    total += res.count;
  }
  console.log(`\n완료 — ${total}행. 되돌리기: node ${path.relative(process.cwd(), process.argv[1])} --undo "${file}"`);
}

async function undo() {
  const rows = JSON.parse(fs.readFileSync(undoPath, "utf8"));
  console.log(`되돌리기 ${rows.length}행 (${undoPath})`);
  let n = 0;
  for (const r of rows) {
    const res = await sql`update textbook_orders set teacher_name = ${r.teacher_name} where id = ${r.id}`;
    n += res.count;
  }
  console.log(`완료 — ${n}행 복원`);
}

await main();
await sql.end();
