// scripts/_edutrix_retire/archive-edutrix.cjs — Edutrix Supabase 전 테이블 raw 아카이브 (은퇴 보험).
//
// Edutrix 완전 종료(2026-07-10 결정) 전, 원본을 무손실 보존: ① 로컬 JSONL(data/edutrix-archive/)
// ② eywa DB edutrix_archive(0095a, service_role 전용) 멱등 upsert. 미매핑 189건·en_*·강사 프로필까지
// 전부 여기 남아 "나중에 그 필드가 필요했는데"를 차단한다.
// 원본 접근: Edutrix **service key**(D:/edutrix/.env.local에서 읽음 — anon은 일부 테이블 RLS 차단).
// ⚠️ profiles 등의 자격증명 필드(/pass|pw|secret|token/i)는 **제거 후** 적재(평문 비번을 eywa로 옮기지 않음).
//
// 실행: node --env-file=.env.local scripts/_edutrix_retire/archive-edutrix.cjs          # dry-run(카운트만)
//       node --env-file=.env.local scripts/_edutrix_retire/archive-edutrix.cjs --apply
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const postgres = require("postgres");

const TENANT = "becaa316-e636-42e9-9d09-08b133e0b094";
const APPLY = process.argv.includes("--apply");
const OUT_DIR = path.join(__dirname, "..", "..", "data", "edutrix-archive");
const TABLES = [
  "reports",
  "en_reports",
  "students",
  "classes",
  "profiles",
  "en_students",
  "en_classes",
  "share_link_views",
  "submission_logs",
];
const CRED_RE = /pass|pw|secret|token/i; // share_token 등도 걸리지만 아카이브 무결성보다 자격증명 비유출 우선(원본엔 있음)

function loadEnv(p) {
  const out = {};
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

async function fetchAllPaged(q, page = 1000) {
  const rows = [];
  for (let from = 0; ; from += page) {
    const { data, error } = await q(from, from + page - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < page) break;
  }
  return rows;
}

(async () => {
  const { EDUTRIX_SUPABASE_URL, DATABASE_URL } = process.env;
  const eduEnv = loadEnv("D:/edutrix/.env.local");
  const serviceKey = eduEnv.SUPABASE_SERVICE_ROLE_KEY;
  if (!EDUTRIX_SUPABASE_URL || !serviceKey || !DATABASE_URL) {
    throw new Error("EDUTRIX_SUPABASE_URL(eywa env) / D:/edutrix/.env.local의 SUPABASE_SERVICE_ROLE_KEY / DATABASE_URL 필요");
  }
  const edu = createClient(EDUTRIX_SUPABASE_URL, serviceKey);
  const sql = postgres(DATABASE_URL, { prepare: false, max: 1 });
  console.log(`[archive] mode=${APPLY ? "APPLY" : "dry-run"} · out=${OUT_DIR}`);

  const summary = {};
  for (const table of TABLES) {
    let rows;
    try {
      rows = await fetchAllPaged((a, b) => edu.from(table).select("*").range(a, b));
    } catch (e) {
      summary[table] = `SKIP(${e.message.slice(0, 60)})`;
      continue;
    }
    // 자격증명 필드 제거(모든 테이블 공통 — profiles 외에도 방어)
    const credCols = rows[0] ? Object.keys(rows[0]).filter((k) => CRED_RE.test(k) && k !== "share_token") : [];
    for (const r of rows) for (const k of credCols) delete r[k];
    summary[table] = { rows: rows.length, strippedCols: credCols };
    if (!APPLY) continue;

    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(path.join(OUT_DIR, `${table}.jsonl`), rows.map((r) => JSON.stringify(r)).join("\n"));

    for (let i = 0; i < rows.length; i += 500) {
      const c = rows.slice(i, i + 500).map((r) => ({
        tenant_id: TENANT,
        source_table: table,
        source_id: String(r.id ?? `${table}:${i}`),
        row: sql.json(r),
      }));
      await sql`insert into edutrix_archive ${sql(c)}
        on conflict (source_table, source_id) do update set row = excluded.row, archived_at = now()`;
    }
  }
  console.log(JSON.stringify(summary, null, 2));

  if (APPLY) {
    const counts = await sql`select source_table, count(*)::int as n from edutrix_archive group by source_table order by 1`;
    console.log("edutrix_archive:", JSON.stringify(counts));
  }
  await sql.end();
})().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
