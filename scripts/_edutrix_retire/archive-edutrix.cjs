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
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");
const postgres = require("postgres");

const TENANT = "becaa316-e636-42e9-9d09-08b133e0b094";
const APPLY = process.argv.includes("--apply");
const OUT_DIR = path.join(__dirname, "..", "..", "data", "edutrix-archive");
// ⚠️ 소등 전 **원본 전 테이블**을 담는다. 2026-07-28 보강: 초판 9개는 수학·영어 본체만 담아
// 고등수학관(hs_*)·수강이력·프롬프트·숙제·진도컨테이너가 통째로 빠져 있었다. hs_*는 lesson_reports
// 이관 대상도 아니라(cron이 `reports`만 읽음) **아카이브에 없으면 소등과 함께 영구 소실**된다.
// 존재하지 않는 테이블은 아래 루프의 try/catch가 SKIP으로 넘긴다(목록에 남겨 둬도 무해).
const TABLES = [
  // 수학(본체)
  "reports",
  "students",
  "classes",
  "class_teachers",
  "class_enrollments",
  "profiles",
  // 영어
  "en_reports",
  "en_students",
  "en_classes",
  "en_class_teachers",
  "en_class_enrollments",
  "en_textbooks",
  "en_textbook_page_analysis",
  // 고등수학관 — 이관 대상 아님(소실 후보 1순위)
  "hs_reports",
  "hs_students",
  "hs_classes",
  "hs_class_teachers",
  "hs_class_enrollments",
  // 발송·열람 이력
  "share_link_views",
  "submission_logs",
  "notice_queue",
  // 설정·AI
  "academy_settings",
  "ai_prompt_settings",
  "chat_conversations",
  "chat_messages",
  "chat_logs",
  // 숙제·첨부·진도
  "homework_assignments",
  "homework_assignment_targets",
  "homework_assignment_attachments",
  "homework_submission_comments",
  "student_attachments",
  "progress_containers",
  "notifications",
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
      // ⚠️ source_id는 (source_table, source_id) 유니크의 절반이다. `id` 없는 테이블에서 예전 폴백
      // `${table}:${i}`는 **청크 시작 인덱스**라 500행이 같은 키가 됐다 → 한 INSERT 안에서 같은 키가
      // 두 번 나와 "ON CONFLICT DO UPDATE command cannot affect row a second time"로 청크 전체가 실패한다.
      // 행 내용 해시로 바꿔 행마다 고유하고 재실행에도 안정적인 키를 만든다(2026-07-28).
      const c = rows.slice(i, i + 500).map((r) => ({
        tenant_id: TENANT,
        source_table: table,
        source_id: String(r.id ?? `${table}:${crypto.createHash("sha1").update(JSON.stringify(r)).digest("hex")}`),
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
