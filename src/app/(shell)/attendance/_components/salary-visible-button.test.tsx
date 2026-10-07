import fs from "node:fs";
import path from "node:path";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeTip } from "@/components/hover-tip/tip";
import { activityGradeOf } from "@/features/slack/activity-catalog";
import { DEFAULT_ATTENDANCE_PREFS, parseAttendanceViewPrefs } from "@/features/attendance/view-prefs";

const h = vi.hoisted(() => ({ save: vi.fn(), refresh: vi.fn(), toastError: vi.fn(), toastOk: vi.fn() }));
vi.mock("@/features/attendance/server/salary-rates-actions", () => ({ saveAttendanceSalaryVisible: h.save }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: h.refresh }) }));
vi.mock("sonner", () => ({ toast: { error: h.toastError, success: h.toastOk } }));

import { SalaryVisibleButton } from "./salary-visible-button";

const teacherId = "aaaaaaaa-1111-1111-1111-111111111111";
const MONTH = "2026-09";
const read = (...p: string[]) => fs.readFileSync(path.join(process.cwd(), "src", ...p), "utf8");
const button = () => screen.getByRole("button", { name: "합계 및 실급여 보여주기" });

beforeEach(() => { vi.clearAllMocks(); h.save.mockResolvedValue({ ok: true }); });
afterEach(cleanup);

// 원장 2026-10-07 — *"이름을 합계 및 실급여 보여주기로 버튼 변경 (마우스 오버시 자세한 설명)"*.
describe("합계 및 실급여 보여주기 버튼", () => {
  it("눌림 상태로 켜짐·꺼짐을 말하고, 설명은 카드 툴팁에 담는다(누가 보게 되는지 · 선생님별 저장)", () => {
    render(<SalaryVisibleButton teacherId={teacherId} month={MONTH} checked={false} canEdit />);
    expect(button().getAttribute("aria-pressed")).toBe("false");
    expect(button().hasAttribute("title")).toBe(false); // 같은 설명을 title로 겹쳐 달지 않는다
    const tip = decodeTip(button().getAttribute("data-tip"));
    expect(tip?.title).toBe("합계 및 실급여 보여주기");
    expect(tip?.meta).toBe("꺼짐");
    const text = tip?.lines.join("\n") ?? "";
    expect(text).toContain("선생님 본인의 출석부(강사 화면)");
    expect(text).toContain("선생님마다 · 달마다 따로 저장");
    expect(text).toContain("지금은 9월 출석부에만 적용");
    expect(text).toContain("0.911");
    expect(text).not.toContain("바꿀 수 있습니다"); // 바꿀 수 있는 사람에겐 '못 바꾼다' 안내가 없다
  });

  it("누르면 그 선생님의 스위치를 저장하고 화면을 다시 읽는다 — 누르는 즉시 눌림이 바뀐다", async () => {
    render(<SalaryVisibleButton teacherId={teacherId} month={MONTH} checked={false} canEdit />);
    fireEvent.click(button());
    expect(button().getAttribute("aria-pressed")).toBe("true");
    await waitFor(() => expect(h.refresh).toHaveBeenCalledTimes(1));
    expect(h.save).toHaveBeenCalledWith({ teacherId, month: MONTH, visible: true });
    expect(decodeTip(button().getAttribute("data-tip"))?.meta).toBe("켜짐 · 선생님에게 보임");
    // 🔴 버튼 뜻이 '선생님에게 공개'다 — 켜는 순간 누구에게 보이게 되는지 알린다.
    expect(h.toastOk).toHaveBeenCalledWith("이제 9월 출석부의 실급여와 합계가 이 선생님 본인에게도 보입니다");
  });

  it("끄면 양쪽에서 감췄다고 알린다", async () => {
    render(<SalaryVisibleButton teacherId={teacherId} month={MONTH} checked canEdit />);
    fireEvent.click(button());
    await waitFor(() => expect(h.toastOk).toHaveBeenCalledWith("9월 출석부에서 실급여를 감췄습니다(이 화면과 선생님 화면 모두)"));
    expect(h.save).toHaveBeenCalledWith({ teacherId, month: MONTH, visible: false });
  });

  it("🔴 강사를 바꾸면 눌림을 그 선생님 값으로 다시 읽는다 — A를 켠 직후 B로 넘어가도 B가 켜진 것처럼 보이지 않는다", async () => {
    let finish: (v: { ok: boolean }) => void = () => {};
    h.save.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const other = "bbbbbbbb-2222-2222-2222-222222222222";
    const view = render(<SalaryVisibleButton teacherId={teacherId} month={MONTH} checked={false} canEdit />);
    fireEvent.click(button()); // A를 켠다(저장 응답 전)
    expect(button().getAttribute("aria-pressed")).toBe("true");
    // 새로고침 결과가 오기 전에 B(꺼짐)로 넘어간다 — `checked`는 그대로 false다.
    view.rerender(<SalaryVisibleButton teacherId={other} month={MONTH} checked={false} canEdit />);
    expect(button().getAttribute("aria-pressed")).toBe("false");
    finish({ ok: true });
    await waitFor(() => expect(h.refresh).toHaveBeenCalled());
    expect(button().getAttribute("aria-pressed")).toBe("false");
  });

  it("🔴 달을 바꾸면 눌림을 그 달 값으로 다시 읽는다 — 9월을 켠 직후 10월로 넘어가도 10월이 켜진 것처럼 보이지 않는다", async () => {
    let finish: (v: { ok: boolean }) => void = () => {};
    h.save.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const view = render(<SalaryVisibleButton teacherId={teacherId} month={MONTH} checked={false} canEdit />);
    fireEvent.click(button()); // 9월을 켠다(저장 응답 전)
    expect(button().getAttribute("aria-pressed")).toBe("true");
    view.rerender(<SalaryVisibleButton teacherId={teacherId} month="2026-10" checked={false} canEdit />);
    expect(button().getAttribute("aria-pressed")).toBe("false");
    expect(decodeTip(button().getAttribute("data-tip"))?.lines.join("\n")).toContain("지금은 10월 출석부에만 적용");
    finish({ ok: true });
    await waitFor(() => expect(h.refresh).toHaveBeenCalled());
    // 늦게 온 9월 저장 응답이 10월 버튼을 건드리지 않는다 · 알림도 9월로 말한다.
    expect(button().getAttribute("aria-pressed")).toBe("false");
    expect(h.save).toHaveBeenCalledWith({ teacherId, month: MONTH, visible: true });
    expect(h.toastOk).toHaveBeenCalledWith("이제 9월 출석부의 실급여와 합계가 이 선생님 본인에게도 보입니다");
  });

  it("서버 값이 바뀌어 다시 그려지면 그 값을 따른다", () => {
    const view = render(<SalaryVisibleButton teacherId={teacherId} month={MONTH} checked={false} canEdit />);
    view.rerender(<SalaryVisibleButton teacherId={teacherId} month={MONTH} checked canEdit />);
    expect(button().getAttribute("aria-pressed")).toBe("true");
  });

  it("켜짐·꺼짐에서 버튼 속 자리(상태 점)가 같다 — 누를 때 표 위 한 줄이 밀리지 않게", () => {
    const view = render(<SalaryVisibleButton teacherId={teacherId} month={MONTH} checked={false} canEdit />);
    const off = button().children.length;
    view.rerender(<SalaryVisibleButton teacherId={teacherId} month={MONTH} checked canEdit />);
    expect(button().children.length).toBe(off);
  });

  it("저장이 실패하면 눌림을 되돌리고 서버가 준 이유를 알린다 — 화면은 다시 읽지 않는다", async () => {
    h.save.mockResolvedValue({ ok: false, error: "프리랜서 선생님만 설정할 수 있습니다" });
    render(<SalaryVisibleButton teacherId={teacherId} month={MONTH} checked canEdit />);
    fireEvent.click(button());
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("프리랜서 선생님만 설정할 수 있습니다"));
    expect(button().getAttribute("aria-pressed")).toBe("true");
    expect(h.refresh).not.toHaveBeenCalled();
  });

  it("액션이 던져도(네트워크 끊김) 같은 갈래로 받는다", async () => {
    h.save.mockRejectedValue(new Error("network"));
    render(<SalaryVisibleButton teacherId={teacherId} month={MONTH} checked={false} canEdit />);
    fireEvent.click(button());
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("합계 및 실급여 보여주기 설정을 저장하지 못했습니다. 다시 눌러 주세요."));
    expect(button().getAttribute("aria-pressed")).toBe("false");
  });

  it("급여 비율을 고칠 수 없는 사람에겐 상태만 보인다(눌리지 않는다) — 이유는 카드에 적는다", () => {
    render(<SalaryVisibleButton teacherId={teacherId} month={MONTH} checked canEdit={false} />);
    expect((button() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button());
    expect(h.save).not.toHaveBeenCalled();
    expect(decodeTip(button().getAttribute("data-tip"))?.lines.join("\n")).toContain("급여 비율을 설정할 수 있는 사람만 바꿀 수 있습니다");
  });
});

describe("합계 및 실급여 보여주기 — 배선", () => {
  const page = read("app", "(shell)", "attendance", "page.tsx");

  it("표에 실급여를 싣는 것은 그 선생님의 스위치뿐이다 — 누르는 사람의 보기 설정이 아니다", () => {
    expect(page).toContain("salaryRates={salaryConfig?.visible ? salaryConfig.rates : undefined}");
    expect(page).not.toContain("showActualSalary");
  });

  it("비율 설정·스위치 버튼은 관리자 화면에만 선다 — 선생님 본인 화면(manage false)엔 없다", () => {
    expect(page).toContain("optionsExtra={salaryConfig?.manage ? <>");
    expect(page).toContain("salaryView={!!salaryConfig?.manage}");
    // 🔴 `key` — 강사를 바꾸면 버튼을 갈아 끼운다(검색 파라미터만 바뀌는 이동은 컴포넌트를 다시 만들지 않는다).
    expect(page).toContain("<SalaryVisibleButton key={`${salaryConfig.teacherId}:${month}`} teacherId={salaryConfig.teacherId} month={month} checked={salaryConfig.visible} canEdit={salaryConfig.canEdit} />");
    // 🔴 스위치는 출석부가 보는 **그 달**의 것이다 — 달 없이 읽지 않는다.
    expect(page).toContain("getAttendanceSalaryRates(mode === \"teacher\" ? effectiveTeacher : classScopeTeacher, month)");
  });

  it("🔴 선생님 본인의 반별 보기에서도 실급여 재료를 읽는다 — 반을 골라 보는 선생님에게 열이 안 서던 것", () => {
    // 반별 보기의 강사 스코프는 로그인한 선생님 본인뿐이다(관리자가 고른 반은 null) — 관리자 반별 보기는 종전 그대로.
    expect(page).toMatch(/const classScopeTeacher =\s*mode === "class" && myTeacherId && selectedClass && classTaughtBy\(selectedClass, myTeacherId\) \? myTeacherId : null;/);
    // 실수업액·청구 상한도 같은 축을 본다(반별 보기에서 열과 재료가 갈리지 않게).
    expect(page).toContain("canShowAttendanceActualAmount(mode === \"teacher\" ? effectiveTeacher : classScopeTeacher ?? ");
  });

  it("🔴 계정 귀속 보기 설정으로 되살리지 않는다 — 선생님이 제 계정 설정으로 스스로 켤 수 있게 된다", () => {
    expect(Object.keys(DEFAULT_ATTENDANCE_PREFS)).not.toContain("showActualSalary");
    expect(parseAttendanceViewPrefs({ showActualSalary: true })).not.toHaveProperty("showActualSalary");
    expect(read("features", "attendance", "server", "prefs-actions.ts")).not.toContain("ShowActualSalary");
  });

  it("스위치 표는 서버 전용이다 — 선생님 계정이 직접 읽거나 고칠 수 없다", () => {
    const month = fs.readFileSync(path.join(process.cwd(), "supabase", "migrations", "0353a_attendance_salary_view_month.sql"), "utf8");
    // 달별 저장(0353a) — 그때 켜져 있던 줄은 9월 것이 되고, 새 키는 지점 · 선생님 · 달이다.
    expect(month).toContain("add column if not exists period text not null default '2026-09'");
    expect(month).toContain("(tenant_id, teacher_id, period)");
    expect(month).not.toMatch(/create policy/i);
    const sql = fs.readFileSync(path.join(process.cwd(), "supabase", "migrations", "0352a_attendance_salary_teacher_view.sql"), "utf8");
    expect(sql).toContain("enable row level security");
    expect(sql).toContain("revoke all on public.attendance_salary_teacher_view from anon, authenticated");
    expect(sql).not.toMatch(/create policy/i);
  });

  it("감사로그는 급여 갈래다 — 슬랙으로 나가지 않는다", () => {
    expect(activityGradeOf("payroll_sheet_visible_set")).toBe("forbid");
    expect(read("features", "attendance", "server", "salary-rates-actions.ts")).toContain(`action: "payroll_sheet_visible_set"`);
  });
});
