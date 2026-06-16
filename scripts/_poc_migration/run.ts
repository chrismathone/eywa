// 전 12메뉴 dry-run: ijw export JSON → eywa Supabase(일회용 테넌트)로 transform→load→리포트→정리.
// 정제: 날짜 정규화 / 학생 활성-중복 스킵 / 수강 기간겹침 그리디 스킵 / 수납 2026-03+ 월별 집계.
// 12메뉴 매핑 외 컬렉션(캘린더·간트·자료실·지출·셔틀·makeEdu로그·교재·알림 등)은 가져오지 않음.
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  makeIdMap, normName, normDate, monthGte,
  transformStaff, transformStudent, transformClass,
  mapAttendanceCount, mapConsultationOutcome, mapInvoiceStatus,
} from "./transform";

const BILLING_SINCE = "2026-03"; // 수납: 이 월(YYYY-MM) 이후만

let dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  const env = readFileSync("D:/eywa_refactoring/.env.local", "utf8");
  dbUrl = env.split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="))?.slice(13).trim().replace(/^["']|["']$/g, "");
}
if (!dbUrl) throw new Error("DATABASE_URL not found");

const TMP = "D:/tmp";
const exp = readdirSync(TMP).filter((f) => f.startsWith("ijw-export-") && f.endsWith(".json")).sort().pop()!;
const data = JSON.parse(readFileSync(path.join(TMP, exp), "utf8"));
const C: Record<string, any[]> = data.collections;
console.log("export:", exp);

// MIG_TARGET=demo → ijw-demo 테넌트에 영구 적재(auth 계정 보존 wipe, cleanup 없음). 기본은 dry-run(일회용).
const TARGET = process.env.MIG_TARGET ?? "dryrun";
const DEMO_TENANT = "becaa316-e636-42e9-9d09-08b133e0b094";

const sql = postgres(dbUrl, { prepare: false, max: 4 });
const tenantId = TARGET === "demo" ? DEMO_TENANT : randomUUID();
const slug = TARGET === "demo" ? "ijw-demo" : `poc-mig-${Date.now()}`;
const tally: Record<string, number> = {};
const note = (k: string, n = 1) => { tally[k] = (tally[k] ?? 0) + n; };
const errKey = (e: any) => (e?.code ? `${e.code}${e.constraint_name ? " " + e.constraint_name : ""}` : String(e?.message ?? "err").slice(0, 40));
const ins = async (label: string, fn: () => Promise<any>) => { try { await fn(); note(label + ".ok"); return true; } catch (e) { note(label + ".FAIL " + errKey(e)); return false; } };

async function main() {
  if (TARGET === "demo") {
    const t = await sql`select slug from tenants where id = ${tenantId}`;
    if (t[0]?.slug !== "ijw-demo") throw new Error("ijw-demo 테넌트 id 불일치 — 중단");
    // 데이터 wipe(FK 순서) + 가짜 시드강사만 삭제(로그인 가능 auth 계정 보존)
    for (const tb of ["attendance_records", "invoices", "student_consultations", "enrollment_consultations", "meeting_minutes", "enrollments", "class_schedules", "students", "classes", "classrooms"])
      await sql`delete from ${sql(tb)} where tenant_id = ${tenantId}`;
    await sql`delete from users where tenant_id = ${tenantId} and email like ${"%@ijw-demo.local"}`;
    console.log("WIPED ijw-demo 데이터 (chrismathone·st2000423·teacher@·student@ 보존)");
  } else {
    await sql`insert into tenants (id, slug, name, plan) values (${tenantId}, ${slug}, 'PoC Migration', 'free')`;
  }

  const staffIds = makeIdMap(), classIds = makeIdMap(), studentIds = makeIdMap();
  const nameToTeacher = new Map<string, string>();
  const roomToId = new Map<string, string>();
  const uidToUser = new Map<string, string>();
  let fallbackUser: string | null = null;

  // classrooms
  for (const r of new Set((C.classes ?? []).map((c) => String(c.room ?? "").trim()).filter(Boolean))) {
    const id = randomUUID();
    if (await ins("classroom", () => sql`insert into classrooms (id,tenant_id,name) values (${id},${tenantId},${r})`)) roomToId.set(r, id);
  }

  // staff → users
  const insertedStaff = new Set<string>();
  for (const s of C.staff ?? []) {
    const row = transformStaff(s, tenantId, staffIds);
    if (await ins("staff", () => sql`insert into users (id,tenant_id,email,display_name,system_role,status,hire_date,subjects,job_title)
      values (${row.id},${row.tenant_id},${row.email},${row.display_name},${row.system_role},${row.status},${normDate(row.hire_date)},${row.subjects as any},${row.job_title})`)) {
      insertedStaff.add(s.id);
      if (s.name) nameToTeacher.set(s.name, row.id);
      fallbackUser ??= row.id;
    }
  }
  // uid → user (staffIndex: doc.id = uid, staffId)
  for (const si of C.staffIndex ?? []) {
    if (si.staffId && staffIds.has(si.staffId) && insertedStaff.has(si.staffId)) uidToUser.set(si.id, staffIds.get(si.staffId));
  }
  const resolveUser = (uid?: string) => (uid && uidToUser.get(uid)) || fallbackUser;

  // classes (+schedules)
  const insertedClass = new Set<string>();
  for (const c of C.classes ?? []) {
    const teacher = c.teacher ? (nameToTeacher.get(c.teacher) ?? null) : null;
    const room = c.room ? (roomToId.get(String(c.room).trim()) ?? null) : null;
    const { classRow, schedules } = transformClass(c, tenantId, classIds, room, teacher);
    if (await ins("class", () => sql`insert into classes (id,tenant_id,class_name,subject,teacher_id,classroom_id,is_active,notes)
      values (${classRow.id},${classRow.tenant_id},${classRow.class_name},${classRow.subject},${classRow.teacher_id},${classRow.classroom_id},${classRow.is_active},${classRow.notes})`)) {
      insertedClass.add(c.id);
      for (const sc of schedules) await ins("schedule", () => sql`insert into class_schedules (id,tenant_id,class_id,day_of_week,start_time,end_time,valid_from,valid_to)
        values (${sc.id},${sc.tenant_id},${sc.class_id},${sc.day_of_week},${sc.start_time},${sc.end_time},${sc.valid_from},${sc.valid_to})`);
    }
  }

  // students (활성 중복 스킵: name_normalized|school|grade)
  const insertedStudent = new Set<string>();
  const seenActive = new Set<string>();
  for (const st of C.students ?? []) {
    const row = transformStudent(st, tenantId, studentIds, null);
    if (row.status !== "withdrawn") {
      const key = `${normName(row.name)}|${row.school ?? ""}|${row.grade ?? ""}`;
      if (seenActive.has(key)) { note("student.dedup-skip"); continue; }
      seenActive.add(key);
    }
    if (await ins("student", () => sql`insert into students (id,tenant_id,name,school,grade,parent_phone,parent_name,status,enrolled_at,withdrawn_at,withdrawal_metadata,student_code,notes)
      values (${row.id},${row.tenant_id},${row.name},${row.school},${row.grade},${row.parent_phone},${row.parent_name},${row.status},${normDate(row.enrolled_at)},${normDate(row.withdrawn_at)},${row.withdrawal_metadata ? sql.json(row.withdrawal_metadata) : null},${row.student_code},${row.notes})`))
      insertedStudent.add(st.id);
  }

  // enrollments (그리디 비겹침: student×class별 start 정렬 후 겹치면 스킵)
  type Cand = { st: string; cls: string; start: string; end: string | null; onHold: boolean; reason: string | null };
  const cands: Cand[] = [];
  for (const st of C.students ?? []) {
    if (!insertedStudent.has(st.id)) { note("enr.skip(student)"); continue; }
    for (const e of st.enrollments ?? []) {
      if (!e.classId || !insertedClass.has(e.classId)) { note("enr.skip(class)"); continue; }
      const start = normDate(e.startDate || e.enrollmentDate || st.startDate) || "2026-03-01";
      const end0 = normDate(e.endDate || e.withdrawalDate);
      const end = end0 && end0 < start ? null : end0; // end<start → 진행중으로 보정
      cands.push({ st: studentIds.get(st.id), cls: classIds.get(e.classId), start, end, onHold: e.onHold ?? false, reason: e.cancelReason ?? null });
    }
  }
  const kept = new Map<string, { start: string; end: string }[]>(); // student|class → 채택 구간
  cands.sort((a, b) => a.start.localeCompare(b.start));
  for (const c of cands) {
    const key = `${c.st}|${c.cls}`;
    const arr = kept.get(key) ?? [];
    const end = c.end ?? "9999-12-31";
    if (arr.some((iv) => c.start < iv.end && iv.start < end)) { note("enr.overlap-skip"); continue; }
    arr.push({ start: c.start, end }); kept.set(key, arr);
    await ins("enr", () => sql`insert into enrollments (id,tenant_id,student_id,class_id,start_date,end_date,on_hold,withdrawal_reason)
      values (${randomUUID()},${tenantId},${c.st},${c.cls},${c.start},${c.end},${c.onHold},${c.reason})`);
  }

  // attendance_records — ijw는 월별 문서 + "반이름::날짜"→카운트 맵. 일별 행으로 펼쳐서 배치 적재.
  const classByName = new Map<string, string>();
  for (const c of C.classes ?? []) if (insertedClass.has(c.id)) classByName.set(c.className, classIds.get(c.id));
  const attRows: Record<string, any>[] = [];
  for (const a of C.attendance_records ?? []) {
    const sid = a.studentId && insertedStudent.has(a.studentId) ? studentIds.get(a.studentId) : null;
    if (!sid) { note("att.skip(student)"); continue; }
    const rb = (a.staffId && insertedStaff.has(a.staffId) ? staffIds.get(a.staffId) : null) ?? fallbackUser!;
    for (const [key, val] of Object.entries(a.attendance ?? {})) {
      const i = key.lastIndexOf("::");
      const cname = i >= 0 ? key.slice(0, i) : "";
      const date = normDate(i >= 0 ? key.slice(i + 2) : "");
      const cid = classByName.get(cname);
      if (!cid || !date) { note("att.skip(class/date)"); continue; }
      attRows.push({ id: randomUUID(), tenant_id: tenantId, class_id: cid, student_id: sid, session_date: date, status: mapAttendanceCount(val), note: a.memos?.[key] ?? null, homework_done: !!a.homework?.[key], recorded_by: rb });
    }
  }
  for (let i = 0; i < attRows.length; i += 500) {
    const chunk = attRows.slice(i, i + 500);
    try { await sql`insert into attendance_records ${sql(chunk)}`; note("att.ok", chunk.length); }
    catch (e) { note("att.chunkFAIL " + errKey(e)); for (const r of chunk) await ins("att", () => sql`insert into attendance_records ${sql(r)}`); }
  }

  // consultations(인테이크) → enrollment_consultations
  for (const k of C.consultations ?? []) {
    const consultant = k.counselor ? (nameToTeacher.get(k.counselor) ?? null) : null;
    await ins("econsult", () => sql`insert into enrollment_consultations (id,tenant_id,prospect_name,prospect_grade,prospect_school,parent_name,parent_phone,parent_request,consultant_id,outcome,consulted_at)
      values (${randomUUID()},${tenantId},${k.studentName ?? "미상"},${k.grade ?? null},${k.schoolName ?? null},${k.parentName ?? null},${k.parentPhone ?? null},${k.notes ?? k.enrollmentReason ?? null},${consultant},${mapConsultationOutcome(k.status)},${normDate(k.consultationDate) || new Date().toISOString()})`);
  }

  // student_consultations
  for (const k of C.student_consultations ?? []) {
    const sid = k.studentId && insertedStudent.has(k.studentId) ? studentIds.get(k.studentId) : null;
    if (!sid) { note("sconsult.skip(student)"); continue; }
    const counselor = resolveUser(k.consultantId) ?? (k.consultantName ? nameToTeacher.get(k.consultantName) ?? null : null);
    await ins("sconsult", () => sql`insert into student_consultations (id,tenant_id,student_id,counselor_id,consulted_at,category,summary,follow_up_action)
      values (${randomUUID()},${tenantId},${sid},${counselor},${normDate(k.date) || new Date().toISOString()},${k.type ?? "general"},${k.notes && String(k.notes).trim() ? k.notes : "(내용 없음)"},${k.followUpContent ?? null})`);
  }

  // billing(2026-03+) → invoices. billing엔 학생 id/학교/전화가 없고 이름+학년만 → 이름+학년 매칭,
  // 없으면 동명이인이 아닐 때만 이름-only 매칭(모호하면 스킵).
  const stuByNG = new Map<string, string>(); // name|grade → uuid
  const stuByName = new Map<string, string[]>(); // name → [uuid…]
  for (const st of C.students ?? []) {
    if (!insertedStudent.has(st.id)) continue;
    const u = studentIds.get(st.id);
    stuByNG.set(`${normName(st.name)}|${st.grade ?? ""}`, u);
    const arr = stuByName.get(normName(st.name)) ?? [];
    arr.push(u); stuByName.set(normName(st.name), arr);
  }
  const matchStudent = (b: any): string | null => {
    const ng = stuByNG.get(`${normName(b.studentName)}|${b.grade ?? ""}`);
    if (ng) return ng;
    const arr = stuByName.get(normName(b.studentName));
    return arr && arr.length === 1 ? arr[0] : null; // 모호하지 않은 이름-only만
  };

  // student×month 집계(unique 충돌 회피, line_items에 분해)
  const byInv = new Map<string, { sid: string; period: string; total: number; paid: number; disc: number; items: any[]; due: string | null; paidAt: string | null }>();
  for (const b of C.billing ?? []) {
    if (!monthGte(b.month, BILLING_SINCE)) { note("inv.skip(before-cutoff)"); continue; }
    const sid = matchStudent(b);
    if (!sid) { note("inv.skip(no-match)"); continue; }
    const period = String(b.month).slice(0, 7);
    const key = `${sid}|${period}`;
    const g = byInv.get(key) ?? { sid, period, total: 0, paid: 0, disc: 0, items: [], due: null, paidAt: null };
    g.total += Number(b.billedAmount) || 0;
    g.paid += Number(b.paidAmount) || 0;
    g.disc += Number(b.discountAmount) || 0;
    g.items.push({ kind: b.category ?? "tuition", description: b.billingName ?? b.category ?? "", amount: Number(b.billedAmount) || 0 });
    if (!g.due && b.billingDay) { const d = String(b.billingDay).padStart(2, "0"); if (+d >= 1 && +d <= 31) g.due = `${period}-${d}`; }
    g.paidAt = normDate(b.paidDate) || g.paidAt;
    byInv.set(key, g);
  }
  for (const g of byInv.values()) {
    await ins("inv", () => sql`insert into invoices (id,tenant_id,student_id,period,category,amount_total,amount_paid,amount_discount,status,line_items,due_date,paid_at)
      values (${randomUUID()},${tenantId},${g.sid},${g.period},'tuition',${g.total},${g.paid},${g.disc},${mapInvoiceStatus(g.total, g.paid)},${sql.json(g.items)},${g.due},${g.paidAt})`);
  }

  // meeting_reports → meeting_minutes (AI 텍스트 스냅샷; 오디오 파일은 GCS라 경로만)
  for (const m of C.meeting_reports ?? []) {
    const hasReport = !!m.report;
    await ins("meeting", () => sql`insert into meeting_minutes (id,tenant_id,title,content,attendees,held_at,transcription,ai_report,ai_speaker_roles,ai_summary,ai_model_version,ai_generated_at,processing_status,audio_path)
      values (${randomUUID()},${tenantId},${m.title ?? "회의"},'',${m.attendees ? sql.json((m.attendees as any[]).map((n: any) => (typeof n === "string" ? n : String(n?.name ?? n)))) : null},${normDate(m.meetingDate) || new Date().toISOString()},${m.transcription ?? null},${m.report ? sql.json(m.report) : null},${m.speakerRoles ? sql.json(m.speakerRoles) : null},${m.report?.summary ?? null},${hasReport ? "ijw-import" : null},${hasReport ? new Date().toISOString() : null},${hasReport ? "completed" : "idle"},${m.storagePath ?? null})`);
  }

  // ── 검증 ──
  const cnt = async (t: string) => (await sql`select count(*)::int c from ${sql(t)} where tenant_id = ${tenantId}`)[0].c;
  console.log("\n=== 적재 결과 (일회용 테넌트) ===");
  for (const t of ["users", "classrooms", "classes", "class_schedules", "students", "enrollments", "attendance_records", "enrollment_consultations", "student_consultations", "invoices", "meeting_minutes"])
    console.log(`  ${t}: ${await cnt(t)}`);
  console.log("\n=== 집계(ok / FAIL / skip) ===");
  for (const k of Object.keys(tally).sort()) console.log(`  ${k}: ${tally[k]}`);
}

main()
  .catch((e) => console.error("FATAL:", e?.message ?? e))
  .finally(async () => {
    if (TARGET === "demo") {
      await sql.end();
      console.log("\n=== LOADED into ijw-demo (영구, cleanup 없음) ===");
      return;
    }
    console.log("\n=== cleanup ===");
    for (const t of ["attendance_records", "invoices", "student_consultations", "enrollment_consultations", "meeting_minutes", "enrollments", "class_schedules", "students", "classes", "classrooms", "users"])
      try { await sql`delete from ${sql(t)} where tenant_id = ${tenantId}`; } catch (e) { console.log("cleanup", t, errKey(e)); }
    try { await sql`delete from tenants where id = ${tenantId}`; console.log("tenant deleted"); } catch (e) { console.log("tenant del", errKey(e)); }
    await sql.end();
    console.log("done.");
  });
