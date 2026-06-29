/**
 * scripts/_makeedu/wipe-tenant-data.cjs — Phase 1 "데모 비우고 makeedu 재구축"의 파괴적 wipe.
 * 운영 데이터(학생/반/수강/수납/상담 + 학생·반 참조 의존 테이블)를 FK-safe 순서로 삭제.
 * ⚠️ 보존: users(담임 연결)·tenants·tenant_settings·super_admins·classrooms·user_integrations·intake_tokens·
 *   kakao_channels·kiosk_devices·meeting_minutes(회의록=eywa 고유)·announcements·auth.users(로그인 계정).
 *
 * 사용:
 *   node --env-file=.env.local scripts/_makeedu/wipe-tenant-data.cjs          # dry: 삭제 예정 건수만
 *   node --env-file=.env.local scripts/_makeedu/wipe-tenant-data.cjs --apply  # 실제 삭제
 */
const postgres = require("postgres");
const L = require("./lib.cjs");

const APPLY = process.argv.includes("--apply");

// FK-safe 삭제 순서 (자식 → 부모). seed.ts wipe 순서 + 신규 테이블 확장.
const ORDER = [
  "attendance_notifications",
  "attendance_checkins",
  "attendance_records",
  "grade_comments",
  "grade_goals",
  "student_grades",
  "level_tests",
  "lesson_reports",
  "student_memos",
  "reenrollment_campaign_targets",
  "student_consultations",
  "invoices",
  "textbook_orders",
  "tuition_quotes",
  "enrollments",
  "enrollment_consultations", // consultation_ai_analysis는 FK cascade
  "exams",
  "class_schedules",
  "students",
  "classes",
  "textbook_catalog",
  "tuition_catalog",
];

(async () => {
  const sql = postgres(process.env.DATABASE_URL, { prepare: false });
  try {
    const tenantId = await L.resolveTenantId(sql);
    const t = await sql`select name from tenants where id = ${tenantId}`;
    console.log(`tenant: ${tenantId} (${t[0]?.name})`);
    console.log(APPLY ? "=== APPLY (실제 삭제) ===" : "=== DRY (삭제 예정 건수) ===");
    let totalRows = 0;
    for (const tbl of ORDER) {
      const cnt = await sql`select count(*)::int n from ${sql(tbl)} where tenant_id = ${tenantId}`;
      const n = cnt[0].n;
      totalRows += n;
      if (APPLY && n > 0) {
        await sql`delete from ${sql(tbl)} where tenant_id = ${tenantId}`;
        console.log(`  deleted ${tbl}: ${n}`);
      } else {
        console.log(`  ${tbl}: ${n}`);
      }
    }
    console.log(`총 ${totalRows} 행 (대상 ${ORDER.length} 테이블).`);
    // 보존 확인
    const keep = await sql`select
      (select count(*)::int from users where tenant_id=${tenantId}) users,
      (select count(*)::int from tenant_settings) settings,
      (select count(*)::int from classrooms where tenant_id=${tenantId}) classrooms,
      (select count(*)::int from meeting_minutes where tenant_id=${tenantId}) meetings,
      (select count(*)::int from super_admins) super_admins`;
    console.log("보존(불변):", JSON.stringify(keep[0]));
    if (!APPLY) console.log("\n[DRY] --apply 없이 종료 (삭제 0).");
  } finally {
    await sql.end();
  }
})().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
