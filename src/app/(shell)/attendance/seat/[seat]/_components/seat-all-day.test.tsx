import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SeatClassRoster } from "@/features/attendance/seat/server/queries";
import { SEAT_PERIOD_CLASS_BUSY, SEAT_PERIOD_SAME } from "@/features/attendance/seat/period-choice";
import { SEAT_DROP_GUIDE } from "@/features/attendance/seat/drop-verdict";
import { SeatAllDay, type SeatAllDayPeriod, type SeatChoiceDay } from "./seat-all-day";
import { resetSeatPinStoreForTests } from "./seat-pin-ask";

/**
 * 랩실 로그인 자리 출석부 — **다른 시간으로 끌기**(원장 2026-09-11 *"LAB실에서 내가 드래그하고 싶은건, '다른 시간대'의
 * 수업임. 같은 시간대의 수업으로 옮기고 싶은게 아니야."* · *"아니 드래그는 '전체' 에서도 다른 시간으로 이동하려고하면 경고
 * 문구 뜨면서 안됨"*).
 *
 * 순수 판정은 `drop-verdict.test.ts`가 잡는다. 여기는 **배선이 실제로 도는지**를 본다(가드는 글자만 본다):
 * 집는 순간 놓을 곳(교시 칩 · '전체' 보기의 교시 판)마다 가부가 칠해지는가 · 끄는 카드 아래 문장이 포인터 아래 판정과
 * 같은가 · 되는 곳에 놓으면 서버 액션이 그 교시로 불리는가 · 막힌 곳이면 안 불리고 같은 문장이 뜨는가 · 스크롤로 가려진
 * 판이 칩 줄에서 잡히지 않는가 · 거절된 이동에 고정을 묻지 않는가 · 새 서버 줄이 오면 낙관 반영을 걷는가 · 끄는 동안
 * 다른 카드 본문을 다시 그리지 않는가.
 * 드래그는 합성 PointerEvent(dnd-kit `PointerSensor` 그대로)로, 놓을 곳 좌표는 `getBoundingClientRect` 가짜로 준다.
 */

const h = vi.hoisted(() => ({
  moveSeatStudentPeriod: vi.fn(),
  clearSeatPeriodChoices: vi.fn(),
  refresh: vi.fn(),
  /** 출결 세 버튼이 그려진 학생 이름 — 카드 본문이 다시 그려졌는지 세는 재료. */
  triad: [] as string[],
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ref,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    ref?: React.Ref<HTMLAnchorElement>;
  }) => (
    <a href={href} ref={ref} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: h.refresh }) }));
vi.mock("@/features/attendance/seat/server/period-actions", () => ({
  moveSeatStudentPeriod: h.moveSeatStudentPeriod,
  clearSeatPeriodChoices: h.clearSeatPeriodChoices,
}));
vi.mock("@/features/attendance/seat/server/placement-actions", () => ({ resetSeatPlacements: vi.fn() }));
vi.mock("@/features/attendance/seat/server/actions", () => ({
  setSeatCell: vi.fn(),
  fillSeatSlot: vi.fn(),
  fillSeatPrevAbsent: vi.fn(),
}));
vi.mock("@/features/attendance/seat/server/mark-actions", () => ({ setSeatJjField: vi.fn() }));
vi.mock("./seat-mark-extras", async (importOriginal) => {
  const real = await importOriginal<typeof import("./seat-mark-extras")>();
  return {
    ...real,
    SeatMarkTriad: (p: Parameters<typeof real.SeatMarkTriad>[0]) => {
      h.triad.push(p.studentName);
      return real.SeatMarkTriad(p);
    },
  };
});

const DATE = "2026-09-11";
const HREF = `/attendance/seat/lab?date=${DATE}&start=`;
const student = (id: string, name: string): SeatClassRoster["students"][number] => ({
  id,
  name,
  school: null,
  grade: null,
  status: null,
  recordedBy: null,
  fromSeat: false,
  note: null,
  attitude: null,
  listeningLevel: null,
  memorizedWords: null,
  progressNote: null,
});
const period = (start: string, end: string, classId: string, name: string): SeatAllDayPeriod => ({
  start,
  ends: [end],
  classIds: [classId],
  rosters: [
    { classId, className: classId, end, bgColor: null, textColor: null, students: [student(`s-${classId}`, name)] },
  ],
  placements: [],
});

/** 금 랩실(실측 모양) — 이도윤B(PL1b 15:00)는 14:20에 제 반 정규 수업, 16:20~17:15에 수학이 있다. */
const PERIODS: SeatAllDayPeriod[] = [
  period("14:20", "15:00", "LS4a", "임시연"),
  period("15:00", "15:40", "PL1b", "이도윤B"),
  period("15:40", "16:20", "LE1", "박한솔"),
  period("16:20", "17:00", "JP3", "최지우"),
];
const CHOICE_DAY: SeatChoiceDay = {
  moves: [],
  pins: [],
  slotsByClass: { LS4a: ["14:20"], PL1b: ["15:00"], LE1: ["15:40"], JP3: ["16:20"] },
  markedSlotsByCell: {},
  busyStartsByClass: { PL1b: ["14:20"] },
  offSlotByCell: {},
  studentClasses: {
    "s-PL1b": [
      { classId: "EL2S", className: "초등M 초4 EL2S", start: "16:20", end: "17:15", room: "본원205", seatLabel: null },
    ],
  },
};
const DOYUN_MATH =
  "그 시각에 이 학생의 다른 수업(초등M 초4 EL2S 16:20~17:15)이 있습니다 — 겹치는 시간으로는 옮길 수 없습니다";
/** 학생 축 재료가 없는 날(페이지 조회 실패 = 화면 fail-open) — 화면은 통과시키고 서버가 수학 겹침을 잡는다. */
const OPEN_DAY: SeatChoiceDay = { ...CHOICE_DAY, studentClasses: {} };
/** 서버가 받아 준 15:40 이동 — 성공 뒤 새로고침으로 오는 새 줄. */
const MOVED_1540 = { classId: "PL1b", studentId: "s-PL1b", slotStart: "15:40" };
const NEXT_DATE = "2026-09-12";
/** PL1b 15:00 묶음에 학생이 **둘** — 같은 반 두 학생이 서로의 질문·호출을 삼키지 않는지 보는 재료. */
const PAIR_PERIODS: SeatAllDayPeriod[] = PERIODS.map((p) =>
  p.start === "15:00"
    ? { ...p, rosters: [{ ...p.rosters[0]!, students: [student("s-PL1b", "이도윤B"), student("s-PL1b2", "김서준")] }] }
    : p,
);

/** 화면 한 장의 props — 테스트마다 보기·재료만 바꾼다(다시 그리기에도 같은 모양). */
function props(
  o: {
    canMove?: boolean;
    shownStart?: string | null;
    choiceDay?: SeatChoiceDay;
    date?: string;
    periods?: SeatAllDayPeriod[];
  } = {},
) {
  return {
    seat: "lab" as const,
    date: o.date ?? DATE,
    choiceDay: o.choiceDay ?? CHOICE_DAY,
    canMove: o.canMove ?? true,
    periods: o.periods ?? PERIODS,
    shownStart: o.shownStart === undefined ? "15:00" : o.shownStart,
    showAll: true,
    readOnly: false,
    hrefFor: HREF,
    canMovePlacement: true,
    placementNotice: null,
  };
}
function renderDay(o: Parameters<typeof props>[0] = {}) {
  return render(<SeatAllDay {...props(o)} />);
}

/**
 * 놓을 곳 좌표 — 칩은 윗줄(y 0~30)에 100px 간격, 판 상자(`data-seat-boards`)는 그 아래(y 100~600).
 * 교시 판 사각형은 `zones`로 테스트가 정한다(비어 있으면 교시 하나 보기처럼 판 하나가 상자를 가득 채운다).
 */
const CHIP_X: Record<string, number> = { "14:20": 0, "15:00": 100, "15:40": 200, "16:20": 300 };
function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON: () => ({}) };
}
let zones: Record<string, DOMRect> = {};
/** '전체' 보기 — 위에서부터 차례로(16:20 판은 상자 아래로 넘친다). */
const STACKED: Record<string, DOMRect> = {
  "14:20": rect(0, 100, 1000, 140),
  "15:00": rect(0, 250, 1000, 140),
  "15:40": rect(0, 400, 1000, 140),
  "16:20": rect(0, 550, 1000, 140),
};
/**
 * '전체' 보기를 내려 15:40 판이 상자 맨 위에 선 모습 — 14:20·15:00 판은 위로 스크롤돼 **안 보이는데**, dnd-kit 사각형은
 * 스크롤만 보정하고 가려진 부분을 자르지 않아 15:00 판(y -40~90)이 칩 줄(y 0~30)을 그대로 덮는다.
 */
const SCROLLED: Record<string, DOMRect> = {
  "14:20": rect(0, -190, 1000, 140),
  "15:00": rect(0, -40, 1000, 130),
  "15:40": rect(0, 100, 1000, 140),
  "16:20": rect(0, 250, 1000, 140),
};

function pointer(type: string, x: number, y: number): Event {
  const Ctor = (globalThis as { PointerEvent?: typeof MouseEvent }).PointerEvent ?? MouseEvent;
  const ev = new Ctor(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperty(ev, "isPrimary", { value: true });
  return ev;
}
/** dnd-kit은 측정·충돌을 다음 틱에 한다 — 한 틱에 재면 옛 값을 본다([[#98]]). */
async function settle(ms = 20) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}
/**
 * dnd-kit(6.3.1)은 끌기가 시작되면 document에 **click을 캡처 단계에서 막는** 리스너를 걸고, 놓은 뒤 **50ms가 지나야**
 * 뗀다(`AbstractPointerSensor.detach` → `setTimeout(documentListeners.removeAll, 50)` — 놓은 직후의 클릭이 링크를
 * 누르지 않게). 그 안에 누른 버튼은 React까지 안 간다 — 놓고 곧바로 '앞으로도 고정'을 누르던 테스트가 "안 눌린 것"으로
 * 헛실패했고('오늘만'도 이 경계에 걸려 운으로 통과하고 있었다), 그래서 `drop()`이 이 막이가 떨어질 때까지 기다린다.
 * 사람 손은 그렇게 빠르지 않다(창도 서버 왕복 뒤에 뜬다).
 */
const DND_CLICK_GUARD_MS = 50;
async function move(x: number, y: number) {
  await act(async () => {
    document.dispatchEvent(pointer("pointermove", x, y));
  });
  await settle();
}
/** 그 학생 카드를 집는다 — `at`에서 누르고 문턱(5px) 너머로 한 번 민다. */
async function pickUp(name: string, at: { x: number; y: number }) {
  const handle = screen.getByText(name).closest<HTMLElement>('[aria-roledescription="draggable"]');
  expect(handle).not.toBeNull();
  await act(async () => {
    handle!.dispatchEvent(pointer("pointerdown", at.x, at.y));
  });
  await move(at.x + 6, at.y + 8);
}
/** 교시 하나 보기(15:00) — 판(15:00) 위에서 집는다. */
const pickUpDoyun = () => pickUp("이도윤B", { x: 20, y: 120 });
async function drop(x: number, y: number) {
  await move(x, y);
  await act(async () => {
    document.dispatchEvent(pointer("pointerup", x, y));
  });
  // 놓은 뒤 누르는 버튼이 삼켜지지 않게 — dnd-kit의 클릭 막이가 떨어질 때까지(`DND_CLICK_GUARD_MS`).
  await settle(DND_CLICK_GUARD_MS + 10);
}
/** 서버 응답을 테스트가 원하는 순간에 돌려준다 — 왕복 **사이**에 벌어지는 일을 재현하는 재료. */
type MoveResult = { ok: true; pinned: boolean } | { error: string };
function deferred() {
  let resolve!: (v: MoveResult) => void;
  const promise = new Promise<MoveResult>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const chip = (start: string) => document.querySelector<HTMLElement>(`a[data-seat-drop-start="${start}"]`)!;
const zone = (start: string) => document.querySelector<HTMLElement>(`div[data-seat-drop-start="${start}"]`)!;
const errorLine = () => document.querySelector('p[role="status"]');

beforeEach(() => {
  zones = {};
  h.triad.length = 0;
  // 질문·호출 장부는 문서 하나에 한 벌(가게)이라 테스트 사이에 남는다 — 빈 가게로 시작한다.
  resetSeatPinStoreForTests();
  h.moveSeatStudentPeriod.mockResolvedValue({ ok: true, pinned: false });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const start = this.getAttribute("data-seat-drop-start");
    if (start && this.tagName === "A") return rect(CHIP_X[start] ?? -1000, 0, 90, 30);
    if (start) return zones[start] ?? rect(0, 100, 1000, 500);
    if (this.hasAttribute("data-seat-boards")) return rect(0, 100, 1000, 500);
    if (this.getAttribute("aria-roledescription") === "draggable") return rect(10, 110, 150, 60);
    return rect(0, 0, 0, 0);
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  h.moveSeatStudentPeriod.mockReset();
  h.clearSeatPeriodChoices.mockReset();
  h.refresh.mockReset();
});

describe("'교시 하나' 보기 — 다른 시간으로 끌기(원장 2026-09-11)", () => {
  it("보이는 교시 하나만 그리고, 교시 칩이 놓을 곳이 된다(평소엔 아무 표식도 없다)", () => {
    renderDay();
    expect(screen.getByText("이도윤B")).toBeTruthy();
    expect(screen.queryByText("박한솔")).toBeNull();
    for (const start of Object.keys(CHIP_X)) expect(chip(start).getAttribute("href")).toBe(`${HREF}${start}`);
    expect(document.querySelector("[data-drag-blocked]")).toBeNull();
  });

  it("🔴 집는 순간 칩마다 가부가 칠해진다 — 되는 곳(15:40) · 반 축(14:20)·학생 축(16:20) 빗금 · 제자리(15:00) 빗금 없음", async () => {
    renderDay();
    await pickUpDoyun();
    expect(chip("15:40").getAttribute("data-seat-drop")).toBe("ok");
    expect(chip("15:40").hasAttribute("data-drag-blocked")).toBe(false);
    expect(chip("14:20").getAttribute("data-drag-blocked")).toBe("1");
    expect(chip("16:20").getAttribute("data-drag-blocked")).toBe("1");
    expect(chip("15:00").getAttribute("data-seat-drop")).toBe("same");
    expect(chip("15:00").hasAttribute("data-drag-blocked")).toBe(false);
    // 제자리(15:00) 판엔 **그 판 안에** 안내 알약 · 끄는 카드 아래엔 포인터 아래(= 그 판) 판정 그대로 — 둘 다 선다.
    expect(within(zone("15:00")).getByText(SEAT_PERIOD_SAME)).toBeTruthy();
    expect(screen.getAllByText(SEAT_PERIOD_SAME)).toHaveLength(2);
    await drop(26, 128);
  });

  it("🔑 되는 칩(15:40)에 놓으면 그 교시로 옮기고, 서버가 받아 준 뒤 고정을 묻는다", async () => {
    renderDay();
    await pickUpDoyun();
    await move(230, 15);
    expect(screen.getByText("15:40 수업으로 옮기기")).toBeTruthy();
    await drop(230, 15);
    expect(h.moveSeatStudentPeriod).toHaveBeenCalledWith({
      seat: "lab",
      date: DATE,
      studentId: "s-PL1b",
      classId: "PL1b",
      fromSlot: "15:00",
      toSlot: "15:40",
      pin: false,
    });
    expect(screen.getByText("다음에도 이 자리 수업을 15:40로 고정할까요?")).toBeTruthy();
    // 낙관 반영 — 이 교시(15:00)에서 빠진다.
    expect(screen.queryByText("이도윤B")).toBeNull();
    expect(document.querySelector("[data-drag-blocked]")).toBeNull();
  });

  it("🔑 '앞으로도 고정'을 누르면 같은 이동을 `pin: true`로 보내고, 서버가 받아 준 뒤에도 창이 다시 뜨지 않는다", async () => {
    h.moveSeatStudentPeriod
      .mockResolvedValueOnce({ ok: true, pinned: false })
      .mockResolvedValueOnce({ ok: true, pinned: true });
    renderDay();
    await pickUpDoyun();
    await drop(230, 15);
    const pin = screen.getByRole("button", { name: "앞으로도 고정" }) as HTMLButtonElement;
    expect(pin.disabled).toBe(false);
    await act(async () => {
      pin.click();
    });
    await settle();
    expect(h.moveSeatStudentPeriod).toHaveBeenCalledTimes(2);
    expect(h.moveSeatStudentPeriod).toHaveBeenNthCalledWith(2, {
      seat: "lab",
      date: DATE,
      studentId: "s-PL1b",
      classId: "PL1b",
      fromSlot: "15:00",
      toSlot: "15:40",
      pin: true,
    });
    // 🔴 고정 호출은 다시 묻지 않는다 — 되살아나면 누를 때마다 창이 돌아와 '오늘만'으로만 닫힌다.
    expect(screen.queryByText("다음에도 이 자리 수업을 15:40로 고정할까요?")).toBeNull();
    expect(h.refresh).toHaveBeenCalledTimes(2);
  });

  it("🔴 막힌 칩에 놓으면 서버에 안 가고, 끄는 동안 본 것과 같은 문장이 뜬다", async () => {
    renderDay();
    await pickUpDoyun();
    await move(330, 15);
    expect(screen.getByText(DOYUN_MATH)).toBeTruthy();
    await drop(330, 15);
    expect(h.moveSeatStudentPeriod).not.toHaveBeenCalled();
    // ⚠️ dnd-kit 알림 영역도 role="status"라 에러 줄은 `<p>`로 집는다.
    expect(errorLine()?.textContent).toBe(DOYUN_MATH);

    await pickUpDoyun();
    await drop(30, 15);
    expect(h.moveSeatStudentPeriod).not.toHaveBeenCalled();
    expect(errorLine()?.textContent).toBe(SEAT_PERIOD_CLASS_BUSY);
  });

  it("🔴 목표 교시 **안에서 시작하는** 수업도 칩에 빗금 — 교시 끝(`ends`)이 판정까지 간다", async () => {
    // 15:50에 시작하는 보충 — 15:40 교시(~16:20) 안에서 시작하고, 시작이 같지도 15:40을 품지도 않는다.
    const extra = { classId: "MX", className: "수학 보충", start: "15:50", end: "16:30", room: null, seatLabel: null };
    renderDay({ choiceDay: { ...CHOICE_DAY, studentClasses: { "s-PL1b": [extra] } } });
    await pickUpDoyun();
    expect(chip("15:40").getAttribute("data-drag-blocked")).toBe("1");
    await drop(26, 128);
    expect(h.moveSeatStudentPeriod).not.toHaveBeenCalled();
  });

  it("🔴 같은 시간(제자리)에 놓으면 아무 일도 없다 — 서버에도 안 가고 에러도 없다", async () => {
    renderDay();
    await pickUpDoyun();
    await drop(130, 15);
    expect(h.moveSeatStudentPeriod).not.toHaveBeenCalled();
    expect(errorLine()).toBeNull();
    expect(screen.getByText("이도윤B")).toBeTruthy();
  });

  it("🔴 서버가 거절하면 고정을 묻지 않는다 — '옮겼습니다' 창이 거짓이 되고 '앞으로도 고정'이 같은 이동을 다시 보낸다", async () => {
    const why = "그 사이 출결이 찍혀 옮기지 못했습니다";
    h.moveSeatStudentPeriod.mockResolvedValue({ error: why });
    renderDay();
    await pickUpDoyun();
    await drop(230, 15);
    expect(h.moveSeatStudentPeriod).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("다음에도 이 자리 수업을 15:40로 고정할까요?")).toBeNull();
    expect(errorLine()?.textContent).toBe(why);
    // 낙관 반영도 걷혔다 — 카드가 제 교시로 돌아온다.
    expect(screen.getByText("이도윤B")).toBeTruthy();
  });

  it("🔴 새 서버 줄이 오면 낙관 반영을 걷는다 — 다른 창이 푼 지정을 이 화면만 붙들지 않는다", async () => {
    const view = renderDay();
    await pickUpDoyun();
    await drop(230, 15);
    expect(screen.queryByText("이도윤B")).toBeNull();
    // 서버가 받아 준 뒤의 새 줄(그 이동이 실려 있다) — 여전히 15:40이다.
    const moved = { classId: "PL1b", studentId: "s-PL1b", slotStart: "15:40" };
    view.rerender(<SeatAllDay {...props({ choiceDay: { ...CHOICE_DAY, moves: [moved] } })} />);
    expect(screen.queryByText("이도윤B")).toBeNull();
    // 다른 창이 [교시 지정 해제]를 눌러 줄이 사라진 새 줄 — 이 화면도 제 교시로 돌아온다(일괄 버튼 N = 서버 명단).
    view.rerender(<SeatAllDay {...props({ choiceDay: { ...CHOICE_DAY, moves: [] } })} />);
    expect(screen.getByText("이도윤B")).toBeTruthy();
  });

  it("옮기기가 잠긴 화면(공개 PIN·지난 날짜)에선 카드가 안 잡히고 칩도 그냥 링크다", () => {
    renderDay({ canMove: false });
    expect(document.querySelector('[aria-roledescription="draggable"]')).toBeNull();
    expect(document.querySelector("a[data-seat-drop-start]")).toBeNull();
    expect(document.querySelector(`a[href="${HREF}15:40"]`)).not.toBeNull();
  });
});

describe("'전체' 보기 — 교시 판도 놓을 곳(원장 2026-09-11 *\"'전체' 에서도 … 경고 문구 뜨면서 안됨\"*)", () => {
  it("🔴 집는 순간 판마다 가부와 이유가 **그 판 안에** 선다 — 반 축·학생 축 빗금 · 되는 판 초록 · 제자리는 안내만", async () => {
    zones = STACKED;
    renderDay({ shownStart: null });
    await pickUp("이도윤B", { x: 20, y: 260 });
    expect(zone("14:20").getAttribute("data-drag-blocked")).toBe("1");
    expect(within(zone("14:20")).getByText(SEAT_PERIOD_CLASS_BUSY)).toBeTruthy();
    expect(zone("16:20").getAttribute("data-drag-blocked")).toBe("1");
    expect(within(zone("16:20")).getByText(DOYUN_MATH)).toBeTruthy();
    expect(zone("15:40").getAttribute("data-seat-drop")).toBe("ok");
    expect(zone("15:40").hasAttribute("data-drag-blocked")).toBe(false);
    expect(within(zone("15:40")).getByText("15:40 수업으로 옮기기")).toBeTruthy();
    expect(zone("15:00").getAttribute("data-seat-drop")).toBe("same");
    expect(zone("15:00").hasAttribute("data-drag-blocked")).toBe(false);
    expect(within(zone("15:00")).getByText(SEAT_PERIOD_SAME)).toBeTruthy();
    // 되는 판(15:40) 위에 놓으면 그 교시로 옮긴다.
    await drop(500, 450);
    expect(h.moveSeatStudentPeriod).toHaveBeenCalledWith(
      expect.objectContaining({ studentId: "s-PL1b", classId: "PL1b", fromSlot: "15:00", toSlot: "15:40", pin: false }),
    );
  });

  it("🔴 스크롤로 가려진 판은 칩 줄에서 잡히지 않는다 — 칩 사이 틈에 놓으면 아무 일도 없다(칩 위면 칩이 이긴다)", async () => {
    zones = SCROLLED;
    renderDay({ shownStart: null });
    await pickUp("박한솔", { x: 20, y: 150 }); // 15:40 판(상자 맨 위)
    // 칩 사이 틈(14:20 칩 0~90 · 15:00 칩 100~190) — 가려진 15:00 판의 사각형이 이 자리를 덮고 있다.
    await move(95, 15);
    expect(screen.getByText(SEAT_DROP_GUIDE)).toBeTruthy();
    await drop(95, 15);
    expect(h.moveSeatStudentPeriod).not.toHaveBeenCalled();
    expect(errorLine()).toBeNull();

    await pickUp("박한솔", { x: 20, y: 150 });
    await move(330, 15);
    // 16:20 판 안의 알약 + 끄는 카드 아래 문장 — 포인터 아래는 16:20 칩이다.
    expect(screen.getAllByText("16:20 수업으로 옮기기")).toHaveLength(2);
    await drop(330, 15);
    expect(h.moveSeatStudentPeriod).toHaveBeenCalledWith(
      expect.objectContaining({ studentId: "s-LE1", classId: "LE1", fromSlot: "15:40", toSlot: "16:20" }),
    );
  });

  it("🔴 고정 질문은 대기열 — 왕복 중에 끈 다음 카드의 질문이 앞 질문을 덮지 않고, 끄는 동안엔 창이 뜨지 않는다", async () => {
    // 적대 리뷰 2026-09-11: 창이 서버 응답 **뒤에** 뜨게 된 뒤로, 한 칸(ask)이면 ② 응답이 ① 질문을 덮어 ① 학생은 답을
    // 못 받았고, 창 문장이 읽던 사람 앞에서 ②로 바뀌어 '앞으로도 고정'이 엉뚱한 학생을 고정할 수 있었다.
    zones = STACKED;
    const first = deferred();
    const second = deferred();
    h.moveSeatStudentPeriod.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    renderDay({ shownStart: null });
    const askOf = (slot: string) => screen.queryByText(`다음에도 이 자리 수업을 ${slot}로 고정할까요?`);

    // ① 이도윤B → 15:40 칩(응답 전).
    await pickUp("이도윤B", { x: 20, y: 260 });
    await drop(230, 15);
    // ② 응답 전에 박한솔을 집는다 — 그 사이 ①의 응답이 와도 끄는 손 아래서 창이 튀어나오지 않는다.
    await pickUp("박한솔", { x: 20, y: 410 });
    await act(async () => {
      first.resolve({ ok: true, pinned: false });
    });
    await settle();
    expect(askOf("15:40")).toBeNull();
    // ③ 16:20 칩에 놓는다 — 이제 ①의 질문이 선다.
    await drop(330, 15);
    expect(h.moveSeatStudentPeriod).toHaveBeenCalledTimes(2);
    expect(askOf("15:40")).not.toBeNull();
    // ④ ②의 응답이 와도 창은 ①(이도윤B) 그대로다 — 한 칸이었을 땐 여기서 박한솔로 바뀌었다.
    await act(async () => {
      second.resolve({ ok: true, pinned: false });
    });
    await settle();
    expect(askOf("15:40")).not.toBeNull();
    expect(askOf("16:20")).toBeNull();
    expect(screen.getByText(/이도윤B 학생을 15:00 → 15:40로 옮겼습니다/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "앞으로도 고정" }) as HTMLButtonElement).disabled).toBe(false);
    // ⑤ 답하면 다음 질문이 선다 — 박한솔 16:20.
    await act(async () => {
      screen.getByRole("button", { name: "오늘만" }).click();
    });
    expect(askOf("15:40")).toBeNull();
    expect(askOf("16:20")).not.toBeNull();
    expect(screen.getByText(/박한솔 학생을 15:40 → 16:20로 옮겼습니다/)).toBeTruthy();
    await act(async () => {
      screen.getByRole("button", { name: "오늘만" }).click();
    });
    expect(askOf("16:20")).toBeNull();
    // '오늘만'은 서버에 아무것도 보내지 않는다.
    expect(h.moveSeatStudentPeriod).toHaveBeenCalledTimes(2);
  });

  /**
   * 대기열만으로는 부족했다(적대 리뷰 2026-09-11) — 응답 전에 그 학생을 **묻지 않는 이동**(고정된 제 교시로 되돌리기)으로
   * 또 옮기거나 그 반을 [해제]하면 새 질문이 옛 질문을 바꿔 주지 않아, "…15:40로 옮겼습니다" 창이 거짓인 채 섰다. 거기서
   * '앞으로도 고정'을 누르면 서버는 학생이 출발 교시(15:00)에 도로 서 있는 것을 보고 **진짜 이동**으로 받아, 방금 되돌린
   * 15:40 이동을 다시 하고 앞으로도 고정했다.
   */
  const PIN_HOME = { classId: "PL1b", studentId: "s-PL1b", slotStart: "15:00", effectiveFrom: DATE };
  const askAt1540 = () => screen.queryByText("다음에도 이 자리 수업을 15:40로 고정할까요?");

  it("🔴 늦게 온 앞 응답은 질문을 싣지 않는다 — 그 사이 같은 학생을 고정된 제 교시로 되돌렸다", async () => {
    zones = STACKED;
    const first = deferred();
    h.moveSeatStudentPeriod.mockReturnValueOnce(first.promise).mockResolvedValueOnce({ ok: true, pinned: false });
    renderDay({ shownStart: null, choiceDay: { ...CHOICE_DAY, pins: [PIN_HOME] } });
    // ① 15:40 칩으로(응답 전) · ② 도로 15:00 칩으로 — 고정된 교시라 묻지 않는 이동이다.
    await pickUp("이도윤B", { x: 20, y: 260 });
    await drop(230, 15);
    await pickUp("이도윤B", { x: 20, y: 410 });
    await drop(130, 15);
    expect(h.moveSeatStudentPeriod).toHaveBeenLastCalledWith(
      expect.objectContaining({ studentId: "s-PL1b", fromSlot: "15:40", toSlot: "15:00", pin: false }),
    );
    // ③ 이제야 ①의 응답이 온다 — 옛 이동의 질문이 서면 안 된다(서면 '앞으로도 고정'이 15:40 이동을 되살린다).
    await act(async () => {
      first.resolve({ ok: true, pinned: false });
    });
    await settle();
    expect(askAt1540()).toBeNull();
    expect(screen.queryByRole("button", { name: "앞으로도 고정" })).toBeNull();
    expect(within(zone("15:00")).getByText("이도윤B")).toBeTruthy();
  });

  it("🔴 끄는 동안 먼저 도착해 줄에 선 질문도, 같은 학생을 또 놓는 순간 걷는다", async () => {
    zones = STACKED;
    const first = deferred();
    h.moveSeatStudentPeriod.mockReturnValueOnce(first.promise).mockResolvedValueOnce({ ok: true, pinned: false });
    renderDay({ shownStart: null, choiceDay: { ...CHOICE_DAY, pins: [PIN_HOME] } });
    await pickUp("이도윤B", { x: 20, y: 260 });
    await drop(230, 15);
    // ② 도로 집는다 — 그 사이 ①의 응답이 와서 질문이 줄에 선다(끄는 동안이라 창은 아직 안 뜬다).
    await pickUp("이도윤B", { x: 20, y: 410 });
    await act(async () => {
      first.resolve({ ok: true, pinned: false });
    });
    await settle();
    expect(askAt1540()).toBeNull();
    // ③ 제 교시(15:00)에 놓는다 — 줄에 선 옛 질문이 이때 걷혀, 놓은 뒤에도 창이 안 뜬다.
    await drop(130, 15);
    expect(h.moveSeatStudentPeriod).toHaveBeenCalledTimes(2);
    expect(askAt1540()).toBeNull();
    expect(screen.queryByRole("button", { name: "앞으로도 고정" })).toBeNull();
  });

  it("🔴 [해제]하면 그 반의 질문을 걷고, 아직 오는 중인 앞 응답도 질문을 싣지 않는다", async () => {
    zones = STACKED;
    const first = deferred();
    h.moveSeatStudentPeriod.mockReturnValueOnce(first.promise);
    h.clearSeatPeriodChoices.mockResolvedValue({ ok: true, changed: 1 });
    renderDay({ shownStart: null });
    await pickUp("이도윤B", { x: 20, y: 260 });
    await drop(230, 15);
    // ② 응답 전에 옮겨 간 묶음의 [교시 지정 1명 해제] — 그 반은 원래대로 돌아간다.
    await act(async () => {
      screen.getByRole("button", { name: "교시 지정 1명 해제" }).click();
    });
    await settle();
    expect(h.clearSeatPeriodChoices).toHaveBeenCalledWith({ seat: "lab", date: DATE, classId: "PL1b" });
    // ③ 이제야 ①의 응답이 온다 — "옮겼습니다" 창이 서면 거짓이고, '앞으로도 고정'이 푼 지정을 되살린다.
    await act(async () => {
      first.resolve({ ok: true, pinned: false });
    });
    await settle();
    expect(askAt1540()).toBeNull();
    expect(within(zone("15:00")).getByText("이도윤B")).toBeTruthy();
  });

  it("🔴 [해제] 뒤에 늦게 온 앞 이동의 **실패**는 [해제]의 낙관 반영을 되돌리지 않는다 — 옛 서버 교시로 튀지 않게", async () => {
    // 실패한 응답이 무조건 그 학생의 낙관 반영을 지우면, 그 사이 [해제]가 둔 '지정 없음'까지 지워져 카드가 [해제] 전의
    // 서버 줄(15:40)로 튄다 — [해제]가 서버에 닿아 새 줄이 올 때까지 거짓 명단이다. 되돌리기는 그 학생의 마지막 호출만.
    zones = STACKED;
    const first = deferred();
    h.moveSeatStudentPeriod.mockReturnValueOnce(first.promise);
    h.clearSeatPeriodChoices.mockResolvedValue({ ok: true, changed: 1 });
    const earlier = { classId: "PL1b", studentId: "s-PL1b", slotStart: "15:40" };
    renderDay({ shownStart: null, choiceDay: { ...CHOICE_DAY, moves: [earlier] } });
    expect(within(zone("15:40")).getByText("이도윤B")).toBeTruthy();
    // ① 제 교시(15:00)로 되돌린다(응답 전) · ② 그 교시에 선 [교시 지정 1명 해제]를 누른다.
    await pickUp("이도윤B", { x: 20, y: 410 });
    await drop(130, 15);
    await act(async () => {
      screen.getByRole("button", { name: "교시 지정 1명 해제" }).click();
    });
    await settle();
    // ③ 이제야 ①이 실패로 돌아온다 — 문장은 사실이라 보이되, 카드는 [해제]가 둔 제 교시 그대로다.
    const why = "그 사이 출결이 찍혀 옮기지 못했습니다";
    await act(async () => {
      first.resolve({ error: why });
    });
    await settle();
    expect(errorLine()?.textContent).toBe(why);
    expect(within(zone("15:00")).getByText("이도윤B")).toBeTruthy();
    expect(within(zone("15:40")).queryByText("이도윤B")).toBeNull();
  });

  it("🔴 끄는 동안 다른 카드 본문은 다시 그려지지 않는다 — 집을 때도, 칸을 넘을 때도(끄는 카드 한 장만)", async () => {
    zones = STACKED;
    renderDay({ shownStart: null });
    h.triad.length = 0;
    await pickUp("이도윤B", { x: 20, y: 260 });
    await move(500, 450); // 15:40 판
    await move(30, 15); // 14:20 칩
    expect(h.triad.filter((name) => name !== "이도윤B")).toEqual([]);
    await drop(26, 268); // 제자리 = 취소
    expect(h.moveSeatStudentPeriod).not.toHaveBeenCalled();
  });
});

/**
 * 왕복 **사이**에 벌어지는 일(적대 리뷰 2026-09-11 라운드 4) — 질문은 서버 응답 뒤에 서므로, 그 사이 사람이 하는 일이 질문을
 * 삼키면 안 된다: 보기·날짜를 바꿔 화면이 다시 마운트된다 · 같은 반의 다른 학생을 옮긴다 · 같은 학생을 또 옮겼는데 서버가
 * 거절한다 · 창이 뜬 채 [해제]를 누른다.
 */
describe("왕복 사이 — 질문은 사라지지도, 거짓이 되지도 않는다", () => {
  const askAt = (slot: string) => screen.queryByText(`다음에도 이 자리 수업을 ${slot}로 고정할까요?`);
  const why = "그 사이 출결이 찍혀 옮기지 못했습니다";

  it("🔴 보기를 바꿔도(교시 칩) 같은 날이면 다시 마운트되지 않는다 — 방금 옮긴 학생이 그 교시에 서고, 응답 뒤 질문이 선다", async () => {
    // 페이지 key = `${seat}|${date}`(가드가 잠근다) — 칩을 누르면 `shownStart`만 바뀐다. 종전 key엔 교시가 있어서 칩을 누르는
    // 순간 다시 마운트돼 낙관 반영과 기다리던 질문이 함께 버려졌다.
    const first = deferred();
    h.moveSeatStudentPeriod.mockReturnValueOnce(first.promise);
    const view = render(<SeatAllDay key={`lab|${DATE}`} {...props()} />);
    await pickUpDoyun();
    await drop(230, 15);
    view.rerender(<SeatAllDay key={`lab|${DATE}`} {...props({ shownStart: "15:40" })} />);
    expect(within(zone("15:40")).getByText("이도윤B")).toBeTruthy();
    await act(async () => {
      first.resolve({ ok: true, pinned: false });
    });
    await settle();
    expect(askAt("15:40")).not.toBeNull();
    expect(screen.getByRole("button", { name: "오늘만" })).toBeTruthy();
  });

  it("🔴 보기를 바꾼 뒤 서버가 거절하면 바뀐 보기에 이유가 서고 카드는 제 교시로 돌아간다", async () => {
    const first = deferred();
    h.moveSeatStudentPeriod.mockReturnValueOnce(first.promise);
    const view = render(<SeatAllDay key={`lab|${DATE}`} {...props()} />);
    await pickUpDoyun();
    await drop(230, 15);
    view.rerender(<SeatAllDay key={`lab|${DATE}`} {...props({ shownStart: "15:40" })} />);
    await act(async () => {
      first.resolve({ error: why });
    });
    await settle();
    expect(errorLine()?.textContent).toBe(why);
    expect(within(zone("15:40")).queryByText("이도윤B")).toBeNull();
    expect(askAt("15:40")).toBeNull();
  });

  it("🔴 날짜를 옮겨 다시 마운트돼도 응답은 버려지지 않는다 — 창이 그 날짜를 적고, 답은 **그날로** 간다(이 화면 명단은 그대로)", async () => {
    const first = deferred();
    h.moveSeatStudentPeriod.mockReturnValueOnce(first.promise).mockResolvedValueOnce({ ok: true, pinned: true });
    const view = render(<SeatAllDay key={`lab|${DATE}`} {...props()} />);
    await pickUpDoyun();
    await drop(230, 15);
    // 응답 전에 날짜 화살표 — 페이지가 새 key로 다시 마운트한다.
    view.rerender(<SeatAllDay key={`lab|${NEXT_DATE}`} {...props({ date: NEXT_DATE })} />);
    await act(async () => {
      first.resolve({ ok: true, pinned: false });
    });
    await settle();
    expect(askAt("15:40")).not.toBeNull();
    expect(screen.getByText(/9월 11일 \(금\) 이도윤B 학생을 15:00 → 15:40로 옮겼습니다\(그날 명단에 이미 반영됨\)/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "그날만" })).toBeTruthy();
    await act(async () => {
      screen.getByRole("button", { name: "앞으로도 고정" }).click();
    });
    await settle();
    // 🔴 이 화면(9/12)의 날짜로 보내면 그날에는 없던 이동·고정을 만든다 — 질문의 날짜(9/11)로 간다.
    expect(h.moveSeatStudentPeriod).toHaveBeenLastCalledWith({
      seat: "lab",
      date: DATE,
      studentId: "s-PL1b",
      classId: "PL1b",
      fromSlot: "15:00",
      toSlot: "15:40",
      pin: true,
    });
    expect(askAt("15:40")).toBeNull();
    // 9/12 명단엔 낙관 반영을 얹지 않는다 — 이도윤B는 9/12 15:00에 그대로다.
    expect(within(zone("15:00")).getByText("이도윤B")).toBeTruthy();
  });

  it("🔴 날짜를 옮긴 사이 온 거절은 **그날 화면**에 선다 — 다른 날 화면을 덮지 않는다", async () => {
    const first = deferred();
    h.moveSeatStudentPeriod.mockReturnValueOnce(first.promise);
    const view = render(<SeatAllDay key={`lab|${DATE}`} {...props()} />);
    await pickUpDoyun();
    await drop(230, 15);
    view.rerender(<SeatAllDay key={`lab|${NEXT_DATE}`} {...props({ date: NEXT_DATE })} />);
    await act(async () => {
      first.resolve({ error: why });
    });
    await settle();
    expect(errorLine()).toBeNull();
    expect(askAt("15:40")).toBeNull();
    view.rerender(<SeatAllDay key={`lab|${DATE}`} {...props()} />);
    expect(errorLine()?.textContent).toBe(why);
  });

  it("🔴 화면이 사라졌다 돌아와도(자리 전환) 질문이 기다린다", async () => {
    const first = deferred();
    h.moveSeatStudentPeriod.mockReturnValueOnce(first.promise);
    const view = render(<SeatAllDay key={`lab|${DATE}`} {...props()} />);
    await pickUpDoyun();
    await drop(230, 15);
    view.rerender(<p>JJ실</p>);
    await act(async () => {
      first.resolve({ ok: true, pinned: false });
    });
    await settle();
    view.rerender(<SeatAllDay key={`lab|${DATE}`} {...props()} />);
    expect(askAt("15:40")).not.toBeNull();
  });

  it("🔴 같은 반 두 학생 — 앞 학생의 질문은 뒤 학생을 놓아도 걷히지 않는다", async () => {
    zones = STACKED;
    const first = deferred();
    const second = deferred();
    h.moveSeatStudentPeriod.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    renderDay({ shownStart: null, periods: PAIR_PERIODS });
    await pickUp("이도윤B", { x: 20, y: 260 });
    await drop(230, 15);
    await pickUp("김서준", { x: 20, y: 260 });
    await act(async () => {
      first.resolve({ ok: true, pinned: false });
    });
    await settle();
    await drop(230, 15);
    expect(h.moveSeatStudentPeriod).toHaveBeenLastCalledWith(
      expect.objectContaining({ studentId: "s-PL1b2", classId: "PL1b", toSlot: "15:40" }),
    );
    expect(screen.getByText(/이도윤B 학생을 15:00 → 15:40로 옮겼습니다/)).toBeTruthy();
  });

  it("🔴 같은 반 두 학생 — 뒤 학생이 먼저 돌아와도 앞 학생의 질문이 줄에 선다", async () => {
    zones = STACKED;
    const first = deferred();
    const second = deferred();
    h.moveSeatStudentPeriod.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    renderDay({ shownStart: null, periods: PAIR_PERIODS });
    await pickUp("이도윤B", { x: 20, y: 260 });
    await drop(230, 15);
    await pickUp("김서준", { x: 20, y: 260 });
    await drop(230, 15);
    await act(async () => {
      second.resolve({ ok: true, pinned: false });
    });
    await settle();
    await act(async () => {
      first.resolve({ ok: true, pinned: false });
    });
    await settle();
    expect(screen.getByText(/김서준 학생을 15:00 → 15:40로 옮겼습니다/)).toBeTruthy();
    await act(async () => {
      screen.getByRole("button", { name: "오늘만" }).click();
    });
    expect(screen.getByText(/이도윤B 학생을 15:00 → 15:40로 옮겼습니다/)).toBeTruthy();
  });

  it("🔴 같은 반 두 학생 — 뒤 학생이 받아진 뒤 앞 학생이 거절되면 앞 학생 카드만 제 교시로 돌아온다", async () => {
    zones = STACKED;
    const first = deferred();
    const second = deferred();
    h.moveSeatStudentPeriod.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    renderDay({ shownStart: null, periods: PAIR_PERIODS });
    await pickUp("이도윤B", { x: 20, y: 260 });
    await drop(230, 15);
    await pickUp("김서준", { x: 20, y: 260 });
    await drop(230, 15);
    await act(async () => {
      second.resolve({ ok: true, pinned: false });
    });
    await settle();
    await act(async () => {
      first.resolve({ error: why });
    });
    await settle();
    expect(errorLine()?.textContent).toBe(why);
    expect(within(zone("15:00")).getByText("이도윤B")).toBeTruthy();
    expect(within(zone("15:40")).queryByText("이도윤B")).toBeNull();
    expect(within(zone("15:40")).getByText("김서준")).toBeTruthy();
  });

  it("🔴 뒤 이동이 서버에서 거절되면 서버에 남은 앞 이동의 질문이 돌아온다(응답 전에 또 옮겼다)", async () => {
    zones = STACKED;
    const first = deferred();
    const second = deferred();
    h.moveSeatStudentPeriod.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const view = renderDay({ shownStart: null, choiceDay: OPEN_DAY });
    await pickUp("이도윤B", { x: 20, y: 260 });
    await drop(230, 15); // 15:40 칩
    await pickUp("이도윤B", { x: 20, y: 410 });
    await drop(330, 15); // 16:20 칩 — 화면은 학생 축을 몰라 통과시킨다
    expect(h.moveSeatStudentPeriod).toHaveBeenLastCalledWith(
      expect.objectContaining({ fromSlot: "15:40", toSlot: "16:20", pin: false }),
    );
    await act(async () => {
      first.resolve({ ok: true, pinned: false });
    });
    await settle();
    // 뒤 이동이 도는 중 — 앞 질문은 아직 거짓일 수 있어 숨어 있다.
    expect(askAt("15:40")).toBeNull();
    // 앞 이동의 새로고침(서버: 15:40)이 오고, 뒤 이동은 서버가 수학 겹침으로 거절한다.
    view.rerender(<SeatAllDay {...props({ shownStart: null, choiceDay: { ...OPEN_DAY, moves: [MOVED_1540] } })} />);
    await act(async () => {
      second.resolve({ error: DOYUN_MATH });
    });
    await settle();
    expect(errorLine()?.textContent).toBe(DOYUN_MATH);
    expect(askAt("15:40")).not.toBeNull();
    expect(within(zone("15:40")).getByText("이도윤B")).toBeTruthy();
  });

  it("🔴 끄는 동안 먼저 도착해 줄에 선 질문도 — 같은 학생의 뒤 이동이 거절되면 돌아온다", async () => {
    zones = STACKED;
    const first = deferred();
    h.moveSeatStudentPeriod.mockReturnValueOnce(first.promise).mockResolvedValueOnce({ error: DOYUN_MATH });
    renderDay({ shownStart: null, choiceDay: OPEN_DAY });
    await pickUp("이도윤B", { x: 20, y: 260 });
    await drop(230, 15);
    await pickUp("이도윤B", { x: 20, y: 410 });
    await act(async () => {
      first.resolve({ ok: true, pinned: false });
    });
    await settle();
    await drop(330, 15);
    await settle();
    expect(h.moveSeatStudentPeriod).toHaveBeenCalledTimes(2);
    expect(errorLine()?.textContent).toBe(DOYUN_MATH);
    expect(askAt("15:40")).not.toBeNull();
  });

  it("🔴 창이 뜬 채 [해제]를 누르면 창이 걷힌다 — 창은 초점을 가두지 않아 키보드로 뒤의 [해제]에 닿는다", async () => {
    // 걷지 않으면 "…15:40로 옮겼습니다"가 거짓인 채 남고, '앞으로도 고정'을 누르면 서버는 학생이 출발 교시에 도로 선 것을 보고
    // 진짜 이동으로 받아 방금 [해제]한 이동을 되살리고 고정한다.
    zones = STACKED;
    h.clearSeatPeriodChoices.mockResolvedValueOnce({ ok: true, changed: 1 });
    renderDay({ shownStart: null });
    await pickUp("이도윤B", { x: 20, y: 260 });
    await drop(230, 15);
    expect(askAt("15:40")).not.toBeNull();
    await act(async () => {
      within(zone("15:40")).getByRole("button", { name: "교시 지정 1명 해제" }).click();
    });
    await settle();
    expect(h.clearSeatPeriodChoices).toHaveBeenCalledWith({ seat: "lab", date: DATE, classId: "PL1b" });
    expect(askAt("15:40")).toBeNull();
    expect(screen.queryByRole("button", { name: "앞으로도 고정" })).toBeNull();
  });

  it("🔴 [해제]가 거절되면 숨긴 질문이 돌아온다 — 지정이 그대로 남았다", async () => {
    zones = STACKED;
    const refused = "교시 지정을 풀지 못했습니다 — 다시 시도해 주세요";
    h.clearSeatPeriodChoices.mockResolvedValueOnce({ error: refused });
    const view = renderDay({ shownStart: null });
    await pickUp("이도윤B", { x: 20, y: 260 });
    await drop(230, 15);
    // 받아 준 뒤의 새로고침(서버: 15:40).
    view.rerender(<SeatAllDay {...props({ shownStart: null, choiceDay: { ...CHOICE_DAY, moves: [MOVED_1540] } })} />);
    expect(askAt("15:40")).not.toBeNull();
    await act(async () => {
      within(zone("15:40")).getByRole("button", { name: "교시 지정 1명 해제" }).click();
    });
    await settle();
    expect(errorLine()?.textContent).toBe(refused);
    expect(askAt("15:40")).not.toBeNull();
    expect(within(zone("15:40")).getByText("이도윤B")).toBeTruthy();
  });

  it("🔴 [해제]는 그 반만 — 다른 반 학생의 이동이 응답 대기 중이어도 그 질문은 선다", async () => {
    zones = STACKED;
    const second = deferred();
    h.moveSeatStudentPeriod.mockReturnValueOnce(second.promise);
    h.clearSeatPeriodChoices.mockResolvedValueOnce({ ok: true, changed: 1 });
    renderDay({ shownStart: null, choiceDay: { ...CHOICE_DAY, moves: [MOVED_1540] } });
    // 박한솔(LE1) → 16:20 칩(응답 전) · 그 사이 PL1b 묶음의 [교시 지정 1명 해제].
    await pickUp("박한솔", { x: 20, y: 410 });
    await drop(330, 15);
    await act(async () => {
      within(zone("15:40")).getByRole("button", { name: "교시 지정 1명 해제" }).click();
    });
    await settle();
    expect(h.clearSeatPeriodChoices).toHaveBeenCalledWith({ seat: "lab", date: DATE, classId: "PL1b" });
    await act(async () => {
      second.resolve({ ok: true, pinned: false });
    });
    await settle();
    expect(askAt("16:20")).not.toBeNull();
    expect(screen.getByText(/박한솔 학생을 15:40 → 16:20로 옮겼습니다/)).toBeTruthy();
  });
});
