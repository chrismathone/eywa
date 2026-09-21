// ijw-calander data/textbookCatalog.ts → aywa textbook_catalog (데모 테넌트 ijw-demo).
// 멱등: 테넌트 카탈로그 행 wipe 후 재삽입. 사용: node scripts/_poc_migration/import-catalog.cjs [--apply]
// (소스는 ijw 코드 데이터 파일이라 Firestore export가 아닌 D:/ijw-calander 경로에서 직접 파싱.)
const fs = require("fs");
const postgres = require("postgres");

const T = "becaa316-e636-42e9-9d09-08b133e0b094"; // ijw-demo
const APPLY = process.argv.includes("--apply");
const SRC = "D:/ijw-calander/data/textbookCatalog.ts";

const src = fs.readFileSync(SRC, "utf8");
const m = src.match(/TEXTBOOK_CATALOG[^=]*=\s*(\[[\s\S]*?\n\]);/);
if (!m) {
  console.error("TEXTBOOK_CATALOG 배열을 못 찾음:", SRC);
  process.exit(1);
}
// 신뢰된 로컬 데이터 파일의 순수 객체 리터럴 배열 — eval로 로드.
const items = eval(m[1]);

const CAT = { elementary: "초", middle: "중", high: "고" };
const SUBJ = { 수학: "math", 영어: "english", 국어: "korean", 과학: "science" };

const rows = items.map((it) => ({
  tenant_id: T,
  title: String(it.name),
  book_detail: it.difficulty ? String(it.difficulty) : null,
  grade_level: CAT[it.category] ?? null,
  subject: SUBJ[it.subject || "수학"] ?? "math",
  publisher: null,
  price: String(Math.round(Number(it.price) || 0)),
  is_active: true,
}));

const by = (g) => rows.filter((r) => r.grade_level === g).length;
console.log(`파싱: ${rows.length}항목 (초 ${by("초")} / 중 ${by("중")} / 고 ${by("고")})`);

if (!APPLY) {
  console.log("[dry-run] --apply 없이 종료. 샘플:", rows.slice(0, 2));
  process.exit(0);
}

let url = process.env.DATABASE_URL;
if (!url) {
  const e = fs.readFileSync("D:/eywa_refactoring/.env.local", "utf8");
  url = e.split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL=")).slice(13).trim().replace(/^["']|["']$/g, "");
}
const sql = postgres(url, { prepare: false, max: 3 });
(async () => {
  try {
    await sql`delete from textbook_catalog where tenant_id=${T}`;
    const cols = ["tenant_id", "title", "book_detail", "grade_level", "subject", "publisher", "price", "is_active"];
    for (let i = 0; i < rows.length; i += 100) {
      await sql`insert into textbook_catalog ${sql(rows.slice(i, i + 100), ...cols)}`;
    }
    const after = await sql`select count(*)::int n from textbook_catalog where tenant_id=${T}`;
    console.log(`재삽입 완료: ${after[0].n}행`);
  } catch (err) {
    console.error("FAILED:", err.message);
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
})();
