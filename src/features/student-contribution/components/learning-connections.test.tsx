import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OperationsProvider } from "@/features/owner/operations-context";

vi.mock("../server/learning-actions", () => ({ getStudentLearningConnections: vi.fn() }));
vi.mock("../server/communication-actions", () => ({ getStudentCommunicationConnections: vi.fn() }));
vi.mock("./expandable-connections", () => ({
  ExpandableConnections: ({ description }: { description: string }) => <p>{description}</p>,
}));

import { LearningConnections } from "./learning-connections";

afterEach(cleanup);

describe("학습 연결 안내의 기능 흔적", () => {
  it("셔틀이 켜진 지점은 종전 문구를 그대로 쓴다", () => {
    render(<LearningConnections studentId="student-1" />);
    expect(screen.getByText("출결·학습 계획·성적·진도·교재·영상과 셔틀 기록을 확인합니다.")).toBeInTheDocument();
  });

  it("셔틀이 꺼진 지점은 셔틀 이름도 보이지 않는다", () => {
    render(
      <OperationsProvider subjects={[]} gradeLevels={[]} disabledModules={["shuttle"]}>
        <LearningConnections studentId="student-1" />
      </OperationsProvider>,
    );
    expect(screen.getByText("출결·학습 계획·성적·진도·교재·영상 기록을 확인합니다.")).toBeInTheDocument();
    expect(screen.queryByText(/셔틀/)).toBeNull();
  });
});
