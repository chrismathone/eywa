import { readFileSync, existsSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * 회차 확정의 **자리 몫 줄**(원장 2026-10-07 *"어떤반의 수업/JJ 비율을 19/5를 20/4로 변경할 수 있으면 가장 편할거같은데 · LAB도
 * 마찬가지겠고"* · *"반별로 한번에 설정도 가능하고, 반 내에서 개별적으로도 설정 가능하게"* · *"굳이 어떤 날을 강제하지 않아도 되고"*).
 */
const h = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), refresh: vi.fn(), success: vi.fn() }));
vi.mock("@/features/attendance/server/seat-share-actions", () => ({ loadSeatShareSheet: h.load, saveSeatShareAdjust: h.save }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: h.refresh }) }));
vi.mock("sonner", () => ({ toast: { success: h.success, error: vi.fn() } }));

import { SeatShareRow } from "./seat-share-row";

const CLASS = "c1";
type Student = { id: string; name: string; gone?: boolean };
const sheet = () => ({
  classId: CLASS, period: "2026-09", seat: 5,
  teachers: [
    { id: "t1", name: "추민아", planned: 19, units: 0, students: {} as Record<string, number>, assigned: true },
    { id: "t2", name: "김그린", planned: 4, units: 0, students: {} as Record<string, number>, assigned: true },
  ],
  students: [{ id: "s1", name: "가학생" }, { id: "s2", name: "나학생" }] as Student[],
});
// `className`은 CSS가 아니라 반 이름이다 — 속성을 펼쳐 넘긴다(디자인 린트가 반 이름을 없는 클래스로 읽지 않게).
const ROW = Object.fromEntries([["classId", CLASS], ["className", "중고E_중3 심화"], ["period", "2026-09"]]) as { classId: string; className: string; period: string };
const mount = (adjusted: { teacherId: string; name: string; units: number; students: number }[] = []) =>
  render(<table><tbody><SeatShareRow {...ROW} adjusted={adjusted} /></tbody></table>);
const openDialog = async () => {
  fireEvent.click(screen.getByRole("button", { name: "몫 조정" }));
  await screen.findByRole("dialog");
};
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const saved = (teachers: { teacherId: string; units: number; students: Record<string, number> }[]) => ({ classId: CLASS, period: "2026-09", teachers });

beforeEach(() => {
  vi.clearAllMocks();
  h.load.mockResolvedValue({ ok: true, sheet: sheet() });
  h.save.mockResolvedValue({ ok: true });
});

describe("자리 몫 줄", () => {
  it("이미 돌린 값을 한 줄로 요약한다 — 없으면 시간표 몫 그대로", () => {
    const { unmount } = mount();
    expect(screen.getByText("시간표 몫 그대로")).toBeTruthy();
    unmount();
    mount([{ teacherId: "t1", name: "추민아", units: 1, students: 2 }, { teacherId: "t2", name: "김그린", units: 0, students: 1 }]);
    expect(screen.getByText("수업 몫으로 돌림 — 추민아 1시수 · 따로 2명 / 김그린 따로 1명")).toBeTruthy();
  });

  it("창은 누를 때 읽는다 — 시간표 기준 몫(선생님 · 자리)이 선다", async () => {
    mount();
    expect(h.load).not.toHaveBeenCalled();
    await openDialog();
    expect(h.load).toHaveBeenCalledExactlyOnceWith({ classId: CLASS, period: "2026-09" });
    expect(screen.getByText(/추민아 19 · 김그린 4 · 자리/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
  });

  it("반 전체 값 하나를 적으면 그 선생님 앞으로 저장한다 — 19/5 → 20/4", async () => {
    mount();
    await openDialog();
    type("추민아 반 전체 시수", "1");
    expect(screen.getByText("바꾼 값이 있습니다")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(h.refresh).toHaveBeenCalledOnce());
    expect(h.save).toHaveBeenCalledExactlyOnceWith(saved([{ teacherId: "t1", units: 1, students: {} }]));
    expect(h.success).toHaveBeenCalledOnce();
  });

  it("학생별로 따로 정할 수 있다 — 비워 두면 반 전체 값을 따르고, 0은 그 학생만 빼기", async () => {
    mount();
    await openDialog();
    type("추민아 반 전체 시수", "1");
    fireEvent.click(screen.getAllByRole("button", { name: "학생별로 따로" })[0]!);
    type("추민아 나학생 시수", "0");
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(h.save).toHaveBeenCalledOnce());
    expect(h.save).toHaveBeenCalledWith(saved([{ teacherId: "t1", units: 1, students: { s2: 0 } }]));
  });

  it("저장돼 있던 값이 채워져 뜬다 — 지우면 0(조정 없음)으로 저장한다 · 바뀐 선생님만 보낸다", async () => {
    const data = sheet();
    data.teachers[0]!.units = 1;
    data.teachers[0]!.students = { s1: 2 };
    h.load.mockResolvedValue({ ok: true, sheet: data });
    mount();
    await openDialog();
    expect((screen.getByLabelText("추민아 반 전체 시수") as HTMLInputElement).value).toBe("1");
    expect((screen.getByLabelText("추민아 가학생 시수") as HTMLInputElement).value).toBe("2"); // 학생 값이 있으면 펼쳐서 보인다
    type("추민아 반 전체 시수", "");
    type("추민아 가학생 시수", "");
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(h.save).toHaveBeenCalledOnce());
    expect(h.save).toHaveBeenCalledWith(saved([{ teacherId: "t1", units: 0, students: {} }]));
  });

  it("🔴 여러 선생님 값은 한 번에 보낸다 — 맞바꾸기(합은 그대로)는 저장을 잠그지 않는다", async () => {
    const data = sheet();
    data.teachers[0]!.units = 2;
    data.teachers[1]!.units = 3;
    h.load.mockResolvedValue({ ok: true, sheet: data });
    mount();
    await openDialog();
    type("추민아 반 전체 시수", "3");
    // 하나만 올린 사이(합 6 > 자리 5)는 잠긴다.
    expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
    type("김그린 반 전체 시수", "2");
    expect(screen.getByRole("button", { name: "저장" })).not.toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(h.save).toHaveBeenCalledOnce());
    expect(h.save).toHaveBeenCalledWith(saved([{ teacherId: "t1", units: 3, students: {} }, { teacherId: "t2", units: 2, students: {} }]));
  });

  it("🔴 틀린 숫자 · 자리 몫을 넘는 값은 저장을 잠그고 이유를 말한다", async () => {
    mount();
    await openDialog();
    type("추민아 반 전체 시수", "0.3");
    expect(screen.getByText("시수는 0 이상 0.5 단위로 적어 주세요.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
    type("추민아 반 전체 시수", "3");
    type("김그린 반 전체 시수", "2.5");
    expect(screen.getByText("자리 몫 5시수보다 많이 돌릴 수 없습니다.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
    type("김그린 반 전체 시수", "2");
    expect(screen.getByRole("button", { name: "저장" })).not.toBeDisabled();
  });

  it("이미 자리 몫을 넘은 값도 줄이는 저장은 잠그지 않는다(시간표가 바뀐 뒤 고칠 수 있어야 한다)", async () => {
    const data = { ...sheet(), seat: 1 };
    data.teachers[0]!.units = 3;
    h.load.mockResolvedValue({ ok: true, sheet: data });
    mount();
    await openDialog();
    type("추민아 반 전체 시수", "2");
    expect(screen.queryByText(/많이 돌릴 수 없습니다/)).toBeNull();
    expect(screen.getByRole("button", { name: "저장" })).not.toBeDisabled();
    type("추민아 반 전체 시수", "3.5");
    expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
  });

  it("저장 실패는 창을 닫지 않고 누구 값이 왜 안 됐는지 보인다", async () => {
    h.save.mockResolvedValue({ ok: false, error: "이 반을 맡은 선생님에게만 돌릴 수 있습니다", teacherId: "t1" });
    mount();
    await openDialog();
    type("추민아 반 전체 시수", "1");
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(await screen.findByText("추민아 — 이 반을 맡은 선생님에게만 돌릴 수 있습니다")).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(h.success).not.toHaveBeenCalled();
  });

  it("🔴 거절되면 기준값을 다시 읽는다 — 그 사이 저장된 값은 '바꾼 값'에서 빠지고, 고쳐서 다시 누르면 남은 것만 간다(적어 둔 값은 그대로)", async () => {
    mount();
    await openDialog();
    type("추민아 반 전체 시수", "1");
    type("김그린 반 전체 시수", "9");
    // 창을 연 사이 다른 사람이 추민아 값을 1로 이미 저장했다 — 서버는 김그린 값을 거절한다.
    const fresh = sheet();
    fresh.teachers[0]!.units = 1;
    h.load.mockResolvedValue({ ok: true, sheet: fresh });
    h.save.mockResolvedValueOnce({ ok: false, error: "이 달 자리 몫 5시수보다 많이 돌릴 수 없습니다" });
    // 창은 합(10 > 5)을 먼저 잡으므로, 서버 거절을 보려면 창의 검사를 통과하는 값으로 보낸다.
    type("김그린 반 전체 시수", "4");
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(await screen.findByText("이 달 자리 몫 5시수보다 많이 돌릴 수 없습니다")).toBeTruthy();
    await waitFor(() => expect(h.load).toHaveBeenCalledTimes(2));
    expect((screen.getByLabelText("김그린 반 전체 시수") as HTMLInputElement).value).toBe("4");
    type("김그린 반 전체 시수", "2");
    await waitFor(() => expect(screen.getByRole("button", { name: "저장" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(h.save).toHaveBeenCalledTimes(2));
    // 추민아 1은 이미 저장돼 있어 다시 보내지 않는다 — 한 명씩 보내던 때는 여기서 "바뀐 값 없음"에 막혀 김그린이 영영 저장되지 않았다.
    expect(h.save).toHaveBeenLastCalledWith(saved([{ teacherId: "t2", units: 2, students: {} }]));
    await waitFor(() => expect(h.success).toHaveBeenCalledOnce());
  });

  it("🔴 거절 뒤 다시 저장할 때 손대지 않은 선생님 값은 보내지 않는다 — 그 사이 남이 고친 값을 옛 값으로 되돌리지 않는다", async () => {
    const data = sheet();
    data.teachers[0]!.units = 1;
    h.load.mockResolvedValue({ ok: true, sheet: data });
    mount();
    await openDialog();
    type("김그린 반 전체 시수", "1");
    // 창을 연 사이 다른 사람이 추민아를 3으로 저장했다.
    const fresh = sheet();
    fresh.teachers[0]!.units = 3;
    h.load.mockResolvedValue({ ok: true, sheet: fresh });
    h.save.mockResolvedValueOnce({ ok: false, error: "저장하지 못했습니다" });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(h.load).toHaveBeenCalledTimes(2));
    // 손대지 않은 칸은 다시 읽은 값(3)을 보인다 — 옛 값(1)이 남아 있으면 그대로 실려 간다.
    await waitFor(() => expect((screen.getByLabelText("추민아 반 전체 시수") as HTMLInputElement).value).toBe("3"));
    await waitFor(() => expect(screen.getByRole("button", { name: "저장" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(h.save).toHaveBeenCalledTimes(2));
    expect(h.save).toHaveBeenLastCalledWith(saved([{ teacherId: "t2", units: 1, students: {} }]));
  });

  it("🔴 그 달 이 반에서 수업 몫이 없는 선생님은 값을 늘릴 수 없다(돌려도 실리지 않는다) — 이유를 말하고 저장을 잠근다", async () => {
    const data = sheet();
    data.teachers[1]!.planned = 0;
    data.teachers[1]!.units = 2;
    h.load.mockResolvedValue({ ok: true, sheet: data });
    mount();
    await openDialog();
    expect(screen.getByText(/수업 몫이 없어 돌려도 실리지 않습니다/)).toBeTruthy();
    type("김그린 반 전체 시수", "3");
    expect(screen.getByText("김그린 — 값을 늘릴 수 없습니다(줄이거나 지울 수만 있습니다).")).toBeTruthy();
    expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
    type("김그린 반 전체 시수", "1");
    expect(screen.queryByText(/값을 늘릴 수 없습니다/)).toBeNull();
    expect(screen.getByRole("button", { name: "저장" })).not.toBeDisabled();
  });

  it("🔴 값이 남은 옛 담당 · 명단에서 빠진 학생은 표시와 함께 보이고 지울 수 있다", async () => {
    const data = sheet();
    data.teachers.push({ id: "t3", name: "옛담당", planned: 0, units: 3, students: { s9: 2 }, assigned: false });
    data.students.push({ id: "s9", name: "떠난학생", gone: true });
    h.load.mockResolvedValue({ ok: true, sheet: data });
    mount();
    await openDialog();
    expect(screen.getByText(/이 달 이 반 담당이 아닙니다/)).toBeTruthy();
    expect(screen.getByText(/이 달 명단에 없음/)).toBeTruthy();
    // 명단에 없는 학생은 값이 남은 선생님 밑에만 보인다.
    expect(screen.queryByLabelText("추민아 떠난학생 시수")).toBeNull();
    type("옛담당 반 전체 시수", "");
    type("옛담당 떠난학생 시수", "");
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(h.save).toHaveBeenCalledOnce());
    expect(h.save).toHaveBeenCalledWith(saved([{ teacherId: "t3", units: 0, students: {} }]));
  });

  it("읽기가 거절되면 줄에서 이유를 말한다(창은 안 뜬다) · 자리 몫이 없는 달은 그렇게 말한다", async () => {
    h.load.mockResolvedValue({ ok: false, error: "급여 비율을 설정할 수 있는 사람만 자리 몫을 조정할 수 있습니다" });
    const { unmount } = mount();
    fireEvent.click(screen.getByRole("button", { name: "몫 조정" }));
    expect(await screen.findByText("급여 비율을 설정할 수 있는 사람만 자리 몫을 조정할 수 있습니다")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    unmount();
    h.load.mockResolvedValue({ ok: true, sheet: { ...sheet(), seat: 0 } });
    mount();
    await openDialog();
    expect(screen.getByText(/돌릴 자리 몫이 없습니다/)).toBeTruthy();
  });
});

describe("배선 — 조정하는 곳은 회차 확정 한 곳", () => {
  // 줄바꿈은 LF로 맞춰 읽는다 — 여러 줄 문자열을 찾는 단언이 CRLF로 받은 작업본에서도 같게 돈다.
  const read = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

  it("회차 확정 면이 자리 몫 줄 재료를 표 조회와 나란히 읽어 표에 넘긴다", () => {
    const face = read("src/app/(shell)/billing/_components/session-terms-face.tsx");
    expect(face).toContain("getTenantSettings(), loadSeatShareSummary(p)]);");
    expect(face).toContain("seatShare={seatShare}");
    const table = read("src/app/(shell)/billing/_components/session-term-table.tsx");
    expect(table).toContain("{hasClass && seatShareClasses.has(g.classId) ? (");
    expect(table).toContain("<SeatShareRow classId={g.classId} className={g.className} period={period} adjusted={seatShare?.adjusted[g.classId] ?? []} />");
  });

  it("🔴 줄은 권한자에게만 — 재료 조회와 두 액션이 같은 문(급여 비율 설정 권한 · 이동 없는 판정)을 본다", () => {
    const summary = read("src/features/attendance/server/seat-share-summary.ts");
    expect(summary).toContain("const user = await attendanceSalaryAdminOrNull();\n    if (!user) return null;");
    const actions = read("src/features/attendance/server/seat-share-actions.ts");
    expect(actions.split("const user = await attendanceSalaryAdminOrNull();\n  if (!user) return { ok: false, error: NO_PERMISSION };").length - 1).toBe(2);
    for (const src of [summary, actions]) expect(src).not.toContain("requireAttendanceSalaryAdmin");
  });

  it("🔴 조정값은 등록 차수 몫에 실린다 — 그 반 선생님 전부를 읽어 줄마다 차례로 나눠 갖고, 못 읽으면 표식을 남긴다", () => {
    const share = read("src/features/attendance/server/teacher-term-share.ts");
    // 이 선생님 것만 읽으면 같은 자리 시수가 두 선생님 상한에 선다 — 반의 조정값 전부를 읽는다(선생님 id를 넘기지 않는다).
    expect(share).toContain("loadSeatShareAdjust(db, tenantId, ids, month),");
    expect(share).toContain("(taken.get(key) ?? 0) + seatShareTakeFor(shareAdjust.get(cls.classId), scope.teacherId, studentId, planned)));");
    expect(share).not.toContain("seatShareUnitsFor(");
    expect(share).toContain("return carryFolded(shareAdjust, carryFolded(takenRows, result));");
    const loader = read("src/features/attendance/server/seat-share-adjust.ts");
    expect(loader).toContain('markFolded(new Map() as SeatShareByClass, "자리 몫 조정을 읽지 못했습니다")');
    expect(loader).not.toContain('.eq("teacher_id", teacherId)');
    // 표가 없다고 읽는 오류는 '표 없음' 코드 둘뿐이다 — 권한 오류 같은 것을 '없음'으로 접으면 낮은 금액이 조용히 나간다.
    expect(loader).toContain('(error.code === "42P01" || error.code === "PGRST205");');
  });

  it("🔴 날짜를 골라 칸을 넘기던 창은 걷었다(원장 '그냥 따로 JJ 전용 시수 이동이 아니라') — 되살리지 않는다", () => {
    for (const gone of [
      "src/app/(shell)/billing/_components/seat-give-row.tsx", "src/features/attendance/seat-give.ts",
      "src/features/attendance/server/seat-give-actions.ts", "src/features/attendance/server/seat-give-summary.ts",
    ]) expect(existsSync(gone), gone).toBe(false);
  });

  it("감사로그는 급여 갈래다 — 외부 알림으로 나가지 않는다", async () => {
    const { activityGradeOf } = await import("@/features/slack/activity-catalog");
    expect(activityGradeOf("payroll_seat_share_set")).toBe("forbid");
    expect(read("src/features/audit/server/log.ts")).toContain('payroll_seat_share_set: "자리 몫 조정(수업 몫으로 돌리기)"');
  });
});
