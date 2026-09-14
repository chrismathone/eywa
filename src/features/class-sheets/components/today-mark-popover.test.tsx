import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TodayMarkPopover, type MarkSlot } from "./today-mark-popover";
import { upsertStudentMark } from "../server/actions";
import { commitSheetEdits } from "../server/edit-audit-actions";

// 오늘 보드 팝오버의 **JJ 전용 칸** 회귀 가드 — 원장 2026-08-13: *"JJ 수업에만 넣을것이므로 만약 JJ가
// 있다면 넣기"*. 지켜야 할 것: ① JJ 교시에만 두 칸이 뜬다 ② 저장이 **그 교시가 가진 칸만** 싣는다
// (안 실은 시험 점수는 서버가 지금 값을 유지 — 주간 시트에 적힌 점수가 지워지면 안 된다).
vi.mock("../server/actions", () => ({ upsertStudentMark: vi.fn(async () => ({ ok: true })) }));
// 칸 편집 감사로그(원장 결정 2026-09-14) — 서버 액션은 흉내만 낸다(게이트·DB는 서버 몫).
vi.mock("../server/edit-audit-actions", () => ({ commitSheetEdits: vi.fn(async () => ({ ok: true })) }));

afterEach(() => {
  cleanup();
  vi.mocked(commitSheetEdits).mockClear();
});

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

describe("오늘 보드 기록 팝오버 — 칸 편집 감사로그(칸을 떠날 때 한 줄)", () => {
  it("저장이 끝난 뒤 **바뀐 칸만** 직전 값과 함께 기록한다", async () => {
    open({
      "16:20": { status: "좋음", progressNote: "PL 6", score: null, listeningLevel: null, memorizedWords: null },
    });
    const input = await screen.findByLabelText("김학생 EiE 4교시 특이사항");
    fireEvent.change(input, { target: { value: "PL 7" } });
    fireEvent.blur(input);
    await waitFor(() => expect(commitSheetEdits).toHaveBeenCalledTimes(1));
    const arg = vi.mocked(commitSheetEdits).mock.calls[0][0];
    expect(arg.classId).toBe("cls-1");
    // 태도는 안 바뀌었으니 줄이 없다 — 특이사항 한 칸만.
    expect(arg.edits).toEqual([
      {
        cell: { kind: "mark", studentId: "stu-1", date: "2026-08-13", slotStart: "16:20", field: "progressNote" },
        before: "PL 6",
      },
    ]);
  });

  it("저장이 실패하면 기록하지 않는다(바뀌지 않은 것을 바뀌었다고 적지 않는다)", async () => {
    vi.mocked(upsertStudentMark).mockResolvedValueOnce({ ok: false, error: "편집 권한이 없습니다" });
    open();
    const input = await screen.findByLabelText("김학생 EiE 4교시 특이사항");
    fireEvent.change(input, { target: { value: "PL 7" } });
    fireEvent.blur(input);
    await waitFor(() => expect(upsertStudentMark).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(commitSheetEdits).not.toHaveBeenCalled();
  });
});
