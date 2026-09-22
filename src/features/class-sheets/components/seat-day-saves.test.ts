import { act, renderHook, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSeatDaySaves, type SeatAtt } from "./seat-day-saves";
import { seatAttKey } from "../lib/seat-day";
import { setAttendanceCell } from "@/features/attendance/server/actions";

vi.mock("@/features/attendance/server/actions", () => ({ setAttendanceCell: vi.fn() }));
vi.mock("../server/actions", () => ({ clearPresentAttendance: vi.fn(), upsertStudentMark: vi.fn() }));

const key = seatAttKey("c1", "s1", "15:00");
function setup() {
  return renderHook(() => {
    const [attendance, setAttendance] = useState<Record<string, SeatAtt | null>>({});
    const handlers = useSeatDaySaves(attendance, setAttendance, {}, vi.fn())("c1");
    return { attendance, handlers };
  });
}
beforeEach(() => vi.clearAllMocks());

describe("JJ 합명단 자동 시수 표시", () => {
  it("저장한 1.5시수를 새로고침 없이 표시한다", async () => {
    vi.mocked(setAttendanceCell).mockResolvedValueOnce({ ok: true, autoUnits: 1.5 });
    const { result } = setup();
    act(() => result.current.handlers.setAttendance("s1", "2026-09-22", "15:00", "present"));
    await waitFor(() => expect(result.current.attendance[key]?.units).toBe(1.5));
  });
  it("늦게 온 자동값 응답이 그 사이 직접 입력한 시수를 덮지 않는다", async () => {
    let finish!: (value: Awaited<ReturnType<typeof setAttendanceCell>>) => void;
    vi.mocked(setAttendanceCell).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
      .mockResolvedValueOnce({ ok: true });
    const { result } = setup();
    act(() => result.current.handlers.setAttendance("s1", "2026-09-22", "15:00", "present"));
    await act(async () => result.current.handlers.setAttendance("s1", "2026-09-22", "15:00", "present", undefined, "2.5"));
    await act(async () => finish({ ok: true, autoUnits: 1.5 }));
    expect(result.current.attendance[key]?.units).toBe(2.5);
  });
});
