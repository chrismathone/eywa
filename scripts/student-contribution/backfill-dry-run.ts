/** DB가 쓰기를 거절하는 트랜잭션. 실제 소개 연결·AI 호출 없음. */
import postgres from "postgres";
import { mkdirSync, writeFileSync } from "node:fs";
import { checkedConnection, readBackfillSnapshot } from "./backfill-source";
async function main() {
  if (process.argv.includes("--apply")) throw new Error("이 파일은 드라이런 전용입니다");
  const db = postgres(checkedConnection(), { ssl: "require", prepare: false, max: 1, onnotice: () => {} });
  try {
    const report = await db.begin("read only", async (sql) => {
      await sql`set local statement_timeout = '60s'`;
      return readBackfillSnapshot(sql);
    });
    mkdirSync("work", { recursive: true });
    writeFileSync("work/student-contribution-backfill-dry-run.json", JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ readOnly: true, counts: report.counts, automaticSampleCount: report.sample.length, fingerprint: report.fingerprint,
      report: "work/student-contribution-backfill-dry-run.json" }, null, 2));
  } finally { await db.end({ timeout: 5 }); }
}
main().catch((error) => { console.error(String(error.message).replace(/postgres(?:ql)?:\/\/\S+/gi, "[database-url]")); process.exitCode = 1; });
