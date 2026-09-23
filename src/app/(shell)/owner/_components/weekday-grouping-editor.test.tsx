import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@/features/owner/defaults";
import { weekdayGroupingChoices } from "@/features/timetable/lib/weekday-groups";
import type { CustomWeekdayGrouping, SubjectSetting, WeekdayGrouping } from "@/features/owner/settings-types";
import { SubjectListEditor } from "./list-editors";
import { WeekdayGroupingEditor } from "./weekday-grouping-editor";

function Harness({ custom = [] }: { custom?: CustomWeekdayGrouping[] }) {
  const [subjects, setSubjects] = useState<SubjectSetting[]>([DEFAULT_SETTINGS.operations.subjects[0]!]);
  const [groupings, setGroupings] = useState(custom);
  const [hiddenBuiltins, setHiddenBuiltins] = useState<WeekdayGrouping[]>([]);
  return (
    <>
      <WeekdayGroupingEditor
        groupings={groupings}
        hiddenBuiltins={hiddenBuiltins}
        subjects={subjects}
        onChange={(next) => {
          setGroupings(next.groupings);
          setHiddenBuiltins(next.hiddenBuiltins);
          setSubjects(next.subjects);
        }}
      />
      <SubjectListEditor value={subjects} onChange={setSubjects} groupingChoices={weekdayGroupingChoices(groupings, hiddenBuiltins)} />
    </>
  );
}

it("기본 묶음은 사용 중일 때 보호하고, 다른 묶음으로 바꾼 뒤 드롭다운에서 제거·복원한다", () => {
  render(<Harness />);
  const manager = screen.getByText("드롭다운 목록 관리 · 5개").closest("details")!;
  fireEvent.click(within(manager).getByText("드롭다운 목록 관리 · 5개"));
  const row = () => within(manager).getByText("월·목 / 화·금 (주2회)").closest("li")!;
  expect(within(row()).getByRole("button", { name: "목록에서 빼기" })).toBeDisabled();
  fireEvent.change(screen.getByRole("combobox", { name: "시간표 요일 병합" }), { target: { value: "mon-tue" } });
  fireEvent.click(within(row()).getByRole("button", { name: "목록에서 빼기" }));
  expect(screen.getByRole("combobox", { name: "시간표 요일 병합" }).querySelector('option[value="mon-thu"]')).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "다시 넣기" }));
  expect(screen.getByRole("combobox", { name: "시간표 요일 병합" }).querySelector('option[value="mon-thu"]')).not.toBeNull();
});

it("직접 만든 묶음도 사용 중일 때는 보호하고, 바꾼 뒤 제거하면 드롭다운에서 사라진다", () => {
  const custom: CustomWeekdayGrouping = {
    id: "c_abcdef0123", groups: [["mon", "wed"], ["tue", "thu"], ["fri"]],
  };
  render(<Harness custom={[custom]} />);
  fireEvent.change(screen.getByRole("combobox", { name: "시간표 요일 병합" }), { target: { value: custom.id } });
  const manager = screen.getByText("드롭다운 목록 관리 · 6개").closest("details")!;
  fireEvent.click(within(manager).getByText("드롭다운 목록 관리 · 6개"));
  const row = within(manager).getByText("월·수 / 화·목 / 금").closest("li")!;
  expect(within(row).getByRole("button", { name: "목록에서 빼기" })).toBeDisabled();
  fireEvent.change(screen.getByRole("combobox", { name: "시간표 요일 병합" }), { target: { value: "mon-thu" } });
  fireEvent.click(within(row).getByRole("button", { name: "목록에서 빼기" }));
  expect(screen.getByRole("combobox", { name: "시간표 요일 병합" }).querySelector(`option[value="${custom.id}"]`)).toBeNull();
});
