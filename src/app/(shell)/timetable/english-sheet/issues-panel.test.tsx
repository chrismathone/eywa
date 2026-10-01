import { useState } from "react";
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { IssuesPanel } from "./issues-panel";
import { preview } from "./test-preview";
import type { MasterIssue } from "@/features/timetable/import/master/types";

afterEach(cleanup);
const issues: MasterIssue[] = [
  {
    key: "match:1",
    severity: "confirm",
    target: "학생 이름 연결",
    reason: "이름 표기 차이",
    fix: "동일인 확인",
  },
  {
    key: "student-time:1",
    severity: "confirm",
    target: "학생 시간 충돌",
    reason: "수학과 겹침",
    fix: "등원 확인",
  },
  {
    key: "status:1",
    severity: "error",
    target: "퇴원 학생",
    reason: "퇴원 상태",
    fix: "상태 확인",
  },
  {
    key: "identity:1",
    severity: "error",
    target: "미연결 반",
    reason: "동점 후보",
    fix: "수동 연결",
  },
];
function Harness({ dirty = false }: { dirty?: boolean }) {
  const [checks, setChecks] = useState<string[]>([]);
  return (
    <IssuesPanel
      preview={preview(issues)}
      dirty={dirty}
      pending={false}
      checks={checks}
      onChecks={setChecks}
    />
  );
}
it("적용 불가도 분류하고 분류별/전체 확인·해제를 실제 체크박스와 연결한다", async () => {
  render(<Harness />);
  const user = userEvent.setup();
  const blocked = screen.getByRole("region", { name: "적용 불가 항목" });
  expect(
    within(blocked).getByRole("list", {
      name: "재원·휴원 상태 적용 불가 항목",
    }),
  ).toBeVisible();
  expect(
    within(blocked).getByRole("list", { name: "반 연결·진급 적용 불가 항목" }),
  ).toBeVisible();
  expect(within(blocked).queryByRole("checkbox")).toBeNull();
  await user.click(
    screen.getByRole("button", { name: "학생 연결·동명이인 전체 확인" }),
  );
  expect(
    screen.getByRole("checkbox", { name: "학생 이름 연결 확인" }),
  ).toBeChecked();
  expect(
    screen.getByRole("checkbox", { name: "학생 시간 충돌 확인" }),
  ).not.toBeChecked();
  await user.click(screen.getByRole("button", { name: "확인 항목 전체 확인" }));
  expect(
    screen
      .getAllByRole("checkbox")
      .every((c) => (c as HTMLInputElement).checked),
  ).toBe(true);
  expect(screen.getByRole("heading", { name: "적용 불가 2건" })).toBeVisible();
  await user.click(
    screen.getByRole("button", { name: "학생 연결·동명이인 전체 해제" }),
  );
  expect(
    screen.getByRole("checkbox", { name: "학생 시간 충돌 확인" }),
  ).toBeChecked();
  await user.click(screen.getByRole("button", { name: "확인 항목 전체 해제" }));
  expect(
    screen
      .getAllByRole("checkbox")
      .every((c) => !(c as HTMLInputElement).checked),
  ).toBe(true);
});
it("입력 변경 후에는 분류별·전체 확인도 재검사 전까지 막는다", () => {
  render(<Harness dirty />);
  expect(
    screen.getByRole("button", { name: "확인 항목 전체 확인" }),
  ).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "학생 연결·동명이인 전체 확인" }),
  ).toBeDisabled();
});
