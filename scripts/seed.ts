/**
 * scripts/seed.ts
 *
 * Idempotently rebuilds the demo tenant ("ijw-demo") with a realistic-looking
 * snapshot: 5 teachers, 5 classrooms, 8 classes, 30 students, ~30 days of
 * attendance, and 3 announcements. Safe to re-run — wipes the tenant first.
 *
 * Run with: pnpm db:seed
 */

import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL missing — make sure .env.local has it.");
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 4 });

const TENANT_SLUG = "ijw-demo";

const TEACHERS = ["박지훈", "이연우", "김민지", "최서영", "강도현"];

const STUDENTS: { name: string; school: string; grade: string }[] = [
  // 중1
  { name: "강민서", school: "인재중", grade: "중1" },
  { name: "윤지호", school: "강남중", grade: "중1" },
  { name: "이서연", school: "선린중", grade: "중1" },
  { name: "김도윤", school: "인재중", grade: "중1" },
  { name: "한지우", school: "강남중", grade: "중1" },
  // 중2
  { name: "박하윤", school: "인재중", grade: "중2" },
  { name: "정수아", school: "선린중", grade: "중2" },
  { name: "최예린", school: "강남중", grade: "중2" },
  { name: "송지안", school: "인재중", grade: "중2" },
  { name: "임시우", school: "선린중", grade: "중2" },
  // 중3
  { name: "김서연", school: "강남중", grade: "중3" },
  { name: "오은서", school: "인재중", grade: "중3" },
  { name: "윤소율", school: "선린중", grade: "중3" },
  { name: "조하린", school: "강남중", grade: "중3" },
  { name: "한지유", school: "인재중", grade: "중3" },
  // 고1
  { name: "이도현", school: "휘문고", grade: "고1" },
  { name: "박재민", school: "서일고", grade: "고1" },
  { name: "김민준", school: "휘문고", grade: "고1" },
  { name: "송도윤", school: "선덕고", grade: "고1" },
  { name: "임예준", school: "동덕여고", grade: "고1" },
  // 고2
  { name: "강서아", school: "동덕여고", grade: "고2" },
  { name: "윤채원", school: "선덕고", grade: "고2" },
  { name: "이지유", school: "동덕여고", grade: "고2" },
  { name: "박서영", school: "휘문고", grade: "고2" },
  { name: "정하은", school: "서일고", grade: "고2" },
  // 고3
  { name: "최민재", school: "휘문고", grade: "고3" },
  { name: "한태윤", school: "선덕고", grade: "고3" },
  { name: "오준서", school: "서일고", grade: "고3" },
  { name: "김다온", school: "휘문고", grade: "고3" },
  { name: "박시현", school: "동덕여고", grade: "고3" },
];

const CLASSROOMS = ["301호", "302호", "205호", "206호", "401호"];

const CLASSES: { className: string; subject: string; grade: string }[] = [
  { className: "중1 수학 정규", subject: "math", grade: "중1" },
  { className: "중2 수학 심화 A반", subject: "math", grade: "중2" },
  { className: "중3 수학 심화 C반", subject: "math", grade: "중3" },
  { className: "중3 영어 정규", subject: "english", grade: "중3" },
  { className: "고1 영어 정규 B반", subject: "english", grade: "고1" },
  { className: "고2 수학 심화 A반", subject: "math", grade: "고2" },
  { className: "고2 영어 정규 B반", subject: "english", grade: "고2" },
  { className: "고3 수학 마무리", subject: "math", grade: "고3" },
];

const SCHEDULES: { className: string; day: string; start: string; end: string }[] = [
  { className: "중1 수학 정규", day: "mon", start: "16:00", end: "17:30" },
  { className: "중1 수학 정규", day: "wed", start: "16:00", end: "17:30" },
  { className: "중2 수학 심화 A반", day: "tue", start: "16:00", end: "17:30" },
  { className: "중2 수학 심화 A반", day: "thu", start: "16:00", end: "17:30" },
  { className: "중3 수학 심화 C반", day: "mon", start: "19:00", end: "20:30" },
  { className: "중3 수학 심화 C반", day: "wed", start: "19:00", end: "20:30" },
  { className: "중3 영어 정규", day: "tue", start: "19:00", end: "20:30" },
  { className: "중3 영어 정규", day: "thu", start: "19:00", end: "20:30" },
  { className: "고1 영어 정규 B반", day: "mon", start: "17:40", end: "19:00" },
  { className: "고1 영어 정규 B반", day: "wed", start: "17:40", end: "19:00" },
  { className: "고2 수학 심화 A반", day: "tue", start: "17:40", end: "19:10" },
  { className: "고2 수학 심화 A반", day: "thu", start: "17:40", end: "19:10" },
  { className: "고2 영어 정규 B반", day: "fri", start: "17:00", end: "18:30" },
  { className: "고3 수학 마무리", day: "fri", start: "19:00", end: "21:00" },
];

const ANNOUNCEMENTS = [
  {
    title: "6월 정기시험 일정 안내",
    content:
      "6월 17일(수) ~ 19일(금) 진행. 시험 시간표는 각 반 담임이 학생에게 전달합니다. 시험 범위는 별도 공지.",
    audience: "all" as const,
    pinned: true,
  },
  {
    title: "여름방학 시간표 변경 사전 공지",
    content: "7월 21일부터 여름 특강 시간표로 전환. 강사진 회의는 6월 25일 19:30 회의실에서 진행.",
    audience: "teachers" as const,
    pinned: false,
  },
  {
    title: "수강료 자동이체 신청 안내문 배포",
    content: "신규 등록 학부모 대상 안내문 PDF가 자료실에 업로드되었습니다. 6월 한 달 신청 접수.",
    audience: "counselors" as const,
    pinned: false,
  },
];

function pick<T>(arr: T[], i: number): T {
  return arr[i % arr.length]!;
}

async function main() {
  const [tenant] = await sql<{ id: string }[]>`
    select id from tenants where slug = ${TENANT_SLUG}
  `;
  if (!tenant) {
    console.error(`Tenant ${TENANT_SLUG} not found — run the migration first.`);
    process.exit(1);
  }
  const tenantId = tenant.id;
  console.log(`Tenant: ${TENANT_SLUG} (${tenantId})`);

  // --- 1. Wipe everything tenant-scoped except master users ---
  console.log("Wiping existing demo data…");
  await sql`delete from attendance_records where tenant_id = ${tenantId}`;
  await sql`delete from enrollments where tenant_id = ${tenantId}`;
  await sql`delete from students where tenant_id = ${tenantId}`;
  await sql`delete from classes where tenant_id = ${tenantId}`;
  await sql`delete from classrooms where tenant_id = ${tenantId}`;
  await sql`delete from announcements where tenant_id = ${tenantId}`;
  await sql`delete from class_schedules where tenant_id = ${tenantId}`;
  await sql`delete from users where tenant_id = ${tenantId} and system_role <> 'master'`;

  // --- 2. Teachers (5) ---
  console.log("Inserting teachers…");
  const teacherIds: string[] = [];
  for (const name of TEACHERS) {
    const id = randomUUID();
    await sql`
      insert into users (id, tenant_id, email, display_name, system_role, status)
      values (${id}, ${tenantId}, ${`teacher.${id.slice(0, 8)}@ijw-demo.local`}, ${name}, 'teacher', 'active')
    `;
    teacherIds.push(id);
  }

  // --- 3. Classrooms (5) ---
  console.log("Inserting classrooms…");
  const classroomIds: string[] = [];
  for (const name of CLASSROOMS) {
    const [row] = await sql<{ id: string }[]>`
      insert into classrooms (tenant_id, name, capacity)
      values (${tenantId}, ${name}, 16)
      returning id
    `;
    classroomIds.push(row.id);
  }

  // --- 4. Classes (8) ---
  console.log("Inserting classes…");
  const classes: { id: string; grade: string; className: string }[] = [];
  for (let i = 0; i < CLASSES.length; i++) {
    const c = CLASSES[i]!;
    const [row] = await sql<{ id: string }[]>`
      insert into classes (tenant_id, class_name, subject, teacher_id, classroom_id, is_active)
      values (${tenantId}, ${c.className}, ${c.subject}, ${pick(teacherIds, i)}, ${pick(classroomIds, i)}, true)
      returning id
    `;
    classes.push({ id: row.id, grade: c.grade, className: c.className });
  }

  // --- 4b. Class schedules (weekly recurrence) ---
  console.log("Inserting class schedules…");
  const validFrom = new Date();
  validFrom.setDate(validFrom.getDate() - 60);
  const validFromStr = validFrom.toISOString().slice(0, 10);
  for (const sched of SCHEDULES) {
    const cls = classes.find((c) => c.className === sched.className);
    if (!cls) continue;
    await sql`
      insert into class_schedules
        (tenant_id, class_id, day_of_week, start_time, end_time, valid_from)
      values
        (${tenantId}, ${cls.id}, ${sched.day}, ${sched.start}, ${sched.end}, ${validFromStr})
    `;
  }

  // --- 5. Students (30) ---
  console.log("Inserting students…");
  const enrolledAt = new Date();
  enrolledAt.setDate(enrolledAt.getDate() - 45);
  const enrolledDate = enrolledAt.toISOString().slice(0, 10);

  const students: { id: string; grade: string }[] = [];
  for (let i = 0; i < STUDENTS.length; i++) {
    const s = STUDENTS[i]!;
    const [row] = await sql<{ id: string }[]>`
      insert into students (
        tenant_id, name, school, grade, status,
        primary_teacher_id, enrolled_at, parent_name, parent_phone
      ) values (
        ${tenantId}, ${s.name}, ${s.school}, ${s.grade}, 'enrolled',
        ${pick(teacherIds, i)}, ${enrolledDate},
        ${`${s.name.slice(0, 1)}**`}, ${`010-${1000 + i}-${2000 + i}`}
      )
      returning id
    `;
    students.push({ id: row.id, grade: s.grade });
  }

  // --- 6. Enrollments (each student → 1 class matching their grade) ---
  console.log("Inserting enrollments…");
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 30);
  const startStr = startDate.toISOString().slice(0, 10);

  const studentClass = new Map<string, string>(); // studentId → classId
  for (const stu of students) {
    const matching = classes.filter((c) => c.grade === stu.grade);
    const klass = matching.length > 0 ? matching[Math.floor(Math.random() * matching.length)]! : classes[0]!;
    await sql`
      insert into enrollments (tenant_id, student_id, class_id, start_date)
      values (${tenantId}, ${stu.id}, ${klass.id}, ${startStr})
    `;
    studentClass.set(stu.id, klass.id);
  }

  // --- 7. Attendance: last 30 days, weekdays only, ~92% present ---
  console.log("Inserting attendance records…");
  const [masterRow] = await sql<{ id: string }[]>`
    select id from users where tenant_id = ${tenantId} and system_role = 'master' order by created_at limit 1
  `;
  const recordedBy = masterRow.id;

  const today = new Date();
  let inserted = 0;
  for (let d = 30; d >= 1; d--) {
    const day = new Date(today);
    day.setDate(today.getDate() - d);
    const dow = day.getDay(); // 0=Sun, 6=Sat
    if (dow === 0) continue; // skip Sundays
    const dateStr = day.toISOString().slice(0, 10);

    const rows: Record<string, string>[] = [];
    for (const stu of students) {
      const classId = studentClass.get(stu.id)!;
      const r = Math.random();
      const status = r < 0.92 ? "present" : r < 0.96 ? "late" : r < 0.99 ? "absent" : "excused";
      rows.push({
        tenant_id: tenantId,
        class_id: classId,
        student_id: stu.id,
        session_date: dateStr,
        status,
        recorded_by: recordedBy,
      });
    }
    await sql`insert into attendance_records ${sql(rows)}`;
    inserted += rows.length;
  }
  console.log(`  ${inserted} attendance rows`);

  // --- 8. Announcements ---
  console.log("Inserting announcements…");
  for (const a of ANNOUNCEMENTS) {
    await sql`
      insert into announcements (tenant_id, title, content, audience, pinned, author_id)
      values (${tenantId}, ${a.title}, ${a.content}, ${a.audience}, ${a.pinned}, ${recordedBy})
    `;
  }

  // --- Summary ---
  const [{ count: students_c }] = await sql<{ count: number }[]>`select count(*)::int as count from students where tenant_id = ${tenantId}`;
  const [{ count: teachers_c }] = await sql<{ count: number }[]>`select count(*)::int as count from users where tenant_id = ${tenantId} and system_role = 'teacher'`;
  const [{ count: classes_c }] = await sql<{ count: number }[]>`select count(*)::int as count from classes where tenant_id = ${tenantId}`;
  const [{ count: enrollments_c }] = await sql<{ count: number }[]>`select count(*)::int as count from enrollments where tenant_id = ${tenantId}`;
  const [{ count: attendance_c }] = await sql<{ count: number }[]>`select count(*)::int as count from attendance_records where tenant_id = ${tenantId}`;
  const [{ count: announcements_c }] = await sql<{ count: number }[]>`select count(*)::int as count from announcements where tenant_id = ${tenantId}`;
  const [{ count: schedules_c }] = await sql<{ count: number }[]>`select count(*)::int as count from class_schedules where tenant_id = ${tenantId}`;

  console.log("");
  console.log("Seed complete:");
  console.log(`  students       ${students_c}`);
  console.log(`  teachers       ${teachers_c}`);
  console.log(`  classes        ${classes_c}`);
  console.log(`  schedules      ${schedules_c}`);
  console.log(`  enrollments    ${enrollments_c}`);
  console.log(`  attendance     ${attendance_c}`);
  console.log(`  announcements  ${announcements_c}`);

  await sql.end();
}

main().catch(async (err) => {
  console.error(err);
  await sql.end({ timeout: 1 });
  process.exit(1);
});
