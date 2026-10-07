import fs from "node:fs";
import path from "node:path";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ transfer: vi.fn(), refresh: vi.fn(), done: vi.fn(), ok: vi.fn(), fail: vi.fn() }));
vi.mock("@/features/attendance/server/seat-transfer-actions", () => ({ transferSeatUnits: h.transfer }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: h.refresh }) }));
vi.mock("sonner", () => ({ toast: { success: h.ok, error: h.fail } }));

import { JjTransferSection } from "./jj-transfer-section";

const props = { classId: "c1", studentId: "s1", sessionDate: "2026-10-07", teacherId: "t1", onDone: h.done };
const read = (...p: string[]) => fs.readFileSync(path.join(process.cwd(), "src", ...p), "utf8");

beforeEach(() => { vi.clearAllMocks(); h.transfer.mockResolvedValue({ ok: true, moved: 1 }); });
afterEach(cleanup);

// 원장 2026-10-07 — *"JJ 시수를 선생님에게 … JJ가 -1되면, 다른 선생님이 +1 되도록. / 월별 출석부 우클릭으로 (권한 보유자 전용)"*.
describe("칸 팝오버의 JJ실 시수 넘기기", () => {
  it("아직 방 몫인 시수가 있으면 '넘겨받기' — 누르면 그 칸·그 선생님으로 저장하고 화면을 다시 읽는다", async () => {
    render(<JjTransferSection {...props} units={[1, 0, 0]} />);
    expect(screen.queryByRole("button", { name: /되돌리기/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "JJ실 시수 1 넘겨받기" }));
    await waitFor(() => expect(h.refresh).toHaveBeenCalledTimes(1));
    expect(h.transfer).toHaveBeenCalledWith({ classId: "c1", studentId: "s1", date: "2026-10-07", teacherId: "t1", take: true });
    expect(h.ok).toHaveBeenCalledWith("JJ실 시수 1을(를) 이 선생님 몫으로 넘겼습니다");
    expect(h.done).toHaveBeenCalledTimes(1);
  });

  it("넘겨받은 시수가 있으면 '되돌리기' — 둘 다 있으면 둘 다 선다(소수 시수 표기)", async () => {
    render(<JjTransferSection {...props} units={[0.5, 1.5, 1]} />);
    expect(screen.getByRole("button", { name: "JJ실 시수 0.5 넘겨받기" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "JJ실 시수 1.5 되돌리기" }));
    await waitFor(() => expect(h.transfer).toHaveBeenCalledWith(expect.objectContaining({ take: false })));
  });

  it("🔴 넘겨받은 기록이 결석으로 바뀌어 시수가 0이어도 되돌릴 수 있다 — 버튼이 사라지면 그 칸은 영영 그 선생님 것으로 남는다", async () => {
    render(<JjTransferSection {...props} units={[0, 0, 1]} />);
    fireEvent.click(screen.getByRole("button", { name: "넘겨받은 JJ실 기록 되돌리기" }));
    await waitFor(() => expect(h.transfer).toHaveBeenCalledWith(expect.objectContaining({ take: false })));
  });

  it("JJ실 시수가 없는 칸에는 아무것도 서지 않는다", () => {
    const { container } = render(<JjTransferSection {...props} units={[0, 0, 0]} />);
    expect(container.innerHTML).toBe("");
  });

  it("실패하면 서버가 준 이유를 알리고 닫지 않는다 — 액션이 던져도 같은 갈래", async () => {
    h.transfer.mockResolvedValue({ ok: false, error: "이 칸의 JJ실 시수는 이미 다른 선생님 몫으로 넘겨져 있습니다" });
    render(<JjTransferSection {...props} units={[1, 0, 0]} />);
    fireEvent.click(screen.getByRole("button", { name: "JJ실 시수 1 넘겨받기" }));
    await waitFor(() => expect(h.fail).toHaveBeenCalledWith("이 칸의 JJ실 시수는 이미 다른 선생님 몫으로 넘겨져 있습니다"));
    expect(h.refresh).not.toHaveBeenCalled();
    expect(h.done).not.toHaveBeenCalled();
    h.transfer.mockRejectedValue(new Error("network"));
    fireEvent.click(screen.getByRole("button", { name: "JJ실 시수 1 넘겨받기" }));
    await waitFor(() => expect(h.fail).toHaveBeenCalledWith("JJ실 시수를 넘기지 못했습니다. 다시 눌러 주세요."));
  });
});

describe("JJ실 시수 넘기기 — 배선", () => {
  const page = read("app", "(shell)", "attendance", "page.tsx");

  it("🔴 권한 보유자 전용 — 급여 비율을 고칠 수 있는 사람의 강사 전체 보기에만 재료(jjUnits)를 내려보낸다", () => {
    expect(page).toContain("requireAttendanceSalaryAdmin()");
    expect(page).toMatch(/const canTransferSeat = [^;]*mode === "teacher"[^;]*seatAdmin/);
    // 그 밖의 화면(선생님 본인 · 권한 없는 직원 · 반별 보기)은 매트릭스에서 지운다 — 화면에서 감추는 게 아니라 안 보낸다.
    expect(page).toMatch(/canTransferSeat \|\| !g\.matrix\.jjUnits \? g : \{ \.\.\.g, matrix: \{ \.\.\.g\.matrix, jjUnits: undefined \} \}/);
    expect(page).toContain("canTransferSeat: true");
  });

  it("칸은 재료와 화면 신호가 둘 다 있을 때만 넘기기를 세운다 — 스코프 반 밖(보강 묶음)엔 안 선다", () => {
    const popover = read("app", "(shell)", "attendance", "_components", "cell-popover.tsx");
    expect(popover).toContain("jjUnits && scope?.canTransferSeat && scope.classIds.has(classId)");
    expect(read("app", "(shell)", "attendance", "_components", "matrix-row.tsx")).toContain("jjUnits={matrix.jjUnits?.[student.id]?.[d.date]}");
  });

  it("매트릭스는 화면·저장과 같은 판정(isJjSeatRow)으로 세고, 다른 선생님이 넘겨받은 시수는 안 센다", () => {
    const queries = read("features", "attendance", "server", "queries.ts");
    expect(queries).toContain("isJjSeatRow({ slotStart: slot, seatLabel: r.seat_label, recordedVia: r.recorded_via }, axisSlots, r.session_date)");
    expect(queries).toContain("holder === null || holder === scopeTeacherId");
    // 넘겨받은 행은 시수 0이어도 싣는다(되돌리기 버튼의 재료).
    expect(queries).toContain("if (jj > 0 || holder === scopeTeacherId)");
    expect(read("features", "attendance", "server", "seat-transfer-actions.ts")).toContain("seatTransferTargets(current, slots, input.date, input.teacherId, input.take)");
  });

  it("🔴 넘긴 뒤 — 강사 보기 저장 네 갈래(지우기·칸·범위·메모만)가 넘겨받은 행이 있는 칸을 거절한다", () => {
    const actions = read("features", "attendance", "server", "actions.ts");
    expect(actions.split("takenSeat?.(").length - 1).toBe(4);
    // 메모만 저장도 같은 사유로 — 화면은 넘겨받은 행의 메모를 칸 메모로 보여 주는데 저장은 그 행을 건드리지 않는다.
    expect(actions).toContain("if (day.rows.some((r) => day.share.takenSeat?.(classId, sessionDate, r) === true)) return { error: SCOPED_REJECT_MESSAGE.seatTaken };");
    expect(read("features", "attendance", "scope-ownership.ts")).toContain(`if (takenSeat(classId, date, row)) return "seat";`);
  });

  it("넘겨받은 시수만큼 등록 차수 몫을 옮기고(실급여 상한), JJ실 월간 집계에서는 뺀다", () => {
    const share = read("features", "attendance", "server", "teacher-term-share.ts");
    expect(share).toContain(`.eq("taught_by", teacherId)`);
    expect(share).toContain("withTakenSeatUnits(");
    // 다른 재료와 함께 읽고(B4), 못 읽으면 접힘 표식을 남겨 명세서가 멈춘다(조용히 낮은 금액으로 발행하지 않는다).
    expect(share).toContain("loadTakenSeatRows(db, tenantId, ids, scope.teacherId, from, to),");
    expect(share).toContain('markFolded([] as TakenRow[], "넘겨받은 JJ실 시수를 읽지 못했습니다")');
    expect(share).toContain("return carryFolded(takenRows, result);");
    expect(read("features", "attendance", "server", "class-billing.ts")).toContain("if (weightsFolded) degraded.push(weightsFolded);");
    expect(read("features", "attendance", "seat", "monthly-build.ts")).toContain("if (hit.rec.taughtBy) {");
    expect(read("features", "attendance", "seat", "server", "monthly-queries.ts")).toContain("taughtBy: r.taught_by ?? null");
  });

  it("감사로그는 급여 갈래다 — 슬랙으로 나가지 않는다", async () => {
    const { activityGradeOf } = await import("@/features/slack/activity-catalog");
    expect(activityGradeOf("payroll_jj_units_take")).toBe("forbid");
    expect(activityGradeOf("payroll_jj_units_return")).toBe("forbid");
    expect(read("features", "attendance", "server", "seat-transfer-actions.ts")).toContain(`"payroll_jj_units_take" : "payroll_jj_units_return"`);
  });

  it("🔴 서버가 게이트를 다시 본다 — 급여 비율을 고칠 수 있는 사람 · 그 달 그 반을 맡은 선생님", () => {
    const action = read("features", "attendance", "server", "seat-transfer-actions.ts");
    expect(action).toContain("await requireAttendanceSalaryAdmin()");
    expect(action).toContain("scopeTeaches(own, input.teacherId, input.date)");
  });
});
