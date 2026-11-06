import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LAST_COURSE_VIA_REPORT, SUBJECT_END_VIA_REPORT } from "@/features/withdrawals/via-report";
import type { EndScopeResult } from "@/features/timetable/lib/end-scope-text";
import { EndEnrollmentAction } from "./end-enrollment-action";

/**
 * 여기서 잠그는 계약(원장 제보 2026-11-05 — '수강 종료' 막힘 문구가 한 줄로 창 밖 회색 배경까지 나갔다):
 *  학생 상세 수업 탭 표는 `[&_td]:whitespace-nowrap`이고 이 버튼 칸은 `text-right`다. 창이 DOM상 `<td>` 자손이면
 *  nowrap·오른쪽 정렬을 물려받아 문구가 줄바꿈을 못 한다 → 창은 `document.body`로 포털하고(표 밖),
 *  문구에서 body까지 nowrap 계열 클래스가 없고 줄바꿈 클래스(`whitespace-normal` · `break-keep`)가 있어야 한다.
 *  (happy-dom은 Tailwind CSS를 계산하지 않으므로 클래스로 본다.)
 */
const mocks = vi.hoisted(() => ({ fetchEndScope: vi.fn(), endSingleEnrollment: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/features/students/server/actions", () => ({ endSingleEnrollment: mocks.endSingleEnrollment }));
vi.mock("@/features/billing/session-terms/plan-change-signal", () => ({ notifyTermPlansChanged: vi.fn() }));
// 사유 칸은 이 계약과 무관 — 비워 두면 폼 검사(`reportValidity`)가 바로 통과해 서버 거절 문구까지 갈 수 있다.
vi.mock("@/features/withdrawals/reason-fields", () => ({ ReasonFields: () => null }));
vi.mock("@/features/timetable/lib/end-scope-text", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/timetable/lib/end-scope-text")>()),
  fetchEndScope: mocks.fetchEndScope,
}));
beforeEach(() => vi.clearAllMocks());

const NOWRAP = /(^|\s)(whitespace-nowrap|text-nowrap|whitespace-pre|truncate|w-max|inline-flex)(\s|$)/;
/** 문구 요소부터 body까지 — 줄바꿈을 막는 클래스가 걸린 요소들. */
const nowrapChain = (el: Element) => {
  const hits: string[] = [];
  for (let n: Element | null = el; n && n !== document.body; n = n.parentElement) {
    const cls = n.getAttribute("class") ?? "";
    if (NOWRAP.test(cls)) hits.push(`<${n.tagName.toLowerCase()} class="${cls}">`);
  }
  return hits;
};
const hasClassUp = (el: Element, cls: string) => {
  for (let n: Element | null = el; n; n = n.parentElement) if (n.classList.contains(cls)) return true;
  return false;
};

/** 학생 상세 수업 탭의 '수강 종료' 칸을 그대로 — 표 nowrap + 칸 오른쪽 정렬 + inline-flex 묶음. */
function renderInStudentTable() {
  render(
    <table className="w-full min-w-[720px] text-sm [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
      <tbody>
        <tr>
          <td className="px-2 py-2.5 text-right">
            <div className="inline-flex items-center gap-1.5">
              <EndEnrollmentAction enrollmentId="e1" studentId="s1" className="중고E_중1 MED" startDate="2026-03-02" today="2026-11-05" />
            </div>
          </td>
        </tr>
      </tbody>
    </table>,
  );
  fireEvent.click(screen.getByRole("button", { name: /수강 종료/ }));
}

const scope = (over: Partial<EndScopeResult>): EndScopeResult => ({ scope: "student", otherClassName: null, transfer: false, ...over });

describe("수강 종료 창 — 표 칸 안에서 열어도 문구가 창 안에서 줄바꿈된다", () => {
  it.each([
    ["학생의 마지막 수업", scope({ scope: "student", viaReport: true }), LAST_COURSE_VIA_REPORT],
    ["그 과목의 마지막 수업", scope({ scope: "subject", otherClassName: "수학 A", viaReport: true }), SUBJECT_END_VIA_REPORT],
  ])("🔴 %s — 막힘 문구가 표 밖(body)에 있고 nowrap을 물려받지 않는다", async (_, result, message) => {
    mocks.fetchEndScope.mockResolvedValue(result);
    renderInStudentTable();
    const dialog = await screen.findByRole("alertdialog", { name: "수강 종료 불가" });
    expect(dialog.closest("td")).toBeNull();
    expect(dialog.closest("table")).toBeNull();
    const text = screen.getByText(message);
    expect(dialog.contains(text)).toBe(true);
    expect(nowrapChain(text)).toEqual([]);
    expect(hasClassUp(text, "whitespace-normal")).toBe(true);
    expect(text).toHaveClass("break-keep");
  });

  it("🔴 판정 조회가 실패해 입력 창이 열린 뒤 서버가 거절해도 — 안내·오류 문구가 nowrap을 물려받지 않는다", async () => {
    mocks.fetchEndScope.mockResolvedValue(null);
    mocks.endSingleEnrollment.mockResolvedValue({ error: LAST_COURSE_VIA_REPORT });
    renderInStudentTable();
    const choice = (await screen.findAllByRole("button", { name: /오늘까지 수업/ }))[0];
    await waitFor(() => expect(choice).toBeEnabled());
    const guide = screen.getByText(/이 반 수강만 끝냅니다/);
    expect(guide.closest("td")).toBeNull();
    expect(nowrapChain(guide)).toEqual([]);
    fireEvent.click(choice);
    const error = await screen.findByText(LAST_COURSE_VIA_REPORT);
    expect(error.closest("td")).toBeNull();
    expect(nowrapChain(error)).toEqual([]);
    expect(hasClassUp(error, "whitespace-normal")).toBe(true);
    expect(error).toHaveClass("break-keep");
  });
});
