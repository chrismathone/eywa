/**
 * 데모 재원이 운영실에 비지 않게, 화면이 읽는 날짜·상태로 위성 행을 계산한다.
 * DB에 쓰지 않는다. 날짜는 호출부가 넘긴 오늘(KST) 기준이다.
 */

import { personName } from "./plan.mjs";

const DOW = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const MARK = "demo-roster:";

export function shiftYmd(ymd, days) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function monthKeys(today, count = 6) {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7)) - 1;
  return Array.from({ length: count }, (_, i) =>
    new Date(Date.UTC(year, month - count + 1 + i, 1)).toISOString().slice(0, 7),
  );
}

function dowOf(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function classKey(cls) {
  return `${cls.subject}|${cls.name}`;
}

function atNoonKst(ymd) {
  return `${ymd}T03:00:00.000Z`;
}

function tuitionOf(student) {
  if (student.role === "both") return 480000;
  return student.role === "math" ? 280000 : 250000;
}

function clampDay(month, today) {
  const day = `${month}-16`;
  return day > today ? today : day;
}

/** 지난 상담은 오늘 접수 칸에 섞지 않는다. 이번 달 1일이면 이번 달 추가 행은 없다. */
function historyDay(month, today) {
  if (month < today.slice(0, 7)) return `${month}-16`;
  const yesterday = shiftYmd(today, -1);
  return yesterday.slice(0, 7) === month ? yesterday : null;
}

/**
 * @param {ReturnType<import("./plan.mjs").buildScenario>} plan
 * @param {string} today YYYY-MM-DD (KST)
 */
export function buildDashboardWorld(plan, today) {
  const months = monthKeys(today);
  const windowStart = shiftYmd(today, -13);
  const yesterday = shiftYmd(today, -1);
  const enrolledAt = new Map();
  const startDate = new Map();
  const mathOnly = plan.students.filter((s) => s.role === "math");
  const engOnly = plan.students.filter((s) => s.role === "eng");
  const firstClassCodes = new Set(
    [mathOnly[0], mathOnly[Math.floor(mathOnly.length / 2)], engOnly[0], engOnly[Math.floor(engOnly.length / 2)]]
      .filter(Boolean)
      .map((s) => s.code),
  );

  for (const student of plan.students) {
    if (firstClassCodes.has(student.code)) {
      enrolledAt.set(student.code, today);
      startDate.set(student.code, today);
      continue;
    }
    const month = months[student.seq % months.length];
    const when = `${month}-02` <= today ? `${month}-02` : today;
    enrolledAt.set(student.code, when);
    startDate.set(student.code, when);
  }

  const riskCodes = new Set(
    plan.students.filter((s) => !firstClassCodes.has(s.code) && s.seq % 23 === 0).slice(0, 5).map((s) => s.code),
  );
  const attendance = [];
  for (let date = windowStart; date <= today; date = shiftYmd(date, 1)) {
    for (const student of plan.students) {
      if (startDate.get(student.code) > date) continue;
      for (const cls of student.classes) {
        if (!cls.days.includes(DOW[dowOf(date)])) continue;
        if (!riskCodes.has(student.code) && date === today && student.seq % 7 === 0) continue;
        let status = "present";
        if (riskCodes.has(student.code)) status = "absent";
        else if (date === yesterday && student.seq % 11 === 0) status = "absent";
        else if (date === today && student.seq % 13 === 0) status = "late";
        else if (date === today && student.seq % 17 === 0) status = "excused";
        attendance.push({
          studentCode: student.code,
          classKey: classKey(cls),
          date,
          status,
          slotStart: cls.periods[0].start,
        });
      }
    }
  }

  const invoices = [];
  for (const student of plan.students) {
    const amount = tuitionOf(student);
    for (const month of months) {
      if (enrolledAt.get(student.code).slice(0, 7) > month) continue;
      const current = month === today.slice(0, 7);
      const mod = student.seq % 5;
      const status = !current ? "paid" : mod === 0 ? "unpaid" : mod === 1 ? "partial" : "paid";
      const paid = status === "paid" ? amount : status === "partial" ? Math.round(amount / 2) : 0;
      invoices.push({ studentCode: student.code, period: month, amount, paid, status });
    }
  }

  const withdrawn = [];
  let n = 0;
  for (const month of months) {
    for (let k = 0; k < 2; k++) {
      const sample = plan.students[n % plan.students.length];
      const cls = sample.classes[0];
      const person = personName(400 + n);
      const when = clampDay(month, today);
      withdrawn.push({
        code: `DMO-9${String(n + 1).padStart(3, "0")}`,
        name: person.name,
        gender: person.gender,
        school: sample.school.name,
        grade: sample.grade,
        parentName: `${person.surname}미경`,
        parentPhone: `010-5559-${String(n + 1).padStart(4, "0")}`,
        withdrawnAt: when,
        enrolledAt: shiftYmd(when, -40),
        endDate: when,
        classKey: classKey(cls),
      });
      n += 1;
    }
  }

  const consultations = [];
  const prospects = [
    ["초5", "한빛초", "수학", "지인 소개"],
    ["중1", "푸른중", "영어", "네이버"],
    ["초6", "새솔초", "수학", "현수막"],
    ["중2", "노을중", "영어", "재원생 소개"],
  ];
  prospects.forEach((row, i) => {
    const person = personName(500 + i);
    consultations.push({
      name: person.name,
      grade: row[0],
      school: row[1],
      subject: row[2],
      path: row[3],
      outcome: "pending",
      at: atNoonKst(today),
      payment: null,
      parentPhone: `010-5551-${String(i + 1).padStart(4, "0")}`,
    });
  });
  const older = [
    ["consulted", 0],
    ["enrolled", 0],
    ["declined", 0],
    ["no_show", 0],
    ["consulted", -1],
    ["enrolled", -1],
    ["declined", -1],
  ];
  older.forEach((row, i) => {
    const month = months[months.length - 1 + row[1]];
    const day = historyDay(month, today);
    if (!day) return;
    const person = personName(520 + i);
    consultations.push({
      name: person.name,
      grade: i % 2 ? "중1" : "초6",
      school: i % 2 ? "푸른중" : "한빛초",
      subject: i % 2 ? "영어" : "수학",
      path: "지인 소개",
      outcome: row[0],
      at: atNoonKst(day),
      payment: row[0] === "enrolled" ? 300000 : null,
      parentPhone: `010-5551-${String(20 + i).padStart(4, "0")}`,
    });
  });

  const studentConsultations = [];
  const consultPool = plan.students.filter((s) => !firstClassCodes.has(s.code)).slice(0, 8);
  consultPool.forEach((student, i) => {
    const overdue = i < 3;
    studentConsultations.push({
      studentCode: student.code,
      subject: student.subjects[0] === "math" ? "수학" : "영어",
      at: atNoonKst(shiftYmd(today, -(i % 5))),
      summary: overdue ? "학습 습관 확인 후 다시 연락하기로 했습니다." : "이번 주 수업 태도를 보호자와 나눴습니다.",
      followUpDate: overdue ? shiftYmd(today, -3) : i === 3 ? shiftYmd(today, 5) : null,
      followUpDone: false,
    });
  });

  const reports = [];
  const mathStudents = plan.students.filter((s) => s.subjects.includes("math") && !firstClassCodes.has(s.code));
  mathStudents.slice(0, 12).forEach((student, i) => {
    const cls = student.classes.find((c) => c.subject === "math");
    if (!cls) return;
    const earliest = shiftYmd(today, -6);
    let date = shiftYmd(today, -1);
    while (date >= earliest && (!cls.days.includes(DOW[dowOf(date)]) || date < startDate.get(student.code))) {
      date = shiftYmd(date, -1);
    }
    if (date < earliest || date < startDate.get(student.code)) return;
    const low = i < 3;
    const missing = i === 3;
    reports.push({
      studentCode: student.code,
      classKey: classKey(cls),
      date,
      subject: "math",
      homeworkScore: missing ? "미제출" : low ? "40%" : "90%",
      progress: low ? "연산 단원 복습" : "그날 진도까지 풀이",
      unread: i < 6,
    });
  });

  const expenses = [
    ["교재 인쇄", "매입", 186000],
    ["강의실 소모품", "운영비", 74000],
    ["간식", "운영비", 52000],
    ["복사기 임대", "운영비", 90000],
    ["홍보 현수막", "기타", 150000],
  ].map((row, i) => ({
    title: row[0],
    category: row[1],
    amount: row[2],
    date: shiftYmd(today, -i),
    memo: MARK,
  }));

  const announcements = [
    ["이번 주 보강 안내", "금요일은 정규 수업이 없고, 보강은 담임이 따로 안내합니다."],
    ["수납 안내", "이번 달 수강료는 학원 계좌로 받습니다. 납부 확인은 데스크에 말씀해 주세요."],
    ["신입 오리엔테이션", "오늘 첫 수업인 학생은 시작 10분 전에 데스크로 와 주세요."],
  ].map((row) => ({ title: `[데모] ${row[0]}`, content: row[1] }));

  const meetings = [
    { title: "[데모] 주간 운영 회의", at: atNoonKst(shiftYmd(today, -2)), content: "출결 미입력 반과 이번 주 신입 안내를 점검했습니다." },
    { title: "[데모] 상담 회의", at: atNoonKst(shiftYmd(today, -9)), content: "이번 달 문의와 등록으로 이어진 건을 나눴습니다." },
  ];

  const documents = [
    { title: "[데모] 신입 안내문", body: "첫 수업 전에 교재와 교실을 안내하는 데스크용 메모입니다." },
    { title: "[데모] 수납 확인 메모", body: "이번 달 미납은 청구서의 미납·일부 납부 상태와 같습니다." },
  ];

  const makeup = [];
  const seenMakeup = new Set();
  for (const row of attendance) {
    if (row.date !== yesterday || row.status !== "absent" || seenMakeup.has(row.studentCode)) continue;
    const student = plan.students.find((s) => s.code === row.studentCode);
    const cls = student?.classes.find((c) => classKey(c) === row.classKey);
    const period = cls?.periods[0];
    if (!period) continue;
    let makeupDate = shiftYmd(today, 7);
    const dow = dowOf(makeupDate);
    if (dow === 0) makeupDate = shiftYmd(makeupDate, 1);
    if (dow === 6) makeupDate = shiftYmd(makeupDate, 2);
    makeup.push({
      studentCode: row.studentCode,
      classKey: row.classKey,
      absenceDate: yesterday,
      makeupDate,
      slotStart: period.start,
      slotEnd: period.end,
      periodLabel: period.label,
    });
    seenMakeup.add(row.studentCode);
    if (makeup.length >= 4) break;
  }

  const checks = [];
  for (const student of plan.students) {
    const enrolled = enrolledAt.get(student.code);
    if (shiftYmd(enrolled, 90) < today) continue;
    const subject = "";
    const done = student.seq % 2 === 0 && !firstClassCodes.has(student.code);
    for (const key of done ? ["pre_call", "first_class_guide", "ojt"] : []) {
      checks.push({ studentCode: student.code, subject, itemKey: key, doneOn: enrolled });
    }
  }

  return {
    mark: MARK,
    enrolledAt,
    startDate,
    firstClassCodes,
    attendance,
    invoices,
    withdrawn,
    consultations,
    studentConsultations,
    reports,
    expenses,
    announcements,
    meetings,
    documents,
    makeup,
    checks,
  };
}
