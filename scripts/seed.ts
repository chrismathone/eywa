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

type AiAnalysisSeed = {
  diagnosis: {
    strengths: string[];
    weaknesses: string[];
    level: string;
    summary: string;
  };
  learningPlan: {
    immediate: string[];
    semester: string[];
    longTerm: string[];
  };
};

type ProspectSeed = {
  name: string;
  grade: string;
  school: string;
  parentName: string;
  parentPhone: string;
  parentRequest: string;
  learningHistory: { prevAcademy?: string; lastScore?: string; weakSubjects?: string[] };
  outcome: "pending" | "scheduled" | "consulted" | "ai_done" | "enrolled";
  consultedDaysAgo: number;
  aiAnalysis?: AiAnalysisSeed;
};

const PROSPECTS: ProspectSeed[] = [
  {
    name: "황민호",
    grade: "중1",
    school: "인재중",
    parentName: "황**",
    parentPhone: "010-2001-3001",
    parentRequest: "초6 때 수학 학원을 다녔지만 중학 수학에 적응이 어렵습니다. 기초 점검 후 적합한 반 추천 부탁드립니다.",
    learningHistory: { prevAcademy: "ABC수학", lastScore: "초6 단원평가 평균 82점", weakSubjects: ["분수", "방정식"] },
    outcome: "pending",
    consultedDaysAgo: 0,
  },
  {
    name: "전소율",
    grade: "중2",
    school: "강남중",
    parentName: "전**",
    parentPhone: "010-2002-3002",
    parentRequest: "1학기 중간고사에서 수학 70점대. 개념 보충이 필요한 것 같습니다.",
    learningHistory: { lastScore: "중2 1학기 중간 수학 74점", weakSubjects: ["일차함수"] },
    outcome: "scheduled",
    consultedDaysAgo: 1,
  },
  {
    name: "김지안",
    grade: "중3",
    school: "선린중",
    parentName: "김**",
    parentPhone: "010-2003-3003",
    parentRequest: "고입 대비 + 수학 심화. 영재고는 아니지만 자사고 정도 목표.",
    learningHistory: { prevAcademy: "XYZ학원", lastScore: "중3 1학기 기말 수학 92점", weakSubjects: ["기하"] },
    outcome: "ai_done",
    consultedDaysAgo: 3,
    aiAnalysis: {
      diagnosis: {
        strengths: ["대수 영역 안정적", "응용 문제 접근 적극적", "자기주도 학습 가능"],
        weaknesses: ["기하 도형 직관 약함", "서술형 풀이 정리 부족"],
        level: "상위권",
        summary:
          "전반적인 수학 역량은 상위권. 단 기하 영역의 시각화/증명 단계에서 약점이 보이며, 풀이 과정을 글로 정리하는 훈련이 필요합니다.",
      },
      learningPlan: {
        immediate: ["기하 도형 단원 복습 4주", "주 1회 서술형 풀이 첨삭"],
        semester: ["중3 2학기 도형의 닮음/원 단원 선행", "기출 문제 풀이 200제 완료"],
        longTerm: ["고1 수학 상 1단원 선행", "자사고 수학 면접 대비 풀이 발표 훈련"],
      },
    },
  },
  {
    name: "이예성",
    grade: "고1",
    school: "휘문고",
    parentName: "이**",
    parentPhone: "010-2004-3004",
    parentRequest: "내신과 수능을 동시에 잡고 싶습니다. 영어와 수학 모두 등록 희망.",
    learningHistory: { lastScore: "중3 기말 영어 89점 / 수학 95점", weakSubjects: ["영어 듣기"] },
    outcome: "ai_done",
    consultedDaysAgo: 5,
    aiAnalysis: {
      diagnosis: {
        strengths: ["수학 기본기 견고", "장기 계획 수립 가능", "성실한 학습 태도"],
        weaknesses: ["영어 듣기 영역", "어휘 정착도 부족"],
        level: "최상위권 (수학) / 중상위권 (영어)",
        summary:
          "수학은 정규반 심화 진도 가능 수준. 영어는 듣기와 어휘 보강이 우선 과제로, 듣기 모의고사 주 2회와 어휘 누적 테스트 도입 권장.",
      },
      learningPlan: {
        immediate: ["고1 수학 상 심화 진도 시작", "영어 듣기 모의고사 주 2회"],
        semester: ["고1 1학기 내신 대비 4주 집중", "수능 어휘 2,000개 완성"],
        longTerm: ["고2 진도 선행 (수학 II)", "고2 모의고사 영어 1등급 달성"],
      },
    },
  },
  {
    name: "박서린",
    grade: "고2",
    school: "서일고",
    parentName: "박**",
    parentPhone: "010-2005-3005",
    parentRequest: "이전 학원에서 영어 1등급 유지하다 떨어져 학원 이동 결정.",
    learningHistory: { prevAcademy: "DEF영어", lastScore: "고2 모의고사 영어 2등급", weakSubjects: ["독해 속도"] },
    outcome: "enrolled",
    consultedDaysAgo: 14,
    aiAnalysis: {
      diagnosis: {
        strengths: ["기본 문법 우수", "어휘력 풍부", "독해 정확도 높음"],
        weaknesses: ["장문 독해 속도", "EBS 연계 학습 부족"],
        level: "상위권",
        summary:
          "정확도는 높지만 시간 압박 상황에서 속도가 떨어집니다. 빠른 독해 훈련과 EBS 연계 분석을 통해 1등급 회복 가능.",
      },
      learningPlan: {
        immediate: ["주 3회 시간 측정 독해 훈련", "EBS 수능특강 분석 시작"],
        semester: ["고2 2학기 모의고사 1등급 회복", "어휘 누적 4,000개"],
        longTerm: ["수능 영어 1등급 안정화", "고3 진학 시 심화반 합류"],
      },
    },
  },
];

const TUITION_BY_GRADE: Record<string, number> = {
  "중1": 350_000,
  "중2": 380_000,
  "중3": 400_000,
  "고1": 420_000,
  "고2": 450_000,
  "고3": 500_000,
};

const STUDENT_CONSULTATION_TEMPLATES: { summary: string; followUp?: string }[] = [
  {
    summary: "최근 모의고사 성적 하락에 대한 학부모 면담. 학교 시험 직전 컨디션 관리와 풀이 시간 분배가 약점으로 확인됨.",
    followUp: "주 1회 모의고사 시간 측정 풀이 + 컨디션 노트 점검",
  },
  {
    summary: "본인이 직접 진로 상담 요청. 수학 심화반 진입에 대한 자신감과 부담감을 동시에 호소. 단계적 진도 조정 합의.",
    followUp: "다음 단원 평가에서 80점 이상 시 심화반 합류",
  },
  {
    summary: "결석 누적 3회. 가정 상황 변화로 통원 패턴이 불규칙. 학부모와 통화 후 보강 일정 재조정.",
    followUp: "수/금 19:00 보강 슬롯 배정",
  },
  {
    summary: "과제 미제출 패턴에 대한 면담. 학습 분량은 적절하지만 우선순위 정리 능력이 부족. 플래너 작성 코칭 시작.",
    followUp: "주간 플래너 검토 (월요일 16시)",
  },
  {
    summary: "선행 학습 가속화 요청 (학부모). 현재 진도 대비 1.5학년 위 단원 학습 가능 여부 평가 필요.",
    followUp: "다음 주 진단 평가 예약 → 결과에 따라 결정",
  },
];

const MEETINGS: { title: string; daysAgo: number; attendees: string[]; content: string }[] = [
  {
    title: "주간 강사 회의 (5월 4주차)",
    daysAgo: 2,
    attendees: ["박지훈", "이연우", "김민지", "최서영", "강도현"],
    content: `안건 1. 6월 정기시험 일정 확정
  - 6/17(수) ~ 6/19(금) 진행, 시간표는 다음 주 화요일까지 전달
  - 시험 범위는 각 과목 강사가 학생에게 별도 안내

안건 2. 출석률 추이 점검
  - 5월 평균 출석률 92% 유지
  - 결석 3회 이상 학생 5명 → 학생상담 우선순위 등록

안건 3. 여름방학 시간표 사전 공지
  - 7/21부터 여름 특강 전환, 강사 일정 사전 확인 필요
  - 강사진 회의 6/25 19:30 예정`,
  },
  {
    title: "수학 교과 분과 회의",
    daysAgo: 7,
    attendees: ["박지훈", "김민지", "강도현"],
    content: `안건 1. 중3 심화반 진도 조정
  - 도형 단원 시간 부족 → 2주 추가 배정
  - 자사고 면접 대비 풀이 발표 훈련 도입

안건 2. 고2 모의고사 결과 분석
  - 평균 1.8등급 (전월 대비 +0.3 향상)
  - 약점 단원: 적분의 활용 → 6월 보강 진행

안건 3. 신입 강사 코칭
  - 강도현 강사 수업 참관 후 피드백 진행`,
  },
  {
    title: "원장-부장 운영 회의",
    daysAgo: 14,
    attendees: ["박원장", "이부장"],
    content: `안건 1. 6월 신규 등록 목표
  - 중1 +5, 중3 +3, 고1 +4 → 총 12명 목표
  - 등록상담 AI 분석 적극 활용

안건 2. 학부모 만족도 조사 결과
  - 만족도 92% (전월 대비 +1pt)
  - 개선 요청: 학원 시간표 모바일 알림 추가

안건 3. 직원 워크숍 일정
  - 7월 첫째 주 1박 2일 예정`,
  },
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
  await sql`delete from invoices where tenant_id = ${tenantId}`;
  await sql`delete from enrollments where tenant_id = ${tenantId}`;
  await sql`delete from student_consultations where tenant_id = ${tenantId}`;
  // Cascade deletes consultation_ai_analysis through FK
  await sql`delete from enrollment_consultations where tenant_id = ${tenantId}`;
  // ijw 패리티 신규 테이블들
  await sql`delete from student_grades where tenant_id = ${tenantId}`;
  await sql`delete from student_memos where tenant_id = ${tenantId}`;
  await sql`delete from payroll_records where tenant_id = ${tenantId}`;
  await sql`delete from staff_leaves where tenant_id = ${tenantId}`;
  await sql`delete from user_integrations where tenant_id = ${tenantId}`;
  await sql`delete from students where tenant_id = ${tenantId}`;
  await sql`delete from class_schedules where tenant_id = ${tenantId}`;
  await sql`delete from classes where tenant_id = ${tenantId}`;
  await sql`delete from classrooms where tenant_id = ${tenantId}`;
  await sql`delete from announcements where tenant_id = ${tenantId}`;
  await sql`delete from meeting_minutes where tenant_id = ${tenantId}`;
  await sql`delete from users where tenant_id = ${tenantId} and system_role <> 'master'`;

  // --- 1b. Master persona — set 김수진 원장 on the primary master account ---
  // (시안 페르소나: 28년차 · 재원생 248명 목표. display_name + job_title + hire_date 업데이트)
  console.log("Setting master persona (김수진 원장)…");
  await sql`
    update users
    set display_name = '김수진',
        job_title = '원장',
        hire_date = '1998-03-15'
    where tenant_id = ${tenantId}
      and system_role = 'master'
      and email = 'chrismathone@gmail.com'
  `;

  // --- 1c. st2000423 — 총괄 마스터 계정 보강 ---
  // 실제 gmail auth 계정이라, master로 두면 wipe(`system_role <> 'master'`)에서 보존되지만
  // 방어적으로 명시 upsert해 둔다. (한때 teacher로 두면 wipe에 삭제돼 로그인 튕김이 발생했음.)
  console.log("Restoring st2000423 (총괄 마스터)…");
  await sql`
    insert into users (id, tenant_id, email, display_name, system_role, status, job_title)
    values (
      'fcf735fa-edf7-4095-8fa6-724285a018ed', ${tenantId},
      'st2000423@gmail.com', '석태선', 'master', 'active', '원장'
    )
    on conflict (id) do update set
      tenant_id = excluded.tenant_id,
      display_name = excluded.display_name,
      system_role = 'master',
      status = 'active',
      job_title = '원장'
  `;

  // --- 1d. super_admin grant — chrismathone + st2000423 둘 다 SaaS 운영자 ---
  console.log("Granting super_admin to chrismathone + st2000423…");
  await sql`
    insert into super_admins (id, email, display_name)
    select id, email, display_name from users
    where email in ('chrismathone@gmail.com', 'st2000423@gmail.com')
    on conflict (id) do update set
      email = excluded.email,
      display_name = excluded.display_name
  `;

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

  // --- 5. Students (30 — last 3 are withdrawn) ---
  console.log("Inserting students…");
  const enrolledAt = new Date();
  enrolledAt.setDate(enrolledAt.getDate() - 45);
  const enrolledDate = enrolledAt.toISOString().slice(0, 10);

  const withdrawnAt = new Date();
  withdrawnAt.setDate(withdrawnAt.getDate() - 7);
  const withdrawnDate = withdrawnAt.toISOString().slice(0, 10);

  const WITHDRAWAL_REASONS = [
    "타 학원으로 이동",
    "학업 부담 (자율 학습 전환)",
    "이사로 인한 통원 어려움",
  ];

  const ENROLLED_COUNT = STUDENTS.length - 3;
  const students: { id: string; grade: string }[] = [];
  for (let i = 0; i < STUDENTS.length; i++) {
    const s = STUDENTS[i]!;
    const isWithdrawn = i >= ENROLLED_COUNT;
    const reason = isWithdrawn ? WITHDRAWAL_REASONS[i - ENROLLED_COUNT] : null;
    const [row] = await sql<{ id: string }[]>`
      insert into students (
        tenant_id, name, school, grade, status,
        primary_teacher_id, enrolled_at, withdrawn_at, parent_name, parent_phone
      ) values (
        ${tenantId}, ${s.name}, ${s.school}, ${s.grade},
        ${isWithdrawn ? "withdrawn" : "enrolled"},
        ${pick(teacherIds, i)}, ${enrolledDate},
        ${isWithdrawn ? withdrawnDate : null},
        ${`${s.name.slice(0, 1)}**`}, ${`010-${1000 + i}-${2000 + i}`}
      )
      returning id
    `;
    students.push({ id: row.id, grade: s.grade });
    // withdrawal_reason is set on the most recent active enrollment after we
    // create enrollments below — but the 3 withdrawn students get no
    // enrollment in the first place (loop below uses ENROLLED_COUNT).
    void reason;
  }

  // --- 6. Enrollments (active students only; withdrawn students get a closed enrollment) ---
  console.log("Inserting enrollments…");
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 30);
  const startStr = startDate.toISOString().slice(0, 10);

  const studentClass = new Map<string, string>(); // studentId → classId
  for (let i = 0; i < students.length; i++) {
    const stu = students[i]!;
    const matching = classes.filter((c) => c.grade === stu.grade);
    const klass =
      matching.length > 0 ? matching[Math.floor(Math.random() * matching.length)]! : classes[0]!;
    const isWithdrawn = i >= ENROLLED_COUNT;
    const reason = isWithdrawn
      ? WITHDRAWAL_REASONS[i - ENROLLED_COUNT]
      : null;

    await sql`
      insert into enrollments (
        tenant_id, student_id, class_id, start_date, end_date, withdrawal_reason
      ) values (
        ${tenantId}, ${stu.id}, ${klass.id}, ${startStr},
        ${isWithdrawn ? withdrawnDate : null},
        ${reason}
      )
    `;
    if (!isWithdrawn) studentClass.set(stu.id, klass.id);
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
      const classId = studentClass.get(stu.id);
      if (!classId) continue; // withdrawn students have no active enrollment
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
    if (rows.length === 0) continue;
    await sql`insert into attendance_records ${sql(rows)}`;
    inserted += rows.length;
  }
  console.log(`  ${inserted} attendance rows`);

  // --- 8a. Enrollment consultations + AI analysis ---
  console.log("Inserting enrollment consultations…");
  for (let i = 0; i < PROSPECTS.length; i++) {
    const p = PROSPECTS[i]!;
    const consultedAt = new Date();
    consultedAt.setDate(consultedAt.getDate() - p.consultedDaysAgo);

    const [consult] = await sql<{ id: string }[]>`
      insert into enrollment_consultations (
        tenant_id, prospect_name, prospect_grade, prospect_school,
        parent_name, parent_phone, parent_request, learning_history,
        consultant_id, outcome, consulted_at
      ) values (
        ${tenantId}, ${p.name}, ${p.grade}, ${p.school},
        ${p.parentName}, ${p.parentPhone}, ${p.parentRequest},
        ${sql.json(p.learningHistory)},
        ${recordedBy}, ${p.outcome}, ${consultedAt.toISOString()}
      )
      returning id
    `;

    if (p.aiAnalysis) {
      const matching = classes.filter((c) => c.grade === p.grade);
      const recommendedIds = matching.slice(0, 2).map((c) => c.id);

      const printPayload = {
        prospect: {
          name: p.name,
          grade: p.grade,
          school: p.school,
          parentName: p.parentName,
          parentPhone: p.parentPhone,
        },
        consultedAt: consultedAt.toISOString(),
        consultantName: "원장",
        parentRequest: p.parentRequest,
        learningHistory: p.learningHistory,
        diagnosis: p.aiAnalysis.diagnosis,
        learningPlan: p.aiAnalysis.learningPlan,
        recommendedClasses: matching.slice(0, 2).map((c) => c.className),
      };

      await sql`
        insert into consultation_ai_analysis (
          consultation_id, model_version,
          recommended_class_ids, diagnosis, learning_plan, print_payload,
          approved_by
        ) values (
          ${consult.id}, 'claude-opus-4-7-2026-01-seed',
          ${recommendedIds.length > 0 ? recommendedIds : null},
          ${sql.json(p.aiAnalysis.diagnosis)},
          ${sql.json(p.aiAnalysis.learningPlan)},
          ${sql.json(printPayload)},
          ${recordedBy}
        )
      `;
    }
  }

  // --- 8a-2. Invoices (current month, active students only) ---
  console.log("Inserting invoices…");
  const invoiceNow = new Date();
  const period = `${invoiceNow.getFullYear()}-${String(invoiceNow.getMonth() + 1).padStart(2, "0")}`;
  const dueDate = new Date(invoiceNow.getFullYear(), invoiceNow.getMonth(), 25);
  const dueDateStr = dueDate.toISOString().slice(0, 10);

  const activeStudentRecords = students.slice(0, ENROLLED_COUNT);
  const studentGrades = new Map<string, string>();
  for (const stu of activeStudentRecords) studentGrades.set(stu.id, stu.grade);

  for (let i = 0; i < activeStudentRecords.length; i++) {
    const stu = activeStudentRecords[i]!;
    const grade = studentGrades.get(stu.id) ?? "중1";
    const tuition = TUITION_BY_GRADE[grade] ?? 400_000;
    const classId = studentClass.get(stu.id);
    const className =
      classId !== undefined ? classes.find((c) => c.id === classId)?.className ?? "수업료" : "수업료";

    const r = Math.random();
    let status: "paid" | "partial" | "unpaid";
    let amountPaid: number;
    let paidAtIso: string | null;
    if (r < 0.78) {
      status = "paid";
      amountPaid = tuition;
      const paidAt = new Date(invoiceNow);
      paidAt.setDate(invoiceNow.getDate() - Math.floor(Math.random() * 18) - 1);
      paidAtIso = paidAt.toISOString();
    } else if (r < 0.9) {
      status = "partial";
      amountPaid = Math.floor(tuition * 0.5);
      paidAtIso = null;
    } else {
      status = "unpaid";
      amountPaid = 0;
      paidAtIso = null;
    }

    const lineItems = [
      {
        kind: "tuition",
        description: `${className} ${period.slice(5)}월 수업료`,
        classId,
        amount: tuition,
      },
    ];

    await sql`
      insert into invoices (
        tenant_id, student_id, period, amount_total, amount_paid,
        status, line_items, due_date, paid_at
      ) values (
        ${tenantId}, ${stu.id}, ${period}, ${tuition}, ${amountPaid},
        ${status}, ${sql.json(lineItems)}, ${dueDateStr}, ${paidAtIso}
      )
    `;
  }

  // --- 8b. Student consultations (10 random pairings against active students) ---
  console.log("Inserting student consultations…");
  const activeStudents = students.slice(0, ENROLLED_COUNT);
  for (let i = 0; i < 10; i++) {
    const stu = activeStudents[Math.floor(Math.random() * activeStudents.length)]!;
    const template =
      STUDENT_CONSULTATION_TEMPLATES[i % STUDENT_CONSULTATION_TEMPLATES.length]!;
    const counselorId = pick(teacherIds, i);
    const consultedAt = new Date();
    consultedAt.setDate(consultedAt.getDate() - Math.floor(Math.random() * 28));
    consultedAt.setHours(14 + Math.floor(Math.random() * 6));
    await sql`
      insert into student_consultations (
        tenant_id, student_id, counselor_id, consulted_at, summary, follow_up_action
      ) values (
        ${tenantId}, ${stu.id}, ${counselorId}, ${consultedAt.toISOString()},
        ${template.summary}, ${template.followUp ?? null}
      )
    `;
  }

  // --- 8c. Meeting minutes ---
  console.log("Inserting meeting minutes…");
  for (const m of MEETINGS) {
    const heldAt = new Date();
    heldAt.setDate(heldAt.getDate() - m.daysAgo);
    heldAt.setHours(19, 30, 0, 0);
    await sql`
      insert into meeting_minutes (
        tenant_id, title, content, attendees, held_at, author_id
      ) values (
        ${tenantId}, ${m.title}, ${m.content},
        ${sql.json(m.attendees)},
        ${heldAt.toISOString()}, ${recordedBy}
      )
    `;
  }

  // --- 8. Announcements ---
  console.log("Inserting announcements…");
  for (const a of ANNOUNCEMENTS) {
    await sql`
      insert into announcements (tenant_id, title, content, audience, pinned, author_id)
      values (${tenantId}, ${a.title}, ${a.content}, ${a.audience}, ${a.pinned}, ${recordedBy})
    `;
  }

  // --- ijw 패리티 신규 시드: 학생 성적 + 메모 + 강사 급여/휴가 ---
  // 학생 성적 — 첫 5명에게 각 2건
  console.log("Seeding student grades & memos…");
  const studentRows = await sql<{ id: string; name: string }[]>`
    select id, name from students where tenant_id = ${tenantId} order by created_at limit 8
  `;
  for (const [idx, stu] of studentRows.entries()) {
    if (idx >= 5) break;
    const subjects = ["math", "english"] as const;
    for (const sub of subjects) {
      const score = 70 + Math.floor(Math.random() * 25);
      const takenOn = new Date();
      takenOn.setDate(takenOn.getDate() - (idx + 1) * 14);
      await sql`
        insert into student_grades (tenant_id, student_id, exam_name, subject, score, max_score, taken_on, notes)
        values (${tenantId}, ${stu.id}, '중간고사', ${sub}, ${score}, 100, ${takenOn.toISOString().slice(0, 10)}, '학년 평균 대비 ' || ${score > 80 ? "상위권" : "중위권"})
      `;
    }
  }

  const memoTemplates = [
    { category: "general", content: "수업 시간에 집중도가 높고 질문을 자주 합니다." },
    { category: "homework", content: "지난 주 숙제 100% 완료. 우수." },
    { category: "behavior", content: "친구 관계가 좋고 교실 분위기에 긍정적 영향." },
    { category: "parent", content: "학부모님께서 학습 진도 점검 요청하심." },
  ];
  for (const [idx, stu] of studentRows.entries()) {
    if (idx >= 6) break;
    const memo = memoTemplates[idx % memoTemplates.length];
    await sql`
      insert into student_memos (tenant_id, student_id, category, content, created_by)
      values (${tenantId}, ${stu.id}, ${memo.category}, ${memo.content}, ${recordedBy})
    `;
  }

  // 강사 시급 + 기본급 (teacher만)
  const teacherRows = await sql<{ id: string }[]>`
    select id from users where tenant_id = ${tenantId} and system_role = 'teacher'
  `;
  for (const t of teacherRows) {
    const hourlyRate = 40000 + Math.floor(Math.random() * 20000);
    const monthlyBase = 1500000 + Math.floor(Math.random() * 1000000);
    await sql`
      update users set hourly_rate = ${hourlyRate}, monthly_base = ${monthlyBase}
      where id = ${t.id}
    `;
  }

  // 강사 휴가 1건씩 (선택 2명)
  console.log("Seeding staff leaves…");
  for (const [idx, t] of teacherRows.slice(0, 2).entries()) {
    const start = new Date();
    start.setDate(start.getDate() + 14 + idx * 7);
    const end = new Date(start);
    end.setDate(end.getDate() + (idx === 0 ? 0 : 2));
    await sql`
      insert into staff_leaves (tenant_id, user_id, leave_type, starts_on, ends_on, reason)
      values (${tenantId}, ${t.id}, ${idx === 0 ? "반차" : "연차"}, ${start.toISOString().slice(0, 10)}, ${end.toISOString().slice(0, 10)}, '시드 데모')
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
  const [{ count: consultations_c }] = await sql<{ count: number }[]>`select count(*)::int as count from enrollment_consultations where tenant_id = ${tenantId}`;
  const [{ count: ai_c }] = await sql<{ count: number }[]>`
    select count(*)::int as count from consultation_ai_analysis a
    join enrollment_consultations c on c.id = a.consultation_id
    where c.tenant_id = ${tenantId}
  `;
  const [{ count: stu_consult_c }] = await sql<{ count: number }[]>`select count(*)::int as count from student_consultations where tenant_id = ${tenantId}`;
  const [{ count: meeting_c }] = await sql<{ count: number }[]>`select count(*)::int as count from meeting_minutes where tenant_id = ${tenantId}`;
  const [{ count: invoices_c }] = await sql<{ count: number }[]>`select count(*)::int as count from invoices where tenant_id = ${tenantId}`;
  const [{ count: paid_c }] = await sql<{ count: number }[]>`select count(*)::int as count from invoices where tenant_id = ${tenantId} and status = 'paid'`;

  console.log("");
  console.log("Seed complete:");
  console.log(`  students       ${students_c}`);
  console.log(`  teachers       ${teachers_c}`);
  console.log(`  classes        ${classes_c}`);
  console.log(`  schedules      ${schedules_c}`);
  console.log(`  enrollments    ${enrollments_c}`);
  console.log(`  attendance     ${attendance_c}`);
  console.log(`  announcements  ${announcements_c}`);
  console.log(`  consultations  ${consultations_c}`);
  console.log(`  ai_analyses    ${ai_c}`);
  console.log(`  stu_consults   ${stu_consult_c}`);
  console.log(`  meetings       ${meeting_c}`);
  console.log(`  invoices       ${invoices_c} (paid: ${paid_c})`);

  await sql.end();
}

main().catch(async (err) => {
  console.error(err);
  await sql.end({ timeout: 1 });
  process.exit(1);
});
