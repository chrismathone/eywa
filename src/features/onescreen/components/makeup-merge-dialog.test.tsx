import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MakeupMergeDialog } from "./makeup-merge-dialog";
import type { MergeCandidate } from "../makeup-merge-plan";

/**
 * 여기서 잠그는 계약(원장 2026-08-06 *"선생님들이 헷갈린대"*):
 *  ① 보강 추가는 **묻는다** — 합침/분리를 강사가 고른다(자동 합치기 금지).
 *  ② 후보가 둘 이상이면 **고르기 전엔 합칠 수 없다** — 추측해서 시수를 올리면 안 한 과목까지 급여가 붙는다.
 *  ③ 어느 쪽을 고르면 무슨 일이 벌어지는지(발송 건수·수업타임) 화면에 문장으로 있다.
 */
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
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...props}
    />,
  );
  return { onConfirm, onCancel };
};

describe("MakeupMergeDialog — 합침/분리 확인", () => {
  it("후보가 하나면 바로 '합쳐서 발송'할 수 있다", async () => {
    const { onConfirm } = setup();

    await userEvent.click(screen.getByRole("button", { name: "합쳐서 발송" }));

    expect(onConfirm).toHaveBeenCalledWith({ mode: "merge", candidate: expect.objectContaining({ classId: "c1" }) });
  });

  it("'분리'를 고르면 별도 보강 보고서로 — 합치기 정보는 넘기지 않는다", async () => {
    const { onConfirm } = setup();

    await userEvent.click(screen.getByRole("radio", { name: "분리 (보강 따로)" }));
    await userEvent.click(screen.getByRole("button", { name: "분리해서 발송" }));

    expect(onConfirm).toHaveBeenCalledWith({ mode: "separate" });
  });

  it("후보가 둘이면 과목을 고르기 전엔 합칠 수 없다(시수 오지급 차단)", async () => {
    const { onConfirm } = setup({ candidates: [cand(), cand({ name: "수학 특강", classId: "c2" })] });

    expect(screen.getByRole("button", { name: "합쳐서 발송" })).toBeDisabled();

    await userEvent.click(screen.getByRole("radio", { name: "수학 특강" }));
    await userEvent.click(screen.getByRole("button", { name: "합쳐서 발송" }));

    expect(onConfirm).toHaveBeenCalledWith({ mode: "merge", candidate: expect.objectContaining({ classId: "c2" }) });
  });

  it("후보가 둘이어도 '분리'는 고르는 것 없이 바로 된다", async () => {
    const { onConfirm } = setup({ candidates: [cand(), cand({ name: "수학 특강", classId: "c2" })] });

    await userEvent.click(screen.getByRole("radio", { name: "분리 (보강 따로)" }));

    const confirm = screen.getByRole("button", { name: "분리해서 발송" });
    expect(confirm).not.toBeDisabled();
    await userEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith({ mode: "separate" });
  });

  it("고른 결과를 문장으로 밝힌다 — 합치면 1건·수업타임 2, 분리하면 2건", async () => {
    setup();

    // ⚠️ 숫자 뒤 조사 금지("2이 됩니다"는 틀린 조사) — 수치는 문장 끝에 붙는다.
    expect(screen.getByText(/1건에 합쳐/)).toHaveTextContent("출석부 수업타임 2");

    await userEvent.click(screen.getByRole("radio", { name: "분리 (보강 따로)" }));
    expect(screen.getByText(/따로 만듭니다/)).toHaveTextContent("모두 2건이 발송됩니다");
  });

  it("이미 발송된 정규 행이면 합치기 전에 경고한다", async () => {
    setup({ sentSubjects: ["수학"] });

    // 과목명과 '보고서' 사이 공백까지 확인 — JSX에서 식과 텍스트를 섞으면 붙어 나온다("수학보고서는").
    expect(screen.getByText(/^수학 보고서는 이미 발송되어 보강 내용은 실리지 않습니다/)).toBeInTheDocument();

    // 분리로 바꾸면 그 경고는 해당 없음(분리는 보강 보고서를 새로 만든다).
    await userEvent.click(screen.getByRole("radio", { name: "분리 (보강 따로)" }));
    expect(screen.queryByText(/이미 발송되어 보강 내용은 실리지 않습니다/)).not.toBeInTheDocument();
  });

  it("취소는 아무 선택도 넘기지 않는다", async () => {
    const { onConfirm, onCancel } = setup();

    await userEvent.click(screen.getByRole("button", { name: "취소" }));

    expect(onCancel).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
