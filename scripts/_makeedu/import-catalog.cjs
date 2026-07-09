/**
 * scripts/_makeedu/import-catalog.cjs — makeedu 기타수납 단가표 → eywa.
 *   · 수납구분=교재 → `textbook_catalog` (makeedu_id 멱등, 0057a)
 *   · 그 외(재료/유니폼/차량비/식비/학용품/교구 등) → `tuition_catalog` (category="기타", 이름 기준 — fresh wipe라 insert)
 * 입력: $MAKEEDU_OUT/catalog.json.
 *   node --env-file=.env.local scripts/_makeedu/import-catalog.cjs [--apply]
 */
const fs = require("fs");
const path = require("path");
const postgres = require("postgres");
const L = require("./lib.cjs");

const APPLY = process.argv.includes("--apply");
const OUT = process.env.MAKEEDU_OUT || path.resolve(__dirname, "..", "..", ".makeedu-tmp");
const idx = (H) => (s) => H.findIndex((h) => (h || "").includes(s));

// makeedu 학년(초5 등) → textbook_catalog.grade_level 코어스(초/중/고).
function coarseGrade(v) {
  const s = L.txt(v) || "";
  if (/초|유치/.test(s)) return "초";
  if (/중/.test(s)) return "중";
  if (/고/.test(s)) return "고";
  return null;
}

(async () => {
  const data = JSON.parse(fs.readFileSync(path.join(OUT, "catalog.json"), "utf8"));
  const H = idx(data.headers);
  const ci = { name: H("수납명"), kind: H("수납구분"), price: H("판매금액"), grade: H("학년"), pub: H("제조사"), active: H("사용여부") };
  const books = [], extras = [];
  for (const r of data.rows) {
    const name = L.txt(r[ci.name]);
    if (!name || name === "신규") continue;
    const kind = L.txt(r[ci.kind]) || "";
    const rec = {
      makeedu_id: L.txt(r[0]),
      name,
      kind,
      price: L.parseAmount(r[ci.price]),
      grade: coarseGrade(r[ci.grade]),
      publisher: L.txt(r[ci.pub]),
      is_active: L.txt(r[ci.active]) !== "X",
    };
    if (/교재/.test(kind)) books.push(rec);
    else extras.push(rec);
  }
  console.log("file: catalog.json  교재:", books.length, "기타:", extras.length);
  console.log("기타 종류:", [...new Set(extras.map((e) => e.kind))]);

  // additive: textbook_catalog는 (제목+출판사)로 ijw 행에 매칭→makeedu_id 백필(값 보존)/없으면 신규.
  //           tuition_catalog 기타는 makeedu_id 컬럼이 없으므로 이름 기준 — 기존 이름이면 스킵, 새 이름만 추가.
  const normTitle = (s) => (L.txt(s) || "").replace(/\s+/g, "").toLowerCase();
  const sql = postgres(process.env.DATABASE_URL, { prepare: false });
  try {
    const tenantId = await L.resolveTenantId(sql);
    const existBooks = await sql`select id, makeedu_id, title, publisher from textbook_catalog where tenant_id = ${tenantId}`;
    const byMakeedu = new Map(existBooks.filter((b) => b.makeedu_id).map((b) => [b.makeedu_id, b.id]));
    const matchBook = L.tieredMatcher(existBooks, [
      (b) => `${normTitle(b.title)}|${(L.txt(b.publisher) || "")}`,
      (b) => normTitle(b.title),
    ]);
    const bookLink = [], bookInsert = [];
    let bookAlready = 0;
    for (const r of books) {
      if (byMakeedu.has(r.makeedu_id)) { bookAlready++; continue; }
      const id = matchBook({ title: r.name, publisher: r.publisher });
      if (id) bookLink.push({ id, makeedu_id: r.makeedu_id });
      else bookInsert.push(r);
    }
    const existExtra = new Set(
      (await sql`select name from tuition_catalog where tenant_id = ${tenantId} and category = ${"기타"}`).map((x) => x.name),
    );
    const extraSeen = new Set(), extraInsert = [];
    for (const r of extras) {
      if (existExtra.has(r.name) || extraSeen.has(r.name)) continue;
      extraSeen.add(r.name);
      extraInsert.push(r);
    }
    console.log(`\n[additive] 교재(textbook_catalog) ijw ${existBooks.length} | makeedu ${books.length}`);
    console.log(`  이미 연결됨: ${bookAlready} | 매칭→백필: ${bookLink.length} | 신규 추가: ${bookInsert.length}`);
    console.log(`[additive] 기타(tuition_catalog) 기존 ${existExtra.size} → 신규 추가: ${extraInsert.length}`);

    if (!APPLY) {
      console.log("\n[DRY-RUN] --apply 없이 종료 (DB write 0).");
      return;
    }
    // ↻ 동기화 배지 = "지난 동기화가 새로 추가한 교재". 이 성공 실행 시작에 지난 신규 표시를 클리어(0062a).
    const cleared = await sql`update textbook_catalog set sync_added_at = null where tenant_id = ${tenantId} and sync_added_at is not null`;
    if (cleared.count) console.log(`  지난 동기화 라벨 클리어: ${cleared.count}`);
    let bl = 0, bi = 0, e = 0;
    for (const t of bookLink) {
      const res = await sql`update textbook_catalog set makeedu_id = ${t.makeedu_id}, updated_at = now() where id = ${t.id} and makeedu_id is null`;
      bl += res.count;
    }
    for (const r of bookInsert) {
      await sql`
        insert into textbook_catalog (tenant_id, makeedu_id, title, grade_level, publisher, price, is_active, sync_added_at)
        values (${tenantId}, ${r.makeedu_id}, ${r.name}, ${r.grade}, ${r.publisher}, ${r.price}, ${r.is_active}, now())
        on conflict (tenant_id, makeedu_id) where makeedu_id is not null do nothing`;
      bi++;
    }
    for (const r of extraInsert) {
      await sql`
        insert into tuition_catalog (tenant_id, category, name, price, is_active)
        values (${tenantId}, ${"기타"}, ${r.name}, ${r.price}, ${r.is_active})`;
      e++;
    }
    await L.recordSync(sql, tenantId, "catalog", bl + bi + e);
    console.log(`\n교재 백필 ${bl} 신규 ${bi} | 기타 신규 ${e}`);
  } finally {
    await sql.end();
  }
})().catch((err) => {
  console.error("ERR", err.message);
  process.exit(1);
});
