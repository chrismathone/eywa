/**
 * 발송 기한(오늘 포함 7일)이 지난 수업보고서를 **원장이 지정한 건만** 다시 보낸다 — 0276a.
 *
 * 원장 2026-09-21: *"앞으로도 내가 예외로 지정하는건은 기한 지난것도 발송."* 7일 규칙은 그대로이고, 이 스크립트가
 * 붙이는 표시(`classnote_deadline_exempt_at`)가 있는 행만 워커가 창 밖에서도 집는다(classnote-core.mjs).
 *
 *   pnpm tsx scripts/_reports/resend-past-deadline.mts --student=김지유A --dates=2026-09-11          (드라이런)
 *   pnpm tsx scripts/_reports/resend-past-deadline.mts --student=김지유A --dates=2026-09-11 --apply
 *
 * 기한 말고는 발송 콘솔 재발송(`retryClassnote`)과 **같은 관문**을 지난다: 취소·이관분 제외 · 멘트 필수 ·
 * 과목 opt-in · '수업보고서 미발송' 반 제외 · 그날 결석이면 제외(보강 예외) · 발송 스위치 ON.
 * 🔴 이미 나갔거나(success) 큐에 있는 건(queued·processing)은 건드리지 않는다 — 학부모 게시판에 같은 글이 두 번 붙는다.
 * 감사로그 = `classnote_resend`(via: deadline_exempt) 한 줄.
 */
import { config } from "dotenv";
import postgres from "postgres";
import { hasSendableMent } from "../../src/features/report-admin/unsent-sendable";
import { isClassnoteSubjectEnabled } from "../../src/features/onescreen/classnote-guard";
import { isAbsentForSend } from "../../src/features/onescreen/absence-gate";
import { resolveSettings } from "../../src/features/owner/resolve";

config({ path: ".env.local", quiet: true });
const arg = (key: string) => process.argv.find((a) => a.startsWith(`--${key}=`))?.slice(key.length + 3);
const studentName = arg("student")?.trim();
const dates = (arg("dates") ?? "").split(",").map((d) => d.trim()).filter(Boolean);
const by = arg("by")?.trim() || "원장";
const apply = process.argv.includes("--apply");
if (!studentName || dates.length === 0 || dates.some((d) => !/^\d{4}-\d{2}-\d{2}$/.test(d)))
  throw new Error("--student=이름 --dates=YYYY-MM-DD[,YYYY-MM-DD] 가 필요합니다");

const BUSY = new Set(["success", "queued", "processing"]);
const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1, connect_timeout: 10 });
try {
  const [col] = await sql`select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'lesson_reports' and column_name = 'classnote_deadline_exempt_at'`;
  if (!col && apply) throw new Error("0276a가 아직 적용되지 않았습니다 — SQL을 먼저 적용하세요");
  if (!col) console.log("⚠️ 0276a 미적용 — 드라이런만 됩니다(적용 뒤 --apply)");

  const students = await sql`select id, tenant_id, name from students where name = ${studentName} and status <> 'withdrawn'`;
  if (students.length !== 1) throw new Error(`'${studentName}' 재원 학생이 ${students.length}명 — 정확히 한 명이어야 합니다`);
  const student = students[0]!;

  const [saved] = await sql`select data from tenant_settings where tenant_id = ${student.tenant_id}`;
  const settings = resolveSettings(saved?.data ?? null, { name: "" });
  if (!settings.report.classnoteSendEnabled) throw new Error("학원설정 발송 스위치가 꺼져 있습니다");

  const reports = await sql`
    select lr.id, lr.report_date::text as d, lr.subject, lr.class_id, lr.makeup, lr.notes, lr.classnote_status,
           lr.source, lr.revoked_at, coalesce(c.report_optout, false) as optout
    from lesson_reports lr left join classes c on c.id = lr.class_id
    where lr.tenant_id = ${student.tenant_id} and lr.student_id = ${student.id} and lr.report_date::text in ${sql(dates)}
    order by lr.report_date`;
  const attendance = await sql`
    select a.id, a.class_id, a.session_date::text as d, a.status, a.recorded_at, c.subject
    from attendance_records a join classes c on c.id = a.class_id
    where a.tenant_id = ${student.tenant_id} and a.student_id = ${student.id} and a.session_date::text in ${sql(dates)}`;

  const ok: { id: string; d: string }[] = [];
  for (const d of dates) if (!reports.some((r) => r.d === d)) console.log(`  ${d} 보고서 없음`);
  for (const r of reports) {
    // 결석 판정 = 앱 게이트와 같은 축(반이 있으면 그 반, 없으면 그 과목 반 전체) · 같은 순수 함수.
    const dayRecords = attendance
      .filter((a) => a.d === r.d && (r.class_id ? a.class_id === r.class_id : a.subject === r.subject))
      .map((a) => ({ id: a.id, classId: a.class_id, status: a.status, recordedAt: new Date(a.recorded_at).toISOString() }));
    const why = r.revoked_at
      ? "발송 취소된 보고서"
      : r.source === "edutrix_import"
        ? "이관분(이미 발송됨)"
        : BUSY.has(r.classnote_status ?? "")
          ? `이미 ${r.classnote_status === "success" ? "발송됨" : "발송 대기 중"}`
          : !hasSendableMent(r.notes)
            ? "멘트 없음"
            : !isClassnoteSubjectEnabled(r.subject, settings.report.classnoteSubjects)
              ? "발송 대상 과목 아님"
              : r.optout
                ? "'수업보고서 미발송' 반"
                : !r.makeup && isAbsentForSend(dayRecords)
                  ? "그날 결석"
                  : null;
    console.log(`  ${r.d} ${r.classnote_status ?? "미발송"} → ${why ?? "보냄"}`);
    if (!why) ok.push({ id: r.id, d: r.d });
  }
  if (ok.length === 0) throw new Error("보낼 수 있는 보고서가 없습니다");
  if (!apply) {
    console.log(`(드라이런 — ${ok.length}건. --apply로 실행)`);
  } else {
    await sql.begin(async (tx) => {
      const ids = ok.map((r) => r.id);
      const updated = await tx`
        update lesson_reports set classnote_deadline_exempt_at = now(), classnote_status = 'queued',
          classnote_queued_at = now(), classnote_processing_at = null, classnote_retry_count = 0, classnote_error = null
        where id in ${tx(ids)} and revoked_at is null
          and (classnote_status is null or classnote_status not in ('success', 'queued', 'processing'))
        returning id`;
      if (updated.length !== ids.length) throw new Error("그 사이 상태가 바뀐 보고서가 있습니다 — 되돌림");
      await tx`insert into audit_logs (tenant_id, actor_id, actor_name, action, target_type, target_label, metadata)
        values (${student.tenant_id}, ${null}, ${`${by} 지정(기한 예외)`}, 'classnote_resend', 'lesson_report', ${student.name},
                ${tx.json({ via: "deadline_exempt", deadlineExempt: true, reportCount: ids.length, studentNames: [student.name], reportIds: ids, reportDates: ok.map((r) => r.d) })}::jsonb)`;
      console.log(`✓ ${ids.length}건 발송 대기에 올림(기한 예외) + 감사로그 1줄`);
    });
  }
} finally {
  await sql.end({ timeout: 2 });
}
