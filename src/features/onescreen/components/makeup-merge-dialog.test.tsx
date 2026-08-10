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
// 라벨에 "(결석분일 때만)" 보조 문구가 붙어 있어 정확 일치가 아니라 부분 일치로 잡는다.
const absentDateInput = () => screen.getByLabelText(/며칠자 결석분 보강인가요\?/);

describe("MakeupMergeDialog — 합침/분리 확인", () => {
  it("후보가 하나면 바로 '합쳐서 발송'할 수 있다", async () => {
    const { onConfirm } = setup();

    await userEvent.click(screen.getByRole("button", { name: "합쳐서 발송" }));

    expect(onConfirm).toHaveBeenCalledWith({ mode: "merge", candidate: expect.objectContaining({ classId: "c1" }), addUnits: 1 });
  });

  it("후보가 둘이면 과목을 고르기 전엔 합칠 수 없다(시수 오지급 차단)", async () => {
    const { onConfirm } = setup({ candidates: [cand(), cand({ name: "수학 특강", classId: "c2" })] });

    expect(screen.getByRole("button", { name: "합쳐서 발송" })).toBeDisabled();

    await userEvent.click(screen.getByRole("radio", { name: "수학 특강" }));
    await userEvent.click(screen.getByRole("button", { name: "합쳐서 발송" }));

    expect(onConfirm).toHaveBeenCalledWith({ mode: "merge", candidate: expect.objectContaining({ classId: "c2" }), addUnits: 1 });
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
  // 🔴 뒤집힘(원장 2026-08-07: *"오늘 날짜에 추가 보강할 수도 있잖아.. 근데 추가가 안된다니?"*).
  //    분리 보강이 반드시 결석분인 건 아니다 — 결석과 무관한 **추가 보강**은 메울 결석이 없다.
  //    필수로 두는 바람에 그 경우를 적을 칸이 없었고, 강사가 보강일(오늘)을 넣었다가 다시 막혔다.
  it("날짜를 비워 두면 '추가 보강'으로 보낼 수 있다", async () => {
    const { onConfirm } = setup();

    await pickSeparate();

    const confirm = screen.getByRole("button", { name: "분리해서 발송" });
    expect(confirm).toBeEnabled();
    expect(screen.getByText(/결석분 연결은 없고\(추가 보강\)/)).toBeInTheDocument();

    await userEvent.click(confirm);
    // 결석일 없이 넘어간다 — 호출부가 이 값으로 '연결할지'를 가른다.
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "separate", absentDate: "" }),
    );
  });

  it("날짜를 고르면 결석일과 함께 넘긴다", async () => {
    const { onConfirm } = setup();

    await pickSeparate();
    await userEvent.type(absentDateInput(), "2026-07-16");
    await userEvent.click(screen.getByRole("button", { name: "분리해서 발송" }));

    expect(onConfirm).toHaveBeenCalledWith({
      mode: "separate",
      candidate: expect.objectContaining({ classId: "c1" }),
      addUnits: 1,
      absentDate: "2026-07-16",
    });
  });

  // 🔴 뒤집힘(원장 2026-08-07: *"미래에 결석할 예정으로 미리 수업할 경우 추가할 방법이 없네"*).
  //    예전엔 상한(max=보강일)으로 미래를 아예 못 골랐다 — **선보강**이라는 실제 쓰임을 막고 있었다.
  it("미래 결석 예정일도 고를 수 있다 — 선보강", async () => {
    const { onConfirm } = setup();

    await pickSeparate();
    expect(absentDateInput()).not.toHaveAttribute("max"); // 상한 없음

    await userEvent.type(absentDateInput(), "2026-08-14"); // 보강일(TODAY)보다 뒤
    const confirm = screen.getByRole("button", { name: "분리해서 발송" });
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ absentDate: "2026-08-14" }));
  });

  /**
   * 같은 날은 출석부가 한 칸이라 "결석 0 그대로 + 시수 얹기"를 동시에 적을 자리가 없다.
   * 🔴 **값 자체를 안 받는다**(원장 2026-08-07: *"처음부터 오늘 날짜 선택 못하게"*) — 예전엔 받아 두고
   *    발송 버튼만 잠갔더니 "골랐는데 왜 안 되지"가 됐다. 칸은 비어 있고 = 그대로 '추가 보강'이라
   *    **막다른 길이 아니다**(확인 버튼은 살아 있다).
   */
  it("보강한 날은 칸에 들어가지 않고, 갈 길을 알려 준다", async () => {
    setup();

    await pickSeparate();
    await userEvent.type(absentDateInput(), TODAY);

    expect(absentDateInput()).toHaveValue(""); // 값이 안 들어간다
    expect(screen.getByText(/보강한 날이라 결석분으로 고를 수 없습니다/)).toBeInTheDocument();
    // 비어 있는 상태 = 추가 보강 → 막히지 않는다.
    expect(screen.getByRole("button", { name: "분리해서 발송" })).toBeEnabled();
  });

  it("다른 날을 다시 고르면 안내가 사라진다", async () => {
    setup();

    await pickSeparate();
    await userEvent.type(absentDateInput(), TODAY);
    await userEvent.type(absentDateInput(), "2026-07-16");

    expect(absentDateInput()).toHaveValue("2026-07-16");
    expect(screen.queryByText(/보강한 날이라 결석분으로 고를 수 없습니다/)).not.toBeInTheDocument();
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
      addUnits: 1,
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

  it("기본 보강 시수 = 그 반 정규 1회와 같은 값(1로 박지 않는다)", () => {
    // 🔴 원장 2026-08-06: 수학은 **0.5당 1시간** — 3시간 반은 1.5다. 1로 박으면 급여가 매번 0.5 모자란다.
    setup({ candidates: [cand({ attendanceUnits: 1.5 })] });

    expect(screen.getByLabelText("이번 보강 시수")).toHaveAttribute("placeholder", "1.5");
    expect(screen.getByText(/1건에 합쳐/)).toHaveTextContent("1.5 + 보강 1.5 = 3");
  });
});

describe("보강 시수 — 강사가 고칠 수 있다", () => {
  it("일부만 보강했으면 그만큼만(3시간 반에 1시간 = 0.5)", async () => {
    const { onConfirm } = setup({ candidates: [cand({ attendanceUnits: 1.5 })] });

    await userEvent.type(screen.getByLabelText("이번 보강 시수"), "0.5");
    expect(screen.getByText(/1건에 합쳐/)).toHaveTextContent("1.5 + 보강 0.5 = 2");

    await userEvent.click(screen.getByRole("button", { name: "합쳐서 발송" }));
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ addUnits: 0.5 }));
  });

  it("쉼표 소수점도 받는다 — 화면만 접히고 DB엔 다른 값이 남는 사고 방지", async () => {
    const { onConfirm } = setup();

    await userEvent.type(screen.getByLabelText("이번 보강 시수"), "1,5");
    await userEvent.click(screen.getByRole("button", { name: "합쳐서 발송" }));

    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ addUnits: 1.5 }));
  });

  it.each(["0", "-1", "abc"])("0 이하·숫자 아님(%s)이면 확인이 안 열린다", async (bad) => {
    setup();

    await userEvent.type(screen.getByLabelText("이번 보강 시수"), bad);

    expect(screen.getByRole("button", { name: "합쳐서 발송" })).toBeDisabled();
    expect(screen.getByText(/0보다 큰 숫자로 적어 주세요/)).toBeInTheDocument();
  });
});
