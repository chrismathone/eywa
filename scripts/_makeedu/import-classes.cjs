/**
 * scripts/_makeedu/import-classes.cjs — makeedu 수업목록 → eywa `classes` **additive(ijw 정본)**.
 * ⚠️ ijw 반이 정본(반 색상·스케줄·담임 보유). makeedu-only 반은 생성하지 않고, 이름이 정확히 일치하는
 *    ijw 반에만 `makeedu_lesson_id`를 백필(미설정인 경우만). ijw 코드명 vs makeedu 풀네임이라 대부분 미일치(정상).
 * 입력: $MAKEEDU_OUT(기본 D:/tmp/makeedu)/classes.json (scrape.cjs 산출, rows=[헤더→셀]).
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
  console.log("subject dist:", rows.reduce((a, r) => ((a[r.subject] = (a[r.subject] || 0) + 1), a), {}));

  // additive: ijw 반이 정본(색상·스케줄·담임). makeedu-only 반은 **만들지 않는다**(색 없는 중복 방지).
  // 이름이 정확히 일치하는 ijw 반에만 makeedu_lesson_id를 백필(미설정인 경우만). ijw는 코드명('PJ2'),
  // makeedu는 풀네임('[EiE] Pre Junior')이라 대부분 미일치 = 정상(미연결로 남김, 색/스케줄 그대로 보존).
  const norm = (s) => (s || "").replace(/[\s[\]()（）]/g, "").toLowerCase();
  const sql = postgres(process.env.DATABASE_URL, { prepare: false });
  try {
    const tenantId = await L.resolveTenantId(sql);
    const existing = await sql`select id, makeedu_lesson_id, class_name, subject from classes where tenant_id = ${tenantId}`;
    const byLesson = new Map(existing.filter((c) => c.makeedu_lesson_id).map((c) => [c.makeedu_lesson_id, c.id]));
    const match = L.tieredMatcher(existing, [
      (c) => `${c.subject}|${norm(c.class_name)}`,
      (c) => norm(c.class_name),
    ]);
    const toLink = [], unmatched = [];
    let already = 0;
    for (const r of rows) {
      if (byLesson.has(r.makeedu_lesson_id)) { already++; continue; }
      const id = match({ subject: r.subject, class_name: r.class_name });
      if (id) toLink.push({ id, makeedu_lesson_id: r.makeedu_lesson_id });
      else unmatched.push(r.class_name);
    }
    console.log(`\n[additive] ijw 반 ${existing.length} | makeedu 반 ${rows.length}`);
    console.log(`  이미 연결됨: ${already} | 이름 일치→makeedu_lesson_id 백필: ${toLink.length} | 미일치(미연결, 신규 생성 안 함): ${unmatched.length}`);
    if (unmatched.length) console.log("  미일치 표본:", unmatched.slice(0, 10).join(", "));

    if (!APPLY) {
      console.log("\n[DRY-RUN] --apply 없이 종료 (DB write 0).");
      return;
    }
    let linked = 0;
    for (const t of toLink) {
      const res = await sql`update classes set makeedu_lesson_id = ${t.makeedu_lesson_id} where id = ${t.id} and makeedu_lesson_id is null`;
      linked += res.count;
    }
    await L.recordSync(sql, tenantId, "classes", linked);
    console.log(`\nbackfilled makeedu_lesson_id: ${linked} (신규 반 생성: 0 — ijw 정본)`);
  } finally {
    await sql.end();
  }
})().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
