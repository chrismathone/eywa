/**
 * 0143a 트리거 도입 **이전에 이미 failed로 굳은** 보고서에 대해 담당 강사 알림을 1회 생성(백필).
 *
 * 왜 필요한가: 트리거는 `failed로 바뀌는 전이`에서만 발화한다. 손민우 07-22 건은 이미 failed라
 * 트리거를 켜도 영원히 안 울린다 — 정작 이 알림을 만들게 한 사건이 알림을 못 받는다.
 *
 * ⚠️ 상태를 건드려 트리거를 억지로 깨우지 않는다(`failed → queued → failed`). queued로 되돌리면
 *    워커가 그 행을 집어 **실제 재발송을 시도**한다(학부모에게 나감). 그래서 알림만 직접 만든다.
 * ⚠️ 문구는 0143a 트리거와 **동일**하게 유지할 것(두 경로가 다른 말을 하면 안 된다).
 * ⚠️ 멱등: 같은 (수신자, 보고서 날짜, 학생)로 이미 report_send_failed 알림이 있으면 건너뛴다.
 *
 * 사용: node scripts/_oneoff/backfill-report-send-fail-alerts.cjs [--apply]
 */
const fs = require("node:fs");
const path = require("node:path");

const TENANT = "becaa316-e636-42e9-9d09-08b133e0b094";
const APPLY = process.argv.includes("--apply");
const url = fs
  .readFileSync(path.join(__dirname, "..", "..", ".env.local"), "utf8")
  .match(/^DATABASE_URL=(.+)$/m)[1]
  .trim()
  .replace(/^"|"$/g, "");

(async () => {
  const sql = require("postgres")(url, { ssl: "require", max: 1 });
  try {
    const rows = await sql`
      SELECT lr.id, lr.report_date, lr.classnote_error, s.name AS student,
             c.teacher_id, u.display_name AS teacher
      FROM lesson_reports lr
      JOIN students s ON s.id = lr.student_id
      LEFT JOIN classes c ON c.id = lr.class_id
      LEFT JOIN users u ON u.id = c.teacher_id
      WHERE lr.tenant_id = ${TENANT} AND lr.classnote_status = 'failed'
      ORDER BY lr.report_date`;

    console.log(`failed 보고서 ${rows.length}건`);
    let made = 0;
    for (const r of rows) {
      const hint = /학생 없음/.test(r.classnote_error ?? "")
        ? "학부모가 ClassNote 알림장에 연결되어 있지 않습니다 — 학부모를 초대한 뒤 다시 발송하세요."
        : (r.classnote_error ?? "사유가 기록되지 않았습니다 — 발송 콘솔에서 확인하세요.");
      const md = new Date(r.report_date).toISOString().slice(5, 10).replace("-", "-");
      const body = `${r.student} · ${md} — ${hint}`;

      // 수신자: 반 담당 → 없으면 master 전원(트리거와 동일 폴백)
      const recipients = r.teacher_id
        ? [{ id: r.teacher_id, name: r.teacher }]
        : await sql`SELECT id, display_name AS name FROM users
                    WHERE tenant_id = ${TENANT} AND status = 'active' AND system_role = 'master'`;

      for (const rc of recipients) {
        const dup = await sql`
          SELECT id FROM notifications
          WHERE tenant_id = ${TENANT} AND recipient_id = ${rc.id}
            AND type = 'report_send_failed' AND body = ${body} LIMIT 1`;
        if (dup.length) {
          console.log(`  건너뜀(이미 있음) ${rc.name} ← ${body}`);
          continue;
        }
        console.log(`  ${APPLY ? "생성" : "생성 예정"}: ${rc.name} ← ${body}`);
        if (APPLY) {
          await sql`
            INSERT INTO notifications (tenant_id, recipient_id, type, title, body, link, actor_id)
            VALUES (${TENANT}, ${rc.id}, 'report_send_failed', '수업 보고서 발송 실패', ${body}, '/lesson-reports', null)`;
          made++;
        }
      }
    }
    console.log(APPLY ? `\n생성 ${made}건` : `\n(dry-run — 반영하려면 --apply)`);
  } finally {
    await sql.end();
  }
})();
