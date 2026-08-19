import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TodayClassSheet } from "./today-class-sheet";
import { TODAY_NAME_W, todayContentWidth } from "../lib/today-columns";
import type { ClassSheetWeekData } from "../server/queries";
import type { GridDay } from "../lib/grid";
import type { SheetHandlers } from "./sheet-client";
import type { SheetSaveStore } from "./use-sheet-saves";

/**
 * 원장 2026-08-18: *"수업명을 빈 공간으로 이동시켜줘."* + *"그러면 행 절약할 수 있을듯."*
 *
 * 반 이름 줄이 카드 **바깥 위**에 따로 있어 반마다 한 줄을 더 먹었다 — 카드 안 일괄 버튼 줄의 왼쪽은
 * 내내 비어 있었고 거기가 제자리다. 지켜야 할 것:
 *  ① 제목은 카드 **안**에 있다(바깥 제목 줄은 사라졌다 — 둘 다 있으면 이름이 두 번 나온다).
 *  🔴 ② 학생 이름 열 자리(`aria-hidden` 스페이서, `TODAY_NAME_W`)와 폭 정렬은 그대로다.
 *  🔴 ③ 머리 줄의 폭 = 표의 내용 폭 — 카드가 `w-max`라 이걸 안 묶으면 긴 반 이름이 카드를 늘려
 *        아래 표와 어긋나고 가로 스크롤이 표 끝을 지나 더 밀린다.
 */
// ⚠️ 카드 안에 나중에 들어온 `EcsMakeupAdder`가 `useRouter()`를 쓴다 — 앱 라우터가 없는 렌더 테스트에선
//    "invariant expected app router to be mounted"로 죽는다. 리포 표준대로 navigation만 mock 하고
//    컴포넌트는 **진짜로 그린다**(이 테스트가 보는 건 폭·줄맞춤이라 실물이 트리에 있어야 뜻이 있다).
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/ui/drag-scroll-area", () => ({
  DragScrollArea: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("./period-block", () => ({ PeriodBlock: () => <div>계획칸</div> }));
vi.mock("./day-bulk", () => ({ DayBulk: () => <button type="button">일괄 출석 6×2</button> }));
vi.mock("./today-roster-table", () => ({ TodayRosterTable: () => <div>로스터표</div> }));

afterEach(cleanup);

const day = {
  date: "2026-08-18",
  slots: [
    { slotStart: "16:20", teacherLabel: "Hannah", roster: [{ studentId: "s1" }], lines: [] },
    { slotStart: "17:20", teacherLabel: "Hannah", roster: [{ studentId: "s1" }], lines: [] },
  ],
} as unknown as GridDay;

// ⚠️ periodLabelBySlot은 실제로 **항상 오는 값**이다(서버가 채운다) — 픽스처에서 빼면 보강 어댑터에
// 교시 이름을 넘기는 줄에서 죽는다. 빈 맵이라도 두어 "이름을 못 찾은 날"을 재현한다.
const data = {
  canMarkAttendanceByDate: {},
  isEie: false,
  periodLabelBySlot: {},
} as unknown as ClassSheetWeekData;

function renderSheet(header: React.ReactNode) {
  return render(
    <TodayClassSheet
      day={day}
      header={header}
      data={data}
      linesBySlot={{}}
      marks={{}}
      attendance={{}}
      store={{} as SheetSaveStore}
      handlers={{} as SheetHandlers}
      canEdit
      collapsedGroups={[]}
      onToggleGroup={vi.fn()}
    />,
  );
}

describe("오늘 면 시트 — 반 이름이 카드 안 머리로", () => {
  it("① 넘긴 머리(반 이름·링크)가 카드 안에 그려진다", () => {
    renderSheet(<h2>중등E_초등 브릿지 A</h2>);
    expect(screen.getByText("중등E_초등 브릿지 A")).toBeTruthy();
  });

  it("🔴 ② 학생 이름 열 스페이서는 그대로(aria-hidden · 같은 폭) — 교시 줄맞춤의 근거다", () => {
    const { container } = renderSheet(<h2>반</h2>);
    const spacer = container.querySelector('[aria-hidden="true"]') as HTMLElement | null;
    expect(spacer).not.toBeNull();
    expect(spacer!.style.width).toBe(`${TODAY_NAME_W}px`);
  });

  it("🔴 ③ 머리 줄의 폭 = 표 내용 폭(카드가 w-max라 긴 이름이 카드를 늘리지 않게)", () => {
    const { container } = renderSheet(<h2>아주 긴 반 이름이 들어와도 카드를 늘리면 안 된다</h2>);
    const header = container.querySelector('[style*="width"]') as HTMLElement | null;
    expect(header).not.toBeNull();
    expect(header!.style.width).toBe(`${todayContentWidth(day.slots.length)}px`);
  });

  it("머리를 안 넘기면 그 자리는 비어 있다(주간 시트 등 다른 소비처 영향 0)", () => {
    const { container } = renderSheet(undefined);
    expect(container.textContent).toContain("일괄 출석");
  });
});

describe("① ECS 오늘 면 페이지 — 바깥 제목 줄은 없앴다", () => {
  const page = readFileSync(
    join(process.cwd(), "src", "app", "(shell)", "ecs", "page.tsx"),
    "utf8",
  );

  it("페이지가 반 이름 제목을 다시 그리지 않는다(카드 안 제목과 두 번 나오면 행 절약이 사라진다)", () => {
    // 반 이름 자체는 남아 있어도 된다(반 선택 목록·조회 실패 안내) — 금지되는 건 **제목 줄**이다.
    expect(page).not.toMatch(/<h2[^>]*>\s*\{s\.className\}/);
    // 화면에 보이는 링크 라벨(화살표 포함)이 페이지에 남아 있으면 제목 줄이 되살아난 것이다.
    expect(page).not.toContain("주간 시트 열기 →");
  });

  it("제목·링크는 SheetClient가 header로 넘긴다", () => {
    const client = readFileSync(
      join(process.cwd(), "src", "features", "class-sheets", "components", "sheet-client.tsx"),
      "utf8",
    );
    expect(client).toContain("주간 시트 열기");
    expect(client).toMatch(/header=\{/);
  });
});
