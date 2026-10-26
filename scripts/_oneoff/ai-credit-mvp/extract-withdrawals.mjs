// ① 퇴원 사유 복원 — 추출 단계(운영 DB 읽기 전용 · 침산만). 결과는 D:/tmp 결과 루트로(Git 밖).
// node --env-file=D:/eywa_refactoring/.env.local scripts/_oneoff/ai-credit-mvp/extract-withdrawals.mjs
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { closeReadOnly, openReadOnly, tenantIdOf } from "./lib/db-readonly.mjs";
import { maskPhones, scanRecord } from "./lib/pii.mjs";

const ROOT = "D:/tmp/ai-credit-mvp-2026-10-26";
const OUT = join(ROOT, "01-snapshots", "withdrawals");
// 원본 보고서에서 판정에 쓰는 칸만(원비·미납·성명·담임명·교무처 담당자·서명·원본 격자는 싣지 않는다).
const ARCHIVE_FIELDS = ["퇴원사유", "상세사유", "담임의견", "학생상담", "학부모상담", "상담결과", "수강기간", "반명", "퇴원일", "학년"];
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const diffDays = (a, b) => (a && b ? Math.round((Date.parse(a) - Date.parse(b)) / 86_400_000) : null);
const sid = (id) => createHash("sha256").update(`wd-v1|${id}`).digest("hex").slice(0, 10);
const txt = (v) => maskPhones(String(v ?? "").trim());

const sql = await openReadOnly();
try {
  const cs = await tenantIdOf(sql);
  const students = await sql`select id, name, school, grade, enrolled_at, withdrawn_at, makeedu_id from students
    where tenant_id=${cs} and status='withdrawn' and coalesce(withdrawal_metadata->>'reason','')='' order by withdrawn_at, id`;
  const ids = students.map((s) => s.id);
  const [mk, arch, enr, cons, msgs, unmapped, license, closedMonths, allReasons, evalSettings] = await Promise.all([
    sql`select student_id, withdrawn_on, enrolled_on, withdrawal_reason from makeedu_history_students where tenant_id=${cs} and student_id = any(${ids})`,
    sql`select id, mapped_student_id, exit_date, raw_exit_date, subject, class_name, mapping_kind, fields from withdrawal_report_archives where tenant_id=${cs} and mapped_student_id = any(${ids})`,
    sql`select e.student_id, e.start_date, e.end_date, e.withdrawal_reason, e.withdrawal_detail, e.withdrawal_memo, e.is_transferred, c.class_name, c.subject
        from enrollments e left join classes c on c.id=e.class_id where e.tenant_id=${cs} and e.student_id = any(${ids})`,
    sql`select student_id, consulted_at, category, subject, summary, follow_up_action, ai_summary from student_consultations where tenant_id=${cs} and student_id = any(${ids})`,
    sql`select student_id, posted_at, content from classnote_parent_messages where tenant_id=${cs} and student_id = any(${ids})`,
    sql`select id, student_name, exit_date, subject, class_name from withdrawal_report_archives where tenant_id=${cs} and mapped_student_id is null`,
    sql`select feature, is_active, expires_at from tenant_licenses where tenant_id=${cs} and feature='ai_analysis'`,
    sql`select month, count(*)::int teachers, min(closed_at) closed_at from teacher_portfolio_months where tenant_id=${cs} and closed_at is not null group by month order by month`,
    sql`select coalesce(withdrawal_metadata->>'reason','(빈칸)') reason, count(*)::int n from students where tenant_id=${cs} and status='withdrawn' group by 1 order by 2 desc`,
    sql`select config from teacher_evaluation_settings where tenant_id=${cs}`,
  ]);
  const by = (rows, key = "student_id") => rows.reduce((m, r) => m.set(r[key], [...(m.get(r[key]) ?? []), r]), new Map());
  const mkBy = by(mk), archBy = by(arch, "mapped_student_id"), enrBy = by(enr), consBy = by(cons), msgBy = by(msgs);
  const fold = (s) => String(s ?? "").replace(/\s+|[A-Z]$/g, "");

  const records = students.map((s) => {
    const w = day(s.withdrawn_at);
    const m = (mkBy.get(s.id) ?? [])[0];
    const archives = (archBy.get(s.id) ?? []).map((a) => {
      const exit = day(a.exit_date);
      const gap = diffDays(exit, w);
      return { aid: a.id.slice(0, 8), exitDate: exit, rawExitDate: a.raw_exit_date, subject: a.subject, className: a.class_name, mapping: a.mapping_kind,
        gapDays: gap, thisWithdrawal: gap == null ? "날짜 모름" : Math.abs(gap) <= 14 ? "같은 퇴원" : "다른 때(과목 종료 등)",
        fields: Object.fromEntries(ARCHIVE_FIELDS.map((k) => [k, txt(a.fields?.[k])]).filter(([, v]) => v)) };
    }).sort((a, b) => String(a.exitDate).localeCompare(String(b.exitDate)));
    const enrollments = (enrBy.get(s.id) ?? []).map((e) => ({ className: e.class_name, subject: e.subject, start: day(e.start_date), end: day(e.end_date),
      reason: e.withdrawal_reason, detail: e.withdrawal_detail, memo: txt(e.withdrawal_memo), transferred: e.is_transferred, gapDays: diffDays(day(e.end_date), w) }));
    const consultations = (consBy.get(s.id) ?? []).map((c) => ({ date: day(c.consulted_at), gapDays: diffDays(day(c.consulted_at), w), category: c.category, subject: c.subject,
      summary: txt(c.summary), followUp: txt(c.follow_up_action), aiSummary: txt(c.ai_summary) })).filter((c) => c.gapDays != null && c.gapDays >= -90 && c.gapDays <= 15);
    const parentMessages = (msgBy.get(s.id) ?? []).map((p) => ({ date: day(p.posted_at), gapDays: diffDays(day(p.posted_at), w), content: txt(p.content) }))
      .filter((p) => p.gapDays != null && p.gapDays >= -60 && p.gapDays <= 15);
    const sources = { makeedu: m ? { reasonRaw: txt(m.withdrawal_reason), withdrawnOn: day(m.withdrawn_on), enrolledOn: day(m.enrolled_on), gapDays: diffDays(day(m.withdrawn_on), w) } : null,
      archives, enrollments, consultations, parentMessages };
    const pii = scanRecord(sources);
    return { sid: sid(s.id), studentId: s.id, name: s.name, grade: s.grade, school: s.school, enrolledAt: day(s.enrolled_at), withdrawnAt: w,
      group: archives.length ? "원본 있음" : "원본 없음", sources, held: pii.length > 0, pii,
      nameMatchedUnmapped: archives.length ? [] : unmapped.filter((u) => fold(u.student_name) === fold(s.name)).map((u) => ({ aid: u.id.slice(0, 8), exitDate: day(u.exit_date), subject: u.subject, className: u.class_name })) };
  });

  // 조정용/최종 평가용을 미리 나눠 고정 — 학생 id 해시 순(한 학생 = 한 퇴원 사건이라 사건이 갈라지지 않는다).
  const pick = (group, n) => records.filter((r) => r.group === group && !r.held).map((r) => r.sid).sort().slice(0, n);
  const tuning = [...pick("원본 있음", 30), ...pick("원본 없음", 25)];
  const splits = { rule: "sha256('wd-v1|'+student_id) 앞 10자 정렬 · 그룹별 앞 N명 = 조정용(원본 있음 30 · 원본 없음 25) · 나머지 = 최종 평가", tuning, final: records.filter((r) => !r.held && !tuning.includes(r.sid)).map((r) => r.sid) };

  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "inputs.jsonl"), records.map((r) => JSON.stringify(r)).join("\n") + "\n");
  writeFileSync(join(OUT, "splits.json"), JSON.stringify(splits, null, 2));
  writeFileSync(join(OUT, "redaction-report.json"), JSON.stringify({ rule: "lib/pii.mjs — 주민번호·카드·계좌·급여 표현이면 행 보류 · 전화번호는 가림", held: records.filter((r) => r.held).map((r) => ({ sid: r.sid, pii: r.pii })), total: records.length }, null, 2));
  writeFileSync(join(OUT, "context.json"), JSON.stringify({ tenantId: cs, extractedAt: new Date().toISOString(), aiAnalysisLicense: license, closedPortfolioMonths: closedMonths,
    withdrawnReasonDistribution: allReasons, churnExcludeReasons: evalSettings[0]?.config?.metrics?.churn?.churn?.excludeReasons ?? "기본값(graduated·relocation·illness·advised)" }, null, 2));
  const c = (f) => records.filter(f).length;
  console.log(JSON.stringify({ total: records.length, 원본있음: c((r) => r.group === "원본 있음"), 원본없음: c((r) => r.group === "원본 없음"), 보류: c((r) => r.held),
    메이크에듀사유: c((r) => r.sources.makeedu?.reasonRaw), 같은퇴원원본: c((r) => r.sources.archives.some((a) => a.thisWithdrawal === "같은 퇴원")), 이름같은미연결원본: c((r) => r.nameMatchedUnmapped.length),
    조정용: tuning.length, 최종: splits.final.length }));
} finally {
  await closeReadOnly(sql);
}
