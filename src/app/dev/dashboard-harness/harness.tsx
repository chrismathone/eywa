"use client";

// 개발 전용 샘플: 로그인 없이 동작하며 저장은 서버로 보내지 않는다.
import { MENU_KEYS, type MenuKey } from "@/lib/permissions";
import type { OverviewSnapshot } from "@/features/dashboard/overview/model";
import { BUNDLES, type Bundle } from "@/features/dashboard/layout/types";
import { DashboardEditorLazy } from "@/app/(shell)/owner/_components/dashboard/dashboard-editor-lazy";
import { Overview } from "@/app/(shell)/dashboard/_overview/overview";
import { previewSnapshot } from "@/features/dashboard/layout/preview";
import { defaultItems } from "@/features/dashboard/layout/defaults";
import { ReplyHarness } from "./reply-harness";

const ok = <T,>(data: T) => ({ data, at: Date.now(), error: false });
const bill = (period: string, k: number) => ({ period, totalCount: 300, paidCount: 240 - k, partialCount: 10, unpaidCount: 50 + k, totalBilled: 98_000_000 + k * 1_000_000, totalCollected: 80_000_000, totalDiscount: 2_000_000, outstanding: 16_340_000, paymentRate: 82.3 });

export const FIXTURE = {
  scope: "harness",
  tenantId: "t",
  academy: "인재원 침산",
  today: "2026-10-01",
  requestedAt: Date.now(),
  allowed: [...MENU_KEYS],
  subjects: { math: "수학", english: "영어" },
  sections: {
    students: ok({
      enrolled: 338,
      subjects: [{ label: "math", value: 210 }, { label: "english", value: 190 }],
      levels: [{ label: "초등", value: 120 }, { label: "중등", value: 150 }, { label: "고등", value: 68 }],
      schools: [{ label: "침산중", value: 40 }, { label: "칠성초", value: 30 }],
      concurrent: 62,
      subjectCombinations: [{ subjects: ["math"], value: 148 }, { subjects: ["english"], value: 128 }, { subjects: ["english", "math"], value: 62 }],
      programs: { eie: 90, injaewon: 100, math: 210, both: 62, noEnrollment: 3, otherOnly: 0 },
      gradeSplit: { rows: [{ label: "중1", englishOnly: 10, both: 8, mathOnly: 20 }], neither: 3 },
    }),
    changes: ok([
      { month: "2026-05", enrolled: 12, withdrawn: 5 },
      { month: "2026-06", enrolled: 9, withdrawn: 7 },
      { month: "2026-07", enrolled: 15, withdrawn: 4 },
      { month: "2026-08", enrolled: 20, withdrawn: 6 },
      { month: "2026-09", enrolled: 11, withdrawn: 9 },
      { month: "2026-10", enrolled: 2, withdrawn: 1 },
    ]),
    withdrawals: ok({ month: "2026-10", rows: [{ id: "w1", name: "김가람", schoolGrade: "침산중2", withdrawnAt: "2026-10-01", program: "math" }] }),
    intake: ok([{ id: "i1", name: "박서준", time: "10:12" }]),
    enrolledToday: ok([]),
    firstClass: ok([{ studentId: "s1", name: "이하은", kind: "first", subjects: ["math"] }]),
    absent: ok({ from: "2026-09-23", to: "2026-09-29", students: [] }),
    attendance: ok({ date: "2026-10-01", total: 120, present: 100, absent: 8, late: 6, excused: 4, rate: 88 }),
    processing: ok([]),
    attendanceTrend: ok(Array.from({ length: 14 }, (_, i) => ({ date: `2026-09-${String(18 + i).padStart(2, "0")}`, rate: 85 + (i % 5), total: 100 }))),
    billing: ok([bill("2026-05", 1), bill("2026-06", 2), bill("2026-07", 3), bill("2026-08", 4), bill("2026-09", 5), bill("2026-10", 6)]),
    expenses: ok({ period: "2026-10", count: 4, byCurrency: [{ currency: "KRW", total: 1_200_000, count: 4 }], primaryCurrency: "KRW", byCategory: [{ category: "교재", amount: 800_000, count: 2 }], categoryCount: 1 }),
    absences: ok({ anchor: "2026-09-30", rows: [{ studentId: "s9", studentName: "정유나", absences: 4, unexplained: 3 }] }),
    consultations: ok({ thisMonth: 41, lastWeek: 12, pendingFollowUps: 5, overdueFollowUps: 2 }),
    schedule: ok([
      { id: "1", classId: "c1", className: "수학 중2A", subject: "math", startTime: "16:00", endTime: "17:40", teacherName: "갑", classroomName: "301", status: "ongoing" },
      { id: "2", classId: "c2", className: "EiE 5", subject: "english", startTime: "16:20", endTime: "17:20", teacherName: "을", classroomName: "602", status: "upcoming" },
    ]),
    staff: ok([{ label: "강사", value: 15, bySubject: { english: 6, both: 1, math: 7, other: 0, none: 1 } }]),
    operations: ok([{ label: "회의록", href: "/meetings", count: 12, unit: "건" }, { label: "운행 차량", href: "/shuttle", count: 2, unit: "대" }]),
    notices: ok([]),
    calendar: ok([{ id: "e1", title: "입테 최지우 010-1234-5678", startDate: "2026-10-01", endDate: "2026-10-01", startTime: "15:00", source: "manual", kind: "levelTest" }]),
  },
} as unknown as OverviewSnapshot;

const menus = Object.fromEntries(BUNDLES.map((b) => [b, b === "owner" ? [...MENU_KEYS] : MENU_KEYS.filter((m) => m !== "staff" && m !== "owner")])) as Record<Bundle, MenuKey[]>;

export function Harness({ mode, role }: { mode: string; role: string }) {
  if (mode === "reply") return <ReplyHarness />;
  if (mode === "view") {
    const r = (BUNDLES as readonly string[]).includes(role) ? (role as Bundle) : "desk";
    const snap = previewSnapshot(FIXTURE, { role: r, items: defaultItems(r), menus: new Set(menus[r]), subject: r === "subject" ? { key: "math", label: "수학" } : null });
    return <Overview initial={snap} preview />;
  }
  return (
    <div style={{ padding: 16 }} onSubmitCapture={(event) => { event.preventDefault(); event.stopPropagation(); }}>
      <p role="status" className="mb-4 text-sm">샘플 데이터로 편집 동작을 확인하는 화면입니다. 변경 내용은 저장되지 않습니다.</p>
      <DashboardEditorLazy
        initial={{ version: 1, layouts: [] }}
        roleMenus={menus}
        subjects={[{ key: "math", label: "수학" }, { key: "english", label: "영어" }]}
        members={{ failed: false, people: [
          { id: "sample-owner", name: "원장 예시", role: "master", bundle: "owner", scopeLabel: "전 과목", canOpen: true, inherited: true },
          { id: "sample-math", name: "수학 담당 예시", role: "admin", bundle: "subject", scopeLabel: "수학", canOpen: true, inherited: false },
          { id: "sample-desk", name: "경영지원 예시", role: "admin", bundle: "desk", scopeLabel: "전 과목", canOpen: true, inherited: false },
        ] }}
      />
    </div>
  );
}
