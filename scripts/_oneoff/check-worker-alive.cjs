/** READ-ONLY: 연동 PC 워커 생존 확인(classnote_workers 하트비트) + 공지 큐 최근 상태. */
const fs = require("node:fs");
const path = require("node:path");

const TENANT = "becaa316-e636-42e9-9d09-08b133e0b094"; // 인재원

function dbUrl() {
  const env = fs.readFileSync(path.join(__dirname, "..", "..", ".env.local"), "utf8");
  const m = env.match(/^DATABASE_URL=(.+)$/m);
  if (!m) throw new Error(".env.local에 DATABASE_URL 없음");
  return m[1].trim().replace(/^"|"$/g, "");
}

async function main() {
  const sql = require("postgres")(dbUrl(), { ssl: "require", max: 1 });
  try {
    const w = await sql`
      SELECT hostname, last_seen, now() - last_seen AS ago, last_results
      FROM classnote_workers WHERE tenant_id = ${TENANT} ORDER BY last_seen DESC`;
    console.log("=== 워커 하트비트 ===");
    for (const r of w) {
      const sec = Math.round(Number(r.ago.seconds ?? 0) + (r.ago.minutes ?? 0) * 60 + (r.ago.hours ?? 0) * 3600);
      console.log(`${r.hostname}  마지막 ${sec}초 전  caps=${JSON.stringify(r.last_results?.caps ?? null)}`);
    }
    if (!w.length) console.log("(하트비트 없음 — 워커 미가동)");

    const n = await sql`
      SELECT id, status, created_at, processed_at, jsonb_array_length(targets) AS n,
             (attachments IS NOT NULL) AS has_att, left(body, 40) AS body
      FROM classnote_notices WHERE tenant_id = ${TENANT}
      ORDER BY created_at DESC LIMIT 5`;
    console.log("\n=== 최근 공지 큐 5건 ===");
    for (const r of n) console.log(`${r.created_at.toISOString().slice(0, 19)} ${r.status} 대상${r.n} 첨부${r.has_att} ${r.body}`);

    const s = await sql`SELECT data->'report'->>'classnoteSendEnabled' AS on FROM tenant_settings WHERE tenant_id = ${TENANT}`;
    console.log(`\n실제 발송 스위치: ${s[0]?.on}`);
  } finally {
    await sql.end();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
