/**
 * ⚠️ SUPERSEDED by sync-consultations.cjs — 이 스크립트는 목록의 제목만 summary로 넣고 makeedu_id를 표시용 'No'로
 *    저장한다(상담 본문 누락 + No≠counselSeq). 상담 동기화는 **sync-consultations.cjs**(counselSeq + 상세 본문)를 쓸 것.
 *    (참고용으로 남김 — 재실행 금지: 내용을 제목으로 덮어쓰고 makeedu_id가 어긋난다.)
 *
 * scripts/_makeedu/import-consultations.cjs — makeedu 상담내역(재원생) → eywa `student_consultations` (makeedu_id 멱등, 0057a).
 * student_id(NN) 필수 → 학생 매칭(makeedu_id 임포트 후 (이름·학교·학년)) 실패 행은 스킵+로그. counselor=users 매칭.
 * 입력: $MAKEEDU_OUT/consultations.json (전체 이력 5000 — 412 재원생 매칭분만 적재).
 *   node --env-file=.env.local scripts/_makeedu/import-consultations.cjs [--apply]
 */
const fs = require("fs");
const path = require("path");
const postgres = require("postgres");
const L = require("./lib.cjs");

const APPLY = process.argv.includes("--apply");
const OUT = process.env.MAKEEDU_OUT || path.resolve(__dirname, "..", "..", ".makeedu-tmp");
const idx = (H) => (s) => H.findIndex((h) => (h || "").includes(s));

(async () => {
  const data = JSON.parse(fs.readFileSync(path.join(OUT, "consultations.json"), "utf8"));
  const H = idx(data.headers);
  const ci = { name: H("이름"), school: H("학교"), grade: H("학년"), title: H("제목"), cat: H("상담구분"), reg: H("등록자"), cdate: H("상담일") };
  const noIx = data.headers.findIndex((h) => (h || "").includes("No"));
  const rows = [];
  for (const r of data.rows) {
    const name = L.txt(r[ci.name]);
    if (!name) continue;
    const title = L.txt(r[ci.title]) || "상담";
    rows.push({
      makeedu_id: L.txt(r[noIx >= 0 ? noIx : 0]),
      name,
      school: L.txt(r[ci.school]),
      grade: L.gradeNorm(r[ci.grade]),
      summary: title,
      registrant: L.txt(r[ci.reg]),
      consulted_at: L.parseTimestamp(r[ci.cdate]),
    });
  }
  console.log("file: consultations.json  parsed:", rows.length);

  const sql = postgres(process.env.DATABASE_URL, { prepare: false });
  try {
    const tenantId = await L.resolveTenantId(sql);
    // 학생 매칭 맵: makeedu로 임포트된 students (normName|grade|school → id), 폴백 normName|grade, normName.
    const studs = await sql`select id, name, grade, school from students where tenant_id = ${tenantId} and makeedu_id is not null`;
    const m3 = new Map(), m2 = new Map(), m1 = new Map();
    for (const s of studs) {
      const n = L.normalizeName(s.name);
      m3.set(`${n}|${s.grade || ""}|${s.school || ""}`, s.id);
      m2.set(`${n}|${s.grade || ""}`, s.id);
      if (!m1.has(n)) m1.set(n, s.id); else m1.set(n, null); // 동명이인이면 null(폴백 금지)
    }
    const users = await sql`select id, display_name, english_name from users where tenant_id = ${tenantId}`;
    const uKo = new Map(), uEn = new Map();
    for (const u of users) { if (u.display_name) uKo.set(u.display_name.trim(), u.id); if (u.english_name) uEn.set(u.english_name.trim().toLowerCase(), u.id); }

    let matched = 0, unmatched = 0;
    for (const r of rows) {
      const n = L.normalizeName(r.name);
      r.student_id = m3.get(`${n}|${r.grade || ""}|${r.school || ""}`) || m2.get(`${n}|${r.grade || ""}`) || m1.get(n) || null;
      if (r.student_id) matched++; else unmatched++;
      const rk = (r.registrant || "").match(/^(.*?)\s*[(（]([^)）]+)[)）]?\s*$/);
      const ko = rk ? rk[1].trim() : r.registrant;
      const en = rk ? rk[2].trim().toLowerCase() : null;
      r.counselor_id = (ko && uKo.get(ko)) || (en && uEn.get(en)) || null;
    }
    console.log(`student match: ${matched}/${rows.length} (unmatched ${unmatched} = 비활성/과거 학생 → 스킵)`);

    if (!APPLY) {
      console.log("[DRY-RUN] --apply 없이 종료 (DB write 0).");
      return;
    }
    let up = 0;
    for (const r of rows) {
      if (!r.student_id) continue; // student_id NN — 매칭 실패 스킵
      await sql`
        insert into student_consultations (tenant_id, makeedu_id, student_id, counselor_id, summary, consulted_at)
        values (${tenantId}, ${r.makeedu_id}, ${r.student_id}, ${r.counselor_id}, ${r.summary}, ${r.consulted_at ?? sql`now()`})
        on conflict (tenant_id, makeedu_id) where makeedu_id is not null
        do update set student_id = excluded.student_id, counselor_id = excluded.counselor_id,
          summary = excluded.summary, consulted_at = excluded.consulted_at, updated_at = now()`;
      up++;
    }
    await L.recordSync(sql, tenantId, "consultations", up);
    console.log("upserted consultations:", up);
  } finally {
    await sql.end();
  }
})().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
