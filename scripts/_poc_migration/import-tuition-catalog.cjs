// ijw 수강료 계산기 "설정" 단가표 → aywa tuition_catalog 데모 이식.
// 출처: D:/ijw-calander/constants/tuitionCourses.ts(43) + tuitionExtras.ts(기타 4·할인 3).
// 멱등: 테넌트 기존 tuition_catalog 행 삭제 후 재삽입. 사용: node scripts/_poc_migration/import-tuition-catalog.cjs [--apply]
const fs = require("fs");
const postgres = require("postgres");

const APPLY = process.argv.includes("--apply");
const T = "becaa316-e636-42e9-9d09-08b133e0b094"; // ijw-demo 테넌트
let url = process.env.DATABASE_URL;
if (!url) {
  const e = fs.readFileSync("D:/eywa_refactoring/.env.local", "utf8");
  url = e.split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="))?.slice(13).trim().replace(/^["']|["']$/g, "");
}

// 분류 라벨: 수학(MATH)·EIE(ENGLISH)·영어(ENGLISH_SUB)·국어(KOREAN)
const COURSES = [
  // --- 수학 (회당 단가) ---
  ["수학", "초등M 개별심화", 21250],
  ["수학", "초등M 정규반 (3T2H)", 21250],
  ["수학", "초등M 정규반 (2T2H)", 22500],
  ["수학", "초등M 개별진도반 (3T2H)", 21250],
  ["수학", "중등M 정규반 (3T2H)", 24000],
  ["수학", "중등M 특별반 (3T2H)", 25000],
  ["수학", "중등M 특별반 (2T3H)", 37500],
  ["수학", "중등 내신대비반 (3T2H)", 24000],
  ["수학", "중등 현행심화반 (3T2H)", 24000],
  ["수학", "고등M 정규반 (3T2H)", 27250],
  ["수학", "고등M 정규반 (2T3H)", 40875],
  ["수학", "고등M 선택과목반 (3T2H)", 31250],
  ["수학", "중등M_PrideS반 (2T3H)", 36000],
  ["수학", "고등M_PrideS반 (2T3H)", 40875],
  ["수학", "초등M_메디컬반 (2T2H)", 22500],
  ["수학", "중등M_메디컬반 (2T3H)", 37500],
  ["수학", "고등M_메디컬반 (2T3H)", 43750],
  ["수학", "수능반 (2T3H)", 37500],
  // --- EIE (월 단가) ---
  ["EIE", "Dr.Phonics", 270000],
  ["EIE", "Pre Let's", 270000],
  ["EIE", "Ready To Talk", 270000],
  ["EIE", "Let's Talk", 270000],
  ["EIE", "Ready To Speak", 270000],
  ["EIE", "Let's Speak", 270000],
  ["EIE", "Let's Express", 270000],
  ["EIE", "Kopi Wang", 270000],
  ["EIE", "Pre Junior", 270000],
  ["EIE", "Junior Plus", 270000],
  ["EIE", "Senior Plus", 270000],
  ["EIE", "Middle School English Course", 270000],
  // --- 영어 (회당 단가) ---
  ["영어", "중등E_초등브릿지 (3T2H)", 24000],
  ["영어", "중등E_초5메디컬 (3T2H)", 24000],
  ["영어", "중등E_초6브릿지SKY (3T2H)", 24000],
  ["영어", "중고E_초6메디컬 (2T3H)", 37500],
  ["영어", "중등E_정규 (3T2H)", 24000],
  ["영어", "중등E_정규 (2T3H)", 36000],
  ["영어", "중등E_정규 TOP (3T2H)", 25000],
  ["영어", "중등E_정규 TOP (2T3H)", 37500],
  ["영어", "중등E_TOP (3T2H)", 24000],
  ["영어", "고등E_중등메디컬 (3T2H)", 27250],
  ["영어", "고등E_정규 (2T3H)", 40875],
  // --- 국어 (회당 단가) ---
  ["국어", "중등국어 (비재원생)", 31250],
  ["국어", "중등국어 (재원생)", 25000],
];

// 기타 부가 항목(ijw tuitionExtras 서비스 4종)
const EXTRAS = [
  ["기타", "레벨 테스트 비용", 20000],
  ["기타", "시스템 사용료", 30000],
  ["기타", "셔틀버스비", 20000],
  ["기타", "스터디케어", 50000],
];

// 할인 프리셋(ijw tuitionDiscounts 3종 — 정액)
const DISCOUNTS = [
  ["할인", "형제 할인", 10000],
  ["할인", "레벨 테스트 비용 차감", 20000],
  ["할인", "동시수강 할인", 10000],
];

const ALL = [...COURSES, ...EXTRAS, ...DISCOUNTS];

async function main() {
  const sql = postgres(url, { ssl: "require", prepare: false, max: 3 });
  try {
    const existing = await sql`select count(*)::int as n from tuition_catalog where tenant_id = ${T}`;
    console.log(`tenant 기존 tuition_catalog 행: ${existing[0].n}`);
    console.log(`이식 대상: 과목 ${COURSES.length} + 기타 ${EXTRAS.length} + 할인 ${DISCOUNTS.length} = ${ALL.length}`);
    if (!APPLY) {
      console.log("DRY-RUN (적용 안 함). --apply 로 실제 반영.");
      return;
    }
    await sql`delete from tuition_catalog where tenant_id = ${T}`;
    const rows = ALL.map(([category, name, price]) => ({ tenant_id: T, category, name, price }));
    await sql`insert into tuition_catalog ${sql(rows, "tenant_id", "category", "name", "price")}`;
    const after = await sql`select category, count(*)::int as n from tuition_catalog where tenant_id = ${T} group by category order by category`;
    console.log("적용 완료. 분류별 행수:");
    console.table(after);
  } finally {
    await sql.end();
  }
}
main().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
