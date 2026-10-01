import { describe, expect, it } from "vitest";
import type { BillingSummary } from "@/features/billing/calc";
import type { OverviewSnapshot, Section } from "@/features/dashboard/overview/model";
import { applyRoleView } from "./apply";
import { allowedPanels, buildLayout, NO_TOGGLES, parseToggles, PANEL_AREAS, toggleParam, TOGGLES, type RoleId, type Toggles } from "./roles";
import { maskPhones } from "./mask";

const ok = <T,>(data: T): Section<T> => ({ data, at: 1, error: false });
const bill = (period: string): BillingSummary => ({
  period,
  totalCount: 10,
  paidCount: 6,
  partialCount: 1,
  unpaidCount: 3,
  totalBilled: 1_000_000,
  totalCollected: 700_000,
  totalDiscount: 50_000,
  outstanding: 300_000,
  paymentRate: 70,
});

/** 원장 시점 전체 스냅샷의 최소 모양 — 영역마다 들어 있는 값만 있으면 걸러내기를 검증할 수 있다. */
function fullSnapshot(): OverviewSnapshot {
  const sections = {
    students: ok({
      enrolled: 300,
      subjects: [
        { label: "math", value: 150 },
        { label: "english", value: 120 },
      ],
      levels: [{ label: "초등", value: 1 }],
      schools: [{ label: "대구초", value: 1 }],
      concurrent: 40,
      subjectCombinations: [
        { subjects: ["math"], value: 100 },
        { subjects: ["english"], value: 80 },
        { subjects: ["english", "math"], value: 40 },
      ],
      programs: { eie: 50, injaewon: 70, math: 150, both: 40, noEnrollment: 5, otherOnly: 3 },
      gradeSplit: { rows: [{ label: "초1", englishOnly: 1, both: 0, mathOnly: 0 }], neither: 0 },
    }),
    withdrawals: ok({
      month: "2026-10",
      rows: [
        { id: "a", name: "가", schoolGrade: null, withdrawnAt: "2026-10-01", program: "math" as const },
        { id: "b", name: "나", schoolGrade: null, withdrawnAt: "2026-10-01", program: "eie" as const },
      ],
    }),
    intake: ok([{ id: "i", name: "문의", time: "10:00" }]),
    enrolledToday: ok([]),
    makeup: ok({ range: { start: "2026-10-01", end: "2026-10-31" }, rows: [], later: 0 }),
    firstClass: ok([
      { studentId: "1", name: "수", kind: "first" as const, subjects: ["math"] },
      { studentId: "2", name: "영", kind: "first" as const, subjects: ["english"] },
    ]),
    absent: ok({
      date: "2026-09-30",
      absent: [
        { studentId: "1", name: "수", subject: "math", classes: [{ id: "c1", name: "수학반", subject: "math" }], preNotified: false, statuses: ["absent" as const] },
        { studentId: "2", name: "영", subject: "english", classes: [{ id: "c2", name: "영어반", subject: "english" }], preNotified: false, statuses: ["absent" as const] },
      ],
      partial: [],
    }),
    billing: ok([bill("2026-08"), bill("2026-09"), bill("2026-10")]),
    expenses: ok({ count: 1, byCategory: [{ category: "임대", amount: 5_000_000 }], byCurrency: {}, primaryCurrency: "KRW" }),
    staff: ok([{ label: "원장", value: 1, bySubject: { english: 0, math: 0, both: 0, other: 0, none: 1 } }]),
    schedule: ok([
      { id: "s1", classId: "c1", className: "수학반", subject: "math", startTime: "16:00", endTime: "17:00", teacherName: "김", classroomName: "1", status: "scheduled" },
      { id: "s2", classId: "c2", className: "영어반", subject: "english", startTime: "16:00", endTime: "17:00", teacherName: "이", classroomName: "2", status: "scheduled" },
    ]),
    calendar: ok([
      { id: "e1", title: "김철수 레벨테스트 010-1234-5678", displayTitle: "김철수 레벨테스트 010-1234-5678", startDate: "2026-10-02", endDate: "2026-10-02", startTime: "15:00", source: "manual", kind: "levelTest" as const },
    ]),
    notices: ok([
      { id: "n1", title: "전체", content: "", audience: "all", pinned: false, createdAt: "2026-10-01T00:00:00Z", authorName: null },
      { id: "n2", title: "강사만", content: "", audience: "teachers", pinned: false, createdAt: "2026-10-01T00:00:00Z", authorName: null },
    ]),
    englishSheet: ok({ period: "이번 주", classes: 3, filled: 1, total: 3 }),
    mathSheet: ok({ period: "이번 달", classes: 3, filled: 1, total: 3 }),
    operations: ok([
      { label: "회의록", href: "/meetings", count: 3, unit: "건" },
      { label: "내 결재 대기", href: "/approvals", count: 2, unit: "건" },
    ]),
  };
  return {
    scope: "t:u:master:all",
    tenantId: "t",
    academy: "학원",
    today: "2026-10-01",
    requestedAt: 1,
    allowed: ["students", "billing", "staff", "owner", "withdrawals", "attendance", "enrollment"],
    subjects: { math: "수학", english: "영어" },
    sections: sections as unknown as OverviewSnapshot["sections"],
  };
}

const view = (role: RoleId, toggles: Toggles = NO_TOGGLES, layout: "a" | "b" | "c" = "a", subject = "math") =>
  applyRoleView(fullSnapshot(), { role, layout, subject, toggles });
const on = (...n: number[]) => parseToggles(n.join(","));

describe("역할별 운영실 걸러내기", () => {
  it("원장 = 지금 운영실 그대로 — 영역·배치 전부 보존", () => {
    const v = view("owner");
    expect(Object.keys(v.snapshot.sections)).toEqual(Object.keys(fullSnapshot().sections));
    expect(v.snapshot.allowed).toEqual(fullSnapshot().allowed);
    expect(v.billingAmounts).toBe(true);
    expect(v.layout.sections.map((s) => s.id)).toEqual(["academy-overview", "student-overview", "operations-overview"]);
  });

  it("실장 — 지출·직원은 데이터째 없고 수납은 지금 달 건수만(금액 0)", () => {
    const v = view("manager");
    expect(v.snapshot.sections.expenses).toBeUndefined();
    expect(v.snapshot.sections.staff).toBeUndefined();
    const billing = v.snapshot.sections.billing?.data ?? [];
    expect(billing).toHaveLength(1);
    expect(billing[0]).toMatchObject({ paidCount: 6, unpaidCount: 3, totalBilled: 0, outstanding: 0, totalCollected: 0 });
    expect(v.billingAmounts).toBe(false);
    expect(v.snapshot.allowed).not.toContain("billing");
    expect(v.snapshot.allowed).not.toContain("staff");
    expect(v.snapshot.allowed).not.toContain("owner");
    expect(v.snapshot.allowed).not.toContain("withdrawals"); // 퇴원관리는 사유 원문이 있어 원장만
  });

  it("⑥ 켜면 실장·데스크에 직원 구성이 열리고, 안 켜면 어느 안에서도 없다", () => {
    for (const role of ["manager", "desk"] as const) {
      expect(view(role, on(6)).snapshot.sections.staff).toBeDefined();
      for (const l of ["a", "b", "c"] as const) expect(view(role, NO_TOGGLES, l).snapshot.sections.staff).toBeUndefined();
    }
  });

  it("① 데스크 — 켜면 미수 잔액 금액이, 꺼두면 건수만. 6개월 이력은 어느 쪽도 안 내려간다", () => {
    const off = view("desk");
    const onV = view("desk", on(1));
    expect(off.snapshot.sections.billing?.data?.[0]?.outstanding).toBe(0);
    expect(onV.snapshot.sections.billing?.data?.[0]?.outstanding).toBe(300_000);
    expect(onV.snapshot.sections.billing?.data).toHaveLength(1);
    expect(onV.billingAmounts).toBe(true);
    expect(onV.snapshot.allowed).toContain("billing");
  });

  it("⑤ 일정 제목의 전화번호 — 기본은 가림, 켜면 그대로(원장은 항상 그대로)", () => {
    expect(view("desk").snapshot.sections.calendar?.data?.[0]?.title).toBe("김철수 레벨테스트 010-****-5678");
    expect(view("desk").snapshot.sections.calendar?.data?.[0]?.displayTitle).toBe("김철수 레벨테스트 010-****-5678");
    expect(view("desk", on(5)).snapshot.sections.calendar?.data?.[0]?.title).toContain("010-1234-5678");
    expect(view("owner").snapshot.sections.calendar?.data?.[0]?.title).toContain("010-1234-5678");
  });

  it("행정·자산의 '내 결재 대기'는 원장 개인 수치라 다른 역할엔 안 간다", () => {
    expect(view("manager").snapshot.sections.operations?.data?.map((r) => r.href)).toEqual(["/meetings"]);
    expect(view("owner").snapshot.sections.operations?.data?.map((r) => r.href)).toContain("/approvals");
  });

  it("0건 카드(공지·행정)는 맨 뒤 얇은 줄 — 원장 배치는 그대로", () => {
    const base = fullSnapshot();
    const empty = { ...base, sections: { ...base.sections, notices: ok([]), operations: ok([]) } } as unknown as OverviewSnapshot;
    const v = applyRoleView(empty, { role: "desk", layout: "a", subject: "math", toggles: NO_TOGGLES });
    const last = v.layout.sections.at(-1);
    expect(last).toMatchObject({ thin: true });
    expect(last?.panels).toEqual(expect.arrayContaining(["notices", "operations"]));
    expect(applyRoleView(empty, { role: "owner", layout: "a", subject: "math", toggles: NO_TOGGLES }).layout.sections.some((s) => s.thin)).toBe(false);
    expect(v.layout.evenGap).toBe(true);
  });

  it("공지는 역할 대상만(강사 전용 공지가 새지 않는다)", () => {
    expect(view("desk").snapshot.sections.notices?.data?.map((n) => n.id)).toEqual(["n1"]);
  });

  it("과목 관리자(수학) — 담당 과목 데이터만 남고 과목 없는 영역은 데이터째 없다", () => {
    const s = view("subject").snapshot.sections;
    expect(s.students?.data?.enrolled).toBe(150);
    expect(s.students?.data?.subjects.map((r) => r.label)).toEqual(["math"]);
    expect(s.students?.data?.programs).toMatchObject({ eie: 0, injaewon: 0, math: 150 });
    expect(s.students?.data?.subjectCombinations?.map((c) => c.value)).toEqual([100, 40]);
    expect(s.schedule?.data?.map((r) => r.id)).toEqual(["s1"]);
    expect(s.firstClass?.data?.map((r) => r.studentId)).toEqual(["1"]);
    expect(s.absent?.data?.absent.map((r) => r.studentId)).toEqual(["1"]);
    expect(s.englishSheet).toBeUndefined();
    // 기본(전부 가림) — 퇴원·수납·시트·접수·직원·지출은 데이터째 없다.
    for (const area of ["withdrawals", "billing", "mathSheet", "intake", "enrolledToday", "makeup", "calendar", "staff", "expenses"] as const) {
      expect(s[area], area).toBeUndefined();
    }
  });

  it("과목 관리자 — 다른 과목 반·과목 이름과 영어 이중 집계가 안 새고, 과목 미정이면 아무것도 통과 못 한다", () => {
    const s = view("subject").snapshot.sections;
    expect(s.absent?.data?.absent.flatMap((r) => r.classes.map((c) => c.subject))).toEqual(["math"]);
    expect(s.firstClass?.data?.flatMap((r) => r.subjects)).toEqual(["math"]);
    expect(s.students?.data?.concurrent).toBe(40);
    expect(s.students?.data?.subjectCombinations?.map((c) => c.subjects.join("+"))).toEqual(["math", "english+math"]);
    // 영어 = 과목 막대(학생 단위) — eie(50)+injaewon(70)=120이 아니라 그 값을 쓴다(둘 다 듣는 학생이 겹쳐 세지 않게).
    const en = view("subject", NO_TOGGLES, "a", "english").snapshot.sections;
    expect(en.students?.data?.enrolled).toBe(120);
    // 담당 과목이 비어 있으면(선택지 없음) 과목 없는 행이 null === null로 통과하지 않는다.
    const none = view("subject", NO_TOGGLES, "a", "").snapshot.sections;
    expect(none.schedule?.data).toEqual([]);
    expect(none.absent?.data?.absent).toEqual([]);
    expect(none.firstClass?.data).toEqual([]);
  });

  it("과목 관리자 ③·④ — 켜면 시트(담당 과목 것만)·퇴원(자기 과목 행만)", () => {
    const s = view("subject", on(3, 4), "a", "english").snapshot.sections;
    expect(s.englishSheet).toBeDefined();
    expect(s.mathSheet).toBeUndefined();
    expect(s.withdrawals?.data?.rows.map((r) => r.id)).toEqual(["b"]);
    expect(s.students?.data?.enrolled).toBe(120);
  });

  it("과목 관리자 ② — 켜도 수납은 지금 달 하나뿐(6개월 이력 없음)", () => {
    const v = view("subject", on(2));
    expect(v.snapshot.sections.billing?.data).toHaveLength(1);
    expect(v.billingAmounts).toBe(true);
  });

  it("스냅샷 scope가 역할·안·토글마다 달라 갱신 캐시가 섞이지 않는다", () => {
    const scopes = new Set([view("owner").snapshot.scope, view("manager").snapshot.scope, view("manager", on(6)).snapshot.scope, view("manager", NO_TOGGLES, "b").snapshot.scope]);
    expect(scopes.size).toBe(4);
  });
});

describe("배치", () => {
  const roles = ["subject", "manager", "desk"] as const;
  const every: Toggles[] = Array.from({ length: 64 }, (_, i) => parseToggles(TOGGLES.filter((_, b) => (i >> b) & 1).map((t) => t.n).join(",")));

  it("어느 역할·안·토글에서도 못 놓는 카드는 배치에 없다 — 6개월 청구·지출은 원장 전용", () => {
    for (const role of roles) {
      for (const layout of ["a", "b", "c"] as const) {
        for (const t of every) {
          const placed = buildLayout(role, layout, t).sections.flatMap((s) => s.panels);
          const allowed = allowedPanels(role, t);
          for (const slot of placed) {
            const ids = slot === "followup" ? (["reports", "studentConsult"] as const) : ([slot] as const);
            for (const id of ids) expect(allowed).toContain(id);
          }
          expect(placed).not.toContain("billing6");
          expect(placed).not.toContain("expenses");
        }
      }
    }
  });

  it("스냅샷에도 새지 않는다 — 모든 조합에서 지출·6개월 수납·(⑥ 꺼짐)직원 영역이 없다", () => {
    for (const role of roles) {
      for (const layout of ["a", "b", "c"] as const) {
        for (const t of every) {
          const s = view(role, t, layout).snapshot.sections;
          expect(s.expenses).toBeUndefined();
          if ((s.billing?.data?.length ?? 0) > 0) expect(s.billing?.data).toHaveLength(1);
          if (!t.staffCard || role === "subject") expect(s.staff).toBeUndefined();
        }
      }
    }
  });

  it("각 카드가 읽는 영역 표가 모든 카드를 덮는다", () => {
    expect(Object.keys(PANEL_AREAS)).toHaveLength(24);
  });

  it("C안은 압축·머리 없음·구역 제목 없음(한 구역)", () => {
    for (const role of roles) {
      const l = buildLayout(role, "c", NO_TOGGLES);
      expect(l.compact).toBe(true);
      expect(l.hideHeader).toBe(role !== "subject"); // 과목 관리자는 제목에 담당 과목이 붙어 머리를 남긴다
      expect(l.sections).toHaveLength(1);
      expect(l.sections[0]?.title).toBe("");
    }
  });
});

describe("토글 주소 값", () => {
  it("왕복한다", () => {
    expect(toggleParam(parseToggles("1,4,6"))).toBe("1,4,6");
    expect(parseToggles(undefined)).toEqual(NO_TOGGLES);
    expect(parseToggles("9,x")).toEqual(NO_TOGGLES);
  });
});

describe("전화번호 가림", () => {
  it("전화번호만 가리고 날짜·시각은 둔다", () => {
    expect(maskPhones("박민수 010-9876-5432 입테")).toBe("박민수 010-****-5432 입테");
    expect(maskPhones("01098765432")).toBe("010-****-5432");
    expect(maskPhones("연락 9876-5432")).toBe("연락 ****-5432");
    // 사람이 손으로 적는 다른 표기(리뷰에서 가려지지 않던 것들)
    expect(maskPhones("010 - 1234 - 5678")).toBe("010-****-5678");
    expect(maskPhones("010 1234  5678")).toBe("010-****-5678");
    expect(maskPhones("010/1234/5678")).toBe("010-****-5678");
    expect(maskPhones("010–1234–5678")).toBe("010-****-5678");
    expect(maskPhones("010.1234.5678")).toBe("010-****-5678");
    expect(maskPhones("+82 10 1234 5678")).toBe("+82-10-****-5678");
    expect(maskPhones("8210-1234-5678")).toBe("82-10-****-5678");
    expect(maskPhones("02-123-4567")).toBe("02-****-4567");
    expect(maskPhones("053)123-4567")).toBe("053-****-4567");
    expect(maskPhones("(010)1234-5678")).toBe("(010-****-5678");
    expect(maskPhones("0505-1234-5678")).toBe("0505-****-5678");
    expect(maskPhones("1234  5678")).toBe("****-5678");
    // 시각 범위·연도 범위는 그대로
    expect(maskPhones("월 1500-1700 수업")).toBe("월 1500-1700 수업");
    expect(maskPhones("2025-2026학년도")).toBe("2025-2026학년도");
    expect(maskPhones("초5 1234-5678")).toBe("초5 ****-5678");
    // 가린 번호 뒤에 숫자가 이어져도 그 숫자를 먹지 않는다(한 번의 훑기)
    expect(maskPhones("010-1234-5678 2026-10-02")).toBe("010-****-5678 2026-10-02");
    expect(maskPhones("010-1234-5678 / 2026-10-02")).toBe("010-****-5678 / 2026-10-02");
    expect(maskPhones("2026-10-01 15:30 김철수 초5")).toBe("2026-10-01 15:30 김철수 초5");
    expect(maskPhones("10월 3일 레벨테스트")).toBe("10월 3일 레벨테스트");
  });
});
