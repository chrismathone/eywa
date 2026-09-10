import { render, screen, within, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { OverviewData } from "@/features/dashboard/overview/model";
import { CurrentClasses } from "./current-classes";

vi.mock("@/components/workspace/window-link", () => ({
  WindowLink: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: ReactNode;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
afterEach(cleanup);
const slot = (
  id: string,
  subject: string,
  status: OverviewData["schedule"][number]["status"],
  startTime = "15:00",
): OverviewData["schedule"][number] => ({
  id,
  classId: id,
  className: id,
  subject,
  status,
  startTime,
  endTime: "16:00",
  teacherName: "강사",
  classroomName: "교실",
});

it("과목별로 현재 진행 수업을 우선하고 진행 수업이 없으면 가장 가까운 수업만 보여준다", () => {
  render(
    <CurrentClasses
      subjects={{ english: "영어", math: "수학" }}
      schedule={[
        slot("지난영어", "english", "done", "14:00"),
        slot("현재영어", "english", "ongoing"),
        slot("다음영어", "english", "upcoming", "17:00"),
        slot("먼수학", "math", "upcoming", "18:00"),
        slot("가까운수학", "math", "upcoming", "16:20"),
      ]}
    />,
  );
  const english = screen.getByRole("region", { name: "영어 수업" });
  const math = screen.getByRole("region", { name: "수학 수업" });
  expect(within(english).getByText("진행 중 1개")).toBeTruthy();
  expect(within(english).getByText("현재영어")).toBeTruthy();
  expect(within(english).queryByText("지난영어")).toBeNull();
  expect(within(english).queryByText("다음영어")).toBeNull();
  expect(within(math).getByText("가까운수학")).toBeTruthy();
  expect(within(math).queryByText("먼수학")).toBeNull();
});

it("정기 갱신으로 수업이 끝나면 다음 수업으로 전환한다", () => {
  const view = render(
    <CurrentClasses
      subjects={{ english: "영어" }}
      schedule={[
        slot("수업1", "english", "ongoing"),
        slot("수업2", "english", "upcoming", "16:00"),
      ]}
    />,
  );
  expect(screen.getByText("수업1")).toBeTruthy();
  view.rerender(
    <CurrentClasses
      subjects={{ english: "영어" }}
      schedule={[
        slot("수업1", "english", "done"),
        slot("수업2", "english", "ongoing", "16:00"),
      ]}
    />,
  );
  expect(screen.queryByText("수업1")).toBeNull();
  expect(screen.getByText("수업2")).toBeTruthy();
});
