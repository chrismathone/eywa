import { describe, expect, it } from "vitest";
import { tipText } from "@/components/hover-tip/tip";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { RichCardGroupBoard } from "./rich-card-group";
import { TimetableEditContext, useTimetableEdit, type IncomingStudent } from "./edit-context";
import { buildRichCardGroups, type GridSlot } from "@/features/timetable/lib/class-grid";
import { CLASS_CELL_ID_ATTR } from "@/features/timetable/lib/grid-attrs";
import { DEFAULT_PERIODS_CONFIG, type PeriodsConfig } from "@/features/timetable/lib/periods";
import type { SeatPinRow } from "@/features/timetable/lib/seat-pin-mark";
import { buildVirtualLabs, type SeatLiveSlot } from "@/features/timetable/lib/virtual-lab";

/**
 * 통합뷰 카드의 **\*LAB 임시 칸** 그리기(원장 2026-09-11) — 판정은 순수 테스트(`virtual-lab.test.ts`)가 잡는다.
 * 여기는 "어디에·어떻게 그려지나": 격자 안 / **그 카드에만** 더한 행 / 대기·퇴원 줄이 라벨열과 어긋나지 않음 /
 * 명단·인원 불변 / 배치 편집엔 없음.
 * 기준 = 목요일 2026-09-10, LE1 목 15:00 원어민 · 15:40 LAB · 16:20 원어민, 이현이가 17:00 랩실로 상시 고정.
 */
const REF = "2026-09-10";
const C = DEFAULT_PERIODS_CONFIG;
/** 통합뷰 교시 한 행의 높이(rich-card-group `PERIOD_H`). */
const PERIOD_H = 32;

const stu = (studentId: string, name: string) => ({
  studentId,
  name,
  grade: "중1",
  school: "경명여중",
  status: "active" as const,
  enrollmentDate: "2026-03-02",
  attendanceDays: [] as string[],
});
const STUDENTS = [stu("s1", "이현이"), stu("s2", "송하늘"), stu("s3", "박바다")];

const slot = (classId: string, start: string, end: string, label: string, students: ReturnType<typeof stu>[]) => ({
  id: `${classId}-thu-${start}`,
  classId,
  className: classId,
  subject: "english",
  dayOfWeek: "thu",
  startTime: `${start}:00`,
  endTime: `${end}:00`,
  teacherName: "송지혜",
  classroomName: "본원601",
  slotTeacherLabel: label,
  slotRoomLabel: null,
  classBgColor: null,
  classTextColor: null,
  students,
});

const LE1 = [
  slot("LE1", "15:00", "15:40", "Daniella", STUDENTS),
  slot("LE1", "15:40", "16:20", "LAB", STUDENTS),
  slot("LE1", "16:20", "17:00", "Daniella", STUDENTS),
];
/** 같은 줄(15:00 시작)에 17:00 수업이 있는 반 — 이 반이 있으면 섹션에 17:00 행이 선다. */
const X = [slot("X", "15:00", "15:40", "홍길동", []), slot("X", "17:00", "17:40", "홍길동", [])];

const LIVE: SeatLiveSlot[] = ["14:20", "15:00", "15:40", "16:20", "17:00", "17:40"].map((s) => {
  const [h, m] = s.split(":").map(Number);
  const endMin = h! * 60 + m! + 40;
  const end = `${String(Math.floor(endMin / 60)).padStart(2, "0")}:${String(endMin % 60).padStart(2, "0")}`;
  return { dayOfWeek: "thu", startTime: `${s}:00`, endTime: `${end}:00`, slotTeacherLabel: "LAB" };
});

const PIN: SeatPinRow = {
  seat: "lab",
  dayOfWeek: "thu",
  classId: "LE1",
  studentId: "s1",
  slotStart: "17:00",
  effectiveFrom: "2026-09-01",
};

/** 재원 칸 한 줄 높이·상하 여백(rich-card-group `STU_H`·`SECTION_PAD`). */
const STU_H = 26;
const SECTION_PAD = 8;

/**
 * 40분(EiE)·60분(인재원) 교시가 섞인 영어 교시표 — 실제 학원설정 모양(`subjects[].weekdayPeriods`).
 * 한 줄에 두 체계의 반이 서면 60분 행(16:00~17:00)은 40분 눈금에 **접혀 감춰진다**(row-span `rowPlan.hidden`).
 */
const MIXED: PeriodsConfig = {
  ...C,
  weekdayBySubject: {
    english: {
      "1": { startTime: "14:20", endTime: "15:00" },
      "2": { startTime: "15:00", endTime: "15:40" },
      "3": { startTime: "15:40", endTime: "16:20" },
      "4": { startTime: "16:20", endTime: "17:00" },
      "5": { startTime: "17:00", endTime: "17:40" },
      "6": { startTime: "15:00", endTime: "16:00" },
      "7": { startTime: "16:00", endTime: "17:00" },
    },
  },
};

/** 편집 컨텍스트에 **전입 예정 미리보기만** 얹는다(나머지는 기본값 그대로). */
function WithIncoming({ incoming, children }: { incoming: Map<string, IncomingStudent[]>; children: ReactNode }) {
  const base = useTimetableEdit();
  return (
    <TimetableEditContext.Provider value={{ ...base, incomingByClass: incoming }}>{children}</TimetableEditContext.Provider>
  );
}

function setup(
  slots: ReturnType<typeof slot>[],
  opts: {
    hideStudents?: boolean;
    namesOnly?: boolean;
    withLabs?: boolean;
    config?: PeriodsConfig;
    live?: SeatLiveSlot[];
    pin?: SeatPinRow;
    incoming?: Map<string, IncomingStudent[]>;
  } = {},
) {
  const config = opts.config ?? C;
  const group = buildRichCardGroups(slots as unknown as GridSlot[], config)[0]!;
  const virtualLabs =
    opts.withLabs === false
      ? undefined
      : buildVirtualLabs({
          slots,
          pins: [opts.pin ?? PIN],
          moves: [],
          live: opts.live ?? LIVE,
          referenceDate: REF,
          subject: "english",
          config,
        });
  const board = (
    <RichCardGroupBoard
      group={group}
      subjectSoftClass="bg-rose-soft"
      teacherColors={{}}
      virtualLabs={virtualLabs}
      hideStudents={opts.hideStudents}
      namesOnly={opts.namesOnly}
    />
  );
  const r = render(opts.incoming ? <WithIncoming incoming={opts.incoming}>{board}</WithIncoming> : board);
  return { ...r, group, virtualLabs };
}

/** 좌측 라벨열(sticky)에서 그 글자의 칸. */
const railCell = (container: HTMLElement, text: string) => {
  const rail = container.querySelector<HTMLElement>(".sticky")!;
  return [...rail.children].find((c) => c.textContent === text) as HTMLElement;
};

describe("통합뷰 카드 — *LAB 임시 칸 그리기", () => {
  it("섹션에 그 교시 행이 있으면 **그 칸**에 `*LAB` — 점선·이탤릭, 툴팁이 누가·하루/상시를 말한다", () => {
    const { container } = setup([...LE1, ...X]);
    const marks = container.querySelectorAll<HTMLElement>("[data-virtual-lab]");
    expect(marks).toHaveLength(1);
    expect(marks[0]!.textContent).toBe("*LAB");
    expect(tipText(marks[0]!.getAttribute("data-tip"))).toBe("임시 LAB · 목 17:00 — 교시 이동: 이현이(9/1부터 매주 목 고정)");
    expect(marks[0]!.className).toContain("outline-dashed");
    expect(marks[0]!.className).toContain("italic");
    expect(container.querySelector("[data-virtual-lab-row]")).toBeNull();
    // 격자 안에 앉았으면 빌린 높이가 없다 — 재원 칸이 라벨열과 같다.
    const active = container.querySelectorAll<HTMLElement>(".scrollbar-hide")[0]!;
    expect(active.style.height).toBe(railCell(container, "재원").style.height);
  });

  it("🔴 행이 없으면 **그 카드에만** 행을 더하고 칸이 제 시각을 적는다 — 높이는 재원 칸 남는 자리에서 빌려 대기·퇴원 줄이 라벨열과 맞는다", () => {
    const { container, group } = setup(LE1);
    const rows = container.querySelectorAll("[data-virtual-lab-row]");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toBe("*LAB17:00");
    // 섹션 교시축은 그대로 — 라벨열 교시 칸 수가 늘지 않았다.
    expect(group.periodRows.map((r) => r.time)).not.toContain("17:00~17:40");
    const sections = container.querySelectorAll<HTMLElement>(".scrollbar-hide");
    expect(parseFloat(sections[0]!.style.height)).toBe(parseFloat(railCell(container, "재원").style.height) - PERIOD_H);
    expect(sections[1]!.style.height).toBe(railCell(container, "대기").style.height);
    expect(sections[2]!.style.height).toBe(railCell(container, "퇴원").style.height);
  });

  it("🔴 같은 줄 **옆 카드**엔 행이 안 생긴다 — 추가 행은 보드 전체에 하나(LE1), 옆 카드 재원 칸·라벨열 교시 칸 수 그대로", () => {
    // Y는 LE1과 같은 줄(15:00 시작)에 서지만 17:00 수업이 없다 → 섹션 교시축에 17:00 행이 없어 LE1만 추가 행이 필요하다.
    const Y = [slot("Y", "15:00", "15:40", "홍길동", [stu("y1", "최옆반")])];
    const railCount = (c: HTMLElement) => c.querySelector<HTMLElement>(".sticky")!.children.length;
    const without = setup([...LE1, ...Y], { withLabs: false });
    const railBefore = railCount(without.container);
    without.unmount();

    const { container, group } = setup([...LE1, ...Y]);
    // 전제: 두 반이 **한 줄**(같은 섹션)이다 — 아니면 이 테스트는 아무것도 증명하지 않는다.
    expect(group.cards.map((c) => c.classId).sort()).toEqual(["LE1", "Y"]);
    const rows = container.querySelectorAll("[data-virtual-lab-row]");
    expect(rows, "추가 행은 보드 전체에 하나뿐(그 카드에만)").toHaveLength(1);
    expect(rows[0]!.closest(`[${CLASS_CELL_ID_ATTR}]`)?.getAttribute(CLASS_CELL_ID_ATTR)).toBe("LE1");
    const yCard = container.querySelector<HTMLElement>(`[${CLASS_CELL_ID_ATTR}="Y"]`)!;
    expect(yCard.querySelector("[data-virtual-lab]")).toBeNull();
    const yActive = yCard.querySelectorAll<HTMLElement>(".scrollbar-hide")[0]!;
    expect(yActive.style.height, "옆 카드 재원 칸은 높이를 빌려 준 적이 없다").toBe(railCell(container, "재원").style.height);
    expect(railCount(container), "라벨열 교시 칸 수가 늘지 않았다").toBe(railBefore);
  });

  it("*LAB이 있어도 명단(누가·몇 명)은 한 글자도 안 바뀐다", () => {
    const names = (el: HTMLElement) =>
      [...el.querySelectorAll("a[href^='/students/']")].map((a) => a.textContent ?? "");
    const without = setup(LE1, { withLabs: false });
    expect(without.container.querySelector("[data-virtual-lab]")).toBeNull();
    const before = names(without.container);
    without.unmount();
    const withLabs = setup(LE1);
    expect(names(withLabs.container)).toEqual(before);
    expect(before).toHaveLength(3);
  });

  it("명단 접기 — 빌릴 재원 칸이 없어도 행은 선다(그 카드만 길어진다) · 헤더 인원 그대로", () => {
    const { container } = setup(LE1, { hideStudents: true });
    expect(container.querySelectorAll("[data-virtual-lab-row]")).toHaveLength(1);
    expect(container.querySelectorAll(".scrollbar-hide")).toHaveLength(0);
    expect(container.textContent).toContain("· 3");
  });

  it("배치 편집(수업명만)엔 그리지 않는다", () => {
    const { container } = setup(LE1, { namesOnly: true });
    expect(container.querySelector("[data-virtual-lab]")).toBeNull();
    expect(container.querySelector("[data-virtual-lab-row]")).toBeNull();
  });

  it("🔴 40·60분이 섞여 **접혀 감춘 행**에 앉을 *LAB도 보인다 — 자리는 화면이 실제로 그리는 행으로 정한다", () => {
    // X가 16:00~17:00(60분)을 써서 섹션 축에 그 행이 서지만, 15:40~16:20 + 16:20~17:00(40분)에 덮여 접힌다.
    const slots = [...LE1, slot("X", "15:00", "15:40", "홍길동", []), slot("X", "16:00", "17:00", "홍길동", [])];
    const live: SeatLiveSlot[] = [
      ...LIVE,
      { dayOfWeek: "thu", startTime: "16:00:00", endTime: "17:00:00", slotTeacherLabel: "LAB" },
    ];
    const { container, group, virtualLabs } = setup(slots, { config: MIXED, live, pin: { ...PIN, slotStart: "16:00" } });
    const lab = virtualLabs!.LE1![0]!;
    // 전제: 그 *LAB의 교시 행은 섹션 교시축에 **있지만 접혀 안 그려진다**.
    expect(group.periodRows.map((r) => r.order)).toContain(lab.order);
    expect(group.rowPlan?.hidden).toContain(lab.order);
    const marks = container.querySelectorAll<HTMLElement>("[data-virtual-lab]");
    expect(marks, "감춘 행에 앉힌 *LAB이 아무 데도 안 그려졌다").toHaveLength(1);
    expect(marks[0]!.closest("[data-virtual-lab-row]")?.textContent).toBe("*LAB16:00");
  });

  it("🔴 전입 예정 줄이 있는 카드는 그 줄까지 명단으로 세고 빌린다 — 미리보기가 페이드 아래로 숨지 않는다", () => {
    // 재원 10명(섹션 최소 행 수와 같다) + 전입 1 → 섹션은 11줄로 자라고 남는 자리가 0이라 빌릴 게 없다.
    const ten = [stu("s1", "이현이"), ...Array.from({ length: 9 }, (_, i) => stu(`k${i}`, `학생${i}`))];
    const incoming = new Map<string, IncomingStudent[]>([
      [
        "LE1",
        [{ enrollmentId: "e-in", name: "전입생", fromClassName: "LE2", applyOn: null, landsInHold: false, scheduled: false }],
      ],
    ]);
    const { container } = setup(
      LE1.map((s) => ({ ...s, students: ten })),
      { incoming },
    );
    expect(container.querySelectorAll("[data-virtual-lab-row]")).toHaveLength(1);
    expect(container.textContent).toContain("← 전입생");
    const active = container.querySelectorAll<HTMLElement>(".scrollbar-hide")[0]!;
    expect(parseFloat(active.style.height)).toBeGreaterThanOrEqual(SECTION_PAD + (10 + 1) * STU_H);
  });
});
