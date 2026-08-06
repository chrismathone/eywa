import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MakeupMergeDialog } from "./makeup-merge-dialog";
import type { MergeCandidate } from "../makeup-merge-plan";

/**
 * 여기서 잠그는 계약(원장 2026-08-06):
 *  ① 보강 추가는 **묻는다** — 합침/분리를 강사가 고른다(자동 합치기 금지, *"선생님들이 헷갈린대"*).
 *  ② **어느 쪽이든 어느 수업인지 골라야** 확인이 열린다 — 그 반에 보강 1시수가 얹히므로 급여 귀속이다.
 *  ③ **분리는 며칠자 결석분인지까지** 받는다 — 결석 칸에 남길 메모를 만들려면 날짜가 있어야 한다.
 *  ④ 어느 쪽을 고르면 무슨 일이 벌어지는지(발송 건수·수업타임·출석부 두 칸)가 화면에 문장으로 있다.
 */
const TODAY = "2026-07-31";
const cand = (over: Partial<MergeCandidate> = {}): MergeCandidate => ({
  name: "수학",
  classId: "c1",
  subjectKey: "math",
  attendanceRaw: null,
  attendanceUnits: null,
  ...over,
});

const setup = (props: Partial<Parameters<typeof MakeupMergeDialog>[0]> = {}) => {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <MakeupMergeDialog
      studentName="홍길동"
      candidates={[cand()]}
      sentSubjects={[]}
      makeupDate={TODAY}
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...props}
    />,
  );
  return { onConfirm, onCancel };
};

const pickSeparate = () => userEvent.click(screen.getByRole("radio", { name: "분리 (보강 따로)" }));
const absentDateInput = () => screen.getByLabelText("며칠자 결석분 보강인가요?");

describe("MakeupMergeDialog — 합침/분리 확인", () => {
  it("후보가 하나면 바로 '합쳐서 발송'할 수 있다", async () => {
    const { onConfirm } = setup();

    await userEvent.click(screen.getByRole("button", { name: "합쳐서 발송" }));

    expect(onConfirm).toHaveBeenCalledWith({ mode: "merge", candidate: expect.objectContaining({ classId: "c1" }) });
  });

  it("후보가 둘이면 과목을 고르기 전엔 합칠 수 없다(시수 오지급 차단)", async () => {
    const { onConfirm } = setup({ candidates: [cand(), cand({ name: "수학 특강", classId: "c2" })] });

    expect(screen.getByRole("button", { name: "합쳐서 발송" })).toBeDisabled();

    await userEvent.click(screen.getByRole("radio", { name: "수학 특강" }));
    await userEvent.click(screen.getByRole("button", { name: "합쳐서 발송" }));

    expect(onConfirm).toHaveBeenCalledWith({ mode: "merge", candidate: expect.objectContaining({ classId: "c2" }) });
  });

  it("이미 발송된 정규 행이면 합치기 전에 경고한다", async () => {
    setup({ sentSubjects: ["수학"] });

    // 과목명과 '보고서' 사이 공백까지 확인 — JSX에서 식과 텍스트를 섞으면 붙어 나온다("수학보고서는").
    expect(screen.getByText(/^수학 보고서는 이미 발송되어 보강 내용은 실리지 않습니다/)).toBeInTheDocument();

    await pickSeparate();
    expect(screen.queryByText(/이미 발송되어 보강 내용은 실리지 않습니다/)).not.toBeInTheDocument();
  });

  it("취소는 아무 선택도 넘기지 않는다", async () => {
    const { onConfirm, onCancel } = setup();

    await userEvent.click(screen.getByRole("button", { name: "취소" }));

    expect(onCancel).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe("분리 — 며칠자 결석분인지까지 받는다", () => {
  it("날짜를 비워 두면 확인을 못 누른다", async () => {
    setup();

    await pickSeparate();

    expect(screen.getByRole("button", { name: "분리해서 발송" })).toBeDisabled();
  });

  it("날짜를 고르면 결석일과 함께 넘긴다", async () => {
    const { onConfirm } = setup();

    await pickSeparate();
    await userEvent.type(absentDateInput(), "2026-07-16");
    await userEvent.click(screen.getByRole("button", { name: "분리해서 발송" }));

    expect(onConfirm).toHaveBeenCalledWith({
      mode: "separate",
      candidate: expect.objectContaining({ classId: "c1" }),
      absentDate: "2026-07-16",
    });
  });

  it("보강한 날 이후는 못 고른다 — 아직 결석하지 않은 날의 보강은 없다", async () => {
    const { onConfirm } = setup();

    await pickSeparate();
    expect(absentDateInput()).toHaveAttribute("max", TODAY);

    // 상한을 우회해 같은 날을 넣어도 확인이 열리지 않는다(입력 max는 방어선이 아니다).
    await userEvent.type(absentDateInput(), TODAY);
    expect(screen.getByRole("button", { name: "분리해서 발송" })).toBeDisabled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("후보가 둘이면 분리도 어느 반인지 골라야 한다(그 반에 시수가 얹힌다)", async () => {
    const { onConfirm } = setup({ candidates: [cand(), cand({ name: "수학 특강", classId: "c2" })] });

    await pickSeparate();
    await userEvent.type(absentDateInput(), "2026-07-16");
    expect(screen.getByRole("button", { name: "분리해서 발송" })).toBeDisabled();

    await userEvent.click(screen.getByRole("radio", { name: "수학 특강" }));
    await userEvent.click(screen.getByRole("button", { name: "분리해서 발송" }));

    expect(onConfirm).toHaveBeenCalledWith({
      mode: "separate",
      candidate: expect.objectContaining({ classId: "c2" }),
      absentDate: "2026-07-16",
    });
  });
});

describe("고른 결과를 문장으로 밝힌다", () => {
  it("합침 — 보고서 1건 · 수업타임 1+1=2", () => {
    setup();

    // ⚠️ 숫자 뒤 조사 금지("2이 됩니다"는 틀린 조사) — 수치는 문장 끝에 붙는다.
    expect(screen.getByText(/1건에 합쳐/)).toHaveTextContent("1 + 보강 1 = 2");
  });

  it("분리 — 보고서 2건 · 결석 칸은 메모만 · 보강한 날에 시수", async () => {
    setup();

    await pickSeparate();
    await userEvent.type(absentDateInput(), "2026-07-16");

    const line = screen.getByText(/따로 만듭니다/);
    expect(line).toHaveTextContent("모두 2건이 발송됩니다");
    expect(line).toHaveTextContent('7/16 수학 칸에 "7/31 보강 예정" 메모만 붙고(결석 0은 그대로)');
    expect(line).toHaveTextContent("7/31 칸이 1 + 보강 1 = 2");
  });

  it("이미 2로 고쳐 둔 행이면 3으로 안내한다(1로 박지 않는다)", () => {
    setup({ candidates: [cand({ attendanceUnits: 2 })] });

    expect(screen.getByText(/1건에 합쳐/)).toHaveTextContent("2 + 보강 1 = 3");
  });
});
