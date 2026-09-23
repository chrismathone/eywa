import { describe, expect, it } from "vitest";
import { SCENARIOS, buildScenario } from "./plan.mjs";
import { buildDashboardWorld, classKey, shiftYmd } from "./dashboard-world.mjs";

const TODAY = "2026-09-22";
const DOW = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function dow(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  return DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

describe("데모 운영실 데이터", () => {
  for (const id of Object.keys(SCENARIOS)) {
    it(`${id}는 오늘 기준으로 운영실 칸을 채운다`, () => {
      const plan = buildScenario(id);
      const world = buildDashboardWorld(plan, TODAY);
      const names = new Set(plan.students.map((s: { name: string }) => s.name));

      expect(world.firstClassCodes.size).toBe(4);
      for (const code of world.firstClassCodes) {
        expect(world.startDate.get(code)).toBe(TODAY);
        expect(world.enrolledAt.get(code)).toBe(TODAY);
      }
      for (const student of plan.students) {
        const start = world.startDate.get(student.code);
        expect(start <= TODAY).toBe(true);
        expect(student.classes.length).toBeGreaterThan(0);
      }

      const meetsToday = plan.students.filter((student: { classes: { days: string[] }[]; code: string }) =>
        student.classes.some((cls) => cls.days.includes(dow(TODAY))) && world.startDate.get(student.code)! <= TODAY,
      );
      const recordedToday = new Set(
        world.attendance.filter((row: { date: string }) => row.date === TODAY).map((row: { studentCode: string }) => row.studentCode),
      );
      expect(recordedToday.size).toBeGreaterThan(0);
      expect(meetsToday.some((student: { code: string }) => !recordedToday.has(student.code))).toBe(true);

      const yesterday = shiftYmd(TODAY, -1);
      const absentYesterday = plan.students.filter((student: { code: string; classes: { days: string[]; subject: string; name: string }[] }) => {
        const classes = student.classes.filter((cls) => cls.days.includes(dow(yesterday)));
        if (classes.length === 0 || world.startDate.get(student.code)! > yesterday) return false;
        return classes.every((cls) =>
          world.attendance.some(
            (row: { studentCode: string; classKey: string; date: string; status: string }) =>
              row.studentCode === student.code && row.classKey === classKey(cls) && row.date === yesterday && row.status === "absent",
          ),
        );
      });
      expect(absentYesterday.length).toBeGreaterThan(0);

      const absentDays = new Map<string, Set<string>>();
      for (const row of world.attendance) {
        if (row.status !== "absent") continue;
        const key = row.studentCode;
        const days = absentDays.get(key) ?? new Set<string>();
        days.add(`${row.classKey}|${row.date}`);
        absentDays.set(key, days);
      }
      const risks = [...absentDays.values()].filter((days) => days.size >= 3);
      expect(risks.length).toBeGreaterThanOrEqual(5);

      const current = TODAY.slice(0, 7);
      for (const student of plan.students) {
        expect(world.invoices.some((row: { studentCode: string; period: string }) => row.studentCode === student.code && row.period === current)).toBe(true);
      }
      expect(new Set(world.invoices.map((row: { period: string }) => row.period)).size).toBe(6);
      expect(world.invoices.some((row: { status: string }) => row.status === "unpaid")).toBe(true);
      expect(world.invoices.some((row: { status: string }) => row.status === "paid")).toBe(true);

      expect(world.withdrawn).toHaveLength(18);
      for (const student of world.withdrawn) {
        expect(student.code.startsWith("DMO-9")).toBe(true);
        expect(student.withdrawnAt <= TODAY).toBe(true);
        expect(student.withdrawnAt.endsWith("-03")).toBe(false);
        expect(student.withdrawnAt.endsWith("-10")).toBe(false);
        expect(names.has(student.name)).toBe(false);
        expect(student.enrolledAt < student.endDate).toBe(true);
      }

      const todayIntake = world.consultations.filter((row: { at: string }) => row.at.startsWith(TODAY));
      expect(todayIntake).toHaveLength(4);
      expect(todayIntake.every((row: { outcome: string }) => row.outcome === "pending")).toBe(true);
      expect(world.consultations.some((row: { outcome: string; at: string }) => row.outcome === "enrolled" && !row.at.startsWith(TODAY))).toBe(true);
      // 금일 등록(원장 2026-09-23) — 오늘 옮긴 상담 셋: 오늘 첫 수업 학생 둘(반 배정) + 등록만 한 한 명.
      const movedToday = world.consultations.filter((row: { movedAt?: string }) => row.movedAt?.startsWith(TODAY));
      expect(movedToday).toHaveLength(3);
      expect(movedToday.every((row: { outcome: string }) => row.outcome === "enrolled")).toBe(true);
      expect(movedToday.filter((row: { studentCode?: string | null }) => row.studentCode && world.firstClassCodes.has(row.studentCode))).toHaveLength(2);
      expect(movedToday.every((row: { subject: string }) => row.subject === "math" || row.subject === "english")).toBe(true);

      expect(world.studentConsultations.filter((row: { followUpDate: string | null }) => row.followUpDate && row.followUpDate < TODAY)).toHaveLength(3);
      expect(world.reports.some((row: { homeworkScore: string }) => row.homeworkScore === "40%")).toBe(true);
      expect(world.reports.some((row: { homeworkScore: string }) => row.homeworkScore === "미제출")).toBe(true);
      expect(world.reports.filter((row: { unread: boolean }) => row.unread).length).toBeGreaterThan(0);
      for (const row of world.reports) expect(row.date >= shiftYmd(TODAY, -6) && row.date <= TODAY).toBe(true);

      expect(world.makeup.length).toBeGreaterThan(0);
      for (const row of world.makeup) {
        expect(row.absenceDate).not.toBe(row.makeupDate);
        expect(row.slotEnd > row.slotStart).toBe(true);
      }
      expect(world.expenses.length).toBeGreaterThan(0);
      expect(world.announcements.every((row: { title: string }) => row.title.startsWith("[데모]"))).toBe(true);
      expect(world.checks.length).toBeGreaterThan(0);
      for (const row of world.checks) {
        const enrolled = world.enrolledAt.get(row.studentCode);
        expect(shiftYmd(enrolled, 90) >= TODAY).toBe(true);
      }
    });
  }
});
