/**
 * 좌석표 칸의 **낙관 갱신** — 방금 찍은 값이 언제 뜨고 언제 서버 값에 자리를 내주는가.
 *
 * 🔴 이 스위트가 지키는 건 하나다: **"새 시각 + 옛 입력자 이름"이 절대 함께 뜨지 않는다.**
 *    데스크가 찍어 둔 칸을 담임이 다시 찍는 흔한 경우에, 시각만 낙관으로 앞서 나가고 이름은 props에
 *    남아 있으면 화면이 "박소선이 15:30에 찍었다"고 **없는 사실**을 말한다.
 *
 * 🔴 `useTransition`의 `isPending`으로는 이 구간을 못 잡는다 — `startTransition`에 넘긴 콜백이 동기
 *    함수라(promise를 반환하지도 await 하지도 않는다) 스코프가 그 자리에서 끝나 저장이 오가는 동안
 *    이미 false다. 아래 첫 테스트가 그 사실 자체를 못 박는다(고치기 전엔 여기서 걸린다).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SeatingCell } from "./seating-cell";
import type { SeatingClass, SeatingStudent } from "../seating";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

/** 저장은 테스트가 직접 붙잡는다 — "응답이 아직 안 온 구간"이 이 스위트의 관심사다. */
const setAttendanceCell = vi.fn();
vi.mock("@/features/attendance/server/actions", () => ({
  setAttendanceCell: (...args: unknown[]) => setAttendanceCell(...args),
}));

afterEach(cleanup);
beforeEach(() => {
  refresh.mockClear();
  setAttendanceCell.mockReset();
});

const KLASS: SeatingClass = {
  classId: "c1",
  className: "중등M 개별 BS2F",
  subject: "math",
  teacherName: "이성우",
  teacherId: "t-담임",
  roomName: "601호",
  firstStart: "16:20",
  firstEnd: "18:10",
  periodLabel: null,
  seatLabel: null,
  phase: "due",
  band: "now",
  ownedByMe: true,
  students: [],
};

/** 데스크(박소선)가 16:00에 찍어 둔 칸 — 담임이 아니라 이름이 함께 뜬다. */
const MARKED: SeatingStudent = {
  studentId: "s1",
  studentName: "김하늘",
  schoolGrade: "경명여중1",
  parentPhone: null,
  studentPhone: null,
  status: "absent",
  // 칸은 `mark`를 status에서 스스로 다시 구한다 — 여기 값은 타입을 채우기 위한 것.
  mark: "absent",
  note: null,
  signal: null,
  recordSlot: null,
  recordedAt: "2026-08-24T07:00:00Z", // 16:00 KST
  recordedBy: "u-데스크",
  recordedByName: "박소선",
  writeSlot: null,
};

const cell = (student: SeatingStudent) => (
  <SeatingCell date="2026-08-24" klass={KLASS} student={student} />
);

/** 칸 버튼 하나 — 이름·시각·입력자가 모두 이 안에 있다. */
const chip = () => screen.getByRole("button", { name: /김하늘/ });

describe("낙관 갱신 — 새 시각 옆에 옛 입력자 이름이 남지 않는다", () => {
  it("🔴 저장 응답이 오기 전: 시각은 즉시 새 값, 입력자 이름은 사라진다", () => {
    // 응답을 영영 주지 않는다 = "저장이 오가는 동안"을 그대로 붙잡는다.
    setAttendanceCell.mockReturnValue(new Promise(() => {}));
    render(cell(MARKED));
    expect(chip().textContent).toContain("16:00");
    expect(chip().textContent).toContain("(박소선)");

    fireEvent.click(chip());
    fireEvent.click(screen.getByRole("button", { name: "출석" }));

    const text = chip().textContent ?? "";
    expect(text).not.toContain("16:00"); // 옛 시각은 즉시 사라진다
    expect(text).not.toContain("(박소선)"); // 🔴 옛 입력자도 함께 — 이게 이 스위트의 핵심
    expect(text).toMatch(/\d\d:\d\d/); // 대신 방금 찍은 시각이 붙는다
  });

  it("서버가 따라잡으면(recordedAt 변경) 낙관값을 버리고 진짜 입력자가 뜬다", () => {
    setAttendanceCell.mockReturnValue(new Promise(() => {}));
    const { rerender } = render(cell(MARKED));
    fireEvent.click(chip());
    fireEvent.click(screen.getByRole("button", { name: "출석" }));
    expect(chip().textContent).not.toContain("(박소선)");

    // router.refresh()가 도착한 순간 = 새 props. 이번엔 김예원이 17:30에 찍은 것으로 확정됐다.
    rerender(
      cell({
        ...MARKED,
        status: "present",
        recordedAt: "2026-08-24T08:30:00Z",
        recordedBy: "u-데스크2",
        recordedByName: "김예원",
      }),
    );
    const text = chip().textContent ?? "";
    expect(text).toContain("17:30"); // 클라 시계값이 아니라 **서버 값**으로 수렴한다
    expect(text).toContain("(김예원)");
  });

  it("남이 고친 값이 먼저 도착해도, 그 뒤 내가 찍은 값은 그 자리에서 지워지지 않는다", () => {
    setAttendanceCell.mockReturnValue(new Promise(() => {}));
    const { rerender } = render(cell(MARKED));
    // 내가 누르기 **전에** 다른 사람의 수정이 새로고침으로 도착한다.
    rerender(cell({ ...MARKED, recordedAt: "2026-08-24T08:00:00Z", recordedByName: "김예원" }));
    expect(chip().textContent).toContain("17:00");

    fireEvent.click(chip());
    fireEvent.click(screen.getByRole("button", { name: "지각" }));
    // 추적값을 낙관값이 있을 때만 갱신하면, 여기서 방금 누른 값이 즉시 지워진다(회귀 지점).
    expect(chip().textContent).not.toContain("17:00");
    expect(chip().textContent).not.toContain("(김예원)");
  });

  it("저장이 거절되면 상태·시각·입력자가 **함께** 되돌아온다", async () => {
    setAttendanceCell.mockResolvedValue({ error: "이미 입력된 출결은 데스크가 덮을 수 없습니다" });
    render(cell(MARKED));
    fireEvent.click(chip());
    fireEvent.click(screen.getByRole("button", { name: "출석" }));
    await screen.findByText(/덮을 수 없습니다/);

    const text = chip().textContent ?? "";
    expect(text).toContain("16:00");
    expect(text).toContain("(박소선)");
  });
});

/**
 * 출결 메뉴가 **뜨는 자리** — 반 카드가 `overflow-hidden`이라 칸 안에 그리면 잘린다(원장 제보 2026-09-04:
 * 아랫줄 학생의 메뉴가 카드에 잘려 출결을 못 찍었다). 포털로 카드 밖에 띄우고 화면 안으로 클램프한다.
 *
 * 🔑 jsdom은 모든 rect가 0이라 **직접 물려 준다** — 이 스위트가 지키는 건 좌표 계산이지 실제 그림이 아니다.
 */
describe("메뉴는 카드 밖(포털)에 뜨고 화면 안에 들어온다", () => {
  const VW = 1024;
  const VH = 768;
  /** 겹판(메뉴)과 앵커(칸 버튼)의 크기를 물려 준다 — 나머지 요소는 0으로 둔다. */
  function stubRects(anchor: { top: number; bottom: number; left: number; right: number }) {
    const rect = (r: { top: number; bottom: number; left: number; right: number }) =>
      ({
        ...r,
        width: r.right - r.left,
        height: r.bottom - r.top,
        x: r.left,
        y: r.top,
        toJSON: () => r,
      }) as DOMRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.className.includes("z-[9999]"))
        return rect({ top: 0, bottom: 34, left: 0, right: 120 }); // 겹판 크기
      if (this.tagName === "BUTTON" && (this.textContent ?? "").includes("김하늘")) return rect(anchor);
      return rect({ top: 0, bottom: 0, left: 0, right: 0 });
    });
  }
  const menuBox = () => document.querySelector<HTMLElement>(".z-\\[9999\\]");

  beforeEach(() => {
    setAttendanceCell.mockReturnValue(new Promise(() => {}));
    Object.defineProperty(window, "innerWidth", { value: VW, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: VH, configurable: true });
  });
  afterEach(() => vi.restoreAllMocks());

  it("칸 컨테이너 안이 아니라 body에 붙는다(카드 overflow에 안 잘린다)", () => {
    stubRects({ top: 100, bottom: 136, left: 40, right: 140 });
    const { container } = render(cell(MARKED));
    fireEvent.click(chip());
    const menu = screen.getByRole("button", { name: "출석" });
    expect(container.contains(menu)).toBe(false); // 카드(칸) 트리 밖
    expect(document.body.contains(menu)).toBe(true);
  });

  it("칸 아래에 자리가 있으면 아래에 붙는다", () => {
    stubRects({ top: 100, bottom: 136, left: 40, right: 140 });
    render(cell(MARKED));
    fireEvent.click(chip());
    expect(menuBox()?.style.top).toBe("140px"); // 칸 바닥 + 4
    expect(menuBox()?.style.left).toBe("40px");
  });

  it("🔴 아래 공간이 모자라면 **칸 위로 뒤집는다**(화면 밖으로 안 나간다)", () => {
    stubRects({ top: 700, bottom: 740, left: 40, right: 140 });
    render(cell(MARKED));
    fireEvent.click(chip());
    // 아래로 두면 740+4+34=778 > 768 → 위로: 700 - 4 - 34
    expect(menuBox()?.style.top).toBe("662px");
  });

  it("🔴 오른쪽 끝 칸은 화면 안으로 당겨 붙인다", () => {
    stubRects({ top: 100, bottom: 136, left: 980, right: 1020 });
    render(cell(MARKED));
    fireEvent.click(chip());
    // 980+120=1100 > 1024-8 → 1024-8-120
    expect(menuBox()?.style.left).toBe("896px");
  });

  it("🔴 칸이 스크롤돼 화면 밖으로 나가면 메뉴를 닫는다(엉뚱한 칸에 찍히지 않게)", () => {
    stubRects({ top: 100, bottom: 136, left: 40, right: 140 });
    render(cell(MARKED));
    fireEvent.click(chip());
    expect(screen.getByRole("button", { name: "출석" })).toBeTruthy();

    stubRects({ top: -200, bottom: -164, left: 40, right: 140 }); // 위로 스크롤돼 사라졌다
    fireEvent.scroll(window);
    expect(screen.queryByRole("button", { name: "출석" })).toBeNull();
  });

  it("Esc로 닫힌다", () => {
    stubRects({ top: 100, bottom: 136, left: 40, right: 140 });
    render(cell(MARKED));
    fireEvent.click(chip());
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("button", { name: "출석" })).toBeNull();
  });

  it("바깥을 누르면 닫힌다 — 여러 칸의 메뉴가 겹쳐 뜨지 않는다", () => {
    stubRects({ top: 100, bottom: 136, left: 40, right: 140 });
    render(cell(MARKED));
    fireEvent.click(chip());
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("button", { name: "출석" })).toBeNull();
  });
});

describe("기록이 없던 칸", () => {
  it("찍기 전엔 시각 줄이 없고, 찍는 즉시 생긴다", () => {
    setAttendanceCell.mockReturnValue(new Promise(() => {}));
    render(cell({ ...MARKED, status: null, recordedAt: null, recordedBy: null, recordedByName: null }));
    expect(chip().textContent).not.toMatch(/\d\d:\d\d/);

    fireEvent.click(chip());
    fireEvent.click(screen.getByRole("button", { name: "출석" }));
    expect(chip().textContent).toMatch(/\d\d:\d\d/);
  });
});
