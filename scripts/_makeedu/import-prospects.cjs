/**
 * scripts/_makeedu/import-prospects.cjs — makeedu 예비원생관리 → eywa `enrollment_consultations` (makeedu_id 멱등, 0057a).
 * 입력: $MAKEEDU_OUT/prospects.json. outcome enum 매핑(등원가능성).
 *   node --env-file=.env.local scripts/_makeedu/import-prospects.cjs [--apply]
 */
const fs = require("fs");
const path = require("path");
const postgres = require("postgres");
const L = require("./lib.cjs");

const APPLY = process.argv.includes("--apply");
const OUT = process.env.MAKEEDU_OUT || path.resolve(__dirname, "..", "..", ".makeedu-tmp");
const idx = (H) => (s) => H.findIndex((h) => (h || "").includes(s));

// 방어(2026-07-11): 상담일이 이보다 오래된 예비원생은 **신규 삽입 안 함**. makeedu 예비원생 목록에 2년+ 묵은
// 예비상담이 남아 목록 동기화로 계속 eywa에 유입되던 문제 차단(삭제해도 다음 동기화가 재삽입하던 근본원인 봉쇄).
// env(MAKEEDU_PROSPECT_MAX_AGE_DAYS)로 조정 가능. 백필(기존 행 makeedu_id 연결)·QR 접수(실제 신규 상담)는 무관.
const MAX_AGE_DAYS = Number(process.env.MAKEEDU_PROSPECT_MAX_AGE_DAYS) || 90;
// 상담일(consulted_at ISO)이 컷오프 이내면 삽입 허용. **날짜 미상은 신규 가능성이라 보호**(스킵 안 함).
function isRecentEnough(consultedAtIso) {
  if (!consultedAtIso) return true;
  const t = new Date(consultedAtIso).getTime();
  if (Number.isNaN(t)) return true; // 파싱 실패도 보호(옛것으로 오판해 진짜 신규 버리는 것 방지)
  return t >= Date.now() - MAX_AGE_DAYS * 86_400_000;
}

// 등원가능성 자유텍스트 → enrollment_consultations.outcome enum.
function outcome(v) {
  const s = L.txt(v) || "";
  if (/등록\s*완료|등록함|등록$/.test(s)) return "enrolled";
  if (/거절|미등록|안\s*함/.test(s)) return "declined";
  if (/노쇼|불참/.test(s)) return "no_show";
  if (/상담\s*완료/.test(s)) return "consulted";
  if (/예약|예정/.test(s)) return "scheduled";
  return "pending"; // "선택"·보류·미입력
}

(async () => {
  const data = JSON.parse(fs.readFileSync(path.join(OUT, "prospects.json"), "utf8"));
  const H = idx(data.headers);
  const ci = { name: H("이름"), school: H("학교"), grade: H("학년"), parent: H("보호자연락처"), stud: H("원생연락처"), like: H("등원가능성"), cdate: H("상담일") };
  const rows = [];
  for (const r of data.rows) {
    const name = L.txt(r[ci.name]);
    if (!name || name === "신규") continue;
    rows.push({
      makeedu_id: L.txt(r[0]),
      prospect_name: name,
      prospect_school: L.txt(r[ci.school]),
      prospect_grade: L.gradeNorm(r[ci.grade]),
      parent_phone: L.normPhone(r[ci.parent]),
      student_phone: L.normPhone(r[ci.stud]),
      outcome: outcome(r[ci.like]),
      consulted_at: L.parseTimestamp(r[ci.cdate]),
    });
  }
  console.log("file: prospects.json  parsed:", rows.length);
  console.log("outcome dist:", rows.reduce((a, r) => ((a[r.outcome] = (a[r.outcome] || 0) + 1), a), {}));
  console.log("dup makeedu_id:", rows.length - new Set(rows.map((r) => r.makeedu_id)).size, "| missing name:", rows.filter((r) => !r.prospect_name).length);

  // additive: ijw 기존 예비상담에 (이름+학교+학년)로 매칭 → makeedu_id 백필(ijw 값 보존) / 없으면 신규 추가.
  const sql = postgres(process.env.DATABASE_URL, { prepare: false });
  try {
    const tenantId = await L.resolveTenantId(sql);
    const existing = await sql`
      select id, makeedu_id, prospect_name, prospect_school, prospect_grade
      from enrollment_consultations where tenant_id = ${tenantId}`;
    const byMakeedu = new Map(existing.filter((e) => e.makeedu_id).map((e) => [e.makeedu_id, e.id]));
    const match = L.tieredMatcher(existing, [
      (r) => `${L.normalizeName(r.prospect_name)}|${r.prospect_school || ""}|${r.prospect_grade || ""}`,
      (r) => `${L.normalizeName(r.prospect_name)}|${r.prospect_grade || ""}`,
    ]);
    const toLink = [], toInsert = [];
    let alreadyLinked = 0, skippedOld = 0;
    for (const r of rows) {
      if (byMakeedu.has(r.makeedu_id)) { alreadyLinked++; continue; }
      const id = match(r);
      if (id) { toLink.push({ id, makeedu_id: r.makeedu_id }); continue; }
      // 신규 삽입 후보만 나이 게이트 적용 — 오래된 예비상담은 스킵(백필은 위에서 이미 처리돼 무관).
      if (!isRecentEnough(r.consulted_at)) { skippedOld++; continue; }
      toInsert.push(r);
    }
    console.log(`\n[additive] ijw 기존 예비상담 ${existing.length} | makeedu ${rows.length}`);
    console.log(`  이미 연결됨: ${alreadyLinked} | ijw 매칭→백필: ${toLink.length} | 신규 추가: ${toInsert.length} | 오래돼 스킵(≥${MAX_AGE_DAYS}일): ${skippedOld}`);

    if (!APPLY) {
      console.log("\n[DRY-RUN] --apply 없이 종료 (DB write 0).");
      return;
    }
    // ↻ 동기화 배지 = "지난 동기화가 새로 추가한 예비상담". 이 성공 실행 시작에 지난 신규 표시를 클리어
    // → 라벨이 "다음 동기화까지만" 유지되고 이번엔 사라진다(0062a). 매칭 백필(아래 toLink)에는 세팅 안 함.
    const cleared = await sql`update enrollment_consultations set sync_added_at = null where tenant_id = ${tenantId} and sync_added_at is not null`;
    if (cleared.count) console.log(`  지난 동기화 라벨 클리어: ${cleared.count}`);
    let linked = 0, inserted = 0;
    for (const t of toLink) {
      const res = await sql`
        update enrollment_consultations set makeedu_id = ${t.makeedu_id}, updated_at = now()
        where id = ${t.id} and makeedu_id is null`;
      linked += res.count;
    }
    for (const r of toInsert) {
      // 목록 수준 동기화라 상세 본문이 없다 → parent_request에 안내문구(sentinel)를 채워 상세가 비어 보이지 않게.
      // 나중에 sync-prospects가 실제 본문을 가져오면 이 sentinel을 덮어쓴다(lib.PROSPECT_LIST_NOTE).
      await sql`
        insert into enrollment_consultations
          (tenant_id, makeedu_id, prospect_name, prospect_school, prospect_grade, parent_phone, student_phone, outcome, consulted_at, parent_request, sync_added_at)
        values (${tenantId}, ${r.makeedu_id}, ${r.prospect_name}, ${r.prospect_school}, ${r.prospect_grade},
                ${r.parent_phone}, ${r.student_phone}, ${r.outcome}, ${r.consulted_at ?? null}, ${L.PROSPECT_LIST_NOTE}, now())
        on conflict (tenant_id, makeedu_id) where makeedu_id is not null do nothing`;
      inserted++;
    }
    await L.recordSync(sql, tenantId, "prospects", linked + inserted);
    console.log(`\nbackfilled: ${linked} | inserted new: ${inserted}`);
  } finally {
    await sql.end();
  }
})().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
