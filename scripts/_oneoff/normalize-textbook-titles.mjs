/**
 * 교재 단가표 이름 통일 — `(NN개정)` 앞에 **한 칸**을 띄운다.
 *
 * 원장 2026-09-09: *"교재이름 전부 통일 발전 (22개정) 으로 (22개정)은 전부 한칸 띄우고"*.
 * 배경: 같은 책이 `초5-2 발전 2권(22개정)`·`초5-1 발전 2권 (22개정)`처럼 두 표기로 섞여 있어 검색·비교가
 * 어긋났다(9/8 신청 한 건이 이름을 손으로 고쳐 금액 22,500 ≠ 단가표 23,500이 됐다).
 *
 * 🔴 **지난 신청 기록(`textbook_orders.book_name`)은 건드리지 않는다** — 그건 신청 시점의 스냅샷이라
 *    고치면 그때 뭘 신청했는지가 사라진다(실측: 붙여 쓴 이름을 쓴 지난 신청 0건이라 손해도 없다).
 * ⚠️ 드라이런이 기본. 실제 반영은 `--apply`.
 *
 * 실행: node --env-file=.env.local scripts/_oneoff/normalize-textbook-titles.mjs [--apply]
 */
import postgres from "postgres";

const APPLY = process.argv.includes("--apply");
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });

/** `…2권(22개정)` → `…2권 (22개정)`. 이미 한 칸이면 그대로(멱등). */
function normalizeTitle(title) {
  return title.replace(/\s*\((\d+개정)\)/g, " ($1)").replace(/\s+/g, " ").trim();
}

try {
  const rows = await sql`select id, tenant_id, title, price from textbook_catalog where title ~ '개정' order by title`;
  const changes = rows
    .map((row) => ({ ...row, next: normalizeTitle(row.title) }))
    .filter((row) => row.next !== row.title);

  // 정규화 뒤 같은 이름이 둘 이상이면 사람이 판단할 일이라 통째로 멈춘다(조용한 병합 금지).
  const after = new Map();
  for (const row of rows) {
    const key = `${row.tenant_id}::${normalizeTitle(row.title)}`;
    after.set(key, [...(after.get(key) ?? []), row]);
  }
  const collisions = [...after.entries()].filter(([, list]) => list.length > 1);

  console.log(`대상 ${rows.length}건 중 이름이 바뀌는 것 ${changes.length}건, 이름 충돌 ${collisions.length}건`);
  for (const row of changes) console.log(`  ${row.title}  →  ${row.next}   (${row.price}원)`);
  for (const [key, list] of collisions) {
    console.log(`  🔴 충돌: ${key.split("::")[1]} ← ${list.map((r) => `${r.title}(${r.price}원)`).join(" / ")}`);
  }
  if (collisions.length > 0) {
    console.log("\n충돌이 있어 아무것도 바꾸지 않았습니다 — 어느 쪽을 남길지는 사람이 정할 일입니다.");
    process.exitCode = 1;
  } else if (!APPLY) {
    console.log("\n드라이런입니다. 실제 반영은 --apply");
  } else if (changes.length > 0) {
    await sql.begin(async (tx) => {
      for (const row of changes) {
        await tx`update textbook_catalog set title = ${row.next}, updated_at = now() where id = ${row.id}`;
      }
    });
    console.log(`\n반영 완료 — ${changes.length}건.`);
  } else {
    console.log("\n바꿀 것이 없습니다(이미 통일됨).");
  }
} finally {
  await sql.end();
}
