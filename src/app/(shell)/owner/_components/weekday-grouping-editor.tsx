"use client";

// 학원이 요일 병합을 직접 만든다. 만든 묶음은 과목의 '시간표 요일 병합' 드롭다운에 붙는다.
import { useState } from "react";
import type { CustomWeekdayGrouping, SubjectSetting } from "@/features/owner/settings-types";
import {
  WEEKDAY_GROUPING_LABEL,
  builtinIdForGroups,
  formatWeekdayGroups,
} from "@/features/timetable/lib/weekday-groups";
import {
  GROUPING_DAYS,
  completeWeekdayPartition,
  isWeekendDay,
  parseWeekdayPartition,
  weekdayPartitionKey,
  type GroupingDay,
} from "@/features/timetable/lib/weekday-partition";

const CHIP = "rounded-md border px-3 py-1 text-sm";

function newGroupingId(): string {
  return `c_${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
}

export function WeekdayGroupingEditor({
  groupings,
  subjects,
  onChange,
}: {
  groupings: CustomWeekdayGrouping[];
  subjects: SubjectSetting[];
  onChange: (next: { groupings: CustomWeekdayGrouping[]; subjects: SubjectSetting[] }) => void;
}) {
  const [picked, setPicked] = useState<GroupingDay[]>([]);
  const [draft, setDraft] = useState<GroupingDay[][]>([]);
  const [note, setNote] = useState("");

  const used = new Set(draft.flat());
  const preview = completeWeekdayPartition(draft);

  function toggle(day: GroupingDay) {
    setNote("");
    if (used.has(day)) {
      setDraft((rows) =>
        rows.map((row) => row.filter((item) => item !== day)).filter((row) => row.length >= 2),
      );
      return;
    }
    setPicked((prev) => (prev.includes(day) ? prev.filter((item) => item !== day) : [...prev, day]));
  }

  function bundle() {
    if (picked.length < 2) {
      setNote("묶을 요일을 둘 이상 고르세요.");
      return;
    }
    const mixesWeekend = picked.some((day) => isWeekendDay(day)) && picked.some((day) => !isWeekendDay(day));
    if (mixesWeekend) {
      setNote("토·일은 평일과 따로 묶습니다.");
      return;
    }
    setDraft((rows) => [...rows, GROUPING_DAYS.filter((day) => picked.includes(day))]);
    setPicked([]);
    setNote("");
  }

  function addToList() {
    const full = completeWeekdayPartition(draft);
    if (groupings.length >= 20) {
      setNote("묶음은 20개까지입니다.");
      return;
    }
    if (!full || !draft.some((group) => group.length >= 2)) {
      setNote("둘 이상인 묶음이 있어야 목록에 넣습니다.");
      return;
    }
    const builtin = builtinIdForGroups(full);
    if (builtin) {
      setNote(`${WEEKDAY_GROUPING_LABEL[builtin]}은 이미 목록에 있습니다.`);
      return;
    }
    const key = weekdayPartitionKey(full);
    const duplicated = groupings.some((row) => {
      const parsed = parseWeekdayPartition(row.groups);
      return parsed ? weekdayPartitionKey(parsed) === key : false;
    });
    if (duplicated) {
      setNote("이미 만든 묶음입니다.");
      return;
    }
    onChange({ groupings: [...groupings, { id: newGroupingId(), groups: full }], subjects });
    setDraft([]);
    setPicked([]);
    setNote("");
  }

  function remove(id: string) {
    const labels = subjects
      .filter((subject) => subject.weekdayGrouping === id)
      .map((subject) => subject.label.trim() || subject.key);
    if (labels.length > 0) {
      setNote(`${labels.join(", ")}에서 쓰는 중이라 지울 수 없습니다. 과목의 병합을 다른 것으로 바꾼 뒤 빼세요.`);
      return;
    }
    onChange({ groupings: groupings.filter((row) => row.id !== id), subjects });
    setNote("");
  }

  return (
    <div className="space-y-3">
      <p className="text-sm">
        요일을 고른 뒤 묶으면 한 칸이 됩니다. 고르지 않은 평일은 혼자 남습니다. 토·일을 묶으면 주말 판에서 한 칸이 됩니다.
        목록에 넣은 묶음은 아래 과목의 시간표 요일 병합에서 고릅니다.
      </p>
      {groupings.length > 0 ? (
        <ul className="space-y-2">
          {groupings.map((row) => {
            const parsed = parseWeekdayPartition(row.groups);
            return (
              <li key={row.id} className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-bold">{parsed ? formatWeekdayGroups(parsed) : row.id}</span>
                <button type="button" className={`border-line bg-card ${CHIP}`} onClick={() => remove(row.id)}>
                  목록에서 빼기
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {GROUPING_DAYS.map((day) => {
          const grouped = used.has(day);
          const on = picked.includes(day);
          return (
            <button
              key={day}
              type="button"
              aria-pressed={on || grouped}
              className={`${CHIP} ${
                on
                  ? "border-primary bg-primary text-primary-foreground"
                  : grouped
                    ? "border-primary bg-primary-soft"
                    : "border-line bg-card"
              }`}
              onClick={() => toggle(day)}
            >
              {formatWeekdayGroups([[day]])}
            </button>
          );
        })}
      </div>
      {draft.length > 0 ? (
        <ul className="space-y-2">
          {draft.map((group, index) => (
            <li key={group.join("-")} className="flex flex-wrap items-center gap-2">
              <span className="text-sm">{formatWeekdayGroups([group])}</span>
              <button
                type="button"
                className={`border-line bg-card ${CHIP}`}
                onClick={() => {
                  setDraft((rows) => rows.filter((_, i) => i !== index));
                  setNote("");
                }}
              >
                빼기
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {preview ? <p className="text-sm">미리보기 {formatWeekdayGroups(preview)}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={`border-line bg-card ${CHIP}`} onClick={bundle}>
          선택한 요일 묶기
        </button>
        <button type="button" className={`border-line bg-card ${CHIP}`} onClick={addToList}>
          목록에 넣기
        </button>
        <button
          type="button"
          className={`border-line bg-card ${CHIP}`}
          onClick={() => {
            setDraft([]);
            setPicked([]);
            setNote("");
          }}
        >
          다시
        </button>
      </div>
      {note ? <p className="text-sm">{note}</p> : null}
    </div>
  );
}
