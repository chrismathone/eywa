import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DRAG_DBLCLICK_GRACE_MS,
  getArmedRow,
  holdArmedRow,
  setArmedRow,
  setTimetableDragging,
  swallowDoubleClickAfterDrag,
} from "./drag-flag";

/**
 * 무장 잠금 — 원장 제보 2026-09-09 *"드래그 이동하려고 하니까 '출발 반을 알 수 없어서 옮기지 못했다'는 알림"*.
 * 끄는 동안 지나는 다른 줄의 pointerover가 무장을 빼앗아 끌던 줄이 언마운트되면 dnd-kit `active.data`가 빈 객체가
 * 된다. 그래서 **누르고 있는 동안·끌고 있는 동안**은 무장 줄이 바뀌지 않아야 한다(drag-flag.ts `holdArmedRow` 주석).
 */
describe("무장 잠금 — 누르고 있거나 끌고 있는 동안 무장 줄이 바뀌지 않는다", () => {
  afterEach(() => {
    // 모듈 상태를 평소로: 누름 해제 + 드래그 종료.
    window.dispatchEvent(new Event("pointerup"));
    setTimetableDragging(false);
  });

  it("평소엔 pointerover가 무장 줄을 바꾼다", () => {
    setArmedRow("row-a");
    expect(getArmedRow()).toBe("row-a");
    setArmedRow("row-b");
    expect(getArmedRow()).toBe("row-b");
  });

  it("누르고 있는 동안(pointerdown~pointerup)은 다른 줄이 무장을 빼앗지 못한다", () => {
    setArmedRow("row-a");
    holdArmedRow();
    setArmedRow("row-b");
    expect(getArmedRow()).toBe("row-a");
    // null(무장 해제)도 막는다 — 해제 역시 언마운트다.
    setArmedRow(null);
    expect(getArmedRow()).toBe("row-a");
    window.dispatchEvent(new Event("pointerup"));
    setArmedRow("row-b");
    expect(getArmedRow()).toBe("row-b");
  });

  it("pointercancel·blur로도 풀린다(창 밖에서 놓거나 포커스를 잃어도 잠긴 채 남지 않게)", () => {
    setArmedRow("row-a");
    holdArmedRow();
    window.dispatchEvent(new Event("pointercancel"));
    setArmedRow("row-b");
    expect(getArmedRow()).toBe("row-b");
    holdArmedRow();
    window.dispatchEvent(new Event("blur"));
    setArmedRow("row-c");
    expect(getArmedRow()).toBe("row-c");
  });

  it("끌고 있는 동안(setTimetableDragging)도 막는다 — 5px 문턱을 넘긴 뒤 누름과 무관하게", () => {
    setArmedRow("row-a");
    setTimetableDragging(true);
    setArmedRow("row-b");
    expect(getArmedRow()).toBe("row-a");
    setTimetableDragging(false);
    setArmedRow("row-b");
    expect(getArmedRow()).toBe("row-b");
  });
});

/**
 * 배선 가드 — 무장(`setArmedRow`)을 쓰는 줄 컴포넌트는 **누르는 순간 잠금**(`holdArmedRow`)도 함께 단다.
 * 한쪽만 있으면 그 줄만 옛 증상이 되살아난다(학생 줄과 통합뷰 명단 줄이 각자 무장한다).
 */
describe("배선 — setArmedRow를 쓰는 줄은 onPointerDownCapture로 holdArmedRow를 건다", () => {
  const dir = __dirname;
  const files = readdirSync(dir).filter(
    (f) => f.endsWith(".tsx") && !f.endsWith(".test.tsx") && readFileSync(join(dir, f), "utf8").includes("setArmedRow("),
  );

  it("무장을 쓰는 파일이 실제로 있다(가드가 빈 집합을 지키지 않게)", () => {
    expect(files).toEqual(expect.arrayContaining(["student-rows.tsx", "rich-card-group.tsx"]));
  });

  it.each(files)("%s", (file) => {
    const src = readFileSync(join(dir, file), "utf8");
    expect(src).toMatch(/onPointerDownCapture=\{\(\) => holdArmedRow\(\)\}/);
  });
});

/**
 * 드래그 직후 더블클릭 삼키기 — 원장 2026-09-09 *"드래그하다가 더블클릭이 발생하지 않도록 뭔가 조정"*.
 * 크롬은 더블클릭을 요소가 아니라 시간·좌표로 세므로, 짧게 끌다 놓고 곧바로 다시 잡으면 학생·반 창이 열렸다.
 */
describe("드래그 직후의 더블클릭은 창 열기가 아니다", () => {
  const ev = () => {
    const calls = { stop: 0, prevent: 0 };
    return {
      calls,
      stopPropagation: () => {
        calls.stop += 1;
      },
      preventDefault: () => {
        calls.prevent += 1;
      },
    };
  };

  afterEach(() => {
    setTimetableDragging(false);
    vi.useRealTimers();
  });

  it("드래그가 없었으면 그대로 둔다", () => {
    vi.useFakeTimers();
    // 🔴 **가짜 시각을 아주 먼 미래로** 둔다 — `dragEndedAt`은 앞선 테스트가 **진짜 시계**로 찍어 둔 값이라
    //    가짜 시각을 오늘 10:00Z에 맞추면 실제 시각이 그보다 늦은 저녁(19시 KST 이후)엔 차이가 **음수**가
    //    되어 유예 안으로 읽힌다. 그래서 이 테스트는 하루의 앞부분에만 통과하는 **시한 결함**이었다
    //    (2026-09-09 19:41 KST 실측 — 같은 날 09:40 UTC 전체 실행에선 통과했다).
    //    앞으로 옮기기만 하면 어떤 시각에 돌려도 유예를 확실히 지난다.
    vi.setSystemTime(new Date("2099-01-01T00:00:00Z"));
    vi.advanceTimersByTime(DRAG_DBLCLICK_GRACE_MS * 2);
    const e = ev();
    swallowDoubleClickAfterDrag(e);
    expect(e.calls).toEqual({ stop: 0, prevent: 0 });
  });

  it("끌고 있는 중·끝난 직후엔 삼키고, 유예가 지나면 다시 둔다", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-09T10:00:00Z"));
    setTimetableDragging(true);
    const during = ev();
    swallowDoubleClickAfterDrag(during);
    expect(during.calls).toEqual({ stop: 1, prevent: 1 });
    setTimetableDragging(false);
    vi.advanceTimersByTime(DRAG_DBLCLICK_GRACE_MS - 1);
    const soon = ev();
    swallowDoubleClickAfterDrag(soon);
    expect(soon.calls).toEqual({ stop: 1, prevent: 1 });
    vi.advanceTimersByTime(2);
    const later = ev();
    swallowDoubleClickAfterDrag(later);
    expect(later.calls).toEqual({ stop: 0, prevent: 0 });
  });

  it("배선 — 더블클릭으로 창을 여는 줄을 품는 DnD 영역은 캡처에서 삼킨다(기본뷰 DnD 영역·통합뷰 명단 영역)", () => {
    const dir = __dirname;
    const read = (f: string) => readFileSync(join(dir, f), "utf8");
    const dndFiles = readdirSync(dir).filter(
      (f) => f.endsWith(".tsx") && !f.endsWith(".test.tsx") && read(f).includes("<DndContext"),
    );
    // 삼켜야 하는 영역 = 그 안에 `openOn="doubleClick"` 줄(학생·반·명단)이 그려지는 둘.
    const hosts = ["timetable-board.tsx", "roster-move.tsx"];
    expect(dndFiles).toEqual(expect.arrayContaining(hosts));
    for (const f of hosts) {
      expect(read(f), f).toMatch(/onDoubleClickCapture=\{swallowDoubleClickAfterDrag\}/);
    }
    // 그 밖의 DndContext(통합뷰 그룹 배치 편집기)는 더블클릭 열기가 없어 대상이 아니다 — 생기면 위 목록에 넣을 것.
    for (const f of dndFiles.filter((x) => !hosts.includes(x))) {
      expect(read(f), `${f}: 더블클릭 열기가 생겼으면 swallowDoubleClickAfterDrag 배선도 함께`).not.toMatch(
        /openOn="doubleClick"|onDoubleClick=/,
      );
    }
  });
});
