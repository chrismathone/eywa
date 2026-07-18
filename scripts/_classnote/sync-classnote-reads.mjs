/**
 * scripts/_classnote/sync-classnote-reads.mjs — ClassNote 학부모 읽음 동기화 1회 실행(점검·복구용).
 *
 * 상주 데몬(watch-classnote-queue.mjs)이 30분마다 자동 실행하므로 평소엔 필요 없다.
 * 이 스크립트는 ① 배선 점검 ② 데몬이 죽어 있을 때 수동 1회 ③ 매칭 키 확인용.
 *
 * 실행:
 *   node --env-file=.env.local scripts/_classnote/sync-classnote-reads.mjs           # 점검(기본) — DB 안 건드림
 *   node --env-file=.env.local scripts/_classnote/sync-classnote-reads.mjs --apply   # eywa classnote_read_at 갱신
 *   node --env-file=.env.local scripts/_classnote/sync-classnote-reads.mjs --apply --days 30
 *
 * ⚠️ **ClassNote에는 아무것도 쓰지 않는다**(피드 GET만). --apply가 건드리는 것은 eywa DB의
 *    lesson_reports.classnote_read_at뿐(이미 값이 있는 행은 갱신하지 않음).
 * ⚠️ `/api/v1/reports/{id}/read/`(POST 추정)는 절대 호출하지 않는다 — 학원 계정이 읽음 표시를 남길 위험.
 */
import postgres from "postgres";
import { launchBrowser, resolveTenant } from "./classnote-core.mjs";
import { pollReportReadsOnce } from "./classnote-read-core.mjs";

const APPLY = process.argv.includes("--apply");
const daysArg = process.argv.indexOf("--days");
const DAYS = daysArg > -1 ? Number(process.argv[daysArg + 1]) || 14 : 14;

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL 없음");
  if (!process.env.CLASSNOTE_UPLOAD_ID || !process.env.CLASSNOTE_UPLOAD_PW) {
    throw new Error("CLASSNOTE_UPLOAD_ID / CLASSNOTE_UPLOAD_PW env가 필요합니다(피드 조회에 로그인 필요)");
  }
  const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
  const browser = await launchBrowser();
  try {
    const tenant = await resolveTenant(sql);
    console.log(`tenant=${tenant} · 창 ${DAYS}일 · mode=${APPLY ? "APPLY(읽음 갱신)" : "점검(변경 없음)"}`);
    const res = await pollReportReadsOnce(sql, browser, {
      tenant,
      apply: APPLY,
      maxAgeDays: DAYS,
      force: true, // 수동 실행은 30분 가드 무시
    });
    console.log(JSON.stringify(res));

    // 반영 결과 확인 — 창 안 발송분의 읽음 채움률(운영 점검용).
    const [stat] = await sql`
      select count(*)::int total,
             count(classnote_read_at)::int read,
             count(edutrix_share_token)::int with_token
      from lesson_reports
      where tenant_id = ${tenant}
        and classnote_status = 'success'
        and report_date >= current_date - (${DAYS}::int)`;
    console.log(
      `[확인] 창 내 발송분 ${stat.total}건 · 매칭키(edutrix_share_token) 보유 ${stat.with_token} · 읽음 기록 ${stat.read}`,
    );
    if (stat.with_token === 0 && stat.total > 0) {
      console.log("⚠️ 매칭 키가 하나도 없습니다 — eywa의 edutrix-sync cron(0122a 반영본)이 아직 안 돌았을 수 있습니다.");
    }
  } finally {
    await browser.close().catch(() => {});
    await sql.end({ timeout: 5 }).catch(() => {});
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
