import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ManagerDefaultsButton } from "./manager-defaults-dialog";
import type { ManagerDefaultView } from "./manager-defaults";

/**
 * 신규생 '과목 기본 담당 설정' 대화상자(2026-11-11) — 줄 구성 · 지정·교체만 · 줄마다 저장 · 충돌 안내. 합성 값만 쓴다.
 */
const m = vi.hoisted(() => ({ save: vi.fn(), refresh: vi.fn(), toast: vi.fn() }));
vi.mock("./server/manager-defaults-actions", () => ({ saveNewcomerDefaultManager: m.save }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: m.refresh }) }));
vi.mock("sonner", () => ({ toast: { success: m.toast, error: vi.fn() } }));
const LABELS: Record<string, string> = { math: "수학", english: "영어", science: "과학" };
vi.mock("@/features/owner/operations-context", () => ({
  useSubjectMaps: () => ({ labelOf: (key: string) => LABELS[key] ?? key, options: Object.entries(LABELS).map(([value, label]) => ({ value, label })) }),
}));
// 목록 팝오버는 여기서 보려는 것이 아니다 — 고르기만 되는 평범한 선택 칸으로 바꾼다.
vi.mock("@/components/ui/searchable-select", () => ({
  SearchableSelect: ({ value, onValueChange, options, ariaLabel, disabled, placeholder }: {
    value: string; onValueChange: (id: string) => void; options: { value: string; label: string }[]; ariaLabel: string; disabled?: boolean; placeholder?: string;
  }) => (
    <select aria-label={ariaLabel} value={value} disabled={disabled} onChange={(e) => onValueChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ),
}));

const STAMP = "2026-11-10T16:46:59.510883+00:00";
const heo = { id: "m-1", name: "허은진" }, jung = { id: "m-2", name: "정유진" }, kim = { id: "m-3", name: "김그린" };
const STAFF = [heo, jung, kim];
const DEFAULTS: ManagerDefaultView[] = [
  { subject: "math", manager: heo, updatedAt: STAMP },
  { subject: "english", manager: null, updatedAt: STAMP },
  { subject: "eie", manager: jung, updatedAt: STAMP },
];
const open = (defaults = DEFAULTS, staff = STAFF) => {
  const view = render(<ManagerDefaultsButton defaults={defaults} staff={staff} />);
  fireEvent.click(screen.getByRole("button", { name: "기본 담당 설정" }));
  /** 서버가 새 값을 내려준 것처럼 다시 그린다(router.refresh 뒤의 화면) — 대화상자는 열린 채 그대로다. */
  return { receive: (next: ManagerDefaultView[]) => view.rerender(<ManagerDefaultsButton defaults={next} staff={staff} />) };
};
const row = (label: string) => screen.getByRole("combobox", { name: `${label} 기본 담당` }).closest("li")!;
const pick = (label: string, id: string) => fireEvent.change(screen.getByRole("combobox", { name: `${label} 기본 담당` }), { target: { value: id } });
const saveButton = (label: string) => within(row(label)).getByRole("button");

beforeEach(() => { vi.clearAllMocks(); m.save.mockResolvedValue({ ok: true }); });
afterEach(cleanup);

it("닫혀 있을 때는 단추만 있다 — 누르면 지금 과목마다 한 줄 + EiE 줄이 선다", () => {
  render(<ManagerDefaultsButton defaults={DEFAULTS} staff={STAFF} />);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "기본 담당 설정" }));
  expect(screen.getByRole("dialog")).toHaveTextContent("직접 지정하지 않은 신규생 전체에 적용됩니다");
  expect(screen.getAllByRole("combobox").map((c) => c.getAttribute("aria-label"))).toEqual(["수학 기본 담당", "영어 기본 담당", "과학 기본 담당", "EiE 기본 담당"]);
});

it("줄마다 지금 상태를 적는다 — 지금 담당 · 재지정 필요 · 지정 없음 · EiE 줄의 사실 안내", () => {
  open();
  expect(row("수학")).toHaveTextContent("지금 허은진");
  expect(row("영어")).toHaveTextContent("재지정 필요");
  expect(row("과학")).toHaveTextContent("지정 없음");
  expect(row("EiE")).toHaveTextContent("지금 정유진");
  expect(row("EiE")).toHaveTextContent("EiE 반 학생은 ‘영어’ 기본 담당을 따릅니다");
  expect(row("수학")).not.toHaveTextContent("적용되지 않습니다");
  // 고르기 칸은 지금 담당자를 가리킨다 · 담당자가 없으면 비어 있다.
  expect(screen.getByRole("combobox", { name: "수학 기본 담당" })).toHaveValue("m-1");
  expect(screen.getByRole("combobox", { name: "영어 기본 담당" })).toHaveValue("");
});

it("🔴 지정·교체만 — 다른 담당자를 골라야 저장 단추가 켜진다(같은 사람 · 비우기는 저장할 것이 없다)", () => {
  open();
  expect(saveButton("수학")).toBeDisabled();
  expect(saveButton("수학")).toHaveTextContent("교체");
  expect(saveButton("과학")).toHaveTextContent("지정");
  pick("수학", "m-1");
  expect(saveButton("수학")).toBeDisabled();
  pick("수학", "");
  expect(saveButton("수학")).toBeDisabled();
  expect(screen.getByRole("combobox", { name: "수학 기본 담당" })).toHaveValue("m-1");
  pick("수학", "m-3");
  expect(saveButton("수학")).toBeEnabled();
  expect(screen.getByRole("dialog")).not.toHaveTextContent(/삭제|해제/);
});

it("줄마다 따로 저장한다 — 과목 · 새 담당자 · 연 때의 기준 값(글자 그대로)을 보내고, 화면을 다시 받는다", async () => {
  open();
  pick("수학", "m-3");
  pick("과학", "m-2");
  fireEvent.click(saveButton("수학"));
  await waitFor(() => expect(m.refresh).toHaveBeenCalledTimes(1));
  expect(m.save).toHaveBeenCalledTimes(1);
  expect(m.save).toHaveBeenCalledWith({ subject: "math", managerId: "m-3", expectedUpdatedAt: STAMP });
  expect(m.toast).toHaveBeenCalledWith("수학 기본 담당을 김그린 님으로 바꿨습니다");
});

it("줄이 없는 과목은 기준 값 없이(null) 보낸다 — 서버가 새 줄로 넣는다", async () => {
  open();
  pick("과학", "m-2");
  fireEvent.click(saveButton("과학"));
  await waitFor(() => expect(m.save).toHaveBeenCalledWith({ subject: "science", managerId: "m-2", expectedUpdatedAt: null }));
  await waitFor(() => expect(m.toast).toHaveBeenCalledWith("과학 기본 담당을 정유진 님으로 지정했습니다"));
});

it("🔴 그사이 다른 사람이 바꿨으면 그 줄에 알리고 최신 값을 다시 받는다 — 고른 값은 남는다", async () => {
  m.save.mockResolvedValue({ ok: false, error: "다른 사람이 먼저 바꿨습니다. 최신 값을 불러왔으니 확인한 뒤 다시 저장해 주세요.", conflict: true });
  open();
  pick("수학", "m-3");
  fireEvent.click(saveButton("수학"));
  await waitFor(() => expect(within(row("수학")).getByRole("alert")).toHaveTextContent("먼저 바꿨습니다"));
  expect(m.refresh).toHaveBeenCalledTimes(1);
  expect(m.toast).not.toHaveBeenCalled();
  expect(screen.getByRole("combobox", { name: "수학 기본 담당" })).toHaveValue("m-3");
  expect(within(row("영어")).queryByRole("alert")).not.toBeInTheDocument();
});

it("저장 실패는 그 줄에 사유를 적고 다시 받지 않는다 · 요청 자체가 실패해도 단추가 굳지 않는다", async () => {
  m.save.mockResolvedValue({ ok: false, error: "현재 학원의 관리 담당자를 선택해 주세요" });
  open();
  pick("수학", "m-3");
  fireEvent.click(saveButton("수학"));
  await waitFor(() => expect(within(row("수학")).getByRole("alert")).toHaveTextContent("관리 담당자를 선택"));
  expect(m.refresh).not.toHaveBeenCalled();
  m.save.mockRejectedValue(new Error("network"));
  fireEvent.click(saveButton("수학"));
  await waitFor(() => expect(within(row("수학")).getByRole("alert")).toHaveTextContent("저장하지 못했습니다"));
  expect(saveButton("수학")).toBeEnabled();
});

it("저장하는 동안에는 다른 줄도 잠근다(같은 기준 값으로 두 번 저장하지 않게)", async () => {
  let done: (v: { ok: true }) => void = () => {};
  m.save.mockReturnValue(new Promise((resolve) => { done = resolve; }));
  open();
  pick("수학", "m-3");
  pick("과학", "m-2");
  fireEvent.click(saveButton("수학"));
  await waitFor(() => expect(saveButton("수학")).toHaveTextContent("저장 중…"));
  expect(saveButton("과학")).toBeDisabled();
  expect(screen.getByRole("combobox", { name: "과학 기본 담당" })).toBeDisabled();
  fireEvent.click(saveButton("과학"));
  expect(m.save).toHaveBeenCalledTimes(1);
  done({ ok: true });
  await waitFor(() => expect(m.refresh).toHaveBeenCalled());
});

it("지정할 수 있는 관리 담당자가 없으면 까닭을 알리고 고르기를 잠근다", () => {
  open(DEFAULTS, []);
  expect(screen.getByRole("dialog")).toHaveTextContent("지정할 수 있는 관리 담당자");
  for (const c of screen.getAllByRole("combobox")) expect(c).toBeDisabled();
});

const STAMP2 = "2026-11-11T07:00:00.000001+00:00", STAMP3 = "2026-11-11T07:05:00.000002+00:00";
const withMath = (manager: typeof heo, updatedAt: string): ManagerDefaultView[] => DEFAULTS.map((d) => (d.subject === "math" ? { subject: "math", manager, updatedAt } : d));

it("🔴 저장이 끝난 선택은 남지 않는다 — 그 뒤 다른 사람이 바꾼 값이 내려와도 옛 선택이 '교체할 것'으로 되살아나지 않는다", async () => {
  const { receive } = open();
  pick("수학", "m-3");
  fireEvent.click(saveButton("수학"));
  await waitFor(() => expect(m.toast).toHaveBeenCalledTimes(1));
  // 내 저장이 반영된 값이 내려온다 → 칸은 새 담당자 · 저장할 것 없음.
  receive(withMath(kim, STAMP2));
  expect(screen.getByRole("combobox", { name: "수학 기본 담당" })).toHaveValue("m-3");
  expect(row("수학")).toHaveTextContent("지금 김그린");
  expect(saveButton("수학")).toBeDisabled();
  // 그사이 다른 사람이 정유진으로 바꿨다 → 칸은 지금 값(정유진)을 가리키고, 옛 선택(김그린)으로 다시 저장할 수 없다.
  receive(withMath(jung, STAMP3));
  expect(row("수학")).toHaveTextContent("지금 정유진");
  expect(screen.getByRole("combobox", { name: "수학 기본 담당" })).toHaveValue("m-2");
  expect(saveButton("수학")).toBeDisabled();
  fireEvent.click(saveButton("수학"));
  expect(m.save).toHaveBeenCalledTimes(1);
});

it("한 줄을 저장해도 다른 줄에서 고르던 값은 남는다(줄마다 따로 저장)", async () => {
  const { receive } = open();
  pick("수학", "m-3");
  pick("과학", "m-2");
  fireEvent.click(saveButton("수학"));
  await waitFor(() => expect(m.toast).toHaveBeenCalledTimes(1));
  receive(withMath(kim, STAMP2));
  expect(screen.getByRole("combobox", { name: "과학 기본 담당" })).toHaveValue("m-2");
  expect(saveButton("과학")).toBeEnabled();
});

it("🔴 충돌 뒤 다시 저장 — 고른 값은 남고, 다시 받은 최신 기준 값으로 보낸다", async () => {
  m.save.mockResolvedValueOnce({ ok: false, error: "다른 사람이 먼저 바꿨습니다. 최신 값을 불러왔으니 확인한 뒤 다시 저장해 주세요.", conflict: true });
  const { receive } = open();
  pick("수학", "m-3");
  fireEvent.click(saveButton("수학"));
  await waitFor(() => expect(within(row("수학")).getByRole("alert")).toBeInTheDocument());
  receive(withMath(jung, STAMP2));
  expect(row("수학")).toHaveTextContent("지금 정유진");
  expect(screen.getByRole("combobox", { name: "수학 기본 담당" })).toHaveValue("m-3");
  fireEvent.click(saveButton("수학"));
  await waitFor(() => expect(m.save).toHaveBeenCalledTimes(2));
  expect(m.save).toHaveBeenLastCalledWith({ subject: "math", managerId: "m-3", expectedUpdatedAt: STAMP2 });
  await waitFor(() => expect(within(row("수학")).queryByRole("alert")).not.toBeInTheDocument());
});

it("저장하는 동안에는 닫을 수 없다 · 닫았다 다시 열면 고르던 값이 남아 있지 않다", async () => {
  let done: (v: { ok: true }) => void = () => {};
  m.save.mockReturnValueOnce(new Promise((resolve) => { done = resolve; }));
  open();
  pick("수학", "m-3");
  pick("과학", "m-2");
  fireEvent.click(saveButton("수학"));
  await waitFor(() => expect(saveButton("수학")).toHaveTextContent("저장 중…"));
  expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  done({ ok: true });
  await waitFor(() => expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "기본 담당 설정" }));
  expect(screen.getByRole("combobox", { name: "과학 기본 담당" })).toHaveValue("");
  expect(saveButton("과학")).toBeDisabled();
});
