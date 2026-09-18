/**
 * 학교알리미 공시 CSV(학년별·학급별 학생수) → school_enrollment_stats 적재. (2026-08-05, 0180a와 짝)
 *
 * 목적: 학교별 **점유율**(우리 학생 수 ÷ 전교생 수). NEIS엔 전교생 수가 없어 이 CSV가 유일한 출처다.
 * 전교생 수는 **연 1회 갱신**이라 실시간 API보다 이 적재가 맞다 — 새 연도 공시가 나오면 다시 돌리면 된다.
 *
 * 받는 곳: 학교알리미(schoolinfo.go.kr) → 공시정보 → 학년별·학급별 학생수 → 시도교육청·학교급별 CSV.
 * ⚠️ 공공데이터포털 15106331은 **링크형**이라 파일이 없다(원본 사이트로 넘길 뿐).
 *
 * 실행(eywa 루트에서):
 *   node --env-file=.env.local scripts/_poc_migration/import-school-enrollment.cjs --dir "C:/Users/user/Downloads"
 *   node --env-file=.env.local scripts/_poc_migration/import-school-enrollment.cjs --dir "..." --apply
 *
 * ⚠️ CSV는 리포에 넣지 않는다 — 데이터 파일은 리포 밖에 두고 경로만 넘긴다.
 * 멱등: (tenant, year, info_code) 유니크 upsert라 다시 돌려도 중복이 안 생기고 값만 갱신된다.
 */
const fs = require("node:fs");
const path = require("node:path");
const postgres = require("postgres");

const APPLY = process.argv.includes("--apply");
const argOf = (n) => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? process.argv[i + 1] : null;
};
const DIR = argOf("--dir") ?? "C:/Users/user/Downloads";
const TENANT_SLUG = argOf("--tenant") ?? "cs"; // 침산(cs) — 2026-09-18 slug 개명(옛 injaewon)

// school-name.ts와 **같은 규칙**이어야 한다. .cjs라 TS를 못 불러 옮겨 적되, 바뀌면 양쪽을 함께 고칠 것.
// (규칙의 진실은 src/features/schools/school-name.ts + 그 테스트다.)
const SUFFIX_RULES = [
  [/여자상업고등학교$/, "여상"],
  [/여자정보고등학교$/, "여고"],
  [/여자중학교$/, "여중"],
  [/여자고등학교$/, "여고"],
  [/여자초등학교$/, "여초"],
  [/초등학교$/, "초"],
  [/중학교$/, "중"],
  [/고등학교$/, "고"],
  [/초등$/, "초"],
  [/중등$/, "중"],
  [/고등$/, "고"],
];
const BARE_KIND_RE = /^(초|중|고|여초|여중|여고|여상)$/;
const ALIASES = { 달산: "달산초" };
const applySuffix = (s) => {
  for (const [re, to] of SUFFIX_RULES) if (re.test(s)) return s.replace(re, to);
  return s;
};
// 🔴 지역 접두를 지우면 급만 남는 학교가 있다(대구초등학교→"초", 대구중학교→"중", 대구여자고등학교→"여고").
// 그러면 상담 입력의 쓰레기 값 "초"(43건)·"중"(17건)이 그 학교에 붙어 없는 점유율을 만든다 — 지우지 않는다.
function stripRegionPrefix(s) {
  const stripped = s.replace(/^대구광역시/, "").replace(/^대구/, "");
  if (stripped === s) return s;
  if (!stripped || BARE_KIND_RE.test(applySuffix(stripped))) return s;
  return stripped;
}
function normalizeSchoolName(raw) {
  let s = String(raw ?? "").replace(/\s+/g, "");
  if (!s) return "";
  s = s.replace(/（.*?）|\(.*?\)/g, "");
  s = s.replace(/\d+$/, "");
  s = stripRegionPrefix(s);
  s = applySuffix(s);
  return ALIASES[s] ?? s;
}

const KIND_BY_CODE = { "02": "초", "03": "중", "04": "고" };

/** 따옴표 안 쉼표까지 처리하는 최소 CSV 파서(이 파일은 값에 줄바꿈이 없다). */
function parseLine(line) {
  const out = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (q && line[i + 1] === '"') { cur += '"'; i++; }
      else q = !q;
    } else if (ch === "," && !q) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

function readCsv(file) {
  const raw = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  const H = parseLine(lines[0]);
  const ix = (n) => H.indexOf(n);
  const num = (v) => {
    const n = Number(String(v ?? "").replace(/[^0-9.-]/g, ""));
    return Number.isFinite(n) ? Math.round(n) : null;
  };
  const rows = [];
  for (const line of lines.slice(1)) {
    const c = parseLine(line);
    const name = c[ix("학교명")];
    const code = c[ix("정보공시 학교코드")];
    if (!name || !code) continue;
    // 제외여부 Y = 공시 대상에서 빠진 학교(폐교·통합 등) — 분모로 쓰면 안 되므로 버린다.
    if (String(c[ix("제외여부")] ?? "").toUpperCase() === "Y") continue;
    const kind = KIND_BY_CODE[c[ix("학교급코드")]];
    if (!kind) continue;
    const byGrade = {};
    for (let g = 1; g <= 6; g++) {
      const col = ix(`${g}학년 학생수`);
      if (col < 0) continue;
      const v = num(c[col]);
      if (v !== null) byGrade[String(g)] = v;
    }
    rows.push({
      info_code: code,
      name,
      name_key: normalizeSchoolName(name),
      kind,
      office: c[ix("시도교육청")] || null,
      district: c[ix("교육지원청")] || null,
      region: c[ix("지역")] || null,
      founding: c[ix("설립구분")] || null,
      total_students: num(c[ix("학생수(계)")]) ?? 0,
      total_classes: num(c[ix("학급수(계)")]),
      teachers: num(c[ix("교사수")]),
      by_grade: byGrade,
    });
  }
  return rows;
}

(async () => {
  const files = fs
    .readdirSync(DIR)
    .filter((f) => /학년별.*학급별 학생수.*\.csv$/i.test(f))
    .map((f) => path.join(DIR, f));
  if (!files.length) {
    console.error(`CSV를 못 찾음: ${DIR} 에 "…학년별·학급별 학생수…(초|중|고)….csv"`);
    process.exit(1);
  }
  console.log(`${APPLY ? "★ 적용" : "dry-run"} · 파일 ${files.length}개`);

  const all = [];
  for (const f of files) {
    const rows = readCsv(f);
    // 파일명에서 연도(2026년도) 추출 — 없으면 올해로.
    const y = Number((path.basename(f).match(/(20\d{2})\s*년도/) || [])[1]) || new Date().getFullYear();
    rows.forEach((r) => (r.year = y));
    console.log(`  ${path.basename(f)} → ${rows.length}개교 (${y}년)`);
    all.push(...rows);
  }

  // ⚠️ 중복 검사는 **연도별로** 한다. 여러 해를 한 번에 넣으면 같은 학교가 해마다 한 번씩 나오는데,
  // 연도를 안 나누고 세면 전 학교가 "×4 중복"으로 잡혀 **오탐이 진짜 경고를 묻는다**(실측: 466종 경고).
  const years = [...new Set(all.map((r) => r.year))].sort();
  const dupAll = [];
  for (const y of years) {
    const m = new Map();
    for (const r of all.filter((x) => x.year === y)) m.set(r.name_key, (m.get(r.name_key) ?? 0) + 1);
    for (const [k, n] of m) if (n > 1) dupAll.push(`${y}:${k}×${n}`);
  }
  const keySet = new Set(all.map((r) => r.name_key));
  console.log(`\n총 ${all.length}행 · 연도 ${years.join(", ")} · 정규화 이름 ${keySet.size}종`);
  if (dupAll.length)
    // 같은 해에 같은 키가 둘 이상이면 점유율이 어느 학교 것인지 모호해진다 — 조용히 넘기지 않는다.
    console.log(`⚠️ 같은 해에 이름이 겹치는 ${dupAll.length}건: ${dupAll.slice(0, 8).join(", ")}`);
  else console.log(`  ✅ 같은 해 안에서 이름 충돌 없음`);

  const sample = all.filter((r) => ["칠성초", "침산중", "경명여중"].includes(r.name_key));
  console.log("\n표본:");
  sample.forEach((r) =>
    console.log(`  ${r.name_key.padEnd(8)} ${r.name}  전교생 ${r.total_students}  학년별 ${JSON.stringify(r.by_grade)}`),
  );

  if (!APPLY) {
    console.log("\n(dry-run — 쓰지 않았다. 반영하려면 --apply)");
    return;
  }

  const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, idle_timeout: 10 });
  try {
    const [tenant] = await sql`select id from tenants where slug = ${TENANT_SLUG}`;
    if (!tenant) throw new Error(`tenant '${TENANT_SLUG}' 없음`);
    const [{ ready }] = await sql`
      select count(*)::int > 0 as ready from information_schema.tables
      where table_schema = 'public' and table_name = 'school_enrollment_stats'`;
    if (!ready) throw new Error("0180a 마이그레이션이 아직 적용되지 않았다 — 먼저 실행할 것.");

    let done = 0;
    for (let i = 0; i < all.length; i += 200) {
      const chunk = all.slice(i, i + 200).map((r) => ({ ...r, tenant_id: tenant.id, by_grade: sql.json(r.by_grade) }));
      const cols = ["tenant_id", "year", "info_code", "name", "name_key", "kind", "office",
        "district", "region", "founding", "total_students", "total_classes", "teachers", "by_grade"];
      const res = await sql`
        insert into school_enrollment_stats ${sql(chunk, cols)}
        on conflict (tenant_id, year, info_code) do update set
          name = excluded.name, name_key = excluded.name_key, kind = excluded.kind,
          office = excluded.office, district = excluded.district, region = excluded.region,
          founding = excluded.founding, total_students = excluded.total_students,
          total_classes = excluded.total_classes, teachers = excluded.teachers,
          by_grade = excluded.by_grade, updated_at = now()
        returning id`;
      done += res.length;
    }
    console.log(`\n✅ ${done}개교 적재/갱신 완료.`);
  } finally {
    await sql.end();
  }
})().catch((e) => { console.error(e); process.exit(1); });
