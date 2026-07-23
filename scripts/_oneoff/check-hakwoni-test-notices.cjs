/** READ-ONLY: 학원이 테스트 공지(`[eywa 테스트]`)의 회수 상태 확인. */
const fs = require("node:fs");
const path = require("node:path");
const TENANT = "becaa316-e636-42e9-9d09-08b133e0b094";
const url = fs
  .readFileSync(path.join(__dirname, "..", "..", ".env.local"), "utf8")
  .match(/^DATABASE_URL=(.+)$/m)[1]
  .trim()
  .replace(/^"|"$/g, "");

(async () => {
  const sql = require("postgres")(url, { ssl: "require", max: 1 });
  try {
    const rows = await sql`
      SELECT status, results FROM classnote_notices
      WHERE tenant_id = ${TENANT} AND body LIKE '[eywa 테스트]%' ORDER BY created_at DESC`;
    for (const x of rows) {
      const list = (x.results ?? []).flatMap((y) =>
        (y.revoked ?? y.reports ?? []).map((p) => `${p.id}:${p.revoked === true ? "삭제됨" : "남음"}`),
      );
      console.log(`${x.status}  ${list.join(" ")}`);
    }
    if (!rows.length) console.log("(테스트 공지 없음)");
  } finally {
    await sql.end();
  }
})();
