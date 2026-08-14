import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { RichCardGroupBoard } from "./rich-card-group";
import type { RichCardGroup } from "@/features/timetable/lib/class-grid";

/**
 * 배치 편집의 **빈 줄**(반 0개)이 실제로 그려지는지 — 자리표 섹션을 넣어도 보드가 깨지지 않아야
 * 드롭 칸이 생긴다(2026-08-14, [edit-rows.ts](src/features/timetable/lib/edit-rows.ts) 참조).
 * 빈 줄은 카드도 교시축도 명단도 없어서, 높이 계산(`sectionH(0)`)과 빈 `cards.map`이 견디는지가 관건이다.
 */
const emptyGroup: RichCardGroup = {
  key: "empty::row-1",
  label: "새 줄",
  order: 0,
  sectionKey: 0,
  compacted: false,
  compactable: false,
  cards: [],
  periodRows: [],
  days: [],
  rosterRows: { active: 0, hold: 0, withdrawn: 0 },
  customGroupId: "row-1",
};

describe("RichCardGroupBoard — 반이 0개인 줄", () => {
  it("편집 모드(namesOnly)에서 라벨열과 '맨 뒤' 드롭 칸이 남는다", () => {
    render(
      <RichCardGroupBoard
        group={emptyGroup}
        subjectSoftClass="bg-rose-soft"
        teacherColors={{}}
        namesOnly
        trailing={<div>맨 뒤</div>}
      />,
    );
    expect(screen.getByText("수업명")).toBeTruthy(); // 라벨열이 살아 있어야 줄로 보인다
    expect(screen.getByText("맨 뒤")).toBeTruthy(); // 여기가 반을 놓는 자리다
  });

  it("이름을 비운 교시는 시간대를 **한 줄로** 그린다(두 줄로 부풀면 축이 어긋난다)", () => {
    // 원장 2026-08-14 *"시간 표시하는 열너비 조금만 넓혀서 두줄 안되도록"* — 폭(LABEL_W)과 nowrap이 짝이다.
    const g: RichCardGroup = {
      ...emptyGroup,
      periodRows: [{ order: 860, label: "", time: "14:20~15:00" }],
    };
    render(<RichCardGroupBoard group={g} subjectSoftClass="bg-rose-soft" teacherColors={{}} />);
    const label = screen.getByText("14:20~15:00");
    expect(label.className).toContain("whitespace-nowrap");
  });

  it("읽기 모드에서도 크래시 없이 그려진다(명단 섹션은 0행이라 안 그린다)", () => {
    const { container } = render(
      <RichCardGroupBoard group={emptyGroup} subjectSoftClass="bg-rose-soft" teacherColors={{}} />,
    );
    expect(screen.getByText("수업명")).toBeTruthy();
    expect(container.textContent).not.toContain("undefined");
    expect(container.textContent).not.toContain("NaN");
  });
});
