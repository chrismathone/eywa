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
  mapAttendanceCount, mapConsultationOutcome, mapInvoiceStatus, DAY_MAP,
} from "./transform";

const BILLING_SINCE = "2026-03"; // 수납: 이 월(YYYY-MM) 이후만

// 상담 과목 코드(소스 english/math…) → eywa 한글 라벨
const CONSULT_SUBJECT: Record<string, string> = { english: "영어", math: "수학", korean: "국어", science: "과학" };
const mapConsultSubject = (s?: string): string | null =>
  s && String(s).trim() ? (CONSULT_SUBJECT[String(s).trim().toLowerCase()] ?? String(s).trim()) : null;
const addDays = (iso: string, n: number): string => {
  const d = new Date(iso);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
// 등록상담 과목 라벨(영어/수학…) → eywa 과목 키(english/math…). subject_details 키도 동일.
const SUBJECT_LABEL_TO_KEY: Record<string, string> = { "영어": "english", "수학": "math", "국어": "korean", "과학": "science" };
const consultSubjectKey = (s?: string): string | null => (s && SUBJECT_LABEL_TO_KEY[String(s).trim()]) || null;
// ijw 등록상담 status가 등록상태 enum에 맞으면 registration_status로(그 외는 outcome만 파생).
const REG_STATUSES = new Set(["상담전", "이번달 등록예정", "추후 등록예정", "등록완료", "미등록"]);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asBool = (v: any): boolean => v === true || v === "true";
// ijw 결제수단 코드(C=카드·B=계좌이체·선택=미지정) → eywa payment_method.
const PAY_CODE: Record<string, string> = { C: "card", B: "transfer" };
// ijw 과목별 상담 오브젝트({math,english,korean,science,etc}Consultation) → eywa subject_details jsonb(과목키별).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildSubjectDetails(k: any): Record<string, unknown> | null {
  const sd: Record<string, unknown> = {};
  for (const [src, key] of [["mathConsultation", "math"], ["englishConsultation", "english"], ["koreanConsultation", "korean"], ["scienceConsultation", "science"], ["etcConsultation", "etc"]] as const) {
    const v = k[src];
    if (v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length) sd[key] = v;
  }
  return Object.keys(sd).length ? sd : null;
}

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
const slug = TARGET === "demo" ? "injaewon" : `poc-mig-${Date.now()}`;
const tally: Record<string, number> = {};
const note = (k: string, n = 1) => { tally[k] = (tally[k] ?? 0) + n; };
const errKey = (e: any) => (e?.code ? `${e.code}${e.constraint_name ? " " + e.constraint_name : ""}` : String(e?.message ?? "err").slice(0, 40));
const ins = async (label: string, fn: () => Promise<any>) => { try { await fn(); note(label + ".ok"); return true; } catch (e) { note(label + ".FAIL " + errKey(e)); return false; } };

async function main() {
  if (TARGET === "demo") {
    const t = await sql`select slug from tenants where id = ${tenantId}`;
    if (t[0]?.slug !== "injaewon") throw new Error("injaewon(구 ijw-demo) 테넌트 id 불일치 — 중단");
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

  // 보존된 기존 users(이전 import의 ijw 스태프)를 담임 이름맵에 선로드. 재실행 시 staff insert가 email
  // 유니크 충돌로 실패해도(users는 wipe 보존) 반 teacher_id·상담사가 전부 null이 되는 것을 막는다.
  for (const u of await sql<{ id: string; display_name: string | null; english_name: string | null }[]>`
    select id, display_name, english_name from users where tenant_id = ${tenantId}`) {
    if (u.display_name) nameToTeacher.set(u.display_name, u.id);
    if (u.english_name) nameToTeacher.set(u.english_name, u.id);
    fallbackUser ??= u.id;
  }

  // classrooms
  for (const r of new Set((C.classes ?? []).map((c) => String(c.room ?? "").trim()).filter(Boolean))) {
    const id = randomUUID();
    if (await ins("classroom", () => sql`insert into classrooms (id,tenant_id,name) values (${id},${tenantId},${r})`)) roomToId.set(r, id);
  }

  // staff → users
  const insertedStaff = new Set<string>();
  for (const s of C.staff ?? []) {
    const row = transformStaff(s, tenantId, staffIds);
    if (await ins("staff", () => sql`insert into users (id,tenant_id,email,display_name,system_role,status,hire_date,subjects,job_title,phone,default_classroom)
      values (${row.id},${row.tenant_id},${row.email},${row.display_name},${row.system_role},${row.status},${normDate(row.hire_date)},${row.subjects as any},${row.job_title},${row.phone},${row.default_classroom})`)) {
      insertedStaff.add(s.id);
      if (s.name) nameToTeacher.set(s.name, row.id);
      fallbackUser ??= row.id;
    }
  }
  // uid → user (staffIndex: doc.id = uid, staffId)
  for (const si of C.staffIndex ?? []) {
    if (si.staffId && staffIds.has(si.staffId) && insertedStaff.has(si.staffId)) uidToUser.set(si.id, staffIds.get(si.staffId));
  }

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
    if (await ins("student", () => sql`insert into students (id,tenant_id,name,school,grade,parent_phone,parent_name,status,enrolled_at,withdrawn_at,withdrawal_metadata,student_code,notes,gender,birth_date,parent_relation,student_phone,home_phone,other_phone,address,zip_code,address_detail,email,nickname,graduation_year)
      values (${row.id},${row.tenant_id},${row.name},${row.school},${row.grade},${row.parent_phone},${row.parent_name},${row.status},${normDate(row.enrolled_at)},${normDate(row.withdrawn_at)},${row.withdrawal_metadata ? sql.json(row.withdrawal_metadata) : null},${row.student_code},${row.notes},${row.gender},${row.birth_date},${row.parent_relation},${row.student_phone},${row.home_phone},${row.other_phone},${row.address},${row.zip_code},${row.address_detail},${row.email},${row.nickname},${row.graduation_year})`))
      insertedStudent.add(st.id);
  }

  // enrollments (그리디 비겹침: student×class별 start 정렬 후 겹치면 스킵)
  type Cand = { st: string; cls: string; start: string; end: string | null; onHold: boolean; reason: string | null; isTransferred: boolean; attendanceDays: string[] };
  const cands: Cand[] = [];
  for (const st of C.students ?? []) {
    if (!insertedStudent.has(st.id)) { note("enr.skip(student)"); continue; }
    for (const e of st.enrollments ?? []) {
      if (!e.classId || !insertedClass.has(e.classId)) { note("enr.skip(class)"); continue; }
      const start = normDate(e.startDate || e.enrollmentDate || st.startDate) || "2026-03-01";
      const end0 = normDate(e.endDate || e.withdrawalDate);
      // ⚠️ ijw는 종료·전출된 수강을 end<start(종료일이 시작일보다 이름)로 기록한다. 이를 null(진행중)로
      // 되살리면 옛 반이 안 닫혀 시간표에 유령으로 남는다(강사 간 학생 중복). 종료로 취급하되,
      // GiST daterange(start,end,'[)')는 end<start면 throw하므로 end_date=start(빈 구간=활성 아님)로 닫는다.
      const end = end0 && end0 < start ? start : end0;
      // 분리등원(요일 한글 → eywa day 코드) + 전입 플래그 보존.
      const attDays = Array.isArray(e.attendanceDays) ? e.attendanceDays.map((d: string) => DAY_MAP[d] ?? d) : [];
      cands.push({ st: studentIds.get(st.id), cls: classIds.get(e.classId), start, end, onHold: e.onHold ?? false, reason: e.cancelReason ?? null, isTransferred: e.isTransferred ?? false, attendanceDays: attDays });
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
    await ins("enr", () => sql`insert into enrollments (id,tenant_id,student_id,class_id,start_date,end_date,on_hold,withdrawal_reason,is_transferred,attendance_days)
      values (${randomUUID()},${tenantId},${c.st},${c.cls},${c.start},${c.end},${c.onHold},${c.reason},${c.isTransferred},${c.attendanceDays as any})`);
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

  // consultations(인테이크) → enrollment_consultations. 상세 폼(0046a) 전 필드 매핑 + subject_details jsonb.
  for (const k of C.consultations ?? []) {
    const consultant = k.counselor ? (nameToTeacher.get(k.counselor) ?? null) : null;
    const regStatus = REG_STATUSES.has(String(k.status ?? "").trim()) ? String(k.status).trim() : null;
    const subjectDetails = buildSubjectDetails(k);
    await ins("econsult", () => sql`insert into enrollment_consultations (
      id,tenant_id,prospect_name,prospect_grade,prospect_school,parent_name,parent_phone,parent_request,consultant_id,outcome,consulted_at,
      address,gender,parent_relation,blood_type,student_phone,payment_amount,payment_date,registrar,non_registration_reason,
      follow_up_date,follow_up_content,career_goal,siblings,consultation_path,shuttle_bus_request,privacy_agreement,installment_agreement,
      registration_status,subject,subject_details)
      values (
      ${randomUUID()},${tenantId},${k.studentName ?? "미상"},${k.grade ?? null},${k.schoolName ?? null},${k.parentName ?? null},${k.parentPhone ?? null},${k.notes ?? k.enrollmentReason ?? null},${consultant},${mapConsultationOutcome(k.status)},${normDate(k.consultationDate) || new Date().toISOString()},
      ${k.address ?? null},${k.gender === "male" || k.gender === "female" ? k.gender : null},${k.parentRelation ?? null},${k.bloodType ?? null},${k.studentPhone ?? null},${Number(k.paymentAmount) || null},${normDate(k.paymentDate)},${k.registrar ?? null},${k.nonRegistrationReason ?? null},
      ${normDate(k.followUpDate)},${k.followUpContent ?? null},${k.careerGoal ?? null},${k.siblings ?? null},${k.consultationPath ?? null},${asBool(k.shuttleBusRequest)},${asBool(k.privacyAgreement)},${asBool(k.installmentAgreement)},
      ${regStatus},${consultSubjectKey(k.subject)},${subjectDetails ? sql.json(subjectDetails as any) : null})`);
  }

  // student_consultations
  // ⚠️ 소스 필드명 주의: 내용=content, 카테고리=category(general/academic…), 대상=type(parent/student),
  // 후속메모=followUpNotes, 후속여부=followUpNeeded/followUpDone, 과목=subject(english/math).
  // (구버전은 notes/type→category/followUpContent로 잘못 매핑해 summary 전부 "(내용 없음)"·category 전부 "parent"였음)
  for (const k of C.student_consultations ?? []) {
    const sid = k.studentId && insertedStudent.has(k.studentId) ? studentIds.get(k.studentId) : null;
    if (!sid) { note("sconsult.skip(student)"); continue; }
    // ⚠️ 상담자 우선순위: consultantId(uid) → consultantName(이름, 괄호 영문닉 제거 폴백) → fallbackUser.
    // (옛 버그: resolveUser(uid)가 미해결 시 항상 fallbackUser를 반환해 이름 매칭이 dead code가 됐고,
    //  1411건 전부 '보조T'(fallbackUser)로 몰렸다. reattribute-consultation-counselors.cjs로 사후 교정.)
    const stripParen = (n: string) => n.replace(/\s*\(.*?\)\s*/g, "").trim();
    const counselor =
      (k.consultantId ? uidToUser.get(k.consultantId) : undefined) ??
      (k.consultantName
        ? nameToTeacher.get(k.consultantName) ?? nameToTeacher.get(stripParen(k.consultantName))
        : undefined) ??
      fallbackUser;
    const consultedAt = normDate(k.date) || new Date().toISOString();
    const summary = k.content && String(k.content).trim() ? String(k.content).trim() : "(내용 없음)";
    const category = k.category && String(k.category).trim() ? String(k.category).trim() : "general";
    const audience = k.type && String(k.type).trim() ? String(k.type).trim() : null;
    const subject = mapConsultSubject(k.subject);
    const followAction = k.followUpNotes && String(k.followUpNotes).trim() ? String(k.followUpNotes).trim() : null;
    const followDone = !!k.followUpDone;
    // 소스에 후속 '날짜' 필드가 없어, 후속 필요(미완)면 상담일+7일로 합성해 후속 필터를 의미있게 만든다.
    const followDate = k.followUpNeeded && !followDone ? addDays(consultedAt.slice(0, 10), 7) : null;
    await ins("sconsult", () => sql`insert into student_consultations
      (id,tenant_id,student_id,counselor_id,consulted_at,category,subject,audience,summary,follow_up_action,follow_up_done,follow_up_date)
      values (${randomUUID()},${tenantId},${sid},${counselor},${consultedAt},${category},${subject},${audience},${summary},${followAction},${followDone},${followDate})`);
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
  const byInv = new Map<string, { sid: string; period: string; total: number; paid: number; disc: number; items: any[]; due: string | null; paidAt: string | null; points: number; pm: Record<string, number> }>();
  for (const b of C.billing ?? []) {
    if (!monthGte(b.month, BILLING_SINCE)) { note("inv.skip(before-cutoff)"); continue; }
    const sid = matchStudent(b);
    if (!sid) { note("inv.skip(no-match)"); continue; }
    const period = String(b.month).slice(0, 7);
    const key = `${sid}|${period}`;
    const g = byInv.get(key) ?? { sid, period, total: 0, paid: 0, disc: 0, items: [], due: null, paidAt: null, points: 0, pm: {} };
    g.total += Number(b.billedAmount) || 0;
    g.paid += Number(b.paidAmount) || 0;
    g.disc += Number(b.discountAmount) || 0;
    g.points += Number(b.pointsUsed) || 0;
    const pmCode = PAY_CODE[String(b.paymentMethod ?? "").trim()];
    if (pmCode) g.pm[pmCode] = (g.pm[pmCode] ?? 0) + 1;
    g.items.push({ kind: b.category ?? "tuition", description: b.billingName ?? b.category ?? "", amount: Number(b.billedAmount) || 0 });
    if (!g.due && b.billingDay) { const d = String(b.billingDay).padStart(2, "0"); if (+d >= 1 && +d <= 31) g.due = `${period}-${d}`; }
    g.paidAt = normDate(b.paidDate) || g.paidAt;
    byInv.set(key, g);
  }
  for (const g of byInv.values()) {
    const pm = Object.entries(g.pm).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null; // 최빈 결제수단(card/transfer)
    await ins("inv", () => sql`insert into invoices (id,tenant_id,student_id,period,category,amount_total,amount_paid,amount_discount,status,line_items,due_date,paid_at,payment_method,points_used)
      values (${randomUUID()},${tenantId},${g.sid},${g.period},'tuition',${g.total},${g.paid},${g.disc},${mapInvoiceStatus(g.total, g.paid)},${sql.json(g.items)},${g.due},${g.paidAt},${pm},${g.points})`);
  }

  // meeting_reports → meeting_minutes (AI 텍스트 스냅샷; 오디오 파일은 GCS라 경로만)
  for (const m of C.meeting_reports ?? []) {
    const hasReport = !!m.report;
    await ins("meeting", () => sql`insert into meeting_minutes (id,tenant_id,title,content,attendees,held_at,transcription,ai_report,ai_speaker_roles,ai_summary,ai_model_version,ai_generated_at,processing_status,audio_path,audio_duration_sec)
      values (${randomUUID()},${tenantId},${m.title ?? "회의"},'',${m.attendees ? sql.json((m.attendees as any[]).map((n: any) => (typeof n === "string" ? n : String(n?.name ?? n)))) : null},${normDate(m.meetingDate) || new Date().toISOString()},${m.transcription ?? null},${m.report ? sql.json(m.report) : null},${m.speakerRoles ? sql.json(m.speakerRoles) : null},${m.report?.summary ?? null},${hasReport ? "ijw-import" : null},${hasReport ? new Date().toISOString() : null},${hasReport ? "completed" : "idle"},${m.storagePath ?? null},${m.durationSeconds ? Math.round(Number(m.durationSeconds)) : null})`);
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
