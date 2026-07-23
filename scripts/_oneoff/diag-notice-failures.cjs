/** READ-ONLY: 공지(classnote_notices) 실패 분포 — 담당 알림 설계용(2026-07-23). */
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
    console.log("=== 공지 상태별 ===");
    for (const r of await sql`
      SELECT status, count(*)::int n FROM classnote_notices WHERE tenant_id = ${TENANT}
      GROUP BY 1 ORDER BY 2 DESC`)
      console.log(`  ${r.status}: ${r.n}`);

    console.log("\n=== 타깃 단위 실패 사유 ===");
    for (const r of await sql`
      SELECT r->>'note' AS note, count(*)::int n
      FROM classnote_notices cn, jsonb_array_elements(cn.results) r
      WHERE cn.tenant_id = ${TENANT} AND jsonb_typeof(cn.results) = 'array'
        AND coalesce((r->>'ok')::boolean, false) = false
      GROUP BY 1 ORDER BY 2 DESC LIMIT 20`)
      console.log(`  ${r.n}건  "${(r.note ?? "(사유없음)").slice(0, 70)}"`);

    console.log("\n=== 실패 타깃 — 학생·담당강사 해석 가능성 ===");
    const rows = await sql`
      SELECT t->>'studentName' AS student, t->>'studentId' AS sid, r->>'note' AS note,
             cn.created_at::date AS d, u.display_name AS sender
      FROM classnote_notices cn
      JOIN jsonb_array_elements(cn.results) r ON true
      LEFT JOIN jsonb_array_elements(cn.targets) t ON t->>'board' = r->>'board'
      LEFT JOIN users u ON u.id = cn.created_by
      WHERE cn.tenant_id = ${TENANT} AND jsonb_typeof(cn.results) = 'array'
        AND coalesce((r->>'ok')::boolean, false) = false
      ORDER BY cn.created_at DESC LIMIT 20`;
    for (const r of rows)
      console.log(`  ${r.d.toISOString().slice(0, 10)} ${r.student ?? "(타깃매칭 실패)"} sid=${r.sid ? "있음" : "없음"} 발송자=${r.sender ?? "-"} :: ${(r.note ?? "").slice(0, 50)}`);
    if (!rows.length) console.log("  (없음)");

    console.log("\n=== 실패 학생의 담당 강사(활성 수강 기준) 해석률 ===");
    const who = await sql`
      WITH f AS (
        SELECT DISTINCT t->>'studentId' AS sid
        FROM classnote_notices cn
        JOIN jsonb_array_elements(cn.results) r ON true
        LEFT JOIN jsonb_array_elements(cn.targets) t ON t->>'board' = r->>'board'
        WHERE cn.tenant_id = ${TENANT} AND jsonb_typeof(cn.results) = 'array'
          AND coalesce((r->>'ok')::boolean, false) = false AND t->>'studentId' IS NOT NULL
      )
      SELECT count(*)::int total,
             count(*) FILTER (WHERE EXISTS (
               SELECT 1 FROM enrollments e JOIN classes c ON c.id = e.class_id
               WHERE e.student_id = f.sid::uuid AND e.end_date IS NULL AND c.teacher_id IS NOT NULL))::int resolvable
      FROM f`;
    console.log(`  실패 학생 ${who[0].total}명 중 담당 해석 가능 ${who[0].resolvable}명`);
  } finally {
    await sql.end();
  }
})();
