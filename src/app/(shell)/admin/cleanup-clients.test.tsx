import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 데이터 정리 면의 두 화면(고아 데이터 점검 · 중복 병합)(2026-10-06).
 *  · 정리 작업 버튼은 **그 액션의 권한**을 따른다(학원 설정 쓰기 권한이 아니다). 목록·링크는 권한과 무관하게 보인다.
 *  · 여러 학생의 기록을 바꾸는 작업은 **두 번 눌러야** 실행되고, 확인은 한 번의 실행에만 쓰인다.
 *  · 병합의 확인 문장은 누구의 기록을 누구에게 옮기는지 이름·학년·학교로 적는다(되돌릴 수 없다).
 */
const m = vi.hoisted(() => ({
  merge: vi.fn(), close: vi.fn(), withdraw: vi.fn(), remove: vi.fn(), signal: vi.fn(), clear: vi.fn(),
}));
vi.mock("@/features/admin/server/actions", () => ({
  mergeStudents: m.merge,
  closeOrphanEnrollments: m.close,
  bulkWithdrawStudents: m.withdraw,
  bulkDeleteStudents: m.remove,
}));
vi.mock("@/features/billing/session-terms/plan-change-signal", () => ({ notifyTermPlansChanged: m.signal }));
vi.mock("@/features/students/server/actions", () => ({ clearDupSuspect: m.clear }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children?: ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

import type { DuplicateGroup, OrphanReport } from "@/features/admin/server/queries";
import { MERGE_SCOPE_LABEL, MERGE_TABLES } from "@/features/admin/merge-scope";
import { MENU_LABEL } from "@/lib/permissions";
import { CleanupClient } from "./cleanup/_client";
import { DuplicatesClient } from "./duplicates/_client";
import { LoneSuspects } from "./duplicates/suspects";

const report = (patch: Partial<OrphanReport> = {}): OrphanReport => ({
  studentsWithoutEnrollments: [
    { id: "s-1", name: "김하나", status: "enrolled", lastEndedAt: "2026-01-01" },
    { id: "s-2", name: "이두리", status: "enrolled", lastEndedAt: "2026-01-02" },
  ],
  classesWithoutSchedules: [{ id: "c-1", className: "새 반", isActive: true }],
  enrollmentsWithoutEndDate: 3,
  ...patch,
});
const student = (id: string, name: string, patch: Partial<DuplicateGroup["students"][number]> = {}) => ({
  id,
  name,
  grade: "중2",
  school: "가람중",
  status: "enrolled",
  enrolledAt: "2026-03-01",
  dupSuspect: false,
  ...patch,
});
const group = (students = [student("aaaaaaaa-1", "권민서A"), student("bbbbbbbb-2", "권민서B", { school: "나래중" })]): DuplicateGroup => ({
  key: "g1",
  reasons: [],
  students,
});
const sectionOf = (title: string) => screen.getByRole("heading", { name: title }).closest("section") as HTMLElement;
const submitted = (fn: typeof m.merge) => fn.mock.calls.at(-1)![1] as FormData;
const press = (el: HTMLElement) => act(async () => fireEvent.click(el));

beforeEach(() => {
  vi.clearAllMocks();
  for (const fn of [m.merge, m.close, m.withdraw, m.remove, m.clear]) fn.mockReset();
});
afterEach(cleanup);

describe("권한이 없는 열람자 — 목록은 보이고 정리 버튼은 서지 않는다", () => {
  it("고아 데이터 점검: 학생·반 링크는 그대로, 선택 칸·퇴원·삭제·종료 버튼은 없다", () => {
    render(<CleanupClient report={report()} canManage={false} />);
    expect(screen.getByRole("link", { name: "김하나" }).getAttribute("href")).toBe("/students/s-1");
    expect(screen.getByRole("link", { name: "새 반" })).toBeTruthy();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    // 왜 버튼이 없는지 적는다 — 화면의 권한 이름(역할·권한 표의 줄 이름)으로.
    expect(screen.getAllByText(new RegExp(`${MENU_LABEL.admin}.*권한이 있는 계정만`)).length).toBe(2);
  });

  it("중복 병합: 후보와 근거는 그대로, 병합 폼은 없다", () => {
    render(<DuplicatesClient groups={[group()]} canManage={false} />);
    expect(screen.getAllByText("권민서B").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /병합/ })).toBeNull();
    expect(screen.queryAllByRole("combobox")).toHaveLength(0);
    expect(screen.getByText(new RegExp(`${MENU_LABEL.admin}.*권한이 있는 계정만`))).toBeTruthy();
  });

  it("권한이 있으면 버튼이 선다", () => {
    render(<CleanupClient report={report()} canManage />);
    expect(screen.getAllByRole("checkbox").length).toBe(3);
    expect(screen.getByRole("button", { name: /남은 수강 종료/ })).toBeTruthy();
  });
});

describe("🔴 두 번 눌러야 실행된다", () => {
  it("퇴원 학생의 남은 수강 종료 — 첫 클릭은 무엇을 하는지 알리기만 한다", async () => {
    m.close.mockResolvedValue({ closedCount: 5 });
    render(<CleanupClient report={report()} canManage />);
    const section = sectionOf("퇴원 학생의 활성 수강");
    await press(within(section).getByRole("button", { name: /남은 수강 종료/ }));
    expect(m.close).not.toHaveBeenCalled();
    expect(section.textContent).toContain("퇴원 학생 3명의 남은 수강을 모두 종료합니다");

    await press(within(section).getByRole("button", { name: "종료 확정" }));
    expect(m.close).toHaveBeenCalledTimes(1);
    expect(m.signal).toHaveBeenCalled();
    expect(section.textContent).toContain("5건 자동 종료 완료");
  });

  it("남은 수강 종료 — 취소하면 실행하지 않는다", async () => {
    render(<CleanupClient report={report()} canManage />);
    const section = sectionOf("퇴원 학생의 활성 수강");
    await press(within(section).getByRole("button", { name: /남은 수강 종료/ }));
    await press(within(section).getByRole("button", { name: "취소" }));
    expect(m.close).not.toHaveBeenCalled();
    expect(within(section).getByRole("button", { name: /남은 수강 종료/ })).toBeTruthy();
  });

  it("일괄 퇴원 — 첫 클릭은 몇 명인지 알리기만 하고, 확정해야 고른 학생이 넘어간다", async () => {
    m.withdraw.mockResolvedValue({ ok: true, message: "1명 퇴원 처리 완료" });
    render(<CleanupClient report={report()} canManage />);
    const section = sectionOf("수강 없는 재원생");
    fireEvent.click(within(section).getAllByRole("checkbox")[1]!); // 김하나
    await press(within(section).getByRole("button", { name: /퇴원 처리/ }));
    expect(m.withdraw).not.toHaveBeenCalled();
    expect(section.textContent).toContain("1명을 퇴원 처리합니다");

    await press(within(section).getByRole("button", { name: "퇴원 확정" }));
    expect(m.withdraw).toHaveBeenCalledTimes(1);
    expect(submitted(m.withdraw).get("ids")).toBe("s-1");
  });

  it("🔴 확인은 한 번의 실행에만 쓰인다 — 다음에 고른 학생은 다시 첫 클릭부터다", async () => {
    m.withdraw.mockResolvedValue({ ok: true, message: "1명 퇴원 처리 완료" });
    const { rerender } = render(<CleanupClient report={report()} canManage />);
    const section = () => sectionOf("수강 없는 재원생");
    fireEvent.click(within(section()).getAllByRole("checkbox")[1]!);
    await press(within(section()).getByRole("button", { name: /퇴원 처리/ }));
    await press(within(section()).getByRole("button", { name: "퇴원 확정" }));
    // 목록이 새로 읽혀 처리한 학생이 빠졌다 → 남은 학생을 고른다.
    rerender(<CleanupClient report={report({ studentsWithoutEnrollments: [report().studentsWithoutEnrollments[1]!] })} canManage />);
    fireEvent.click(within(section()).getAllByRole("checkbox")[1]!);
    expect(within(section()).queryByRole("button", { name: "퇴원 확정" })).toBeNull();
    expect(within(section()).getByRole("button", { name: /퇴원 처리/ })).toBeTruthy();
    expect(m.withdraw).toHaveBeenCalledTimes(1);
  });

  it("🔴 확인한 뒤 고른 학생을 바꾸면 확인이 풀린다 — 확인 문장을 본 적 없는 학생이 바로 처리되지 않는다", async () => {
    m.withdraw.mockResolvedValue({ ok: true, message: "1명 퇴원 처리 완료" });
    render(<CleanupClient report={report()} canManage />);
    const section = sectionOf("수강 없는 재원생");
    const [, hana, duri] = within(section).getAllByRole("checkbox");
    fireEvent.click(hana!);
    await press(within(section).getByRole("button", { name: /퇴원 처리/ }));
    expect(within(section).getByRole("button", { name: "퇴원 확정" })).toBeTruthy();
    // 김하나를 풀고 이두리를 고른다 — 확인한 것은 김하나였다.
    fireEvent.click(hana!);
    fireEvent.click(duri!);
    expect(within(section).queryByRole("button", { name: "퇴원 확정" })).toBeNull();
    expect(m.withdraw).not.toHaveBeenCalled();
    // 다시 첫 클릭부터 — 이번엔 이두리로 확인하고, 이두리가 넘어간다.
    await press(within(section).getByRole("button", { name: /퇴원 처리/ }));
    await press(within(section).getByRole("button", { name: "퇴원 확정" }));
    expect(submitted(m.withdraw).get("ids")).toBe("s-2");
  });

  it("🔴 삭제도 같다 — 확인한 뒤 학생을 더 고르면 확인이 풀린다", async () => {
    render(<CleanupClient report={report()} canManage />);
    const section = sectionOf("수강 없는 재원생");
    const [, hana, duri] = within(section).getAllByRole("checkbox");
    fireEvent.click(hana!);
    await press(within(section).getByRole("button", { name: "삭제" }));
    expect(within(section).getByRole("button", { name: "삭제 확정" })).toBeTruthy();
    fireEvent.click(duri!);
    expect(within(section).queryByRole("button", { name: "삭제 확정" })).toBeNull();
    expect(m.remove).not.toHaveBeenCalled();
  });

  it("🔴 확인한 뒤 목록이 새로 읽혀 고른 학생이 달라지면 확인이 풀린다", async () => {
    const { rerender } = render(<CleanupClient report={report()} canManage />);
    const section = () => sectionOf("수강 없는 재원생");
    fireEvent.click(within(section()).getAllByRole("checkbox")[0]!); // 전체 선택(2명)
    await press(within(section()).getByRole("button", { name: /퇴원 처리/ }));
    expect(section().textContent).toContain("2명을 퇴원 처리합니다");
    // 다른 창이 한 명을 처리했다 — 남은 선택은 1명이다.
    rerender(<CleanupClient report={report({ studentsWithoutEnrollments: [report().studentsWithoutEnrollments[1]!] })} canManage />);
    expect(within(section()).queryByRole("button", { name: "퇴원 확정" })).toBeNull();
    expect(within(section()).getByRole("button", { name: /퇴원 처리/ })).toBeTruthy();
  });

  it("🔴 남은 수강 종료 — 확인한 뒤 대상 학생 수가 달라지면 확인이 풀린다", async () => {
    const { rerender } = render(<CleanupClient report={report()} canManage />);
    const section = () => sectionOf("퇴원 학생의 활성 수강");
    await press(within(section()).getByRole("button", { name: /남은 수강 종료/ }));
    expect(within(section()).getByRole("button", { name: "종료 확정" })).toBeTruthy();
    rerender(<CleanupClient report={report({ enrollmentsWithoutEndDate: 9 })} canManage />);
    expect(within(section()).queryByRole("button", { name: "종료 확정" })).toBeNull();
    expect(m.close).not.toHaveBeenCalled();
  });

  it("저장이 도는 동안에는 선택을 바꿀 수 없다 · 일부만 종료됐다는 안내를 보여 준다", async () => {
    let finish!: (value: unknown) => void;
    m.withdraw.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    m.close.mockResolvedValue({ closedCount: 2, warning: "1건은 종료되지 않았습니다" });
    render(<CleanupClient report={report()} canManage />);
    const students = sectionOf("수강 없는 재원생");
    fireEvent.click(within(students).getAllByRole("checkbox")[1]!);
    await press(within(students).getByRole("button", { name: /퇴원 처리/ }));
    await press(within(students).getByRole("button", { name: "퇴원 확정" }));
    for (const box of within(students).getAllByRole("checkbox")) expect((box as HTMLInputElement).disabled).toBe(true);
    // 도는 동안에는 대상 문장·확정 버튼 대신 '처리 중'만 선다.
    expect(within(students).getByRole("status").textContent).toContain("퇴원 처리 중");
    expect(within(students).queryByRole("button", { name: "퇴원 확정" })).toBeNull();
    await act(async () => finish({ ok: true, message: "1명 퇴원 처리 완료" }));

    const enrollments = sectionOf("퇴원 학생의 활성 수강");
    await press(within(enrollments).getByRole("button", { name: /남은 수강 종료/ }));
    await press(within(enrollments).getByRole("button", { name: "종료 확정" }));
    expect(enrollments.textContent).toContain("1건은 종료되지 않았습니다");
  });

  it("🔴 실행이 실패해도 확인은 그 한 번으로 쓰였다 — 다시 하려면 첫 클릭부터다", async () => {
    m.withdraw.mockResolvedValue({ error: "저장하지 못했습니다" });
    m.close.mockResolvedValue({ error: "수강을 종료하지 못했습니다" });
    render(<CleanupClient report={report()} canManage />);
    const students = sectionOf("수강 없는 재원생");
    fireEvent.click(within(students).getAllByRole("checkbox")[1]!);
    await press(within(students).getByRole("button", { name: /퇴원 처리/ }));
    await press(within(students).getByRole("button", { name: "퇴원 확정" }));
    expect(students.textContent).toContain("저장하지 못했습니다");
    // 목록도 선택도 그대로지만 확인은 내려가 있다.
    expect(within(students).queryByRole("button", { name: "퇴원 확정" })).toBeNull();
    expect(within(students).getByRole("button", { name: /퇴원 처리/ })).toBeTruthy();

    const enrollments = sectionOf("퇴원 학생의 활성 수강");
    await press(within(enrollments).getByRole("button", { name: /남은 수강 종료/ }));
    await press(within(enrollments).getByRole("button", { name: "종료 확정" }));
    expect(enrollments.textContent).toContain("수강을 종료하지 못했습니다");
    expect(within(enrollments).queryByRole("button", { name: "종료 확정" })).toBeNull();
    expect(m.withdraw).toHaveBeenCalledTimes(1);
    expect(m.close).toHaveBeenCalledTimes(1);
  });

  it("삭제도 그대로 두 번이다", async () => {
    m.remove.mockResolvedValue({ ok: true, message: "1명 삭제 완료" });
    render(<CleanupClient report={report()} canManage />);
    const section = sectionOf("수강 없는 재원생");
    fireEvent.click(within(section).getAllByRole("checkbox")[1]!);
    await press(within(section).getByRole("button", { name: "삭제" }));
    expect(m.remove).not.toHaveBeenCalled();
    await press(within(section).getByRole("button", { name: "삭제 확정" }));
    expect(m.remove).toHaveBeenCalledTimes(1);
  });
});

describe("병합", () => {
  it("🔴 첫 클릭은 실행하지 않고, 누구의 기록을 누구에게 옮기는지 이름·학년·학교로 적는다", async () => {
    render(<DuplicatesClient groups={[group()]} canManage />);
    await press(screen.getByRole("button", { name: "병합" }));
    expect(m.merge).not.toHaveBeenCalled();
    const confirm = screen.getByRole("alert");
    // 진 쪽(권민서B · 나래중)의 기록을 남길 쪽(권민서A · 가람중)에게.
    expect(confirm.textContent).toContain(`권민서B (중2 · 나래중)의 ${MERGE_SCOPE_LABEL} 기록을 권민서A (중2 · 가람중)에게 옮기고`);
    expect(confirm.textContent).toContain("권민서B은(는) 퇴원 처리합니다");
    expect(confirm.textContent).toContain("되돌릴 수 없습니다");
  });

  it("확정하면 확인한 그 쌍이 넘어간다", async () => {
    m.merge.mockResolvedValue({ mergedRows: 12 });
    render(<DuplicatesClient groups={[group()]} canManage />);
    await press(screen.getByRole("button", { name: "병합" }));
    await press(screen.getByRole("button", { name: "병합 확정" }));
    expect(m.merge).toHaveBeenCalledTimes(1);
    expect(submitted(m.merge).get("keeperId")).toBe("aaaaaaaa-1");
    expect(submitted(m.merge).get("mergeeId")).toBe("bbbbbbbb-2");
    expect(m.signal).toHaveBeenCalled();
    expect(screen.getByText(/12개 항목 이전 완료/)).toBeTruthy();
  });

  it("🔴 확인한 뒤 선택을 바꾸면 확인을 다시 받는다 — 확인한 쌍과 실행되는 쌍이 달라지지 않는다", async () => {
    render(<DuplicatesClient groups={[group()]} canManage />);
    await press(screen.getByRole("button", { name: "병합" }));
    fireEvent.change(screen.getAllByRole("combobox")[0]!, { target: { value: "bbbbbbbb-2" } });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "병합 확정" })).toBeNull();
    // 남길 학생을 바꾸면 진 쪽 선택지에서 그 학생이 빠진다 — 화면에 보이는 값이 확인 문장·전송 값과 같다.
    await press(screen.getByRole("button", { name: "병합" }));
    expect(screen.getByRole("alert").textContent).toContain("권민서A (중2 · 가람중)의");
    expect(screen.getByRole("alert").textContent).toContain("권민서B (중2 · 나래중)에게 옮기고");
    m.merge.mockResolvedValue({ mergedRows: 1 });
    await press(screen.getByRole("button", { name: "병합 확정" }));
    expect(submitted(m.merge).get("keeperId")).toBe("bbbbbbbb-2");
    expect(submitted(m.merge).get("mergeeId")).toBe("aaaaaaaa-1");
  });

  it("🔴 세 명 이상인 묶음 — 한 번 병합한 뒤 남은 학생은 다시 첫 클릭부터다(확인이 켜진 채 남지 않는다)", async () => {
    m.merge.mockResolvedValue({ mergedRows: 3 });
    const three = [student("aaaaaaaa-1", "권민서A"), student("bbbbbbbb-2", "권민서B"), student("cccccccc-3", "권민서C")];
    const { rerender } = render(<DuplicatesClient groups={[group(three)]} canManage />);
    await press(screen.getByRole("button", { name: "병합" }));
    await press(screen.getByRole("button", { name: "병합 확정" }));
    // 목록이 새로 읽혀 병합된 학생(권민서B)이 빠졌다 — 카드는 남는다.
    rerender(<DuplicatesClient groups={[group([three[0]!, three[2]!])]} canManage />);
    expect(screen.queryByRole("button", { name: "병합 확정" })).toBeNull();
    expect(screen.getByRole("button", { name: "병합" })).toBeTruthy();
    expect(m.merge).toHaveBeenCalledTimes(1);
  });

  it("🔴 확인한 뒤 목록이 새로 읽혀 진 쪽이 다른 학생으로 바뀌면 확인이 풀린다 — 본 적 없는 쌍이 바로 병합되지 않는다", async () => {
    const three = [student("aaaaaaaa-1", "권민서A"), student("bbbbbbbb-2", "권민서B"), student("cccccccc-3", "권민서C")];
    const { rerender } = render(<DuplicatesClient groups={[group(three)]} canManage />);
    await press(screen.getByRole("button", { name: "병합" }));
    expect(screen.getByRole("alert").textContent).toContain("권민서B (중2 · 가람중)의");
    // 다른 창이 권민서B를 처리했다 — 같은 카드가 [A, C]로 내려온다(진 쪽이 C로 넘어간다).
    rerender(<DuplicatesClient groups={[group([three[0]!, three[2]!])]} canManage />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "병합 확정" })).toBeNull();
    expect(m.merge).not.toHaveBeenCalled();
    // 다시 누르면 지금의 쌍(C → A)으로 확인을 받는다.
    await press(screen.getByRole("button", { name: "병합" }));
    expect(screen.getByRole("alert").textContent).toContain("권민서C (중2 · 가람중)의");
  });

  it("🔴 병합이 실패해도 확인은 그 한 번으로 쓰였다 — 다시 하려면 첫 클릭부터다", async () => {
    m.merge.mockResolvedValue({ error: "'청구 기록 옮기기' 단계에서 멈췄습니다" });
    render(<DuplicatesClient groups={[group()]} canManage />);
    await press(screen.getByRole("button", { name: "병합" }));
    await press(screen.getByRole("button", { name: "병합 확정" }));
    expect(screen.getByText("'청구 기록 옮기기' 단계에서 멈췄습니다")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "병합 확정" })).toBeNull();
    expect(screen.getByRole("button", { name: "병합" })).toBeTruthy();
    expect(m.merge).toHaveBeenCalledTimes(1);
  });

  it("저장이 도는 동안에는 대상 문장 대신 '처리 중'을 보인다 — 그사이 목록이 바뀌어도 보내지 않은 학생을 처리하는 것처럼 적지 않는다", async () => {
    let finish!: (value: unknown) => void;
    m.merge.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    const three = [student("aaaaaaaa-1", "권민서A"), student("bbbbbbbb-2", "권민서B"), student("cccccccc-3", "권민서C")];
    const { rerender } = render(<DuplicatesClient groups={[group(three)]} canManage />);
    await press(screen.getByRole("button", { name: "병합" }));
    await press(screen.getByRole("button", { name: "병합 확정" }));
    expect(submitted(m.merge).get("mergeeId")).toBe("bbbbbbbb-2");
    // 저장이 도는 중에 다른 창의 처리로 목록이 [A, C]가 됐다.
    rerender(<DuplicatesClient groups={[group([three[0]!, three[2]!])]} canManage />);
    expect(screen.getByRole("status").textContent).toContain("병합 처리 중");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "병합 확정" })).toBeNull();
    await act(async () => finish({ mergedRows: 3 }));
    expect(m.merge).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "병합 확정" })).toBeNull();
  });

  it("남길 학생이 목록에서 빠져도 화면에 보이는 값과 보낼 값이 같다", async () => {
    m.merge.mockResolvedValue({ mergedRows: 1 });
    const three = [student("aaaaaaaa-1", "권민서A"), student("bbbbbbbb-2", "권민서B"), student("cccccccc-3", "권민서C")];
    const { rerender } = render(<DuplicatesClient groups={[group(three)]} canManage />);
    rerender(<DuplicatesClient groups={[group([three[1]!, three[2]!])]} canManage />);
    const [keeperSelect, mergeeSelect] = screen.getAllByRole("combobox") as HTMLSelectElement[];
    expect(keeperSelect!.value).toBe("bbbbbbbb-2");
    expect(mergeeSelect!.value).toBe("cccccccc-3");
    await press(screen.getByRole("button", { name: "병합" }));
    expect(screen.getByRole("alert").textContent).toContain("권민서C (중2 · 가람중)의");
    expect(screen.getByRole("alert").textContent).toContain("권민서B (중2 · 가람중)에게 옮기고");
    await press(screen.getByRole("button", { name: "병합 확정" }));
    expect(submitted(m.merge).get("keeperId")).toBe("bbbbbbbb-2");
    expect(submitted(m.merge).get("mergeeId")).toBe("cccccccc-3");
  });

  it("취소하면 실행하지 않는다 · 실패 사유와 남은 일(경고)을 그대로 보여 준다", async () => {
    m.merge.mockResolvedValueOnce({ error: "'청구 기록 옮기기' 단계에서 멈췄습니다" }).mockResolvedValueOnce({ mergedRows: 2, warning: "표식을 내리지 못했습니다" });
    render(<DuplicatesClient groups={[group()]} canManage />);
    await press(screen.getByRole("button", { name: "병합" }));
    await press(screen.getByRole("button", { name: "취소" }));
    expect(m.merge).not.toHaveBeenCalled();
    await press(screen.getByRole("button", { name: "병합" }));
    await press(screen.getByRole("button", { name: "병합 확정" }));
    expect(screen.getByText("'청구 기록 옮기기' 단계에서 멈췄습니다")).toBeTruthy();
    await press(screen.getByRole("button", { name: "병합" }));
    await press(screen.getByRole("button", { name: "병합 확정" }));
    expect(screen.getByText("표식을 내리지 못했습니다")).toBeTruthy();
  });
});

describe("'의심' 정리 — 왜 의심인지 + '정상 확인'(원장 2026-10-14)", () => {
  const suspect = () => group([student("aaaaaaaa-1", "권민서A"), student("bbbbbbbb-2", "권민서B", { dupSuspect: true })]);

  it("의심 학생 줄에 이유 한 줄과 '정상 확인' — 누르면 그 학생 표식을 내린다", async () => {
    m.clear.mockResolvedValue({ ok: true });
    render(<DuplicatesClient groups={[suspect()]} canManage canConfirm />);
    expect(screen.getByText("왜 의심: 동기화 때 같은 이름이 이미 있어 끝에 알파벳을 붙여 따로 등록")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "정상 확인" })).toHaveLength(1); // 표식 없는 권민서A에는 없다
    await press(screen.getByRole("button", { name: "정상 확인" }));
    expect(m.clear).toHaveBeenCalledWith("bbbbbbbb-2");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("권한이 없으면 이유는 보이고 버튼은 없다 · 실패하면 사유를 그 자리에", async () => {
    const { unmount } = render(<DuplicatesClient groups={[suspect()]} canManage={false} />);
    expect(screen.getByText(/왜 의심: /)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "정상 확인" })).toBeNull();
    unmount();
    m.clear.mockResolvedValue({ error: "학생 정보 변경 권한이 없습니다" });
    render(<DuplicatesClient groups={[suspect()]} canManage canConfirm />);
    await press(screen.getByRole("button", { name: "정상 확인" }));
    expect(screen.getByRole("alert").textContent).toContain("학생 정보 변경 권한이 없습니다");
  });

  it("짝 없는 '의심' 학생 — 이름은 학생 상세로, 이유와 '정상 확인'", async () => {
    m.clear.mockResolvedValue({ ok: true });
    const lone = [student("cccccccc-3", "이지호B", { dupSuspect: true, status: "on_hold" })];
    const { unmount } = render(<LoneSuspects students={lone} canConfirm />);
    expect(screen.getByRole("heading", { name: /짝 없는 .의심. 학생\s*1명/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: "이지호B" }).getAttribute("href")).toBe("/students/cccccccc-3");
    expect(screen.getByText("휴원")).toBeTruthy();
    // 확인할 곳 = 원생목록 퇴원 보기(학생 상세는 퇴원한 짝을 안 보여 주고 다시 이 면을 가리킨다).
    expect(screen.getByText(/원생목록에서 상태를 .퇴원.으로 바꿔 같은 이름을 찾아보세요/)).toBeTruthy();
    expect(screen.getByText(/정상 확인.으로 표식을 내립니다/)).toBeTruthy();
    await press(screen.getByRole("button", { name: "정상 확인" }));
    expect(m.clear).toHaveBeenCalledWith("cccccccc-3");
    unmount();
    // 버튼이 없는 사람에게는 '정상 확인' 안내도 없다(없는 버튼을 말하지 않는다).
    render(<LoneSuspects students={lone} canConfirm={false} />);
    expect(screen.queryByRole("button", { name: "정상 확인" })).toBeNull();
    expect(screen.queryByText(/정상 확인.으로 표식을 내립니다/)).toBeNull();
  });
});

describe("배선", () => {
  const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
  const strip = (code: string) => code.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("🔴 정리 버튼의 판정은 각 액션과 같은 권한이다 — 학원 설정 쓰기 권한이 아니다", () => {
    const page = strip(read("src", "app", "(shell)", "owner", "page.tsx"));
    expect(page).toContain('const canManageData = tab === "data" ? await canWriteTenant(viewer.systemRole, "admin") : false;');
    expect(page).toContain("<DataFace canManage={canManageData} />");
    expect(page).toContain("<DuplicatesFace page={page} isEmbed={isEmbed} canManage={canManageData} />");
    const actions = read("src", "features", "admin", "server", "actions.ts");
    // 네 액션 모두 같은 키로 막는다.
    expect(actions.match(/canWriteTenant\(user\.systemRole, "admin"\)/g)?.length).toBe(4);
  });

  it("🔴 데이터 정리 면은 학원 설정 fieldset 밖에 선다 — 설정이 읽기 전용이어도 정리 버튼이 잠기지 않는다", () => {
    const page = strip(read("src", "app", "(shell)", "owner", "page.tsx"));
    const fieldsetEnd = page.indexOf("</fieldset>");
    expect(fieldsetEnd).toBeGreaterThan(-1);
    expect(page.indexOf("<DataFace ")).toBeGreaterThan(fieldsetEnd);
    expect(page.indexOf("<DuplicatesFace ")).toBeGreaterThan(fieldsetEnd);
    // 설정 '읽기 전용' 안내도 이 면에는 서지 않는다(면이 자기 안내를 한다) — 자체 판정 면의 목록에 들어 있다.
    // 조건에 다른 예외(FACE_WRITES_OWN_NOTE 등)가 더해져도 이 면은 그 목록으로 빠진다(2026-11-05 권한 면 개편 뒤 모양).
    expect(page).toMatch(/!canEditSettings && [^?]*!SELF_GATED_TABS\.has\(tab\)/);
    expect(page).toMatch(/const SELF_GATED_TABS[^=]*= new Set\(\[[^\]]*"data"/);
  });

  it("🔴 화면 안내와 병합 액션이 같은 목록에서 '옮기는 기록'을 적는다 — \"모든 기록\"이라고 적지 않는다", () => {
    expect(MERGE_SCOPE_LABEL).toBe(MERGE_TABLES.map((t) => t.label).join(" · "));
    const face = read("src", "app", "(shell)", "owner", "_components", "duplicates-face.tsx");
    expect(face).toContain("{MERGE_SCOPE_LABEL}");
    expect(strip(face)).not.toMatch(/모든\s*수강/);
    expect(strip(face)).toContain("옮겨지지 않고 퇴원 처리된 학생에게 남습니다");
    const actions = strip(read("src", "features", "admin", "server", "actions.ts"));
    expect(actions).toContain("for (const [index, { table, label }] of MERGE_TABLES.entries())");
  });

  it("못 읽었을 때 면 전체가 죽지 않는다 — 구획마다 안내로 접는다", () => {
    for (const file of ["data-face.tsx", "duplicates-face.tsx", "same-name-face.tsx"]) {
      const code = strip(read("src", "app", "(shell)", "owner", "_components", file));
      expect(code, file).toMatch(/try \{[\s\S]*?await find\w+\(\)[\s\S]*?\} catch/);
    }
    // 고아 점검: 못 읽었으면 '문제 없음'이 아니라 불러오지 못했다고 적는다.
    expect(read("src", "app", "(shell)", "owner", "_components", "data-face.tsx")).toContain("고아 데이터 점검을 불러오지 못했습니다");
  });
});
