import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TodayMarkPopover, type MarkSlot } from "./today-mark-popover";
import { upsertStudentMark } from "../server/actions";

// 오늘 보드 팝오버의 **JJ 전용 칸** 회귀 가드 — 원장 2026-08-13: *"JJ 수업에만 넣을것이므로 만약 JJ가
// 있다면 넣기"*. 지켜야 할 것: ① JJ 교시에만 두 칸이 뜬다 ② 저장이 **그 교시가 가진 칸만** 싣는다
// (안 실은 시험 점수는 서버가 지금 값을 유지 — 주간 시트에 적힌 점수가 지워지면 안 된다).
vi.mock("../server/actions", () => ({ upsertStudentMark: vi.fn(async () => ({ ok: true })) }));

afterEach(cleanup);

const SLOTS: MarkSlot[] = [
  { slotStart: "16:20", label: "EiE 4교시", form: "default" },
  { slotStart: "17:20", label: "JJ", form: "selfStudy" },
];

function open(marks = {}) {
  const onChange = vi.fn();
  render(
    <TodayMarkPopover
      classId="cls-1"
      date="2026-08-13"
      studentId="stu-1"
      studentName="김학생"
      slots={SLOTS}
      marks={marks}
      canEdit
      onChange={onChange}
    />,
  );
  fireEvent.click(screen.getByLabelText("김학생 태도·특이사항"));
  return { onChange };
}

describe("오늘 보드 기록 팝오버 — JJ 교시에만 전용 칸", () => {
  it("JJ 교시에만 듣기 레벨·누적 암기 단어수가 뜬다", async () => {
    open();
    await waitFor(() => expect(screen.getByLabelText("김학생 EiE 4교시 특이사항")).toBeTruthy());
    // 기본 교시 = 태도·특이사항만
    expect(screen.queryByLabelText("김학생 EiE 4교시 듣기 레벨")).toBeNull();
    expect(screen.queryByLabelText("김학생 EiE 4교시 누적 암기 단어수")).toBeNull();
    // JJ 교시 = 두 칸 추가(시험 점수는 여기 없다 — 팝오버는 원래 안 받던 칸이다)
    expect(screen.getByLabelText("김학생 JJ 듣기 레벨")).toBeTruthy();
    expect(screen.getByLabelText("김학생 JJ 누적 암기 단어수")).toBeTruthy();
    expect(screen.queryByLabelText("김학생 JJ 시험 점수")).toBeNull();
  });

  it("🔴 저장은 그 교시가 가진 칸만 싣는다 — 시험 점수는 안 보낸다(서버가 지금 값 유지)", async () => {
    open({
      "17:20": {
        status: null,
        progressNote: null,
        score: "18/20",
        listeningLevel: null,
        memorizedWords: null,
      },
    });
    const input = await screen.findByLabelText("김학생 JJ 누적 암기 단어수");
    fireEvent.change(input, { target: { value: "1250" } });
    fireEvent.blur(input);
    await waitFor(() => expect(upsertStudentMark).toHaveBeenCalledTimes(1));
    const arg = vi.mocked(upsertStudentMark).mock.calls[0][0];
    expect(arg.slotStart).toBe("17:20");
    expect(arg.memorizedWords).toBe("1250");
    expect("score" in arg).toBe(false);
  });

  it("기본 교시 저장엔 JJ 칸이 섞이지 않는다", async () => {
    open();
    const input = await screen.findByLabelText("김학생 EiE 4교시 특이사항");
    fireEvent.change(input, { target: { value: "PL 7" } });
    fireEvent.blur(input);
    await waitFor(() => expect(upsertStudentMark).toHaveBeenCalled());
    const arg = vi.mocked(upsertStudentMark).mock.calls.at(-1)![0];
    expect(arg.progressNote).toBe("PL 7");
    expect("listeningLevel" in arg).toBe(false);
    expect("memorizedWords" in arg).toBe(false);
  });
});
