import { useEffect } from "react";
import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { cellKey, rowKey } from "@/features/attendance/grid/model";
import type { GridStore } from "@/features/attendance/grid/store";
import { EMPTY_COUNT, countCells } from "@/features/attendance/grid/totals";
import { GridProvider, useCellState } from "./grid-context";
import { LiveStats, LiveUnits, RowLessonCountCell, RowTotalCells } from "./live-totals";

// 배선 검증 — 값이 바뀌면 합계가 **서버 왕복 없이 그 자리에서** 바뀐다.
// (계산 자체는 grid/totals.test.ts가 잠근다. 여기서 보는 건 구독이 실제로 연결됐는지다.)

// 격자 컨트롤러는 서버 액션·라우터를 물고 있다 — 여기선 합계 배선만 보므로 대역으로 세운다.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/features/attendance/server/actions", () => ({
  setAttendanceCell: vi.fn(async () => ({ ok: true })),
  setAttendanceRange: vi.fn(async () => ({ ok: true, applied: 0, blocked: 0 })),
}));
vi.mock("@/features/attendance/server/prefs-actions", () => ({
  saveAttendanceCollapsed: vi.fn(async () => ({ ok: true })),
}));

const C = "11111111-1111-1111-1111-111111111111";
const R1 = rowKey(C, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
const R2 = rowKey(C, "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
const D1 = "2026-07-01";
const D2 = "2026-07-02";

/** 격자 저장소를 테스트로 꺼내는 탐침 — 실제 입력 경로(setLocal)를 그대로 흉내내기 위해. */
function Probe({ sink }: { sink: (s: GridStore) => void }) {
  const { ctx } = useCellState(cellKey(R1, D1));
  const store = ctx?.store;
  useEffect(() => {
    if (store) sink(store);
  }, [store, sink]);
  return null;
}

describe("살아 있는 합계", () => {
  it("🔴 칸을 치면 그 행의 시수·출석률이 서버 왕복 없이 바뀐다", () => {
    let store: GridStore | null = null;
    const { container } = render(
      <GridProvider
        rows={[R1, R2]}
        cols={[D1, D2]}
        initial={{ [cellKey(R1, D1)]: { s: "present", u: null } }}
        lockBefore={null}
      >
        <Probe sink={(s) => (store = s)} />
        <table>
          <tbody>
            <tr>
              {/* 2026-09-17: 시수(수업 차수) 칸은 청구액 옆으로 옮겼다 — 두 칸이 같은 구독을 쓴다. */}
              <RowLessonCountCell row={R1} fallback={countCells([{ s: "present", u: null }])} />
              <RowTotalCells row={R1} fallback={countCells([{ s: "present", u: null }])} />
            </tr>
          </tbody>
        </table>
      </GridProvider>,
    );
    expect(container.textContent).toContain("100%");

    // 같은 행 다른 날에 결석을 찍는다 = 낙관적 반영(setLocal). 서버는 아직 아무것도 모른다.
    act(() => store!.setLocal([[cellKey(R1, D2), { s: "absent", u: null }]]));
    expect(container.textContent).toContain("50%");

    // 시수 2짜리 보강을 더하면 시수 합이 1 → 3.
    act(() => store!.setLocal([[cellKey(R1, D1), { s: "makeup", u: 2 }]]));
    expect(container.textContent).toContain("2");
  });

  it("반 합계는 지정한 행만 센다 — 옆 행 기록이 새어 들어오지 않는다", () => {
    const { container } = render(
      <GridProvider
        rows={[R1, R2]}
        cols={[D1, D2]}
        initial={{ [cellKey(R1, D1)]: { s: "present", u: null } }}
        lockBefore={null}
      >
        <LiveUnits rows={[R2]} fallback={EMPTY_COUNT} />
      </GridProvider>,
    );
    expect(container.textContent).toBe("0");
  });

  it("상단 스탯은 기록이 없으면 0%가 아니라 '기록 없음'", () => {
    const { container } = render(
      <GridProvider rows={[R1]} cols={[D1]} initial={{}} lockBefore={null}>
        <LiveStats totalStudents={3} fallback={EMPTY_COUNT} />
      </GridProvider>,
    );
    expect(container.textContent).toContain("기록 없음");
    expect(container.textContent).not.toContain("0%");
  });

  it("상단 스탯의 출석률·결석·지각도 입력을 따라간다", () => {
    let store: GridStore | null = null;
    const { container } = render(
      <GridProvider
        rows={[R1, R2]}
        cols={[D1, D2]}
        initial={{
          [cellKey(R1, D1)]: { s: "present", u: null },
          [cellKey(R2, D1)]: { s: "present", u: null },
        }}
        lockBefore={null}
      >
        <Probe sink={(s) => (store = s)} />
        <LiveStats totalStudents={2} fallback={EMPTY_COUNT} />
      </GridProvider>,
    );
    expect(container.textContent).toContain("100%");
    act(() => store!.setLocal([[cellKey(R2, D2), { s: "absent", u: null }]]));
    expect(container.textContent).toContain("66.7%");
  });
});
