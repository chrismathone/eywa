/**
 * scripts/_makeedu/import-students-list.cjs
 *
 * makeedu **재원생 목록 DOM 스크래핑**(scrape.cjs --list=students → students.json) → eywa `students` additive 동기화.
 * Phase 2 cron 전용 — 부트스트랩의 import-students.cjs(엑셀 47컬럼)는 헤드리스에서 못 쓰므로, 컬럼 적은 DOM
 * 목록을 **header-driven**으로 소비한다. 자연키(이름+학교+학년)로 기존 학생에 매칭 → 없으면 신규 추가(ijw 값 불변).
 *
 * ⚠️ DOM 목록의 첫 셀(No)은 표시용 순번이라 안정 PK가 아니다 → 헤더에 '고유번호'가 있을 때만 makeedu_id 백필,
 *    없으면 자연키 매칭만(makeedu_id 안 건드림). import-students.cjs(엑셀)와 동일한 additive·자연키 가드 사용.
 *
 * 사용: node --env-file=.env.local scripts/_makeedu/import-students-list.cjs [--apply]
 * 입력: $MAKEEDU_OUT/students.json  = { headers, rows:[[...cells]] }
 */
const fs = require("fs");
const path = require("path");
const postgres = require("postgres");
const L = require("./lib.cjs");

const APPLY = process.argv.includes("--apply");
const OUT = process.env.MAKEEDU_OUT || "D:/tmp/makeedu";
const idx = (H) => (sub) => H.findIndex((h) => (h || "").includes(sub));

// DOM 상태 텍스트 → eywa status. 재원생 목록이라 미상이면 enrolled 가정.
function statusFrom(v) {
  const s = L.txt(v) || "";
  if (/퇴원/.test(s)) return "withdrawn";
  if (/휴원/.test(s)) return "on_hold";
  return "enrolled";
}

(async () => {
  const file = path.join(OUT, "students.json");
  if (!fs.existsSync(file)) throw new Error(`no students.json in ${OUT} (scrape.cjs --list=students 먼저 실행)`);
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  const H = idx(data.headers);
  const ci = {
    name: H("이름"),
    school: H("학교"),
    grade: H("학년"),
    gender: H("성별"),
    stud: H("원생연락처"),
    parentPhone: H("보호자연락처"),
    parentName: H("보호자이름"),
    code: H("출결"),
    status: H("상태"),
    uid: H("고유"), // 원생고유번호(있으면 안정 PK) — 없으면 -1
  };

  const rows = [];
  for (const r of data.rows) {
    const name = L.txt(r[ci.name]);
    if (!name || name === "신규") continue;
    rows.push({
      // 안정 고유번호 컬럼이 있을 때만 makeedu_id로 사용(없으면 null = 자연키 매칭만).
      makeedu_id: ci.uid >= 0 ? L.txt(r[ci.uid]) : null,
      name,
      school: ci.school >= 0 ? L.txt(r[ci.school]) : null,
      grade: ci.grade >= 0 ? L.gradeNorm(r[ci.grade]) : null,
      gender: ci.gender >= 0 ? L.gender(r[ci.gender]) : null,
      student_phone: ci.stud >= 0 ? L.normPhone(r[ci.stud]) : null,
      parent_phone: ci.parentPhone >= 0 ? L.normPhone(r[ci.parentPhone]) : null,
      parent_name: ci.parentName >= 0 ? L.txt(r[ci.parentName]) : null,
      attendance_code: ci.code >= 0 ? L.txt(r[ci.code]) : null,
      status: ci.status >= 0 ? statusFrom(r[ci.status]) : "enrolled",
    });
  }
  console.log("file: students.json  parsed:", rows.length, "| makeedu_id 컬럼:", ci.uid >= 0 ? "있음" : "없음(자연키만)");
  console.log("status dist:", rows.reduce((a, r) => ((a[r.status] = (a[r.status] || 0) + 1), a), {}));

  const sql = postgres(process.env.DATABASE_URL, { prepare: false });
  try {
    const tenantId = await L.resolveTenantId(sql);
    const existing = await sql`
      select id, makeedu_id, name, school, grade, status from students where tenant_id = ${tenantId}`;
    const byMakeedu = new Map(existing.filter((e) => e.makeedu_id).map((e) => [e.makeedu_id, e.id]));
    // 활성 자연키(이름+학교+학년) 집합 — 부분유니크 ux_students_active_natural_key(status<>'withdrawn')와 동일.
    const activeNatural = new Set(
      existing.filter((e) => e.status !== "withdrawn").map((e) => `${L.normalizeName(e.name)}|${e.school || ""}|${e.grade || ""}`),
    );
    const match = L.tieredMatcher(existing, [
      (r) => `${L.normalizeName(r.name)}|${r.school || ""}|${r.grade || ""}`,
      (r) => `${L.normalizeName(r.name)}|${r.grade || ""}`,
      (r) => L.normalizeName(r.name),
    ]);

    const toLink = []; // 기존 학생에 makeedu_id 백필(고유번호 있을 때만)
    const toInsert = []; // eywa에 없는 신규 학생
    let alreadyLinked = 0, skippedDup = 0;
    for (const r of rows) {
      if (r.makeedu_id && byMakeedu.has(r.makeedu_id)) { alreadyLinked++; continue; }
      const id = match(r);
      if (id) {
        if (r.makeedu_id) toLink.push({ id, makeedu_id: r.makeedu_id });
        else alreadyLinked++; // 자연키로 이미 존재(makeedu_id 없어 백필 불가) = 멱등 스킵
        continue;
      }
      // 미매칭이지만 활성 동일 자연키가 있으면(모호 미연결) 신규 생성 시 제약 위반 → 사전 스킵.
      if (activeNatural.has(`${L.normalizeName(r.name)}|${r.school || ""}|${r.grade || ""}`)) { skippedDup++; continue; }
      toInsert.push(r);
    }
    console.log(`\n[additive] eywa 기존 학생 ${existing.length} | makeedu DOM ${rows.length}`);
    console.log(`  이미 존재(멱등): ${alreadyLinked} | makeedu_id 백필: ${toLink.length} | 신규 추가: ${toInsert.length}` + (skippedDup ? ` | 자연키중복 스킵: ${skippedDup}` : ""));
    if (toInsert.length) console.log("  신규 표본:", toInsert.slice(0, 5).map((r) => `${r.name}/${r.school || "?"}/${r.grade || "?"}`).join(", "));

    if (!APPLY) { console.log("\n[DRY-RUN] --apply 없이 종료 (DB write 0)."); return; }

    let linked = 0, inserted = 0;
    for (const t of toLink) {
      const res = await sql`update students set makeedu_id = ${t.makeedu_id}, updated_at = now() where id = ${t.id} and makeedu_id is null`;
      linked += res.count;
    }
    for (const r of toInsert) {
      try {
        await sql`
          insert into students (tenant_id, makeedu_id, name, gender, attendance_code, school, grade,
            student_phone, parent_phone, parent_name, status)
          values (${tenantId}, ${r.makeedu_id}, ${r.name}, ${r.gender}, ${r.attendance_code}, ${r.school}, ${r.grade},
            ${r.student_phone}, ${r.parent_phone}, ${r.parent_name}, ${r.status})`;
        inserted++;
      } catch (e) {
        if (/ux_students_active_natural_key|unique|duplicate/i.test(e.message)) { skippedDup++; continue; }
        throw e;
      }
    }
    await L.recordSync(sql, tenantId, "students", linked + inserted);
    console.log(`\nbackfilled makeedu_id: ${linked} | inserted new: ${inserted}` + (skippedDup ? ` | skipped(자연키 중복): ${skippedDup}` : ""));
  } finally {
    await sql.end();
  }
})().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
