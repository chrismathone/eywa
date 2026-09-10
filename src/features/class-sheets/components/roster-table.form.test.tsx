import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RosterTable } from "./roster-table";
import type { ClassSheetWeekData } from "../server/queries";
import type { RosterEntry } from "../lib/grid";
import type { SheetHandlers } from "./sheet-client";
import { TODAY_NAME_W, weeklyNameWidth } from "../lib/today-columns";

// 로스터 **폼**(기본 / JJ 전용) 회귀 가드 — 원장 2026-08-13: *"점수 → 시험 점수"*, *"JJ 수업만 …
// 점수를 없애고 듣기 레벨, 누적 암기 단어수를 추가"*. 지켜야 할 것:
//  ① 머리 라벨이 폼대로일 것 ② JJ엔 시험 점수 칸이 없을 것
//  ③ 저장은 **바뀐 칸만** 실어 보낼 것(안 보낸 칸은 서버가 지금 값을 유지 — 다른 폼 값을 지우지 않는다).
vi.mock("@/components/workspace/window-link", () => ({
  WindowLink: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("./attendance-check", () => ({ AttendanceCheck: () => <span>출결칸</span> }));
vi.mock("./attitude-check", () => ({ AttitudeCheck: () => <span>태도칸</span> }));
vi.mock("@/features/onescreen/components/attendance-pills", () => ({
  SessionUnitsField: () => <span>유닛칸</span>,
}));

afterEach(cleanup);

const DATE = "2026-08-13";
const SLOT = "16:20";
const roster: RosterEntry[] = [{ studentId: "stu-1", eligible: true, historical: false, endedOn: null }];

const data = {
  canMarkAttendanceByDate: { [DATE]: true },
  students: { "stu-1": { name: "김학생", school: null, grade: null, englishName: null } },
} as unknown as ClassSheetWeekData;

function renderTable(form: "default" | "selfStudy", saveMark = vi.fn(), sheet = data) {
  const handlers = { saveMark } as unknown as SheetHandlers;
  const view = render(
    <table>
      <tbody>
        <tr>
          <td>
            <RosterTable
              date={DATE}
              slotStart={SLOT}
              roster={roster}
              data={sheet}
              marks={{
                [`stu-1|${DATE}|${SLOT}`]: {
                  status: null,
                  progressNote: null,
                  score: "18/20",
                  listeningLevel: "L3",
                  memorizedWords: "1200",
                },
              }}
              attendance={{}}
              handlers={handlers}
              canEdit
              collapsedGroups={[]}
              onToggleGroup={vi.fn()}
              form={form}
            />
          </td>
        </tr>
      </tbody>
    </table>,
  );
  return { saveMark, container: view.container };
}

const headers = () => screen.getAllByRole("columnheader").map((th) => th.textContent?.trim());

describe("로스터 표 — 폼별 열", () => {
  it("기본 폼 = 시험 점수 (원장 2026-08-13 '점수' → '시험 점수')", () => {
    renderTable("default");
    expect(headers()).toEqual(["학생1", "출결", "유닛", "태도", "시험 점수", "특이사항"]);
    expect(screen.getByLabelText("김학생 시험 점수")).toHaveProperty("value", "18/20");
  });

  it("JJ 폼 = 점수 없이 듣기 레벨 + 누적 암기 단어수", () => {
    renderTable("selfStudy");
    expect(headers()).toEqual([
      "학생1",
      "출결",
      "유닛",
      "태도",
      "듣기 레벨",
      "누적 암기 단어수",
      "특이사항",
    ]);
    expect(screen.queryByLabelText("김학생 시험 점수")).toBeNull();
    expect(screen.getByLabelText("김학생 듣기 레벨")).toHaveProperty("value", "L3");
    expect(screen.getByLabelText("김학생 누적 암기 단어수")).toHaveProperty("value", "1200");
  });

  it("🔴 저장은 **바뀐 칸만** 보낸다 — 안 보낸 칸(시험 점수)은 서버가 지금 값을 유지한다", () => {
    const { saveMark } = renderTable("selfStudy");
    fireEvent.change(screen.getByLabelText("김학생 누적 암기 단어수"), { target: { value: "1300" } });
    expect(saveMark).toHaveBeenCalledTimes(1);
    const [studentId, date, slot, status, note, patch] = saveMark.mock.calls[0];
    expect([studentId, date, slot, status, note]).toEqual(["stu-1", DATE, SLOT, null, null]);
    expect(patch).toEqual({ memorizedWords: "1300" });
  });
});

// 이름 칸 = `이름/학교학년` 한 줄(원장 2026-09-10 *"김원중/경명여중3 이렇게"*).
describe("로스터 표 — 이름 뒤 /학교학년", () => {
  const withSchool = {
    canMarkAttendanceByDate: { [DATE]: true },
    students: { "stu-1": { name: "김덕현", school: "침산중", grade: "중1", englishName: null } },
  } as unknown as ClassSheetWeekData;

  // 하네스가 표를 표 안에 넣어 렌더하므로 **안쪽 표**의 첫 본문 칸이 이름 칸이다.
  const nameCell = (c: HTMLElement) =>
    c.querySelectorAll("table")[1]!.querySelector("tbody td")!;

  it("압축 표기로 이름 옆에 붙는다 — `김덕현/침산중1`(공백 join 금지)", () => {
    const { container } = renderTable("default", vi.fn(), withSchool);
    const text = nameCell(container).textContent ?? "";
    expect(text).toContain("김덕현/침산중1");
    expect(text).not.toContain("침산중 중1");
  });

  it("🔴 학교·학년이 없으면 슬래시도 없다 — `김학생/`처럼 꼬리만 남기지 않는다", () => {
    const { container } = renderTable("default");
    expect(nameCell(container).textContent).not.toContain("/");
  });

  it("🔴 이름 열 폭은 폼이 정한다 — JJ 폼은 고정 열이 많아 비율로 물러선다", () => {
    const { container } = renderTable("default", vi.fn(), withSchool);
    expect(container.querySelector("col")!.style.width).toBe(`${TODAY_NAME_W}px`);
    cleanup();
    const jj = renderTable("selfStudy", vi.fn(), withSchool);
    expect(jj.container.querySelector("col")!.style.width).toBe(weeklyNameWidth("selfStudy"));
  });
});
