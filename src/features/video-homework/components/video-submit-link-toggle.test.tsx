/**
 * '영상 과제' → '영상 첨부 링크 넣기' 토글(0328a, 원장 2026-10-02) — 표(체크 칸)·카드(체크 알약) 두 모양.
 * 카드 알약에도 체크 칸이 있어야 한다(원장 *"카드모드에서는 영상 과제 체크가 없나본데?"* — 글자만 있는 알약은 칸으로 안 읽혔다).
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import type { SubmitLinkMode } from "@/features/video-submit/link-choice";
import { VideoHomeworkProvider } from "./video-homework-provider";
import { VideoHomeworkToggle } from "./video-homework-toggle";
import { VideoSubmitLinkToggle } from "./video-submit-link-toggle";

vi.mock("../server/actions", () => ({ setVideoHomeworkMark: vi.fn(), setVideoHomeworkMarksBulk: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
afterEach(cleanup);

const row = { classId: "c1", subjectKey: "math", grade: "중1", studentName: "김민준", subjectName: "수학" };
type LinkProps = Partial<ComponentProps<typeof VideoSubmitLinkToggle>>;
function show(mode: SubmitLinkMode, props: LinkProps = {}, known = true) {
  const onToggle = vi.fn();
  render(
    <VideoHomeworkProvider initial={[]} checkDate="2026-10-02" submitLinkMode={mode} assignmentsKnown={known}>
      <VideoSubmitLinkToggle shown checked={false} onToggle={onToggle} {...row} {...props} />
    </VideoHomeworkProvider>,
  );
  return onToggle;
}
const linkBox = () => screen.queryByRole("checkbox", { name: "김민준 수학 영상 첨부 링크 넣기" });

describe("영상 첨부 링크 넣기", () => {
  it("'영상 과제'를 켠 행에서만 뜬다 — 꺼져 있으면 토글 자체가 없다", () => {
    show("on", { shown: false });
    expect(linkBox()).toBeNull();
    cleanup();
    const onToggle = show("on");
    expect(screen.getByText("영상 첨부 링크 넣기")).toBeTruthy();
    fireEvent.click(linkBox()!);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
  it("줄이 붙을 수 없는 행엔 안 그린다 — 꺼진 단계 · 영어 · 반 없음 · 시험 단계의 다른 학생", () => {
    for (const [mode, props] of [["off", {}], ["on", { subjectKey: "english" }], ["on", { classId: null }], ["test", {}]] as [SubmitLinkMode, LinkProps][]) {
      show(mode, props);
      expect(linkBox(), `${mode} ${JSON.stringify(props)}`).toBeNull();
      cleanup();
    }
    show("test", { studentName: "학원이" });
    expect(screen.getByRole("checkbox", { name: "학원이 수학 영상 첨부 링크 넣기" })).toBeTruthy();
  });
  it("잠긴 행·과제 값을 못 읽은 세션은 누를 수 없다", () => {
    show("on", { disabled: true });
    expect(linkBox()).toBeDisabled();
    cleanup();
    show("on", {}, false);
    expect(linkBox()).toBeDisabled();
  });
  it("카드 모드 — 두 토글 모두 알약 안에 체크 칸이 있다(표 모드와 같은 것으로 보이게)", () => {
    const onHw = vi.fn();
    render(
      <VideoHomeworkProvider initial={[]} checkDate="2026-10-02" submitLinkMode="on">
        <VideoHomeworkToggle size="pill" checked onToggle={onHw} {...row} />
        <VideoSubmitLinkToggle size="pill" shown checked onToggle={vi.fn()} {...row} />
      </VideoHomeworkProvider>,
    );
    const hw = screen.getByRole("checkbox", { name: "김민준 수학 오늘 영상 과제" });
    expect(hw).toBeChecked();
    expect(linkBox()).toBeChecked();
    fireEvent.click(hw);
    expect(onHw).toHaveBeenCalledTimes(1);
  });
});
