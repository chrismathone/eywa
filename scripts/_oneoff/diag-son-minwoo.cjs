/** READ-ONLY: '손민우' 학생 — 보고서 저장/발송 상태 진단("보고서가 증발" 제보 2026-07-23). */
const fs = require("node:fs");
const path = require("node:path");
const TENANT = "becaa316-e636-42e9-9d09-08b133e0b094";
const url = fs
  .readFileSync(path.join(__dirname, "..", "..", ".env.local"), "utf8")
  .match(/^DATABASE_URL=(.+)$/m)[1]
  .trim()
  .replace(/^"|"$/g, "");
const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d ?? "").slice(0, 10));

(async () => {
  const sql = require("postgres")(url, { ssl: "require", max: 1 });
  try {
    const studs = await sql`
      SELECT id, name, classnote_name, status, grade, school, created_at
      FROM students WHERE tenant_id = ${TENANT} AND name LIKE '%손민우%'`;
    console.log("=== 학생 ===");
    for (const s of studs)
      console.log(`${s.id} ${s.name} (classnote_name=${s.classnote_name ?? "-"}) 상태=${s.status} ${s.school ?? ""}${s.grade ?? ""}`);
    if (!studs.length) return console.log("(없음)");

    // 동명이인 — 발송 가드가 이름 충돌 시 통째 제외한다.
    const dupe = await sql`
      SELECT name, count(*)::int n FROM students
      WHERE tenant_id = ${TENANT} AND status <> 'withdrawn'
        AND coalesce(classnote_name, name) IN ${sql(studs.map((s) => s.classnote_name || s.name))}
      GROUP BY 1`;
    console.log("\n=== 동명이인(비탈원 기준) ===");
    for (const d of dupe) console.log(`${d.name}: ${d.n}명 ${d.n > 1 ? "⚠️ 발송 제외 대상" : ""}`);

    for (const s of studs) {
      console.log(`\n=== ${s.name} 수강 반 ===`);
      const enr = await sql`
        SELECT c.class_name, c.subject, c.is_active, u.display_name AS teacher, e.start_date, e.end_date
        FROM enrollments e JOIN classes c ON c.id = e.class_id
        LEFT JOIN users u ON u.id = c.teacher_id
        WHERE e.student_id = ${s.id} ORDER BY e.start_date DESC`;
      for (const e of enr)
        console.log(`  ${e.class_name} [${e.subject}] ${e.teacher ?? "-"} ${iso(e.start_date)}~${e.end_date ? iso(e.end_date) : "진행"} 활성반=${e.is_active}`);

      console.log(`--- 최근 수업보고서 15건 ---`);
      const reps = await sql`
        SELECT report_date, subject, class_id, classnote_status, classnote_error, classnote_sent_at,
               classnote_retry_count, left(coalesce(progress,''), 24) AS progress
        FROM lesson_reports WHERE student_id = ${s.id}
        ORDER BY report_date DESC LIMIT 15`;
      for (const r of reps)
        console.log(
          `  ${iso(r.report_date)} [${r.subject ?? "-"}] 발송=${r.classnote_status ?? "미요청"}` +
            `${r.classnote_error ? ` 오류="${r.classnote_error}"` : ""}${r.classnote_retry_count ? ` 재시도${r.classnote_retry_count}` : ""}`,
        );
      if (!reps.length) console.log("  (보고서 0건)");

      // 발송 상태 집계 — '증발'이 실패인지 미요청인지 구분.
      const agg = await sql`
        SELECT coalesce(classnote_status, '미요청') AS st, count(*)::int n
        FROM lesson_reports WHERE student_id = ${s.id} GROUP BY 1 ORDER BY 2 DESC`;
      console.log(`--- 발송 상태 집계(전체) ---`);
      for (const a of agg) console.log(`  ${a.st}: ${a.n}건`);
    }

    // 이 학생이 타깃이었던 공지/보고서 큐 결과에서 사유 문자열 찾기
    console.log("\n=== 공지 큐에서 이 이름의 결과 ===");
    const names = studs.map((s) => s.classnote_name || s.name);
    const notes = await sql`
      SELECT created_at, status, results FROM classnote_notices
      WHERE tenant_id = ${TENANT} AND results::text LIKE ${"%" + names[0] + "%"}
      ORDER BY created_at DESC LIMIT 5`;
    for (const n of notes) {
      const hit = (n.results ?? []).filter((r) => String(r.board ?? "").includes(names[0]));
      console.log(`  ${n.created_at.toISOString().slice(0, 16)} ${n.status} ${JSON.stringify(hit)}`);
    }
    if (!notes.length) console.log("  (없음)");
  } finally {
    await sql.end();
  }
})();
