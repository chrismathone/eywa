import { readFileSync, existsSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * 회차 확정의 **JJ실 줄**(원장 2026-10-07 *"지금 회차 확정에 JJ가 없으니까 이 고생을 하고 있는데, 회차 확정에 JJ반이 생기면 거기서 주면
 * 그냥 쉽게 해결할 수 있는것 같은데?"* → 선택: JJ 줄 + 날짜 골라 주기 · 다른 입구는 없앤다).
 */
const h = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), refresh: vi.fn(), success: vi.fn() }));
vi.mock("@/features/attendance/server/seat-give-actions", () => ({ loadSeatGiveSheet: h.load, saveSeatGives: h.save }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: h.refresh }) }));
vi.mock("sonner", () => ({ toast: { success: h.success, error: vi.fn() } }));

import { SeatGiveRow } from "./seat-give-row";

const CLASS = "c1";
const sheet = () => ({
  classId: CLASS, period: "2026-10", dates: ["2026-10-06", "2026-10-07"],
  students: [{ id: "s1", name: "가학생" }, { id: "s2", name: "나학생" }],
  cells: {
    s1: { "2026-10-06": { units: 1, holder: null }, "2026-10-07": { units: 2, holder: "t1" } },
    s2: { "2026-10-06": { units: 1, holder: null } },
  },
  teachers: [{ id: "t1", name: "추민아" }, { id: "t2", name: "김그린" }],
  names: { t1: "추민아", t2: "김그린" },
});
const mount = (given: { teacherId: string; name: string; units: number }[] = []) =>
  render(<table><tbody><SeatGiveRow classId={CLASS} className="중등E_중2 심화" period="2026-10" given={given} /></tbody></table>);
const openDialog = async () => {
  fireEvent.click(screen.getByRole("button", { name: "선생님에게 주기" }));
  await screen.findByRole("dialog");
};

beforeEach(() => {
  vi.clearAllMocks();
  h.load.mockResolvedValue({ ok: true, sheet: sheet() });
  h.save.mockResolvedValue({ ok: true, changed: 2, units: 2, missing: 0 });
});

describe("JJ실 줄", () => {
  it("이미 준 시수를 한 줄로 요약한다 — 없으면 없다고", () => {
    const { unmount } = mount();
    expect(screen.getByText("선생님에게 준 시수 없음")).toBeTruthy();
    unmount();
    mount([{ teacherId: "t1", name: "추민아", units: 3 }, { teacherId: "t2", name: "김그린", units: 1.5 }]);
    expect(screen.getByText("선생님에게 준 시수 — 추민아 3 · 김그린 1.5")).toBeTruthy();
  });

  it("창은 누를 때 읽는다 — 날짜마다 JJ실 기록 수와 지금 몫이 선다", async () => {
    mount();
    expect(h.load).not.toHaveBeenCalled();
    await openDialog();
    expect(h.load).toHaveBeenCalledExactlyOnceWith({ classId: CLASS, period: "2026-10" });
    expect(screen.getByText("10/6(화)")).toBeTruthy();
    expect(screen.getByText("2명 · 2시수")).toBeTruthy();
    expect((screen.getByLabelText("10/6(화) 시수의 몫") as HTMLSelectElement).value).toBe("");
    expect((screen.getByLabelText("10/7(수) 시수의 몫") as HTMLSelectElement).value).toBe("t1");
  });

  it("날짜에 선생님을 고르면 그 날 그 반 학생 전원의 칸을 보낸다", async () => {
    mount();
    await openDialog();
    fireEvent.change(screen.getByLabelText("10/6(화) 시수의 몫"), { target: { value: "t1" } });
    expect(screen.getByText("바꾼 칸 2개")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(h.refresh).toHaveBeenCalledOnce());
    expect(h.save).toHaveBeenCalledExactlyOnceWith({ classId: CLASS, period: "2026-10", changes: [
      { studentId: "s1", date: "2026-10-06", teacherId: "t1" },
      { studentId: "s2", date: "2026-10-06", teacherId: "t1" },
    ] });
    expect(h.success).toHaveBeenCalledOnce();
  });

  it("학생별로 따로 고를 수 있다 · 되돌리기는 'JJ실 그대로'", async () => {
    mount();
    await openDialog();
    fireEvent.click(screen.getAllByRole("button", { name: "학생별" })[0]!);
    fireEvent.change(screen.getByLabelText("나학생 10/6(화) 시수의 몫"), { target: { value: "t2" } });
    // 그 날짜는 이제 학생마다 다르다.
    expect((screen.getByLabelText("10/6(화) 시수의 몫") as HTMLSelectElement).value).toBe("varies");
    fireEvent.change(screen.getByLabelText("10/7(수) 시수의 몫"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(h.save).toHaveBeenCalledOnce());
    expect(h.save.mock.calls[0]![0].changes).toEqual([
      { studentId: "s1", date: "2026-10-07", teacherId: null },
      { studentId: "s2", date: "2026-10-06", teacherId: "t2" },
    ]);
  });

  it("🔴 잘못 고른 날짜는 [되돌리기]로 처음 상태로 — 'JJ실 그대로'로 취소하면 이미 준 칸까지 되돌려 버린다", async () => {
    // 10/6: 가학생은 이미 추민아, 나학생은 JJ실 — 처음부터 학생마다 다르다.
    const mixedDay = sheet();
    (mixedDay.cells.s1 as Record<string, { units: number; holder: string | null }>)["2026-10-06"] = { units: 1, holder: "t1" };
    h.load.mockResolvedValue({ ok: true, sheet: mixedDay });
    mount();
    await openDialog();
    const day = () => screen.getByLabelText("10/6(화) 시수의 몫") as HTMLSelectElement;
    expect(day().value).toBe("varies");
    expect(screen.queryByRole("button", { name: "10/6(화) 되돌리기" })).toBeNull(); // 손대지 않은 날짜엔 없다
    fireEvent.change(day(), { target: { value: "t2" } }); // 잘못 눌렀다
    expect(screen.getByText("바꾼 칸 2개")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "10/6(화) 되돌리기" }));
    expect(day().value).toBe("varies");
    expect(screen.getByText("바꾼 칸 없음")).toBeTruthy();
    expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "10/6(화) 되돌리기" })).toBeNull();
  });

  it("바꾼 칸이 없으면 저장을 잠근다 · 저장 실패는 창을 닫지 않고 이유를 보인다", async () => {
    h.save.mockResolvedValue({ ok: false, error: "이 반을 맡은 선생님에게만 줄 수 있습니다" });
    mount();
    await openDialog();
    expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("10/6(화) 시수의 몫"), { target: { value: "t2" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(await screen.findByText("이 반을 맡은 선생님에게만 줄 수 있습니다")).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(h.refresh).not.toHaveBeenCalled();
  });

  it("읽기가 거절되면 줄에서 이유를 말한다(창은 안 뜬다) · 기록이 없는 달은 그렇게 말한다", async () => {
    h.load.mockResolvedValue({ ok: false, error: "급여 비율을 설정할 수 있는 사람만 JJ실 시수를 줄 수 있습니다" });
    const first = mount();
    fireEvent.click(screen.getByRole("button", { name: "선생님에게 주기" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("급여 비율을 설정할 수 있는 사람만");
    expect(screen.queryByRole("dialog")).toBeNull();
    first.unmount();
    h.load.mockResolvedValue({ ok: true, sheet: { ...sheet(), dates: [], students: [], cells: {} } });
    mount();
    await openDialog();
    expect(screen.getByText(/이 달에는 이 반의 JJ실 출결 기록이 없습니다/)).toBeTruthy();
  });
});

describe("배선 — 주는 곳은 회차 확정 한 곳", () => {
  const read = (path: string) => readFileSync(path, "utf8");
  it("회차 확정 면이 JJ실 줄 재료를 표 조회와 나란히 읽어 표에 넘긴다", () => {
    const face = read("src/app/(shell)/billing/_components/session-terms-face.tsx");
    expect(face).toContain("getSessionTermsView(p, undefined, { lastMonth: true }), getTenantSettings(), loadSeatGiveSummary(p)]);");
    expect(face).toContain("seatGive={seatGive}");
    const table = read("src/app/(shell)/billing/_components/session-term-table.tsx");
    expect(table).toContain("{hasClass && seatGiveClasses.has(g.classId) ? (");
    expect(table).toContain("<SeatGiveRow classId={g.classId} className={g.className} period={period} given={seatGive?.given[g.classId] ?? []} />");
  });

  it("🔴 줄은 권한자에게만 — 재료 조회와 두 액션이 같은 문(급여 비율 설정 권한)을 본다", () => {
    // 🔴 이동(redirect) 없는 문이다 — 출석부 메뉴가 닫힌 수납 계정이 회차 확정을 열어도 화면이 튕기지 않는다(줄만 안 선다).
    const summary = read("src/features/attendance/server/seat-give-summary.ts");
    expect(summary).toContain("const user = await attendanceSalaryAdminOrNull();\n    if (!user) return null;");
    expect(summary).not.toContain("requireAttendanceSalaryAdmin");
    const actions = read("src/features/attendance/server/seat-give-actions.ts");
    expect(actions.split("const user = await attendanceSalaryAdminOrNull();\n  if (!user) return { ok: false, error: NO_PERMISSION };").length - 1).toBe(2);
    expect(actions).not.toContain("requireAttendanceSalaryAdmin");
    const gate = read("src/features/attendance/server/salary-rates.ts");
    const soft = gate.slice(gate.indexOf("export async function attendanceSalaryAdminOrNull"), gate.indexOf("강사 한 명의 **출석부 실급여 비율**"));
    expect(soft).not.toContain("requireAccess(");
    expect(soft).toContain('canAccessTenant(user.systemRole, "attendance")');
    expect(soft).toContain('isModuleEnabled((await getTenantSettings()).modules.disabled, "payroll")');
    expect(soft).toContain("isReadonlyTeacherView()");
    // 받는 선생님은 저장 때 다시 판정한다(화면의 선택지를 믿지 않는다).
    expect(actions).toContain("if (c.teacherId && !scopeTeaches(own, c.teacherId, c.date))");
  });

  it("🔴 월별 출석부 칸의 넘기기 버튼은 걷었다(원장 '못찾겠으니까') — 되살리지 않는다", () => {
    expect(existsSync("src/app/(shell)/attendance/_components/jj-transfer-section.tsx")).toBe(false);
    expect(existsSync("src/features/attendance/server/seat-transfer-actions.ts")).toBe(false);
    expect(read("src/app/(shell)/attendance/_components/cell-popover.tsx")).not.toContain("jjUnits");
    expect(read("src/features/attendance/server/queries.ts")).not.toContain("jjUnits");
    expect(read("src/features/teacher-view/i18n.ts")).not.toContain("att.pop.jj.");
  });

  it("넘긴 뒤의 규칙은 그대로다 — 강사 보기 저장 보호 · 등록 차수 몫 이동 · JJ실 월간 합계에서 빼기", () => {
    expect(read("src/features/attendance/scope-ownership.ts")).toContain(`if (takenSeat(classId, date, row)) return "seat";`);
    expect(read("src/features/attendance/server/teacher-term-share.ts")).toContain("withTakenSeatUnits(");
    expect(read("src/features/attendance/seat/monthly-build.ts")).toContain("if (hit.rec.taughtBy) {");
  });

  it("감사로그는 급여 갈래다 — 외부 알림으로 나가지 않는다", async () => {
    const { activityGradeOf } = await import("@/features/slack/activity-catalog");
    expect(activityGradeOf("payroll_jj_units_take")).toBe("forbid");
    expect(activityGradeOf("payroll_jj_units_return")).toBe("forbid");
  });
});
