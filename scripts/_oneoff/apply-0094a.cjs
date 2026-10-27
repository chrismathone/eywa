const fs = require("fs");
const path = require("path");
const postgres = require("postgres");
const { readMigration } = require("../../src/lib/db/migrations-corpus.mjs");

(async () => {
  const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
  // 시즌1 합본(s1_season1.sql)의 구역(2026-10-27 시즌2).
  const q = readMigration("0094a_students_edutrix_student_id.sql");
  await sql.unsafe(q);
  console.log("0094a applied");
  const cols = await sql`
    select table_name, column_name
    from information_schema.columns
    where table_schema = 'public'
      and column_name in ('edutrix_student_id', 'edutrix_report_id')
    order by 1, 2
  `;
  console.log(cols);
  await sql.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
