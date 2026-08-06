import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { cellKey, rowKey } from "@/features/attendance/grid/model";
import { EMPTY_COUNT } from "@/features/attendance/grid/totals";
import { ClassGroupBody, CollapseAllButton } from "./class-group";
import { GridProvider } from "./grid-context";
import { LiveUnits } from "./live-totals";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/features/attendance/server/actions", () => ({
  setAttendanceCell: vi.fn(async () => ({ ok: true })),
  setAttendanceRange: vi.fn(async () => ({ ok: true, applied: 0, blocked: 0 })),
}));
const { savePrefs } = vi.hoisted(() => ({ savePrefs: vi.fn(async () => ({ ok: true })) }));
// ⚠️ 접기는 **전용 액션**(saveAttendanceCollapsed)으로 저장한다 — 통째 저장(saveAttendanceViewPrefs)을
// 쓰면 이 컴포넌트가 모르는 정렬 설정(ui_prefs.attendance.sort)이 함께 덮여 되돌아간다(2026-08-06).
vi.mock("@/features/attendance/server/prefs-actions", () => ({ saveAttendanceCollapsed: savePrefs }));

const A = "aaaaaaaa-1111-1111-1111-111111111111";
const B = "bbbbbbbb-2222-2222-2222-222222222222";
const SA = "11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const SB = "22222222-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const RA = rowKey(A, SA);
const RB = rowKey(B, SB);
const D1 = "2026-07-01";

function Table() {
  return (
    <table>
      <thead>
        <tr>
          <th>
            <CollapseAllButton classIds={[A, B]} />
            이름
          </th>
        </tr>
      </thead>
      <ClassGroupBody classId={A} colSpan={1} summary={<span>가반</span>}>
        <tr>
          <td>가반 학생</td>
        </tr>
      </ClassGroupBody>
      <ClassGroupBody classId={B} colSpan={1} summary={<span>나반</span>}>
        <tr>
          <td>나반 학생</td>
        </tr>
      </ClassGroupBody>
      <tfoot>
        <tr>
          <td>
            총시수 <LiveUnits fallback={EMPTY_COUNT} />
          </td>
        </tr>
      </tfoot>
    </table>
  );
}

function renderTable(initialCollapsed?: string[]) {
  return render(
    <GridProvider
      rows={[RA, RB]}
      cols={[D1]}
      initial={{
        [cellKey(RA, D1)]: { s: "present", u: null },
        [cellKey(RB, D1)]: { s: "present", u: 2 },
      }}
      lockBefore={null}
      initialCollapsed={initialCollapsed}
    >
      <Table />
    </GridProvider>,
  );
}

describe("반 접기", () => {
  it("머리행을 누르면 그 반 학생만 사라진다 — 다른 반은 그대로", () => {
    renderTable();
    expect(screen.getByText("가반 학생")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /가반/ }));
    expect(screen.queryByText("가반 학생")).not.toBeInTheDocument();
    expect(screen.getByText("나반 학생")).toBeInTheDocument();
  });

  it("🔴 접어도 총 시수는 안 줄어든다 — 접기는 표시일 뿐 데이터를 빼는 게 아니다", () => {
    const { container } = renderTable();
    expect(container.textContent).toContain("총시수 3"); // 1 + 2
    fireEvent.click(screen.getByRole("button", { name: /가반/ }));
    expect(container.textContent).toContain("총시수 3");
  });

  it("지난번에 접어 둔 반은 접힌 채로 열린다(계정 설정)", () => {
    renderTable([B]);
    expect(screen.getByText("가반 학생")).toBeInTheDocument();
    expect(screen.queryByText("나반 학생")).not.toBeInTheDocument();
  });

  it("접으면 계정에 저장한다 — 다른 PC에서도 같은 모양", () => {
    savePrefs.mockClear();
    renderTable();
    fireEvent.click(screen.getByRole("button", { name: /나반/ }));
    // 🔴 접힌 반 목록**만** 넘긴다 — 정렬 등 다른 설정을 함께 실어 보내면 그 값이 되돌아간다.
    expect(savePrefs).toHaveBeenCalledWith([B]);
  });

  it("전체 토글 — 한 번에 다 접고 다시 다 편다", () => {
    renderTable();
    fireEvent.click(screen.getByRole("button", { name: "모든 반 접기" }));
    expect(screen.queryByText("가반 학생")).not.toBeInTheDocument();
    expect(screen.queryByText("나반 학생")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "모든 반 펼치기" }));
    expect(screen.getByText("가반 학생")).toBeInTheDocument();
  });

  it("접힌 반의 머리행은 남는다 — 다시 펼 길이 사라지면 안 된다", () => {
    renderTable([A]);
    expect(screen.getByRole("button", { name: /가반/ })).toBeInTheDocument();
  });
});
