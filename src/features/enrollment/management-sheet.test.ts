import { describe, expect, it } from "vitest";
import { buildManagementExits, buildManagementSheet, completionRate, completionTipCard, isLongOpen, type SheetRow } from "./management-sheet";

const groupsOf = (s: string | null | undefined) => {
  const t = (s ?? "").toLowerCase();
  const out: string[] = [];
  if (/math|수학/.test(t)) out.push("math");
  if (/english|영어|eie/.test(t)) out.push("english");
  return out;
};
const TODAY = "2026-10-23";
const row = (r: Partial<SheetRow> & Pick<SheetRow, "month" | "outcome">): SheetRow => ({
  subject: null,
  consultedOn: `${r.month}-15`,
  followUpDate: null,
  studentId: null,
  ...r,
});

describe("관리현황 — 달마다 상담·등록·완료율, 과목 묶음마다", () => {
  const sheet = buildManagementSheet(
    [
      row({ month: "2026-09", subject: "math", outcome: "enrolled" }),
      row({ month: "2026-09", subject: "수학, 영어", outcome: "declined" }),
      row({ month: "2026-10", subject: "english", outcome: "consulted" }),
      row({ month: "2026-10", subject: "EIE", outcome: "enrolled" }),
      row({ month: "2026-10", subject: null, outcome: "no_show" }),
    ],
    groupsOf,
    { today: TODAY, attending: null },
  );

  it("최신 달이 위 · 상태는 칸반 묶음(노쇼 = 미등록)", () => {
    expect(sheet.months.map((m) => m.month)).toEqual(["2026-10", "2026-09"]);
    expect(sheet.months[0]!.all).toEqual({ total: 3, enrolled: 1, declined: 1, open: 1, longOpen: 0, attending: null });
    expect(sheet.months[0]!.unknown).toBe(1);
  });

  it("두 과목 문의는 양쪽에 · 묶음은 상담이 많은 순", () => {
    expect(sheet.groups).toEqual(["english", "math"]);
    expect(sheet.total.groups.math).toMatchObject({ total: 2, enrolled: 1, declined: 1, open: 0 });
    expect(sheet.total.groups.english).toMatchObject({ total: 3, enrolled: 1, declined: 1, open: 1 });
    expect(sheet.total.all.total).toBe(5);
  });

  it("완료율 = 등록 ÷ 상담 · 상담 0이면 null", () => {
    expect(completionRate(sheet.total.all)).toBe(40);
    expect(completionRate({ total: 0, enrolled: 0, declined: 0, open: 0, longOpen: 0, attending: null })).toBeNull();
  });

  it("완료율 카드는 내역만 — '결정된 상담 중 %'는 싣지 않는다 · 상담 0이면 카드 없음", () => {
    const card = completionTipCard(sheet.total.all, "2026년");
    expect(card?.rows).toEqual([["상담", "5건"], ["등록", "2건"], ["미등록", "2건"], ["진행 중", "1건"], ["장기 미결", "0건"]]);
    expect(card?.lines).toEqual(["등록 ÷ 상담 — 위 '등록 전환율'과 같은 산식"]);
    expect(JSON.stringify(card)).not.toMatch(/결정된|%/);
    expect(completionTipCard({ total: 0, enrolled: 0, declined: 0, open: 0, longOpen: 0, attending: null }, "x")).toBeNull();
  });
});

describe("관리현황 — 진행 중 · 장기 미결(상담일 기준 60일)", () => {
  it("결정 없이 상담일 60일 넘음 = 장기 미결 · 60일까지는 진행 중 · 오늘 이후 다음 상담일이 있으면 진행 중", () => {
    expect(isLongOpen({ outcome: "consulted", consultedOn: "2026-08-24", followUpDate: null }, TODAY)).toBe(false); // 60일째
    expect(isLongOpen({ outcome: "consulted", consultedOn: "2026-08-23", followUpDate: null }, TODAY)).toBe(true); // 61일째
    expect(isLongOpen({ outcome: "pending", consultedOn: "2025-01-01", followUpDate: null }, TODAY)).toBe(true);
    expect(isLongOpen({ outcome: "ai_done", consultedOn: "2025-01-01", followUpDate: TODAY }, TODAY)).toBe(false);
    expect(isLongOpen({ outcome: "consulted", consultedOn: "2025-01-01", followUpDate: "2026-10-22" }, TODAY)).toBe(true); // 지난 다음 상담일
    expect(isLongOpen({ outcome: "enrolled", consultedOn: "2025-01-01", followUpDate: null }, TODAY)).toBe(false);
    expect(isLongOpen({ outcome: "no_show", consultedOn: "2025-01-01", followUpDate: null }, TODAY)).toBe(false);
  });
  it("장기 미결도 완료율 분모에 남는다 · 등록 셈은 상태 그대로", () => {
    const sheet = buildManagementSheet(
      [
        row({ month: "2026-05", outcome: "consulted", consultedOn: "2026-05-02" }),
        row({ month: "2026-05", outcome: "consulted", consultedOn: "2026-05-03", followUpDate: "2026-10-30" }),
        row({ month: "2026-05", outcome: "enrolled", consultedOn: "2026-05-04" }),
      ],
      groupsOf,
      { today: TODAY, attending: null },
    );
    expect(sheet.total.all).toMatchObject({ total: 3, enrolled: 1, open: 1, longOpen: 1 });
    expect(completionRate(sheet.total.all)).toBe(33);
  });
});

describe("관리현황 — 지금 재원(사람 단위 · 원생목록 재원 판정을 호출부가 넘긴다)", () => {
  const rows = [
    row({ month: "2026-09", subject: "수학", outcome: "enrolled", studentId: "s1" }),
    row({ month: "2026-09", subject: "영어", outcome: "enrolled", studentId: "s1" }), // 같은 학생 두 과목
    row({ month: "2026-09", subject: "영어 수학", outcome: "enrolled", studentId: "s2" }),
    row({ month: "2026-10", subject: "수학", outcome: "enrolled", studentId: "s1" }), // 다음 달에 또 상담
    row({ month: "2026-10", subject: "수학", outcome: "enrolled", studentId: null }), // 원생 미연결
    row({ month: "2026-10", subject: "수학", outcome: "consulted", studentId: "s3" }), // 등록 아님
  ];
  // s1 = 수학만 다님 · s2 = 영어만 다님 · s3 = 수학 다님(등록 상담이 아니라 안 센다)
  const attendsIn: Record<string, string[]> = { s1: ["math"], s2: ["english"], s3: ["math"] };
  const calls: [string[], string | null][] = [];
  const attending = (ids: readonly string[], group: string | null) => {
    calls.push([[...ids].sort(), group]);
    return ids.filter((id) => (group ? attendsIn[id]?.includes(group) : (attendsIn[id]?.length ?? 0) > 0)).length;
  };
  const sheet = buildManagementSheet(rows, groupsOf, { today: TODAY, attending });

  it("묶음 재원 = 그 묶음 등록 상담 학생 중 그 묶음 반에 다니는 사람 · 전체 = 어느 반이든", () => {
    const sep = sheet.months.find((m) => m.month === "2026-09")!;
    expect(sep.groups.math!.attending).toBe(1); // s1(s2는 영어만)
    expect(sep.groups.english!.attending).toBe(1); // s2(s1은 수학만)
    expect(sep.all.attending).toBe(2);
    expect(sep.all.enrolled).toBe(3); // '등록'은 상담 건수 그대로
  });
  it("기간 합계는 달별 인원을 더하지 않고 다시 센다(s1이 두 달에 걸쳐도 한 명)", () => {
    expect(sheet.total.groups.math!.attending).toBe(1);
    expect(sheet.total.all.attending).toBe(2);
    expect(calls).toContainEqual([["s1", "s2"], "math"]);
  });
  it("원생이 이어진 등록 L건 · 재원을 못 읽으면 null(0으로 적지 않는다)", () => {
    expect(sheet.linked).toBe(4);
    expect(sheet.total.all.enrolled).toBe(5);
    expect(buildManagementSheet(rows, groupsOf, { today: TODAY, attending: null }).total.all.attending).toBeNull();
    expect(sheet.asOf).toBe(TODAY);
  });
});

describe("관리현황 — 등록 후 퇴원(퇴원관리와 같은 목록에서 · 지금 퇴원 상태인 학생)", () => {
  it("상담 뒤 퇴원만 · 그 달은 학생 단위 · 합계도 학생 단위", () => {
    const exits = buildManagementExits(
      [
        { month: "2026-03", studentId: "s1", consultedOn: "2026-03-05" },
        { month: "2026-03", studentId: "s1", consultedOn: "2026-03-20" }, // 같은 학생 두 과목
        { month: "2026-04", studentId: "s1", consultedOn: "2026-04-02" },
        { month: "2026-04", studentId: "s2", consultedOn: "2026-04-10" }, // 상담 전에 퇴원한 기록
        { month: "2026-04", studentId: "s3", consultedOn: "2026-04-11" }, // 퇴원 안 함
      ],
      [
        { id: "s1", name: "가", withdrawnAt: "2026-08-31" },
        { id: "s2", name: "나", withdrawnAt: "2026-01-15" },
      ],
    );
    expect(exits.byMonth["2026-03"]).toEqual([{ id: "s1", name: "가", withdrawnAt: "2026-08-31" }]);
    expect(exits.byMonth["2026-04"]?.map((s) => s.id)).toEqual(["s1"]);
    expect(exits.total.map((s) => s.id)).toEqual(["s1"]);
    expect(exits.linked).toBe(5);
  });
});
