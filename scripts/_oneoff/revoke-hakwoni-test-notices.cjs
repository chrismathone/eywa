/**
 * 학원이 테스트 공지 회수(정리) — `[eywa 테스트]`로 시작하는 **테스트 보드 발송분만** 게시취소 요청.
 *
 * ⚠️ 안전: 본문 접두어 + 타깃이 `(수학)학원이` **하나뿐**인 행만 고른다(실 학부모 발송분은 구조적으로 안 걸림).
 * 실제 삭제는 연동 PC 워커가 저장된 리포트 id를 대조 후 DELETE.
 *
 * 사용: node scripts/_oneoff/revoke-hakwoni-test-notices.cjs
 */
const fs = require("node:fs");
const path = require("node:path");

const TENANT = "becaa316-e636-42e9-9d09-08b133e0b094";
const TEST_BOARD = "(수학)학원이";

function dbUrl() {
  const env = fs.readFileSync(path.join(__dirname, "..", "..", ".env.local"), "utf8");
  return env.match(/^DATABASE_URL=(.+)$/m)[1].trim().replace(/^"|"$/g, "");
}

async function main() {
  const sql = require("postgres")(dbUrl(), { ssl: "require", max: 1 });
  try {
    const rows = await sql`
      UPDATE classnote_notices SET status = 'revoke_requested', processing_at = NULL
      WHERE tenant_id = ${TENANT}
        AND status IN ('success', 'partial')
        AND body LIKE '[eywa 테스트]%'
        AND jsonb_array_length(targets) = 1
        AND targets->0->>'board' = ${TEST_BOARD}
      RETURNING id, results`;
    console.log(`회수 요청 ${rows.length}건`);
    for (const r of rows) {
      const ids = (r.results ?? []).flatMap((x) => (x.reports ?? []).map((p) => p.id));
      console.log(`  ${r.id} → 리포트 ${ids.join(", ")}`);
    }
  } finally {
    await sql.end();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
