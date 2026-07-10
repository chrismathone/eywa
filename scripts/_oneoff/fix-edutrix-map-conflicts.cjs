// Fix 이서은A / 송준영 mapping conflicts (read + optional --apply).
// Usage: node --env-file=.env.local scripts/_oneoff/fix-edutrix-map-conflicts.cjs [--apply]
const { createClient } = require("@supabase/supabase-js");
const postgres = require("postgres");

const TENANT = "becaa316-e636-42e9-9d09-08b133e0b094";
const APPLY = process.argv.includes("--apply");

const TARGETS = [
  { preferName: "이서은A", school: "대구일중", grade: "중2" },
  { preferName: "송준영", school: "칠성고", grade: "고1" },
];

function extractTeacher(className) {
  if (!className) return null;
  const first = className.split(/[\s_]+/)[0] || "";
  const ex = { 김정은: "김은정" };
  return ex[first] || first || null;
}

(async () => {
  const edu = createClient(process.env.EDUTRIX_SUPABASE_URL, process.env.EDUTRIX_SUPABASE_ANON_KEY);
  const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });

  for (const t of TARGETS) {
    console.log("\n==========", t.preferName, "==========");

    // All edutrix students whose name normalizes similarly
    const eduAll = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await edu.from("students").select("id, name, school, grade").range(from, from + 999);
      if (error) throw error;
      if (!data?.length) break;
      for (const s of data) {
        const n = (s.name || "").replace(/\s+/g, "");
        const want = t.preferName.replace(/\s+/g, "");
        if (n === want || (s.name || "").includes(want.slice(0, 3))) {
          // tighter: normalized equal only
        }
        if (n === want) eduAll.push(s);
      }
      if (data.length < 1000) break;
    }
    // also fetch by exact variants
    const variants = new Set([t.preferName, t.preferName + " ", t.preferName.replace(/A$/, " A"), t.preferName.replace(/A$/, "A")]);
    for (const v of [...variants]) {
      const { data } = await edu.from("students").select("id, name, school, grade").eq("name", v);
      for (const s of data || []) {
        if (!eduAll.some((x) => x.id === s.id)) eduAll.push(s);
      }
    }
    // broader: ilike not available well — scan all once for normalized match
    const eduHits = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await edu.from("students").select("id, name, school, grade").range(from, from + 999);
      if (error) throw error;
      if (!data?.length) break;
      for (const s of data) {
        if ((s.name || "").replace(/\s+/g, "") === t.preferName.replace(/\s+/g, "")) eduHits.push(s);
      }
      if (data.length < 1000) break;
    }
    console.log("edutrix students (norm name match):", eduHits);

    for (const es of eduHits) {
      const { count } = await edu
        .from("reports")
        .select("id", { count: "exact", head: true })
        .eq("student_id", es.id);
      console.log("  reports for", JSON.stringify(es.name), es.id.slice(0, 8), "count≈", count);
    }

    // pick preferred: exact name preferName, else school+grade, else most reports
    let best = eduHits.find((s) => s.name === t.preferName);
    if (!best) best = eduHits.find((s) => s.school === t.school && s.grade === t.grade);
    if (!best && eduHits.length === 1) best = eduHits[0];
    if (!best && eduHits.length) {
      // most reports
      let maxC = -1;
      for (const es of eduHits) {
        const { count } = await edu
          .from("reports")
          .select("id", { count: "exact", head: true })
          .eq("student_id", es.id);
        if ((count || 0) > maxC) {
          maxC = count || 0;
          best = es;
        }
      }
    }
    console.log("chosen edutrix student:", best);

    // eywa candidates
    const eywa = await sql`
      select id, name, school, grade, status, edutrix_student_id, makeedu_id
      from students
      where tenant_id = ${TENANT}
        and replace(name, ' ', '') = ${t.preferName.replace(/\s+/g, "")}
    `;
    console.log("eywa candidates:", eywa);

    let eywaTarget = eywa.find((s) => s.school === t.school && s.grade === t.grade);
    if (!eywaTarget) eywaTarget = eywa.find((s) => s.status === "enrolled");
    if (!eywaTarget) eywaTarget = eywa[0];
    console.log("chosen eywa:", eywaTarget);

    if (!best || !eywaTarget) {
      console.log("SKIP — missing best or eywa");
      continue;
    }

    // conflict: another eywa already has this edutrix id?
    const clash = await sql`
      select id, name, edutrix_student_id from students
      where tenant_id = ${TENANT}
        and edutrix_student_id = ${best.id}
        and id <> ${eywaTarget.id}
    `;
    console.log("clash if any:", clash);

    // current mapping on target
    console.log("current target mapping:", eywaTarget.edutrix_student_id);

    if (!APPLY) {
      console.log("[dry] would set", eywaTarget.name, "→", best.id, best.name);
      continue;
    }

    // clear wrong mapping on target if points to different edu id with fewer/zero reports?
    // Always set to best.id. If another eywa had best.id, clear them first.
    if (clash.length) {
      for (const c of clash) {
        await sql`update students set edutrix_student_id = null where id = ${c.id}`;
        console.log("cleared clash", c.name, c.id);
      }
    }

    await sql`
      update students
      set edutrix_student_id = ${best.id}, updated_at = now()
      where id = ${eywaTarget.id} and tenant_id = ${TENANT}
    `;
    console.log("mapped", eywaTarget.id, "→", best.id);

    // pull recent reports
    const { data: reps } = await edu
      .from("reports")
      .select("id, date, progress, exam_info, assignment_score, classes(name)")
      .eq("student_id", best.id)
      .order("date", { ascending: false })
      .limit(12);

    const existing = await sql`
      select edutrix_report_id from lesson_reports
      where tenant_id = ${TENANT} and student_id = ${eywaTarget.id}
        and source = 'edutrix_import' and edutrix_report_id is not null
    `;
    const seen = new Set(existing.map((r) => r.edutrix_report_id));
    const rows = [];
    for (const rep of reps || []) {
      if (!rep.id || seen.has(rep.id)) continue;
      const c = rep.classes;
      const cname = Array.isArray(c) ? c[0]?.name : c?.name;
      rows.push({
        tenant_id: TENANT,
        student_id: eywaTarget.id,
        report_date: rep.date,
        progress: rep.progress || null,
        exam_info: rep.exam_info || null,
        homework_score: rep.assignment_score || null,
        teacher_name: extractTeacher(cname || null),
        source: "edutrix_import",
        edutrix_report_id: rep.id,
      });
    }
    if (rows.length) {
      await sql`alter table lesson_reports disable trigger tg_log_activity_id`;
      await sql`alter table lesson_reports disable trigger tg_log_activity_u`;
      try {
        await sql`insert into lesson_reports ${sql(rows)}`;
      } finally {
        await sql`alter table lesson_reports enable trigger tg_log_activity_id`;
        await sql`alter table lesson_reports enable trigger tg_log_activity_u`;
      }
    }
    console.log("pulled reports:", rows.length, "of", (reps || []).length);
  }

  // verify still unmapped?
  console.log("\n=== verify ===");
  for (const t of TARGETS) {
    const { data: eduS } = await edu.from("students").select("id, name").eq("name", t.preferName).maybeSingle();
    if (!eduS) {
      console.log(t.preferName, "edutrix exact not found");
      continue;
    }
    const ey = await sql`
      select id, name, edutrix_student_id from students
      where tenant_id = ${TENANT} and edutrix_student_id = ${eduS.id}
    `;
    console.log(t.preferName, "edu", eduS.id.slice(0, 8), "→ eywa", ey);
  }

  await sql.end();
  console.log(APPLY ? "\nDONE apply" : "\nDRY-RUN (pass --apply to write)");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
