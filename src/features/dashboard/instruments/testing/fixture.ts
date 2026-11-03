/** 시험·개발 화면 전용 스냅샷. 모든 값은 가상이다. 합계는 카드끼리 맞도록 적었다. */
import type { OverviewSnapshot, Sections } from "@/features/dashboard/overview/model";
import { MENU_KEYS } from "@/lib/permissions";
import type { InstrumentExtras } from "../extras-types";

const TODAY = "2026-11-02";
const ok = <T,>(data: T) => ({ data, at: Date.UTC(2026, 10, 2, 8, 5), error: false });
const m = (n: number) => n * 1_000_000;
const MONTHS = ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"];
const trendPoints = (values: number[]) => ["2026-04", "2026-05", ...MONTHS].slice(-values.length).map((key, i, all) => ({ key, label: key, date: `${key}-28`, count: values[values.length - all.length + i]! }));
const bill = (period: string, net: number, paid: number) => ({ period, totalCount: 332, paidCount: 269, partialCount: 19, unpaidCount: 43, totalBilled: m(net) + m(2), totalCollected: m(paid), totalDiscount: m(2), outstanding: m(net - paid), paymentRate: (paid / net) * 100 });
const mix = (englishOnly: number, both: number, mathOnly: number, otherOnly = 0) => ({ englishOnly, both, mathOnly, otherOnly, noEnrollment: 0 });

const sections = {
  students: ok({
    enrolled: 331,
    subjects: [{ label: "math", value: 183 }, { label: "english", value: 172 }, { label: "science", value: 57 }],
    levels: [{ label: "초등", value: 182 }, { label: "중등", value: 120 }, { label: "고등", value: 27 }],
    schools: [{ label: "A초", value: 40 }],
    concurrent: 74,
    subjectCombinations: [{ subjects: ["math"], value: 109 }, { subjects: ["english"], value: 98 }, { subjects: ["english", "math"], value: 74 }],
    subjectStudents: 331,
    programs: { eie: 64, injaewon: 108, math: 183, both: 74, noEnrollment: 8, otherOnly: 42 },
    gradeSplit: {
      rows: [["초1", 5, 1, 1], ["초2", 6, 2, 1], ["초3", 7, 3, 2], ["초4", 7, 4, 3], ["초5", 7, 5, 6], ["초6", 6, 7, 7], ["중1", 19, 15, 18], ["중2", 16, 13, 19], ["중3", 13, 11, 19], ["고1", 6, 7, 14], ["고2", 4, 4, 12], ["고3", 2, 2, 7]].map(([label, englishOnly, both, mathOnly]) => ({ label: label as string, englishOnly: englishOnly as number, both: both as number, mathOnly: mathOnly as number })),
      neither: 50,
    },
    levelSplit: { rows: [
      { label: "초등", englishOnly: 38, both: 22, mathOnly: 20, neither: 12, total: 92 },
      { label: "중등", englishOnly: 48, both: 39, mathOnly: 56, neither: 17, total: 160 },
      { label: "고등", englishOnly: 12, both: 13, mathOnly: 33, neither: 21, total: 79 },
    ] },
    schoolGroups: [
      { label: "초등", total: 92, schools: [{ label: "A초", value: 30, subjects: mix(12, 8, 6) }, { label: "B초", value: 22, subjects: mix(10, 6, 4) }, { label: "C초", value: 16, subjects: mix(8, 4, 3) }, { label: "D초", value: 10, subjects: mix(4, 2, 3) }, { label: "E초", value: 8, subjects: mix(3, 1, 3) }, { label: "F초", value: 6, subjects: mix(1, 1, 1) }] },
      { label: "중등", total: 160, schools: [{ label: "A중", value: 60, subjects: mix(18, 15, 20) }, { label: "B중", value: 42, subjects: mix(12, 10, 15) }, { label: "C중", value: 30, subjects: mix(10, 8, 12) }, { label: "D중", value: 28, subjects: mix(8, 6, 9) }] },
      { label: "고등", total: 79, schools: [{ label: "A고", value: 40, subjects: mix(6, 7, 18) }, { label: "B고", value: 39, subjects: mix(6, 6, 15) }] },
    ],
  }),
  courses: ok({ basis: "student-subject", total: 412, students: 323,
    subjects: { eie: 64, injaewon: 108, math: 183, science: 57 },
    perStudent: [{ courses: 1, students: 249 }, { courses: 2, students: 74 }],
    combos: [{ bucket: 1, parts: [{ subject: "math", count: 1 }], students: 109 }, { bucket: 1, parts: [{ subject: "eie", count: 1 }], students: 37 }, { bucket: 1, parts: [{ subject: "injaewon", count: 1 }], students: 61 }, { bucket: 2, parts: [{ subject: "math", count: 1 }, { subject: "eie", count: 1 }], students: 27 }, { bucket: 2, parts: [{ subject: "math", count: 1 }, { subject: "injaewon", count: 1 }], students: 47 }],
  }),
  changes: ok([[8, 9], [6, 8], [5, 9], [11, 10], [6, 14], [0, 0]].map(([enrolled, withdrawn], i) => ({ month: MONTHS[i]!, enrolled: enrolled!, withdrawn: withdrawn! }))),
  enrolledTrend: ok({ monthly: trendPoints([330, 329, 331, 329, 325, 326, 331]), yearly: [{ key: "2025", label: "2025년", date: "2025-12-31", count: 312 }, { key: "2026", label: "2026년", date: TODAY, count: 331 }], recordsFrom: "2025-02", trustFrom: "2026-04", monthlyFrom: "2026-04" }),
  courseTrend: ok({ monthly: trendPoints([449, 450, 452, 457, 451, 448, 412]), yearly: [{ key: "2025", label: "2025년", date: "2025-12-31", count: 436 }, { key: "2026", label: "2026년", date: TODAY, count: 412 }], trustFrom: "2026-04", monthlyFrom: "2026-04" }),
  withdrawals: ok({ month: "2026-11", rows: [
    { id: "w1", name: "학생 가", schoolGrade: "A중2", withdrawnAt: "2026-11-01", program: "math", kind: "withdrawn", className: "중2 수학 A" },
    { id: "w2", name: "학생 나", schoolGrade: "B초5", withdrawnAt: "2026-11-02", program: "eie", kind: "subject-ended", className: "초5 EiE" },
  ] }),
  intake: ok([{ id: "i1", name: "문의 가", time: "15:12" }, { id: "i2", name: "문의 나", time: "11:02" }]),
  calendar: ok([
    { id: "c1", title: "레벨테스트 가", startDate: "2026-11-01", endDate: "2026-11-01", startTime: "15:00:00", source: "local", kind: "levelTest" },
    { id: "c2", title: "레벨테스트 나", startDate: "2026-11-01", endDate: "2026-11-01", startTime: "16:30:00", source: "local", kind: "levelTest" },
    { id: "c3", title: "레벨테스트 다", startDate: "2026-11-05", endDate: "2026-11-05", startTime: "17:00:00", source: "local", kind: "levelTest" },
    { id: "c4", title: "첫수업 라", startDate: "2026-11-09", endDate: "2026-11-09", startTime: "16:00:00", source: "local", kind: "firstClass" },
    { id: "c5", title: "레벨테스트 취소 마", startDate: "2026-11-12", endDate: "2026-11-12", startTime: "16:00:00", source: "local", kind: null, cancelledKind: "levelTest" },
  ]),
  enrolledToday: ok([
    { id: "e1", name: "신규 가", schoolGrade: "A중1", date: "2026-11-01", time: "11:00", assigned: true, classes: [{ name: "중1 수학 A", subject: "수학" }], subject: "math" },
    { id: "e2", name: "신규 나", schoolGrade: "A초4", date: "2026-11-02", time: "10:00", assigned: false, classes: [], subject: "english" },
  ]),
  firstClass: ok([{ studentId: "s1", name: "학생 다", kind: "first", subjects: ["math"] }, { studentId: "s2", name: "학생 라", kind: "newSubject", subjects: ["english"] }]),
  absent: ok({ from: "2026-10-26", to: "2026-11-01", students: [
    { studentId: "s3", name: "학생 마", count: 2, unnotified: 1, absences: [{ date: "2026-10-27", classId: "k1", className: "중2 수학 A", subject: "math", preNotified: true, teachers: ["강사 가"] }, { date: "2026-10-29", classId: "k1", className: "중2 수학 A", subject: "math", preNotified: false, teachers: ["강사 가"] }] },
    { studentId: "s4", name: "학생 바", count: 1, unnotified: 1, absences: [{ date: "2026-10-30", classId: "k2", className: "초5 영어", subject: "english", preNotified: false, teachers: ["강사 나"] }] },
  ] }),
  makeup: ok({ range: { start: TODAY, end: "2026-12-01" }, later: 1, rows: [
    { id: "mk1", studentId: "s3", name: "학생 마", schoolGrade: "A중2", classId: "k1", className: "중2 수학 A", makeupDate: TODAY, slotStart: "16:00", slotEnd: "17:00", createdByName: "관리자 가", absenceDate: "2026-10-27", overdue: false, origin: "reservation" },
    { id: "mk2", studentId: "s4", name: "학생 바", schoolGrade: "B초5", classId: "k2", className: "초5 영어", makeupDate: "2026-11-12", slotStart: "17:00", slotEnd: "18:00", createdByName: null, absenceDate: "2026-10-30", overdue: false, origin: "reservation" },
  ] }),
  attendance: ok({ date: TODAY, total: 80, present: 75, absent: 4, late: 1, excused: 0, rate: 95 }),
  processing: ok([
    { classId: "k1", className: "중2 수학 A", subject: "math", teacherName: "강사 가", expected: 12, recorded: 12, unprocessed: 0, rate: 100 },
    { classId: "k2", className: "초5 영어", subject: "english", teacherName: "강사 나", expected: 10, recorded: 4, unprocessed: 6, rate: 40 },
  ]),
  holidayAttendance: ok(null),
  attendanceTrend: ok(Array.from({ length: 14 }, (_, i) => ({ date: `2026-10-${String(20 + i > 31 ? 20 + i - 31 : 20 + i).padStart(2, "0")}`.replace("2026-10-01", "2026-11-01").replace("2026-10-02", "2026-11-02"), rate: i % 7 === 5 ? null : 84 + (i % 5), total: i % 7 === 5 ? 0 : 90 }))),
  billing: ok([bill("2026-06", 118, 109), bill("2026-07", 121, 113), bill("2026-08", 123, 116), bill("2026-09", 127, 118), bill("2026-10", 129, 121), bill("2026-11", 134, 111)]),
  expenses: ok({ period: "2026-11", count: 31, byCurrency: [{ currency: "KRW", total: m(25), count: 31 }], primaryCurrency: "KRW", byCategory: [{ category: "교재", amount: m(11), count: 9 }, { category: "시설", amount: m(7), count: 8 }, { category: "차량", amount: m(3), count: 6 }, { category: "기타", amount: m(4), count: 8 }], categoryCount: 4 }),
  absences: ok({ anchor: TODAY, rows: [{ studentId: "s5", studentName: "학생 사", absences: 4, unexplained: 3 }, { studentId: "s6", studentName: "학생 아", absences: 6, unexplained: 5 }] }),
  admissions: ok({ months: [{ month: "2026-10", total: 44, enrolled: 9, open: 3, declined: 24, noShow: 8 }, { month: "2026-11", total: 39, enrolled: 6, open: 18, declined: 12, noShow: 3 }], prevYearMonths: [], paths: [], total: 83, enrolled: 15, rate: 18, paidSum: 0 }),
  consultations: ok({ thisMonth: 64, lastWeek: 20, pendingFollowUps: 8, overdueFollowUps: 3 }),
  newcomers: ok({ total: 22, checksAvailable: true,
    stages: [{ label: "0–7일", value: 6, subjects: mix(2, 2, 2) }, { label: "8–30일", value: 3, subjects: mix(1, 1, 1) }, { label: "31–60일", value: 8, subjects: mix(3, 2, 3) }, { label: "61–90일", value: 5, subjects: mix(2, 1, 2) }],
    items: [
      { label: "사전 콜", needs: [{ id: "s7", name: "학생 자" }, { id: "s7", name: "학생 자" }], optional: false, done: 20, overdue: 1, due: 1, upcoming: 0, pending: 0, waived: 0 },
      { label: "OJT", needs: [], optional: false, done: 16, overdue: 2, due: 1, upcoming: 3, pending: 0, waived: 0 },
      { label: "2개월 콜", needs: [], optional: true, done: 6, overdue: 0, due: 0, upcoming: 16, pending: 0, waived: 0 },
    ] }),
  homework: ok({ students: 14, notSubmitted: 9, zero: 5, windowDays: 7, subjects: ["math"] }),
  unread: ok({ reports: 12, windowDays: 30, graceHours: 48, subjects: ["math"] }),
  schedule: ok([
    { id: "1", classId: "k3", className: "초6 수학 A", subject: "math", startTime: "16:20:00", endTime: "17:20:00", teacherName: "강사 가", classroomName: "본원 302", status: "ongoing" },
    { id: "2", classId: "k4", className: "중2 EiE B", subject: "english", startTime: "16:40:00", endTime: "18:10:00", teacherName: "강사 나", classroomName: "본원 205", status: "ongoing" },
    { id: "3", classId: "k5", className: "고1 수학", subject: "math", startTime: "18:20:00", endTime: "19:50:00", teacherName: "강사 다", classroomName: "본원 304", status: "upcoming" },
    { id: "4", classId: "k6", className: "중3 영어", subject: "english", startTime: "19:15:00", endTime: "20:45:00", teacherName: "강사 라", classroomName: "본원 206", status: "upcoming" },
  ]),
  staff: ok([{ label: "원장", value: 1, bySubject: { english: 0, both: 0, math: 0, other: 0, none: 1 } }, { label: "관리자", value: 3, bySubject: { english: 0, both: 0, math: 1, other: 0, none: 2 } }, { label: "선생님", value: 10, bySubject: { english: 6, both: 0, math: 4, other: 0, none: 0 } }]),
  operations: ok([{ label: "회의록", href: "/meetings", count: 86, unit: "건" }, { label: "운행 차량", href: "/shuttle", count: 4, unit: "대" }, { label: "내 결재 대기", href: "/approvals", count: null, unit: "건" }]),
  notices: ok([{ id: "n1", title: "11월 시간표 안내", content: "반별 변동 사항을 확인해 주세요.", audience: "all", pinned: true, createdAt: "2026-10-28T01:00:00Z", authorName: null }]),
  consultProgress: ok({ summary: { from: "2026-10-04", counts: { received: 28, consulted: 22, levelTest: 14, enrolled: 9, assigned: 8, started: 6 }, stalled: [{ id: "cp1", name: "상담 가", subject: "math", reason: "levelTest", days: 9, label: "입테 끝 9일째 · 등록 없음" }] }, chips: {} }),
  englishSheet: ok({ period: "이번 주", classes: 18, filled: 39, total: 50 }),
  mathSheet: ok({ period: "이번 달", classes: 24, filled: 612, total: 956 }),
} as unknown as Sections;

export const FIXTURE_SNAPSHOT: OverviewSnapshot = {
  scope: "instruments-fixture", tenantId: "t", academy: "인재원", today: TODAY, requestedAt: Date.UTC(2026, 10, 2, 8, 5),
  allowed: [...MENU_KEYS], subjects: { math: "수학", english: "영어", science: "과학" }, sections,
};

const bucket = (b: string, n: number) => ({ b, n, students: n, done: 0, pending: 0, audio: 0, ai: 0, synced: 0, mapped: n });
const overviewOf = (rates: (number | null)[], total: number, snapshot: { total: number; present: number; absent: number; late: number; excused: number; rate: number } | null) => ({
  trend: rates.map((rate, i) => ({ date: new Date(Date.UTC(2026, 9, 20 + i)).toISOString().slice(0, 10), total: rate === null ? 0 : total, rate })),
  snapshot: snapshot ? { date: TODAY, ...snapshot } : null,
});
const cell = (key: string, parsed: number, low: number) => ({ key, reports: parsed, parsed, low, notSubmitted: Math.floor(low / 2), zero: Math.floor(low / 4), sent: parsed, read: Math.floor(parsed * 0.74), unread: parsed - Math.floor(parsed * 0.74) });
const flat = (values: number[]) => Object.fromEntries(values.map((v, i) => [["2026-04", "2026-05", ...MONTHS].slice(-values.length)[i]!, v]));
export const FIXTURE_EXTRAS: InstrumentExtras = {
  subjects: [{ key: "eie", label: "EiE" }, { key: "injaewon", label: "인재원 영어" }, { key: "math", label: "수학" }, { key: "science", label: "과학" }],
  enrolled: { eie: flat([66, 66, 67, 67, 66, 66, 64]), injaewon: flat([110, 110, 110, 112, 111, 110, 108]), math: flat([186, 187, 188, 190, 187, 186, 183]), science: flat([87, 87, 87, 88, 87, 86, 57]) },
  courses: { eie: flat([66, 66, 67, 67, 66, 66, 64]), injaewon: flat([110, 110, 110, 112, 111, 110, 108]), math: flat([186, 187, 188, 190, 187, 186, 183]), science: flat([87, 87, 87, 88, 87, 86, 57]) },
  changes: { eie: { enrolled: flat([2, 1, 1, 3, 1, 0]), withdrawn: flat([1, 2, 2, 2, 3, 0]) }, injaewon: { enrolled: flat([3, 2, 1, 3, 2, 0]), withdrawn: flat([2, 2, 3, 3, 5, 0]) }, math: { enrolled: flat([3, 2, 3, 4, 3, 0]), withdrawn: flat([3, 3, 3, 4, 6, 0]) }, science: { enrolled: flat([0, 1, 0, 1, 0, 0]), withdrawn: flat([3, 1, 1, 1, 0, 0]) } },
  billing: { eie: flat([22, 23, 23, 24, 25, 26].map(m)), injaewon: flat([32, 32, 33, 34, 34, 36].map(m)), math: flat([56, 58, 59, 61, 62, 64].map(m)), science: flat([8, 8, 8, 8, 8, 8].map(m)) },
  longChanges: Array.from({ length: 14 }, (_, i) => { const d = new Date(Date.UTC(2025, 9 + i, 1)); return { month: d.toISOString().slice(0, 7), enrolled: 5 + (i % 4), withdrawn: 4 + (i % 3) }; }),
  longBilling: Array.from({ length: 14 }, (_, i) => { const d = new Date(Date.UTC(2025, 9 + i, 1)); return bill(d.toISOString().slice(0, 7), 110 + i, 100 + i); }),
  longAdmissions: [[0, 0], [0, 0], ...[[42, 9], [38, 8], [51, 12], [47, 10], [40, 7], [44, 11], [52, 13], [46, 9], [39, 8], [48, 10], [43, 9], [50, 12], [44, 9], [39, 6]]].map(([total, enrolled], i) => {
    const month = new Date(Date.UTC(2025, 7 + i, 1)).toISOString().slice(0, 7);
    return { month, total: total!, enrolled: enrolled!, declined: 0, noShow: 0, open: total! - enrolled!, paidSum: 0, rate: total ? Math.round((enrolled! / total) * 100) : null };
  }),
  eieClassIds: ["k4"],
  composition: {
    eie: { students: 64, levels: [{ label: "초등", englishOnly: 12, both: 8, mathOnly: 0 }, { label: "중등", englishOnly: 20, both: 14, mathOnly: 0 }, { label: "고등", englishOnly: 5, both: 5, mathOnly: 0 }], grades: [{ label: "중1", englishOnly: 20, both: 14, mathOnly: 0 }] },
    injaewon: { students: 108, levels: [{ label: "초등", englishOnly: 26, both: 14, mathOnly: 0 }, { label: "중등", englishOnly: 28, both: 25, mathOnly: 0 }, { label: "고등", englishOnly: 7, both: 8, mathOnly: 0 }], grades: [{ label: "중2", englishOnly: 28, both: 25, mathOnly: 0 }] },
    math: { students: 183, levels: [{ label: "초등", englishOnly: 0, both: 22, mathOnly: 20 }, { label: "중등", englishOnly: 0, both: 39, mathOnly: 56 }, { label: "고등", englishOnly: 0, both: 13, mathOnly: 33 }], grades: [{ label: "고1", englishOnly: 0, both: 13, mathOnly: 33 }] },
  },
  roster: {
    students: {
      w1: [{ classId: "k1", className: "중2 수학 A", subject: "수학", teacher: "강사 가", teacherId: "t0" }],
      w2: [{ classId: "k7", className: "초5 EiE", subject: "EiE", teacher: "강사 나", teacherId: "t1" }],
      s1: [{ classId: "k8", className: "중1 수학 A", subject: "수학", teacher: "강사 가", teacherId: "t0" }],
      s2: [{ classId: "k4", className: "초5 영어", subject: "인재원 영어", teacher: "강사 나", teacherId: "t1" }],
      s3: [{ classId: "k1", className: "중2 수학 A", subject: "수학", teacher: "강사 가", teacherId: "t0" }],
      s4: [{ classId: "k4", className: "초5 영어", subject: "인재원 영어", teacher: "강사 나", teacherId: "t1" }],
      s5: [{ classId: "k1", className: "중2 수학 A", subject: "수학", teacher: "강사 가", teacherId: "t0" }, { classId: "k4", className: "초5 영어", subject: "인재원 영어", teacher: "강사 나", teacherId: "t1" }],
      s7: [{ classId: "k4", className: "초5 영어", subject: "인재원 영어", teacher: "강사 나", teacherId: "t1" }],
    },
    classTeachers: { "중2 수학 A": "강사 가", "중1 수학 A": "강사 가", "초5 영어": "강사 나", "초5 EiE": "강사 나" },
    classSubjects: { "중2 수학 A": "수학", "중1 수학 A": "수학", "초5 영어": "인재원 영어", "초5 EiE": "EiE" },
  },
  earlyExits: { month: "2026-11", months: MONTHS, rows: [{ id: "w1", name: "학생 가", schoolGrade: "A중2", enrolledAt: "2026-09-10", withdrawnAt: "2026-11-01", days: 52, subjects: ["math"] }, { id: "w2", name: "학생 나", schoolGrade: "B초5", enrolledAt: "2026-02-01", withdrawnAt: "2026-11-02", days: 274, subjects: ["english"] }], history: [{ month: "2026-09", days: 20, subjects: ["math"] }, { month: "2026-10", days: 80, subjects: ["english"] }] },
  earlyNames: [{ id: "s6", name: "학생 아", schoolGrade: "A중3", enrolledAt: "2026-08-01", withdrawnAt: "2026-10-20", days: 80, subjects: [] }],
  absenceLines: [
    { studentId: "s6", name: "학생 아", schoolGrade: "A중3", classId: "k1", className: "중2 수학 A", subject: "math", teacherId: "t0", teacher: "강사 가", dates: ["2026-10-22", "2026-10-27", "2026-10-29", "2026-10-30"], notified: 1 },
    { studentId: "s5", name: "학생 사", schoolGrade: "A중2", classId: "k1", className: "중2 수학 A", subject: "math", teacherId: "t0", teacher: "강사 가", dates: ["2026-10-26", "2026-10-28"], notified: 0 },
    { studentId: "s5", name: "학생 사", schoolGrade: "A중2", classId: "k2", className: "초5 영어", subject: "english", teacherId: "t1", teacher: "강사 나", dates: ["2026-10-30"], notified: 1 },
  ],
  taskBoard: {
    kinds: [{ kind: "report_send_failed", open: 3, late: 2 }, { kind: "attendance_absent_desk", open: 2, late: 1 }, { kind: "followup_due", open: 1, late: 0 }],
    people: [{ id: "u1", name: "관리자 나", open: 3, late: 2, kinds: [{ kind: "report_send_failed", late: 2 }], items: [
      { id: "st1", kind: "report_send_failed", title: "학생 가 10/30 보고서 발송 실패", link: "/lesson-reports?status=failed", dueAt: "2026-10-31T09:00:00Z" },
      { id: "st2", kind: "report_send_failed", title: "학생 나 10/31 보고서 발송 실패", link: null, dueAt: "2026-11-02T03:00:00Z" },
    ] }, { id: "t0", name: "강사 가", open: 2, late: 1, kinds: [{ kind: "attendance_absent_desk", late: 1 }] }, { id: "t1", name: "강사 나", open: 1, late: 0, kinds: [] }],
  },
  attendance: {
    math: overviewOf([92, 90, null, 88, 91, 94, null, 90, 93, 89, 92, null, 90, 95], 60, { total: 90, present: 84, absent: 4, late: 2, excused: 0, rate: 95 }),
    injaewon: overviewOf([88, 86, null, 84, 90, 88, null, 86, 87, 85, 89, null, 91, 92], 30, { total: 60, present: 53, absent: 5, late: 2, excused: 0, rate: 92 }),
    eie: overviewOf([96, 95, null, 94, 97, 92, null, 93, 96, 94, 95, null, 97, null], 20, null),
  },
  report: {
    weeks: [[62, 11], [58, 8], [60, 13], [64, 9], [40, 4], [66, 12], [61, 9], [63, 16], [59, 7], [65, 12], [62, 8], [12, 1]].map(([parsed, low], i) => cell(new Date(Date.UTC(2026, 7, 17 + i * 7)).toISOString().slice(0, 10), parsed!, low!)),
    months: [[0, 0], [0, 0], [120, 18], [260, 41], [255, 33], [262, 37], [270, 32], [240, 29], [258, 44], [266, 39], [270, 35], [12, 1]].map(([parsed, low], i) => cell(new Date(Date.UTC(2025, 11 + i, 1)).toISOString().slice(0, 7), parsed!, low!)),
    read: { read: 310, sent: 420 },
    students: [
      { id: "s3", name: "학생 마", schoolGrade: "A중2", low: 2, parsed: 3, notSubmitted: 2, zero: 0, last: "2026-10-30", classes: [{ classId: "k1", subject: "math" }] },
      { id: "s5", name: "학생 사", schoolGrade: "A중2", low: 1, parsed: 2, notSubmitted: 0, zero: 1, last: "2026-11-01", classes: [{ classId: "k1", subject: "math" }] },
      { id: "s2", name: "학생 라", schoolGrade: "B초5", low: 1, parsed: 2, notSubmitted: 0, zero: 0, last: "2026-10-29", classes: [{ classId: "k4", subject: "english" }] },
    ],
  },
  consult: {
    weeks: [24, 31, 28, 35, 22, 41, 38, 33, 29, 44, 36, 4].map((n, i) => bucket(new Date(Date.UTC(2026, 7, 17 + i * 7)).toISOString().slice(0, 10), n)),
    months: [88, 92, 110, 96, 121, 104, 99, 87, 132, 141, 118, 12].map((n, i) => bucket(new Date(Date.UTC(2025, 11 + i, 1)).toISOString().slice(0, 10), n)),
    bySubject: { math: [40, 41, 52, 44, 60, 50, 48, 41, 66, 70, 58, 6], injaewon: [30, 31, 38, 34, 41, 36, 33, 30, 44, 47, 40, 4], eie: [18, 20, 20, 18, 20, 18, 18, 16, 22, 24, 20, 2] },
    categories: [{ label: "학습", recent: 164 }, { label: "일반", recent: 98 }, { label: "정서", recent: 31 }, { label: "진로", recent: 12 }],
    homeroom: { months: ["2026-10", "2026-11"], rows: [
      { id: "t0", name: "강사 가", subjects: ["math"], classNames: ["중2 수학 A", "중1 수학 A"], pending: [{ id: "s3", name: "학생 마", grade: "중2", prev: "none", last: "2026-09-02" }, { id: "s5", name: "학생 사", grade: "중2", prev: "self", last: "2026-10-12" }], months: [{ ym: "2026-10", counseled: 41, target: 52, count: 47 }, { ym: "2026-11", counseled: 3, target: 52, count: 3 }] },
      { id: "t1", name: "강사 나", subjects: ["english"], classNames: ["초5 EiE", "초5 영어"], pending: [{ id: "s2", name: "학생 라", grade: "초5", prev: "other", last: null }], months: [{ ym: "2026-10", counseled: 22, target: 40, count: 25 }, { ym: "2026-11", counseled: 1, target: 40, count: 1 }] },
      { id: "t2", name: "강사 다", subjects: ["english"], classNames: ["초5 영어"], pending: [], months: [{ ym: "2026-10", counseled: 30, target: 33, count: 31 }, { ym: "2026-11", counseled: 0, target: 33, count: 0 }] },
    ] },
  },
  teacherWork: {
    reportFrom: "2026-10-26", videoFrom: "2026-10-05", to: TODAY, videoCheckedAt: null, deliveryShown: true, counselShown: false,
    rows: [["강사 가", "english", 6], ["강사 나", "english", 5], ["강사 다", "math", 7], ["강사 라", "math", 4]].map(([teacherName, subject, classes], i) => ({
      teacherId: `t${i}`, teacherName: teacherName as string, subject: subject as string, classIds: Array.from({ length: classes as number }, (_, k) => `k${i}${k}`),
      reports: 12 - i, reportTarget: 14, sent: 11 - i, pending: 1, failed: 0, videoMissing: 0, videoAssigned: 20, videoSubmitted: 16 - i * 2, reportSource: "lesson" as const,
      reportsWritten: 12 - i, videoIssuedReports: 8 - i, todayUnwritten: 0, recalled: 0, unreadJudged: 40, unread: 3 + i * 4, attendanceDays: 12, attendanceUnrecorded: i, counselRate: null,
    })),
  },
};
