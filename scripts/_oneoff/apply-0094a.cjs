const fs = require("fs");
const path = require("path");
const postgres = require("postgres");

(async () => {
  const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
  const q = fs.readFileSync(
    path.join(__dirname, "../../supabase/migrations/0094a_students_edutrix_student_id.sql"),
    "utf8",
  );
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
