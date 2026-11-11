import { describe, expect, it } from "vitest";
import type { WindowWithdrawal } from "./server/window";
import type { SheetExitRecord } from "./sheet-teachers";
import { mergeSheetWithdrawals } from "./sheet-withdrawals";
import { studentNamesOf } from "./sheet-match";

const w = (over: Partial<WindowWithdrawal>): WindowWithdrawal => ({
  id: "s1", name: "태유정", school: "침산중", grade: "중2", enrolledAt: "2025-03-01", withdrawnAt: "2026-07-08", exitDate: "2026-07-08",
  lastClassName: "PS2S", lastClassSubject: "math", lastClassEnglishTrack: null, exitClasses: [], reason: null, memo: null, cleanup: false, ...over,
});
const rec = (over: Partial<SheetExitRecord>): SheetExitRecord => ({
  month: "2026-06", subject: "math", eie: false, name: "태유정", teachers: ["김화영"], schoolGrade: "침산중2", className: "PS2S",
  date: null, reason: null, memo: null, ...over,
});
const opts = { today: "2026-11-11", from: "2026-01-01", names: studentNamesOf([]) };

describe("운영실 퇴원 줄 = 2026-10까지 퇴원생 관리 차트", () => {
  it("🔴 학생마다 한 줄(시트의 두 과목 줄은 묶는다) · 이어진 줄은 시트 달로 · 장부 정리 표시를 푼다", () => {
    const out = mergeSheetWithdrawals([w({ cleanup: true })], [rec({}), rec({ subject: "english" })], opts);
    expect(out.map((r) => [r.id, r.exitDate, r.cleanup])).toEqual([["s1", "2026-06-30", false]]);
  });
  it("🔴 시트에만 있는 퇴원은 시트 글로(학교·학년 나눠서) · 지금 다니는 학생(과목만 끊음)은 퇴원으로 안 센다 · 시트 달의 에이와에만 있는 줄은 뺀다", () => {
    const out = mergeSheetWithdrawals(
      [w({ id: "x", name: "폐강반", exitDate: "2026-07-15", withdrawnAt: "2026-07-15" })],
      [rec({ name: "이민성" }), rec({ name: "재원생" })],
      { ...opts, names: studentNamesOf([{ name: "재원생", status: "enrolled", enrolled_at: "2025-01-01", withdrawn_at: null }]) },
    );
    expect(out.map((r) => [r.name, r.school, r.grade])).toEqual([["이민성", "침산중", "중2"]]);
  });
  it("🔴 11월에 센 줄은 10월 시트 줄이 끌어가지 않는다 · 동명이인 알파벳은 떼고 잇는다", () => {
    const out = mergeSheetWithdrawals(
      [w({ id: "n", name: "김소은", exitDate: "2026-11-05", withdrawnAt: "2026-11-05" }), w({ id: "a", name: "권민서A", exitDate: "2026-10-02", withdrawnAt: "2026-10-02" })],
      [rec({ name: "김소은", month: "2026-10" }), rec({ name: "권민서", month: "2026-10" })],
      { ...opts, names: studentNamesOf([{ name: "김소은", status: "withdrawn", enrolled_at: "2025-01-01", withdrawn_at: "2026-12-05" }]) },
    );
    // 10월 시트 김소은은 11월 에이와 줄을 끌어가지 않는다 — 그 이름은 에이와 퇴원 줄이 있어(다른 달) 과목만 끊은 것으로 본다.
    expect(out.map((r) => [r.id, r.exitDate]).sort()).toEqual([["a", "2026-10-02"], ["n", "2026-11-05"]]);
  });
});

it("🔴 같은 달 짝을 먼저 — 8월 시트 줄이 9월에 센 줄을 가로채지 않는다", () => {
  const out = mergeSheetWithdrawals(
    [w({ id: "aug", exitDate: "2026-08-20", withdrawnAt: "2026-08-20" }), w({ id: "sep", exitDate: "2026-09-10", withdrawnAt: "2026-09-10" })],
    [rec({ month: "2026-09" }), rec({ month: "2026-08" })],
    opts,
  );
  expect(out.map((r) => [r.id, r.exitDate]).sort()).toEqual([["aug", "2026-08-20"], ["sep", "2026-09-10"]]);
});
it("시트가 아직 그 과목을 적지 않던 달의 줄은 그대로(영어 줄이 2월부터면 1월 영어 퇴원은 에이와 그대로)", () => {
  const out = mergeSheetWithdrawals(
    [w({ id: "e", name: "영어생", exitDate: "2026-01-20", withdrawnAt: "2026-01-20", lastClassSubject: "english" })],
    [rec({ month: "2026-01" }), rec({ month: "2026-02", subject: "english", name: "다른학생" })],
    { ...opts, names: studentNamesOf([{ name: "태유정", status: "enrolled", enrolled_at: "2025-01-01", withdrawn_at: null }, { name: "다른학생", status: "enrolled", enrolled_at: "2025-01-01", withdrawn_at: null }]) },
  );
  expect(out.map((r) => r.id)).toEqual(["e"]);
});

it("🔴 그만뒀다 다시 등록한 학생의 지난 퇴원은 퇴원으로 센다(지금 재원이어도 등록일이 그 달 뒤면)", () => {
  const out = mergeSheetWithdrawals([], [rec({ name: "재등록", month: "2026-07" })], {
    ...opts, names: studentNamesOf([{ name: "재등록", status: "enrolled", enrolled_at: "2026-09-01", withdrawn_at: null }]),
  });
  expect(out.map((r) => r.name)).toEqual(["재등록"]);
});

it("🔴 그 달 뒤에 '재원 복구'된 학생의 지난 퇴원은 퇴원으로 센다(복구는 첫 등록일을 그대로 둔다)", () => {
  const out = mergeSheetWithdrawals([], [rec({ name: "복구생", month: "2026-07" })], {
    ...opts,
    names: studentNamesOf([{ id: "b", name: "복구생", status: "enrolled", enrolled_at: "2024-03-01", withdrawn_at: null }], new Map([["b", ["2026-09-02"]]])),
  });
  expect(out.map((r) => r.name)).toEqual(["복구생"]);
});
