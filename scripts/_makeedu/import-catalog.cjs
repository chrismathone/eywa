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
const OUT = process.env.MAKEEDU_OUT || "D:/tmp/makeedu";
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
  console.log("sample 교재:", JSON.stringify(books[0]));

  if (!APPLY) {
    console.log("\n[DRY-RUN] --apply 없이 종료 (DB write 0).");
    return;
  }
  const sql = postgres(process.env.DATABASE_URL, { prepare: false });
  try {
    const tenantId = await L.resolveTenantId(sql);
    let b = 0, e = 0;
    for (const r of books) {
      await sql`
        insert into textbook_catalog (tenant_id, makeedu_id, title, grade_level, publisher, price, is_active)
        values (${tenantId}, ${r.makeedu_id}, ${r.name}, ${r.grade}, ${r.publisher}, ${r.price}, ${r.is_active})
        on conflict (tenant_id, makeedu_id) where makeedu_id is not null
        do update set title = excluded.title, grade_level = excluded.grade_level,
          publisher = excluded.publisher, price = excluded.price, is_active = excluded.is_active, updated_at = now()`;
      b++;
    }
    // tuition_catalog는 makeedu_id 컬럼 없음 → fresh wipe 후 insert(이름 중복만 스킵).
    const seen = new Set();
    for (const r of extras) {
      if (seen.has(r.name)) continue;
      seen.add(r.name);
      await sql`
        insert into tuition_catalog (tenant_id, category, name, price, is_active)
        values (${tenantId}, ${"기타"}, ${r.name}, ${r.price}, ${r.is_active})`;
      e++;
    }
    await L.recordSync(sql, tenantId, "catalog", b + e);
    console.log("upserted 교재:", b, "기타:", e);
  } finally {
    await sql.end();
  }
})().catch((err) => {
  console.error("ERR", err.message);
  process.exit(1);
});
