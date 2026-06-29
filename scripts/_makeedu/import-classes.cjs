/**
 * scripts/_makeedu/import-classes.cjs — makeedu 수업목록 → eywa `classes` (makeedu_lesson_id 멱등, 0057a).
 * 담임강사는 eywa `users`(보존됨)에 이름/영문명으로 매칭. 과목은 수업명에서 도출(operations.subjects).
 * 입력: $MAKEEDU_OUT(기본 D:/tmp/makeedu)/classes.json (scrape.cjs 산출, rows=[헤더→셀]).
 * ⚠️ class_schedules(요일·교시 시각)은 시간표(timeTable.do) 별도 — 여기선 미생성(후속). bg/text_color=eywa 고유 보존(미설정).
 *   node --env-file=.env.local scripts/_makeedu/import-classes.cjs [--apply]
 */
const fs = require("fs");
const path = require("path");
const postgres = require("postgres");
const L = require("./lib.cjs");

const APPLY = process.argv.includes("--apply");
const OUT = process.env.MAKEEDU_OUT || "D:/tmp/makeedu";

function load(key) {
  return JSON.parse(fs.readFileSync(path.join(OUT, `${key}.json`), "utf8"));
}
function indexer(headers) {
  return (sub) => headers.findIndex((h) => (h || "").includes(sub));
}
// "이수연(Hannah)" → { ko:"이수연", en:"Hannah" }
function splitTeacher(s) {
  const t = L.txt(s);
  if (!t) return { ko: null, en: null };
  const m = t.match(/^(.*?)\s*[(（]([^)）]+)[)）]\s*$/);
  if (m) return { ko: m[1].trim() || null, en: m[2].trim() || null };
  return { ko: t, en: null };
}

(async () => {
  const data = load("classes");
  const H = indexer(data.headers);
  const ci = {
    code: 0, // 선행 무라벨 셀 = lessonCode(예 05056)
    name: H("수업명"),
    fee: H("수업료"),
    days: H("요일"),
    teacher: H("담임"),
    room: H("강의실"),
    cap: H("정원"),
    status: H("상태"),
  };
  const raw = [];
  for (const r of data.rows) {
    const name = L.txt(r[ci.name]);
    if (!name || name === "신규") continue;
    if (L.isNonClass(name)) continue; // 교재 단가·시스템 사용료 등 과금/관리용 가짜 항목 차단
    const code = L.txt(r[0]);
    raw.push({
      makeedu_lesson_id: code,
      class_name: name,
      subject: L.subjectFromName(name, r[ci.teacher]),
      teacher: splitTeacher(r[ci.teacher]),
      is_active: L.txt(r[ci.status]) !== "종강",
    });
  }
  // eywa classes 유니크 (tenant, class_name, subject) — makeedu는 동명 반(섹션) 복수 허용 → (이름,과목) dedup(첫 행 유지).
  // 학생 '수업' 컬럼도 이름만이라 섹션 구분 불가 → 이름 기준 단일 반이 매칭에 맞다.
  const seenNS = new Set();
  const rows = [];
  for (const r of raw) {
    const k = `${r.subject}|${r.class_name.replace(/\s+/g, "").toLowerCase()}`;
    if (seenNS.has(k)) continue;
    seenNS.add(k);
    rows.push(r);
  }
  console.log(`file: classes.json  parsed ${raw.length} → dedup(이름+과목) ${rows.length}`);
  const subjDist = rows.reduce((a, r) => ((a[r.subject] = (a[r.subject] || 0) + 1), a), {});
  console.log("subject dist:", subjDist);

  const sql = postgres(process.env.DATABASE_URL, { prepare: false });
  try {
    const tenantId = await L.resolveTenantId(sql);
    // 담임 매칭 맵 (display_name / english_name → user id)
    const users = await sql`select id, display_name, english_name from users where tenant_id = ${tenantId}`;
    const byKo = new Map(), byEn = new Map();
    for (const u of users) {
      if (u.display_name) byKo.set(u.display_name.trim(), u.id);
      if (u.english_name) byEn.set(u.english_name.trim().toLowerCase(), u.id);
    }
    let matched = 0, unmatched = [];
    for (const r of rows) {
      r.teacher_id = (r.teacher.ko && byKo.get(r.teacher.ko)) || (r.teacher.en && byEn.get(r.teacher.en.toLowerCase())) || null;
      if (r.teacher_id) matched++;
      else if (r.teacher.ko || r.teacher.en) unmatched.push(`${r.teacher.ko || ""}(${r.teacher.en || ""})`);
    }
    console.log(`teacher match: ${matched}/${rows.length}`);
    if (unmatched.length) console.log("unmatched teachers (sample):", [...new Set(unmatched)].slice(0, 12));
    console.log("dup makeedu_lesson_id:", rows.length - new Set(rows.map((r) => r.makeedu_lesson_id)).size);
    console.log("sample:", JSON.stringify({ ...rows[0], teacher: undefined }));

    if (!APPLY) {
      console.log("\n[DRY-RUN] --apply 없이 종료 (DB write 0).");
      return;
    }
    let up = 0;
    for (const r of rows) {
      await sql`
        insert into classes (tenant_id, makeedu_lesson_id, class_name, subject, teacher_id, is_active)
        values (${tenantId}, ${r.makeedu_lesson_id}, ${r.class_name}, ${r.subject}, ${r.teacher_id}, ${r.is_active})
        on conflict (tenant_id, makeedu_lesson_id) where makeedu_lesson_id is not null
        do update set class_name = excluded.class_name, subject = excluded.subject,
          teacher_id = excluded.teacher_id, is_active = excluded.is_active`;
      up++;
    }
    await L.recordSync(sql, tenantId, "classes", up);
    console.log("upserted classes:", up);
  } finally {
    await sql.end();
  }
})().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
