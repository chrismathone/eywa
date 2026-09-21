import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MakeupConfirmDialog } from "./makeup-confirm-dialog";
import type { MergeCandidate } from "@/features/onescreen/makeup-merge-plan";
import type { MakeupAbsenceList, MakeupAbsenceOption } from "../makeup-options";

/**
 * 여기서 잠그는 계약:
 *  ① 보강 추가는 **묻는다** — 합침/분리를 강사가 고른다(자동 합치기 금지, 원장 2026-08-06).
 *  ② **어느 쪽이든 어느 수업인지 골라야** 확인이 열린다 — 그 반에 시수가 얹히므로 급여 귀속이다.
 *  ③ 며칠자 결석분인지는 **목록에서 고른다** — 🔴 반 이동 전 옛 반 결석도 고를 수 있어야 한다
 *     (원장 2026-08-19 *"이전 수업을 이월해 보강"*). 목록에 없으면 직접 입력(선보강).
 *  ④ **정규 수업이 없어도 창은 뜬다**(원장 2026-08-19 *"그냥 추가되고 끝이야"*) — 그때는 합침이 없다.
 *  ⑤ 고르면 무슨 일이 벌어지는지가 화면에 문장으로 있다(발송 건수·수업타임·출석부 칸).
 *  ⑥ 목록이 비었으면 **왜** 비었는지 말한다 — 결석이 없는 것과 과목이 달라 뺀 것은 다른 사실이다
 *     (원장 제보 2026-08-19: 수학 반 보강에 영어 결석이 뜨던 것을 과목으로 좁혔다).
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
const absence = (over: Partial<MakeupAbsenceOption> = {}): MakeupAbsenceOption => ({
  classId: "c1",
  className: "수학",
  date: "2026-07-16",
  ...over,
});

/** 결석 후보 한 벌 — 대부분의 테스트는 뺀 건수가 0이다(과목 필터가 안 걸린 화면). */
const list = (options: MakeupAbsenceOption[] = [], over: Partial<MakeupAbsenceList> = {}): MakeupAbsenceList => ({
  options,
  hiddenBySubject: 0,
  ...over,
});

const setup = (props: Partial<Parameters<typeof MakeupConfirmDialog>[0]> = {}) => {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <MakeupConfirmDialog
      studentName="홍길동"
      candidates={[cand()]}
      sentSubjects={[]}
      makeupDate={TODAY}
      absences={list([absence()])}
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...props}
    />,
  );
  return { onConfirm, onCancel };
};

const pickSeparate = () => userEvent.click(screen.getByRole("radio", { name: "분리 (보강 따로)" }));
/** 보강을 기록할 수업 드롭다운 — 칩으로 늘어놓지 않는다(원장 2026-09-21 *"드랍다운으로 처리해 나열하지말고"*). */
const hostSelect = () => screen.getByRole("button", { name: /^보강 기록 수업/ });
const queryHostSelect = () => screen.queryByRole("button", { name: /^보강 기록 수업/ });
/** 드롭다운을 열고 그 이름으로 시작하는 항목을 고른다(항목 이름 뒤에 '오늘 정규'·'보강 반' 꼬리표가 붙는다). */
const pickHost = async (label: RegExp) => {
  await userEvent.click(hostSelect());
  await userEvent.click(screen.getByRole("button", { name: label }));
};
/** 드롭다운을 열어 목록에 선 항목 이름들을 순서대로 돌려준다. */
const openHostOptions = async () => {
  await userEvent.click(hostSelect());
  return screen.getAllByRole("listitem").map((li) => li.textContent ?? "");
};
const absenceSelect = () => screen.getByLabelText(/며칠자 결석분 보강인가요\?/);

describe("합침/분리 확인", () => {
  it("후보가 하나면 바로 '합쳐서 발송'할 수 있다", async () => {
    const { onConfirm } = setup();

    await userEvent.click(screen.getByRole("button", { name: "합쳐서 발송" }));

    expect(onConfirm).toHaveBeenCalledWith({
      mode: "merge",
      candidate: expect.objectContaining({ classId: "c1" }),
      addUnits: 1,
    });
  });

  it("후보가 둘이면 과목을 고르기 전엔 합칠 수 없다(시수 오지급 차단)", async () => {
    const { onConfirm } = setup({ candidates: [cand(), cand({ name: "수학 특강", classId: "c2" })] });

    expect(screen.getByRole("button", { name: "합쳐서 발송" })).toBeDisabled();

    await userEvent.click(screen.getByRole("radio", { name: "수학 특강" }));
    await userEvent.click(screen.getByRole("button", { name: "합쳐서 발송" }));

    expect(onConfirm).toHaveBeenCalledWith({
      mode: "merge",
      candidate: expect.objectContaining({ classId: "c2" }),
      addUnits: 1,
    });
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

describe("🔴 정규 수업이 없어도 창은 뜬다 — 보강의 대다수가 이 경로다", () => {
  it("합침 토글이 없고 '보강 추가'로 확인한다", async () => {
    const { onConfirm } = setup({ candidates: [] });

    expect(screen.queryByRole("radio", { name: "합침 (정규+보강)" })).not.toBeInTheDocument();
    expect(screen.getByText(/오늘 이 선생님의 정규 수업은 없습니다/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "보강 추가" }));

    expect(onConfirm).toHaveBeenCalledWith({ mode: "separate", candidate: null, addUnits: 1 });
  });

  it("후보가 없어도 결석분·시수는 묻는다", () => {
    setup({ candidates: [] });

    expect(absenceSelect()).toBeInTheDocument();
    expect(screen.getByLabelText("이번 보강 시수")).toBeInTheDocument();
  });
});

describe("⑦ 보강을 기록할 수업을 고른다(원장 2026-09-21 — '반 없이'만 되던 보강이 출석부에 줄을 늘렸다)", () => {
  // 🔴 창엔 학생이 다니는 반만 선다(원장 2026-09-21 *"해당 학생의 소속 수업만 띄워"*) — `other`는 선생님 반이지만 이 학생 반이 아니다.
  const hosts = [
    { classId: "own", className: "중등M 초6 TP2Q", subject: "math", enrolled: true },
    { classId: "own2", className: "중등M 중1 MS2R", subject: "math", enrolled: true },
    { classId: "other", className: "고등M 개별 토", subject: "math", enrolled: false },
  ];
  it("정규 수업이 없는 보강에서 기본값이 있으면 그 반으로 확인한다", async () => {
    const { onConfirm } = setup({ candidates: [], hostClasses: { options: hosts }, defaultHostClassId: "own" });
    expect(hostSelect()).toHaveAccessibleName("보강 기록 수업: 중등M 초6 TP2Q");
    expect(screen.getByText(/출석부 중등M 초6 TP2Q 반에 보강으로 기록합니다/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "보강 추가" }));
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ mode: "separate", candidate: null, hostClassId: "own" }));
  });
  it("🔴 학생이 다니는 반만 드롭다운에 선다 — 선생님의 다른 반은 없다(칩으로 늘어놓지도 않는다)", async () => {
    setup({ candidates: [], hostClasses: { options: hosts }, defaultHostClassId: null });
    expect(screen.queryByRole("radio", { name: /중등M/ })).not.toBeInTheDocument();
    expect(await openHostOptions()).toEqual(["중등M 초6 TP2Q", "중등M 중1 MS2R", "반 없이보강 반"]);
  });
  it("기본값이 없으면 고르기 전엔 확인이 막힌다 — '반 없이'로 조용히 떨어지지 않는다", async () => {
    const { onConfirm } = setup({ candidates: [], hostClasses: { options: hosts }, defaultHostClassId: null });
    expect(screen.getByRole("button", { name: "보강 추가" })).toBeDisabled();
    expect(screen.getByText(/보강을 기록할 수업을 고르세요/)).toBeInTheDocument();
    expect(hostSelect()).toHaveAccessibleName("보강 기록 수업: 수업을 고르세요");
    await pickHost(/^반 없이/);
    expect(screen.getByText(/보고서를 저장할 때 선생님 반에 이 학생 칸이 없으면/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "보강 추가" }));
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ hostClassId: null }));
  });
  it("🔴 다니는 반이 없어 '반 없이'만 남아도 자동으로 고르지 않는다 — 조용히 보강 반으로 떨어지면 출석부에 줄이 또 선다(적대 리뷰 2026-09-21)", async () => {
    const { onConfirm } = setup({ candidates: [], hostClasses: { options: [hosts[2]!] }, defaultHostClassId: null });
    expect(screen.getByRole("button", { name: "보강 추가" })).toBeDisabled();
    expect(hostSelect()).toHaveAccessibleName("보강 기록 수업: 수업을 고르세요");
    expect(await openHostOptions()).toEqual(["반 없이보강 반"]);
    await userEvent.click(screen.getByRole("button", { name: /^반 없이/ }));
    await userEvent.click(screen.getByRole("button", { name: "보강 추가" }));
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ hostClassId: null }));
  });
  it("🔴 오늘 선생님 반에 합칠 수 없는 정규 칸(결석 등)이 있으면 '반 없이'는 없다 — 보고서 저장 훅이 보강 반을 안 만들어 시수가 아무 데도 안 선다", async () => {
    setup({ candidates: [], hostClasses: { options: [hosts[1]!, hosts[2]!], regularToday: true }, defaultHostClassId: null });
    expect(await openHostOptions()).toEqual(["중등M 중1 MS2R"]);
    expect(screen.getByText("보강을 기록할 수업을 고르세요.")).toBeInTheDocument();
  });
  it("🔴 그런데 다른 소속 수업도 없으면 기록할 곳이 없다고 밝히고 막는다(빈 드롭다운·보이지 않는 '반 없이'로 두지 않는다)", () => {
    setup({ candidates: [], hostClasses: { options: [hosts[2]!], regularToday: true }, defaultHostClassId: null });
    expect(queryHostSelect()).not.toBeInTheDocument();
    expect(screen.getByText("기록할 수 있는 수업이 없습니다")).toBeInTheDocument();
    expect(screen.getByText(/보강을 기록할 다른 소속 수업도 없습니다 — 그 칸의 출결을 먼저 확인해 주세요/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "보강 추가" })).toBeDisabled();
  });
  it("🔴 창이 열린 사이 고른 반이 후보에서 빠지면 그 반을 내보내지 않는다 — 요약 문장과 다른 반으로 나가지 않게", async () => {
    const onConfirm = vi.fn();
    const props = { studentName: "홍길동", candidates: [], sentSubjects: [], makeupDate: TODAY, absences: list([absence()]), onConfirm, onCancel: vi.fn() };
    const { rerender } = render(<MakeupConfirmDialog {...props} hostClasses={{ options: hosts }} defaultHostClassId={null} />);
    await pickHost(/^중등M 중1 MS2R/);
    // 그 반에 오늘 정규 행이 생겨 후보에서 빠졌다.
    rerender(<MakeupConfirmDialog {...props} hostClasses={{ options: [hosts[0]!] }} defaultHostClassId={null} />);
    expect(screen.getByRole("button", { name: "보강 추가" })).toBeDisabled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
  it("목록을 불러오는 중엔 확인을 막고, '반 없이'로 먼저 두지 않는다", () => {
    setup({ candidates: [], hostClasses: { options: [], loading: true } });
    expect(screen.getByRole("button", { name: "보강 추가" })).toBeDisabled();
    expect(screen.getByText("수업 목록을 불러오는 중…")).toBeInTheDocument();
    // 고를 것이 하나도 없으니 빈 목록이 열리는 드롭다운을 세우지 않는다.
    expect(queryHostSelect()).not.toBeInTheDocument();
    expect(screen.queryByText(/보이지 않는 '보강' 반/)).not.toBeInTheDocument();
  });
  it("수업 목록 실패 — 묻지 않고 종전 앵커(보던 반 필터)로 기록한다: hostClassId를 안 싣는다('반 없이'로 떨어뜨리지 않는다)", async () => {
    const { onConfirm } = setup({ candidates: [], hostClasses: { options: [], failed: true } });
    expect(screen.getByText(/수업 목록을 불러오지 못해 보고 있던 반 필터 기준으로 기록합니다/)).toBeInTheDocument();
    expect(queryHostSelect()).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "보강 추가" }));
    expect(onConfirm).toHaveBeenCalledWith({ mode: "separate", candidate: null, addUnits: 1 });
  });
  it("🔴 정규 수업이 있어도 묻는다 — 오늘 정규 수업이 맨 앞·처음 선택이고, 그대로 합치면 hostClassId를 안 싣는다(원장 2026-09-21 '항상 다른 수업을 고를 수 있게')", async () => {
    const { onConfirm } = setup({ candidates: [cand({ className: "고등M 중2 PS3A" })], hostClasses: { options: hosts }, defaultHostClassId: "own" });
    // 반 필터 기본값(own)은 정규 수업이 있으면 처음 선택이 아니다.
    expect(hostSelect()).toHaveAccessibleName("보강 기록 수업: 고등M 중2 PS3A");
    expect(hostSelect()).toHaveTextContent("오늘 정규");
    expect((await openHostOptions())[0]).toBe("고등M 중2 PS3A오늘 정규");
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByRole("button", { name: "합쳐서 발송" }));
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ mode: "merge", candidate: expect.objectContaining({ classId: "c1" }) }));
    // ⚠️ `not.objectContaining({ hostClassId: expect.anything() })`는 null을 못 잡는다('반 없이'가 잘못 실려도 통과) — 키 자체가 없어야 한다.
    expect(onConfirm.mock.calls[0]![0]).not.toHaveProperty("hostClassId");
  });
  it("🔴 정규 수업이 있으면 '반 없이'는 없다 — 그 정규 칸 때문에 보강 반이 안 생겨 시수가 아무 데도 안 선다(적대 리뷰 2026-09-21)", async () => {
    setup({ candidates: [cand({ className: "고등M 중2 PS3A" })], hostClasses: { options: hosts } });
    expect(await openHostOptions()).toEqual(["고등M 중2 PS3A오늘 정규", "중등M 초6 TP2Q", "중등M 중1 MS2R"]);
  });
  it("오늘 정규 수업의 반이 후보 목록에도 있으면 한 번만 선다('오늘 정규' 항목)", async () => {
    setup({ candidates: [cand({ classId: "own", className: "중등M 초6 TP2Q" })], hostClasses: { options: hosts } });
    expect(await openHostOptions()).toEqual(["중등M 초6 TP2Q오늘 정규", "중등M 중1 MS2R"]);
  });
  it("정규 수업 말고 다니는 반이 없으면 드롭다운 없이 그 수업만 적는다(한 줄짜리 목록을 열게 하지 않는다)", async () => {
    const { onConfirm } = setup({ candidates: [cand({ className: "고등M 중2 PS3A" })], hostClasses: { options: [hosts[2]!] } });
    expect(queryHostSelect()).not.toBeInTheDocument();
    expect(screen.getByText("고등M 중2 PS3A")).toBeInTheDocument();
    expect(screen.getByText("오늘 정규")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "합쳐서 발송" }));
    expect(onConfirm.mock.calls[0]![0]).not.toHaveProperty("hostClassId");
  });
  it("🔴 정규 수업이 있는데 다른 반을 고르면 합침은 사라지고 그 반에 보강으로 기록한다(candidate null · hostClassId)", async () => {
    const { onConfirm } = setup({ candidates: [cand({ className: "고등M 중2 PS3A" })], hostClasses: { options: hosts } });
    await pickHost(/^중등M 초6 TP2Q/);
    expect(hostSelect()).toHaveAccessibleName("보강 기록 수업: 중등M 초6 TP2Q");
    expect(screen.queryByRole("radiogroup", { name: "보강 보고서 처리 방식" })).not.toBeInTheDocument();
    expect(screen.getByText(/오늘 정규 보고서와 따로 보강 보고서가 나갑니다. 출석부 중등M 초6 TP2Q 반에 보강으로 기록합니다/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "보강 추가" }));
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ mode: "separate", candidate: null, hostClassId: "own" }));
  });
  it("정규 수업을 다시 고르면 합침/분리가 돌아오고, 분리 요약에 시수를 얹을 반 이름이 선다", async () => {
    setup({ candidates: [cand({ className: "고등M 중2 PS3A" })], hostClasses: { options: hosts } });
    await pickHost(/^중등M 초6 TP2Q/);
    await pickHost(/^고등M 중2 PS3A/);
    await pickSeparate();
    expect(screen.getByText(/보강 시수는 고등M 중2 PS3A 칸에 얹습니다/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "분리해서 발송" })).toBeEnabled();
  });
  it("정규 수업을 골랐으면 다른 수업 목록을 기다리지 않는다(불러오는 중이어도 확인 가능)", () => {
    setup({ candidates: [cand()], hostClasses: { options: [], loading: true } });
    expect(screen.getByText("다른 수업을 불러오는 중…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "합쳐서 발송" })).toBeEnabled();
  });
  it("정규 수업이 둘이면 고르기 전엔 막힌다 — 추측하지 않는다(결석 선택란이 떴다 사라지지 않게 정규 쪽으로 둔다)", () => {
    setup({ candidates: [cand(), cand({ name: "수학 · 특강", classId: "c2" })], hostClasses: { options: hosts } });
    expect(screen.getByText(/보강을 기록할 수업을 고르세요/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "합쳐서 발송" })).toBeDisabled();
    expect(screen.queryByLabelText("며칠자 결석분 보강인가요?")).not.toBeInTheDocument();
  });
  it("정규 수업이 둘이고 목록을 불러오는 중이면 '불러오는 중'이 아니라 '고르세요'라고 한다(정규 수업은 바로 고를 수 있다)", () => {
    setup({ candidates: [cand(), cand({ name: "수학 · 특강", classId: "c2" })], hostClasses: { options: [], loading: true } });
    expect(screen.getByText(/보강을 기록할 수업을 고르세요\./)).toBeInTheDocument();
    expect(screen.queryByText(/수업 목록을 불러오는 중입니다/)).not.toBeInTheDocument();
  });
  it("정규 수업이 있고 수업 목록이 실패하면 종전대로(묻지 않고 정규 수업에 기록 — hostClassId 없음)", async () => {
    const { onConfirm } = setup({ hostClasses: { options: [], failed: true } });
    expect(queryHostSelect()).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "합쳐서 발송" }));
    expect(onConfirm.mock.calls[0]![0]).not.toHaveProperty("hostClassId");
  });
  it("후보를 안 넘긴 화면(ECS·반별 출석부)은 종전 그대로 — 묻지 않고 hostClassId도 없다", async () => {
    const { onConfirm } = setup({ candidates: [] });
    expect(queryHostSelect()).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "보강 추가" }));
    expect(onConfirm).toHaveBeenCalledWith({ mode: "separate", candidate: null, addUnits: 1 });
  });
});

describe("결석분 — 목록에서 고른다(이월 보강)", () => {
  it("기본은 '결석분 아님'이라 그대로 확인하면 연결이 없다", async () => {
    const { onConfirm } = setup();

    await pickSeparate();
    expect(screen.getByText(/결석분 연결은 없고\(추가 보강\)/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "분리해서 발송" }));
    expect(onConfirm).toHaveBeenCalledWith(
      expect.not.objectContaining({ absentDate: expect.anything() }),
    );
  });

  it("🔴 반 이동 전 옛 반 결석도 고를 수 있고, 그 반 id가 함께 넘어간다", async () => {
    const { onConfirm } = setup({
      candidates: [],
      absences: list([absence({ classId: "old", className: "초4 BS1J", date: "2026-07-16", pastClass: true })]),
    });

    await userEvent.selectOptions(absenceSelect(), "old|2026-07-16");
    await userEvent.click(screen.getByRole("button", { name: "보강 추가" }));

    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ absentDate: "2026-07-16", absentClassId: "old" }),
    );
  });

  it("이전 반은 목록에 '(이전 반)'으로 밝힌다 — 무엇을 고르는지 알아야 한다", () => {
    // 합침 모드에선 결석분을 안 묻는다 → 후보 없는(보강만) 상태로 연다.
    setup({ candidates: [], absences: list([absence({ className: "초4 BS1J", pastClass: true })]) });

    expect(screen.getByRole("option", { name: "7/16 초4 BS1J (이전 반)" })).toBeInTheDocument();
  });

  it("목록에 없으면 직접 입력 — 선보강(미래 결석 예정일)도 받는다", async () => {
    const { onConfirm } = setup({ candidates: [], absences: list() });

    await userEvent.selectOptions(absenceSelect(), "__custom__");
    const date = screen.getByLabelText("결석 날짜 직접 입력");
    await userEvent.type(date, "2026-08-14"); // 보강일(TODAY)보다 뒤
    expect(date).not.toHaveAttribute("max"); // 상한 없음(선보강)

    await userEvent.click(screen.getByRole("button", { name: "보강 추가" }));
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ absentDate: "2026-08-14" }));
  });

  it("보강한 날은 직접 입력 칸에 들어가지 않고, 갈 길을 알려 준다", async () => {
    setup({ candidates: [], absences: list() });

    await userEvent.selectOptions(absenceSelect(), "__custom__");
    const date = screen.getByLabelText("결석 날짜 직접 입력");
    await userEvent.type(date, TODAY);

    expect(date).toHaveValue("");
    expect(screen.getByText(/보강한 날이라 결석분으로 고를 수 없습니다/)).toBeInTheDocument();
    // '직접 입력'인데 칸이 비면 확인은 잠긴다 — 조용히 '추가 보강'으로 넘어가면 고른 것과 다른 일이 된다.
    expect(screen.getByRole("button", { name: "보강 추가" })).toBeDisabled();
    // 🔴 막다른 길이면 안 된다 — 빠져나갈 길을 문장으로 알려 주고, 그대로 하면 열린다.
    expect(screen.getByText(/결석분이 아니면 '결석분 아님'을 고르세요/)).toBeInTheDocument();
    await userEvent.selectOptions(absenceSelect(), "__none__");
    expect(screen.getByRole("button", { name: "보강 추가" })).toBeEnabled();
  });

  it("시수 관용은 서버와 같다 — 1.25·30은 확인이 안 열린다(저장 단계 실패 방지)", async () => {
    setup({ candidates: [] });

    const units = screen.getByLabelText("이번 보강 시수");
    await userEvent.type(units, "1.25");
    expect(screen.getByRole("button", { name: "보강 추가" })).toBeDisabled();

    await userEvent.clear(units);
    await userEvent.type(units, "30");
    expect(screen.getByRole("button", { name: "보강 추가" })).toBeDisabled();

    await userEvent.clear(units);
    await userEvent.type(units, "1.5");
    expect(screen.getByRole("button", { name: "보강 추가" })).toBeEnabled();
  });

  it("합침을 고르면 결석분은 묻지 않는다(같은 날 한 칸에서 만난다)", async () => {
    setup();

    expect(screen.queryByLabelText(/며칠자 결석분/)).not.toBeInTheDocument();
    await pickSeparate();
    expect(absenceSelect()).toBeInTheDocument();
  });
});

describe("고른 결과를 문장으로 밝힌다", () => {
  it("합침 — 보고서 1건 · 수업타임 1+1=2", () => {
    setup();

    expect(screen.getByText(/1건에 합쳐/)).toHaveTextContent("1 + 보강 1 = 2");
  });

  it("분리 — 보고서 2건 · 결석 칸은 메모만 · 보강한 날에 시수", async () => {
    setup();

    await pickSeparate();
    await userEvent.selectOptions(absenceSelect(), "c1|2026-07-16");

    const line = screen.getByText(/따로 만듭니다/);
    expect(line).toHaveTextContent("모두 2건이 발송됩니다");
    expect(line).toHaveTextContent('7/16 수학 칸에 "7/31 보강 예정" 메모만 붙고(결석 0은 그대로)');
    expect(line).toHaveTextContent("보강 수업타임은 1");
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

/**
 * 교시 — 🔴 영어(ECS)는 **하루 한 교시만 도는 반이 없다**(실측 2026-08-19: 활성 반-요일 115개 전부 2~4교시).
 * 교시를 안 넘기면 그 칸이 "그날 전체"로 저장되고 주간 시트가 **첫 교시**에 붙인다.
 */
describe("어느 교시에 왔는가 (교시 축 화면만)", () => {
  const slots = [
    { start: "16:20", label: "1교시 16:20" },
    { start: "17:20", label: "2교시 17:20" },
  ];

  it("교시 선택지를 안 넘기면 묻지 않는다 — 없는 질문을 만들지 않는다(원스크린·반별 출석부)", () => {
    setup({ candidates: [] });
    expect(screen.queryByText("어느 교시에 왔나요?")).toBeNull();
  });

  it("🔴 교시를 고르기 전에는 확인이 막힌다 — 첫 교시로 조용히 밀어 넣지 않는다", async () => {
    const { onConfirm } = setup({ candidates: [], slotOptions: slots });

    expect(screen.getByText("어느 교시에 왔나요?")).toBeTruthy();
    const confirm = screen.getByRole("button", { name: "보강 추가" });
    expect(confirm).toHaveProperty("disabled", true);

    await userEvent.click(screen.getByRole("radio", { name: "2교시 17:20" }));
    await userEvent.click(screen.getByRole("button", { name: "보강 추가" }));

    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ slotStart: "17:20" }));
  });

  it("교시가 하나뿐이면 고를 것이 없으므로 자동 확정된다", async () => {
    const { onConfirm } = setup({ candidates: [], slotOptions: [slots[0]!] });

    await userEvent.click(screen.getByRole("button", { name: "보강 추가" }));

    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ slotStart: "16:20" }));
  });
});

/**
 * 🔴 **빈 목록의 뜻이 갈린다** — "결석이 없다"와 "과목이 달라 뺐다"는 다른 사실이다. 뒤쪽을 앞쪽처럼
 * 말하면 강사는 실제로 있는 영어 결석을 못 찾고 '직접 입력'으로 날짜를 손으로 적게 된다.
 */
describe("과목 필터 — 왜 비었는지 밝힌다", () => {
  it("과목 때문에 0건이면 그 과목 이름으로 말하고, 뺀 건수를 밝힌다", () => {
    setup({ candidates: [], absences: list([], { hiddenBySubject: 2, subjectLabel: "수학" }) });

    expect(screen.getByText(/수학 과목에 메울 결석이 없습니다/)).toBeInTheDocument();
    // ⚠️ 뺀 건수엔 **이미 보강한 결석**도 섞인다 — "메울 수 있는 2건"이라고 약속하면 있지도 않은 결석을
    //    찾아다니게 된다. 사실만 적는다: 다른 과목이라 뺐다.
    expect(screen.getByText(/다른 과목 결석 2건은 과목이 달라 뺐습니다/)).toBeInTheDocument();
  });

  it("과목 라벨을 못 받으면 raw 키 대신 '이 과목'이라고 한다(math·english 노출 금지)", () => {
    setup({ candidates: [], absences: list([], { hiddenBySubject: 1 }) });

    expect(screen.getByText(/이 과목에 메울 결석이 없습니다/)).toBeInTheDocument();
  });

  it("정말 결석이 없으면 종전 문구 그대로다(없는 과목 얘기를 지어내지 않는다)", () => {
    setup({ candidates: [], absences: list() });

    expect(screen.getByText(/최근 1년 결석 기록이 없습니다/)).toBeInTheDocument();
  });

  it("목록이 남아 있어도 뺀 게 있으면 그 사실을 알린다 — 목록이 전부인 줄 알면 안 된다", () => {
    setup({
      candidates: [],
      absences: list([absence()], { hiddenBySubject: 3, subjectLabel: "수학" }),
    });

    // ⚠️ "수학 결석만 보입니다"라고는 하지 않는다 — 미분류 과목 결석은 일부러 통과시키므로 남은 목록이
    //    한 과목이라고 단언할 수 없다. 뺀 사실만 말한다.
    expect(screen.getByText(/과목이 다른 결석 3건은 뺐습니다\(수학 과목 보강\)/)).toBeInTheDocument();
  });
});

describe("보강 기한(강사뷰) — 결석한 달의 다음 달 말일(원장 2026-09-18)", () => {
  it("뺀 결석이 있으면 그 수를 밝힌다 — 목록이 비어도 '결석이 없다'고 하지 않는다", () => {
    setup({ candidates: [], absences: list([], { hiddenByDeadline: 3 }) });
    expect(screen.getByText(/보강 기한\(결석한 달의 다음 달 말일\)이 지난 결석 3건은 뺐습니다/)).toBeInTheDocument();
    expect(screen.queryByText(/최근 1년 결석 기록이 없습니다/)).toBeNull();
  });

  it("🔴 직접 입력으로 기한 지난 결석을 되살리지 못한다 — 선보강(미래 날짜)은 그대로 받는다", async () => {
    // 보강일 7/31 → 5월 결석은 6/30이 기한.
    setup({ candidates: [], absences: list([], { hiddenByDeadline: 0 }) });
    await userEvent.selectOptions(absenceSelect(), "__custom__");
    const date = screen.getByLabelText("결석 날짜 직접 입력");
    await userEvent.type(date, "2026-05-20");
    expect(screen.getByText(/보강 기한이 지난 결석입니다 — 5월 결석은 6\/30까지/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "보강 추가" })).toBeDisabled();

    await userEvent.clear(date);
    await userEvent.type(date, "2026-08-14");
    expect(screen.queryByText(/보강 기한이 지난 결석입니다/)).toBeNull();
    expect(screen.getByRole("button", { name: "보강 추가" })).toBeEnabled();
  });

  it("🔴 목록이 늦게 와도 먼저 넣은 날짜를 다시 본다 — 입력 순간만 보면 로딩 중에 넣은 날짜가 빠져나간다", async () => {
    const onConfirm = vi.fn();
    const props = {
      studentName: "홍길동",
      candidates: [],
      sentSubjects: [],
      makeupDate: TODAY,
      onConfirm,
      onCancel: vi.fn(),
    };
    // 로딩 중(기한 칸 없음)에 5월 날짜를 넣는다.
    const { rerender } = render(<MakeupConfirmDialog {...props} absences={list()} />);
    await userEvent.selectOptions(absenceSelect(), "__custom__");
    await userEvent.type(screen.getByLabelText("결석 날짜 직접 입력"), "2026-05-20");
    expect(screen.getByRole("button", { name: "보강 추가" })).toBeEnabled();
    // 목록이 도착했다(강사뷰 — 기한 칸이 생긴다).
    rerender(<MakeupConfirmDialog {...props} absences={list([], { hiddenByDeadline: 0 })} />);
    expect(screen.getByRole("button", { name: "보강 추가" })).toBeDisabled();
  });

  it("목록을 불러오는 중엔 '직접 입력' 확인을 잠근다 — 기한 판정 재료 없이 보내면 보강만 저장되는 반쪽이 된다", async () => {
    setup({ candidates: [], absences: list(), absenceLoading: true });
    await userEvent.selectOptions(absenceSelect(), "__custom__");
    await userEvent.type(screen.getByLabelText("결석 날짜 직접 입력"), "2026-08-14");
    expect(screen.getByRole("button", { name: "보강 추가" })).toBeDisabled();
    expect(screen.getByText(/결석 기록을 불러오는 중입니다 — 잠시 뒤 확인할 수 있습니다/)).toBeInTheDocument();
  });

  it("사무실 화면(기한 칸 없음)은 직접 입력을 막지 않는다 — 종전 그대로", async () => {
    setup({ candidates: [], absences: list() });
    await userEvent.selectOptions(absenceSelect(), "__custom__");
    const date = screen.getByLabelText("결석 날짜 직접 입력");
    await userEvent.type(date, "2026-05-20");
    expect(date).toHaveValue("2026-05-20");
  });
});
