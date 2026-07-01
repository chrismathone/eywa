// 유령 수강 정리 — run.ts의 옛 버그(end<start → null "진행중 보정")로 되살아난 종료 수강을 닫는다.
// ijw 원본에서 그 (학생·반) 조합이 전부 종료됐는데 eywa엔 end_date=null(무한 활성)로 남아 시간표에서
// 옛 반·새 반 양쪽에 유령으로 뜨던 것(강사 간 학생 중복). 종료로 닫되 daterange(start,end,'[)')가 end<start면
// throw하므로 end_date=start_date(빈 구간=활성 아님)로 닫는다. 멱등(닫힌 뒤엔 0건). run.ts는 영구 수정됨.
// 사용: node --env-file=.env.local scripts/_poc_migration/close-phantom-enrollments.cjs [--apply]
const fs = require("fs"), path = require("path");
const postgres = require("postgres");
const APPLY = process.argv.includes("--apply");
let url = process.env.DATABASE_URL;
if (!url) { const e = fs.readFileSync("D:/eywa_refactoring/.env.local", "utf8"); url = e.split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="))?.slice(13).trim().replace(/^["']|["']$/g, ""); }
const T = "becaa316-e636-42e9-9d09-08b133e0b094";
const TODAY = new Date().toISOString().slice(0, 10);
const sql = postgres(url, { prepare: false });

const normDate = (s) => { const m = s && String(s).match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[1]}-${m[2]}-${m[3]}` : null; };

(async () => {
  try {
    const dir = "D:/tmp";
    const f = fs.readdirSync(dir).filter((x) => /^ijw-export-.*\.json$/.test(x)).sort().pop();
    if (!f) throw new Error("ijw-export JSON not found in D:/tmp");
    const C = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")).collections;
    const classNameById = new Map();
    for (const c of C.classes ?? []) classNameById.set(c.id, c.className);

    // ijw: (name|school|grade || className) → 그 조합에 "종료 안 된"(진행중/미래) 기록이 하나라도 있나
    const sk = (n, s, g) => `${n}|${s ?? ""}|${g ?? ""}`;
    const anyNotEnded = new Map();
    for (const st of C.students ?? []) {
      for (const e of st.enrollments ?? []) {
        const cname = classNameById.get(e.classId);
        if (!cname) continue;
        const end0 = normDate(e.endDate || e.withdrawalDate);
        const notEnded = !end0 || end0 >= TODAY;
        const k = `${sk(st.name, st.school, st.grade)}||${cname}`;
        if (notEnded) anyNotEnded.set(k, true);
        else if (!anyNotEnded.has(k)) anyNotEnded.set(k, false);
      }
    }

    // eywa end_date=null 전체 → ijw에 '종료 안 된' 기록이 없는 것 = 유령
    const rows = await sql`
      select e.id, s.name, s.school, s.grade, c.class_name, u.display_name teacher,
             to_char(e.start_date,'YYYY-MM-DD') start_date
      from enrollments e
      join classes c on c.id=e.class_id
      join students s on s.id=e.student_id
      left join users u on u.id=c.teacher_id
      where e.tenant_id=${T} and e.end_date is null`;

    const phantom = rows.filter((r) => anyNotEnded.get(`${sk(r.name, r.school, r.grade)}||${r.class_name}`) === false);
    console.log(`=== close-phantom-enrollments ${APPLY ? "[APPLY]" : "[DRY-RUN]"} ===`);
    console.log(`export: ${f} | today=${TODAY}`);
    console.log(`eywa end_date=null: ${rows.length} | 유령(닫을 대상): ${phantom.length}\n`);
    for (const p of phantom.sort((a, b) => (a.teacher ?? "").localeCompare(b.teacher ?? "", "ko") || a.name.localeCompare(b.name, "ko")))
      console.log(`  ${p.teacher ?? "(담임없음)"} | ${p.name} (${p.school ?? "-"} ${p.grade ?? "-"}) | ${p.class_name} | start=${p.start_date}`);

    const ids = phantom.map((p) => p.id);
    console.log(`\n롤백용 id(${ids.length}): ${JSON.stringify(ids)}`);
    // 롤백: update enrollments set end_date=null where id = any('{...}') and tenant_id=T

    if (!APPLY) { console.log("\n[DRY-RUN] 쓰기 없음. --apply 로 적용."); return; }
    if (ids.length === 0) { console.log("\n닫을 유령 없음(이미 정리됨)."); return; }
    // end_date=start_date(빈 구간). GiST 빈 구간은 &&가 항상 false → 같은 반 활성 수강과 충돌 없음.
    const res = await sql`update enrollments set end_date = start_date
                          where tenant_id=${T} and end_date is null and id = any(${ids})`;
    console.log(`\nAPPLIED: ${res.count}건 닫음(end_date=start_date).`);
  } catch (e) { console.error("ERR", e.message); process.exitCode = 1; }
  finally { await sql.end(); }
})();
