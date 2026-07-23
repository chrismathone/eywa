/**
 * 0144a 공지 실패 알림 트리거 **롤백 테스트** — 실제 알림·공지를 남기지 않는다.
 *
 * 트랜잭션 안에서 가짜 공지 행을 만들어 status를 failed/partial로 전이시키고, 트리거가 만든
 * notifications를 읽은 뒤 **rollback**한다(테이블에 흔적 0). 발송은 일어나지 않는다 — 워커는
 * 커밋된 queued 행만 보고, 이 행은 커밋되지 않는다.
 *
 * 사용: node scripts/_oneoff/test-notice-fail-trigger.cjs
 */
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
    const [stu] = await sql`SELECT id, name FROM students WHERE tenant_id = ${TENANT} AND name = '손민우' LIMIT 1`;
    if (!stu) throw new Error("테스트용 학생을 찾지 못했습니다");

    for (const scenario of [
      { label: "전건 실패(failed) · 담당 해석 가능", status: "failed", ok: false, note: "해당 학생 없음", sid: stu.id },
      { label: "일부 실패(partial)", status: "partial", ok: false, note: "학부모 미가입(초대 필요)", sid: stu.id },
      { label: "학생 미상(sid 빈 문자열=테스트 타깃)", status: "failed", ok: false, note: "보드 없음(프로비저닝 필요)", sid: "" },
      { label: "회수 결과(ok 키 없음) — 알림 없어야 정상", status: "failed", revoke: true, sid: stu.id },
    ]) {
      await sql.begin(async (tx) => {
        const targets = [{ studentId: scenario.sid, studentName: stu.name, board: `(수학)${stu.name}` }];
        const [row] = await tx`
          INSERT INTO classnote_notices (tenant_id, body, targets, status)
          VALUES (${TENANT}, ${"[트리거 테스트] 롤백됩니다"}, ${tx.json(targets)}, 'queued') RETURNING id`;
        const results = scenario.revoke
          ? [{ board: `(수학)${stu.name}`, revoked: [{ id: 1, revoked: true }] }]
          : [{ ok: scenario.ok, board: `(수학)${stu.name}`, note: scenario.note }];
        await tx`UPDATE classnote_notices SET status = ${scenario.status}, results = ${tx.json(results)} WHERE id = ${row.id}`;
        const notes = await tx`
          SELECT u.display_name AS who, n.title, n.body FROM notifications n
          LEFT JOIN users u ON u.id = n.recipient_id
          WHERE n.tenant_id = ${TENANT} AND n.type = 'notice_send_failed'
            AND n.created_at > now() - interval '10 seconds'`;
        console.log(`\n■ ${scenario.label} → 알림 ${notes.length}건`);
        for (const n of notes) console.log(`   → ${n.who}: ${n.body}`);
        throw new Error("__ROLLBACK__");
      }).catch((e) => {
        if (e.message !== "__ROLLBACK__") throw e;
      });
    }

    const left = await sql`
      SELECT count(*)::int n FROM classnote_notices WHERE tenant_id = ${TENANT} AND body LIKE '[트리거 테스트]%'`;
    console.log(`\n남은 테스트 공지 행: ${left[0].n}건 (0이어야 정상)`);
  } finally {
    await sql.end();
  }
})();
