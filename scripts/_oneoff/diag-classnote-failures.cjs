/** READ-ONLY: ClassNote 발송 실패 전수 — 사유·담당강사·학생 분포(알림 설계용, 2026-07-23). */
const fs = require("node:fs");
const path = require("node:path");
const TENANT = "becaa316-e636-42e9-9d09-08b133e0b094";
const url = fs
  .readFileSync(path.join(__dirname, "..", "..", ".env.local"), "utf8")
  .match(/^DATABASE_URL=(.+)$/m)[1]
  .trim()
  .replace(/^"|"$/g, "");

(async () => {
  const sql = require("postgres")(url, { ssl: "require", max: 1 });
  try {
    console.log("=== 상태별 전체 ===");
    for (const r of await sql`
      SELECT coalesce(classnote_status,'미요청') st, count(*)::int n
      FROM lesson_reports WHERE tenant_id = ${TENANT} GROUP BY 1 ORDER BY 2 DESC`)
      console.log(`  ${r.st}: ${r.n}`);

    console.log("\n=== failed 사유별 ===");
    for (const r of await sql`
      SELECT coalesce(classnote_error,'(없음)') err, count(*)::int n,
             min(report_date)::text mn, max(report_date)::text mx
      FROM lesson_reports WHERE tenant_id = ${TENANT} AND classnote_status = 'failed'
      GROUP BY 1 ORDER BY 2 DESC LIMIT 15`)
      console.log(`  ${r.n}건  ${r.mn}~${r.mx}  "${r.err.slice(0, 70)}"`);

    console.log("\n=== '해당 학생 없음' 계열 — 학생·담당강사 ===");
    const rows = await sql`
      SELECT s.name student, coalesce(u.display_name, lr.teacher_name, '(미지정)') teacher,
             count(*)::int n, max(lr.report_date)::text last_date
      FROM lesson_reports lr
      JOIN students s ON s.id = lr.student_id
      LEFT JOIN classes c ON c.id = lr.class_id
      LEFT JOIN users u ON u.id = c.teacher_id
      WHERE lr.tenant_id = ${TENANT} AND lr.classnote_status = 'failed'
        AND lr.classnote_error ILIKE '%학생 없음%'
      GROUP BY 1,2 ORDER BY 3 DESC`;
    for (const r of rows) console.log(`  ${r.student} · ${r.teacher} · ${r.n}건 (마지막 ${r.last_date})`);
    if (!rows.length) console.log("  (없음)");

    console.log("\n=== 최근 30일 failed 추이(주별) ===");
    for (const r of await sql`
      SELECT to_char(date_trunc('week', report_date), 'MM-DD') wk, count(*)::int n
      FROM lesson_reports WHERE tenant_id = ${TENANT} AND classnote_status = 'failed'
        AND report_date >= current_date - 60 GROUP BY 1 ORDER BY 1`)
      console.log(`  ${r.wk}주: ${r.n}건`);

    console.log("\n=== 담당 강사 해석 가능성(알림 수신자) ===");
    const who = await sql`
      SELECT count(*)::int total,
             count(*) FILTER (WHERE c.teacher_id IS NOT NULL)::int by_class,
             count(*) FILTER (WHERE c.teacher_id IS NULL AND lr.teacher_name IS NOT NULL)::int by_name,
             count(*) FILTER (WHERE c.teacher_id IS NULL AND lr.teacher_name IS NULL)::int unknown
      FROM lesson_reports lr LEFT JOIN classes c ON c.id = lr.class_id
      WHERE lr.tenant_id = ${TENANT} AND lr.classnote_status = 'failed'`;
    console.log(`  failed ${who[0].total} — 반담당 ${who[0].by_class} / 이름만 ${who[0].by_name} / 불명 ${who[0].unknown}`);
  } finally {
    await sql.end();
  }
})();
