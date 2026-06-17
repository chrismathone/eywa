// 담임(primary_teacher_id) 일괄 유도 — recomputePrimaryTeacher(actions.ts) 로직 복제.
// 학생의 활성 enrollment 중 schedule 시간 합이 가장 큰 강사를 담임으로. 실제 수강 데이터 파생(조작 아님).
// 사용: node scripts/_poc_migration/fix-primary-teacher.cjs [--apply]
const fs = require("fs");
const postgres = require("postgres");
const APPLY = process.argv.includes("--apply");
const T = "becaa316-e636-42e9-9d09-08b133e0b094";
let url = process.env.DATABASE_URL;
if (!url) { const e = fs.readFileSync("D:/eywa_refactoring/.env.local", "utf8"); url = e.split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="))?.slice(13).trim().replace(/^["']|["']$/g, ""); }
const sql = postgres(url, { prepare: false, max: 3 });
const mins = (a, b) => {
  const [sh, sm] = String(a).split(":").map(Number);
  const [eh, em] = String(b).split(":").map(Number);
  return eh * 60 + em - (sh * 60 + sm);
};
(async () => {
  try {
    const students = await sql`select id from students where tenant_id=${T} and status='enrolled'`;
    const sids = students.map((s) => s.id);
    const enr = await sql`select e.student_id, e.class_id, c.teacher_id
      from enrollments e join classes c on c.id=e.class_id
      where e.tenant_id=${T} and e.end_date is null and c.teacher_id is not null`;
    const scheds = await sql`select cs.class_id, cs.start_time, cs.end_time
      from class_schedules cs join classes c on c.id=cs.class_id where c.tenant_id=${T}`;
    const classMin = new Map();
    for (const s of scheds) classMin.set(s.class_id, (classMin.get(s.class_id) ?? 0) + mins(s.start_time, s.end_time));
    const perStudent = new Map(); // sid → Map(teacher→mins)
    for (const e of enr) {
      if (!sids.includes(e.student_id)) continue;
      const acc = perStudent.get(e.student_id) ?? new Map();
      acc.set(e.teacher_id, (acc.get(e.teacher_id) ?? 0) + (classMin.get(e.class_id) ?? 0));
      perStudent.set(e.student_id, acc);
    }
    const plan = [];
    for (const [sid, acc] of perStudent) {
      let best = "", bestM = -1;
      for (const [tid, m] of acc) if (m > bestM) { bestM = m; best = tid; }
      if (best) plan.push({ sid, tid: best });
    }
    console.log("=== fix-primary-teacher", APPLY ? "[APPLY]" : "[DRY-RUN]", "===");
    console.log("enrolled:", sids.length, "| will set 담임:", plan.length, "| 강사없는반만 수강(미설정):", sids.length - plan.length);
    if (!APPLY) { console.log("[DRY-RUN] 쓰기 없음. --apply 로 적용."); return; }
    let done = 0;
    for (const p of plan) {
      await sql`update students set primary_teacher_id=${p.tid}, updated_at=now() where id=${p.sid} and tenant_id=${T}`;
      if (++done % 100 === 0) console.log("  set", done, "/", plan.length);
    }
    console.log("APPLIED 담임 set:", done);
  } catch (e) { console.error("ERR", e.message); process.exitCode = 1; }
  finally { await sql.end(); }
})();
