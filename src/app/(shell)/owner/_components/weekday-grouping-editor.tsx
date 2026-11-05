"use client";

// 학원이 요일 병합을 직접 만든다. 만든 묶음은 과목의 '시간표 요일 병합' 드롭다운에 붙는다.
import { useState } from "react";
import { useWriteLock } from "./write-lock-context";
import type { CustomWeekdayGrouping, SubjectSetting, WeekdayGrouping } from "@/features/owner/settings-types";
import {
  WEEKDAY_GROUPING_LABEL,
  WEEKDAY_GROUPING_OPTIONS,
  builtinIdForGroups,
  formatWeekdayGroups,
  weekdayGroupingChoices,
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
  hiddenBuiltins,
  subjects,
  onChange,
}: {
  groupings: CustomWeekdayGrouping[];
  hiddenBuiltins: WeekdayGrouping[];
  subjects: SubjectSetting[];
  onChange: (next: { groupings: CustomWeekdayGrouping[]; hiddenBuiltins: WeekdayGrouping[]; subjects: SubjectSetting[] }) => void;
}) {
  const [picked, setPicked] = useState<GroupingDay[]>([]);
  const [draft, setDraft] = useState<GroupingDay[][]>([]);
  const [note, setNote] = useState("");
  // 읽기 권한(쓰기 잠금)이면 묶음 만들기·빼기·다시 넣기를 그리지 않는다(write-lock-context.tsx).
  const { locked } = useWriteLock();

  const used = new Set(draft.flat());
  const preview = completeWeekdayPartition(draft);
  const choices = weekdayGroupingChoices(groupings, hiddenBuiltins);

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
    onChange({ groupings: [...groupings, { id: newGroupingId(), groups: full }], hiddenBuiltins, subjects });
    setDraft([]);
    setPicked([]);
    setNote("");
  }

  function remove(id: string) {
    const labels = subjects
      .filter((subject) => (subject.weekdayGrouping ?? "mon-thu") === id)
      .map((subject) => subject.label.trim() || subject.key);
    if (labels.length > 0) {
      setNote(`${labels.join(", ")}에서 쓰는 중이라 목록에서 뺄 수 없습니다. 과목의 병합을 다른 것으로 바꾼 뒤 빼세요.`);
      return;
    }
    if (choices.length <= 1) {
      setNote("드롭다운 선택지를 하나 이상 남겨 주세요.");
      return;
    }
    const builtin = WEEKDAY_GROUPING_OPTIONS.find((option) => option.value === id);
    onChange({
      groupings: builtin ? groupings : groupings.filter((row) => row.id !== id),
      hiddenBuiltins: builtin ? [...hiddenBuiltins, builtin.value] : hiddenBuiltins,
      subjects,
    });
    setNote("");
  }

  function restore(id: WeekdayGrouping) {
    onChange({ groupings, hiddenBuiltins: hiddenBuiltins.filter((value) => value !== id), subjects });
    setNote("");
  }

  return (
    <div className="space-y-3">
      {locked ? null : <p className="text-sm">
        요일을 고른 뒤 묶으면 한 칸이 됩니다. 고르지 않은 평일은 혼자 남습니다. 토·일을 묶으면 주말 판에서 한 칸이 됩니다.
        목록에 넣은 묶음은 아래 과목의 시간표 요일 병합에서 고릅니다.
      </p>}
      <details className="border-line rounded-md border px-3 py-2">
        <summary className="cursor-pointer text-sm font-bold">드롭다운 목록 관리 · {choices.length}개</summary>
        {locked ? null : <p className="text-text-dim mt-2 text-xs">과목에서 사용 중인 묶음은 다른 묶음으로 바꾼 뒤 뺄 수 있습니다.</p>}
        <ul className="mt-2 space-y-2">
          {choices.map((choice) => {
            const using = subjects
              .filter((subject) => (subject.weekdayGrouping ?? "mon-thu") === choice.value)
              .map((subject) => subject.label.trim() || subject.key);
            return (
              <li key={choice.value} className="flex flex-wrap items-center gap-2">
                <span className="text-sm">{choice.label}</span>
                {using.length > 0 ? <span className="text-text-dim text-xs">사용 중: {using.join(", ")}</span> : null}
                {choices.length === 1 && !locked ? <span className="text-text-dim text-xs">마지막 선택지</span> : null}
                {locked ? null : <button
                  type="button"
                  className={`border-line bg-card disabled:cursor-not-allowed disabled:opacity-40 ${CHIP}`}
                  disabled={using.length > 0 || choices.length === 1}
                  title={using.length > 0 ? "과목의 병합을 다른 것으로 바꾼 뒤 목록에서 뺄 수 있습니다" : choices.length === 1 ? "선택지를 하나 이상 남겨 주세요" : undefined}
                  onClick={() => remove(choice.value)}
                >
                  목록에서 빼기
                </button>}
              </li>
            );
          })}
        </ul>
        {hiddenBuiltins.length > 0 ? (
          <div className="border-line mt-3 border-t pt-2">
            <p className="text-text-dim text-xs">목록에서 뺀 기본 묶음</p>
            <ul className="mt-2 space-y-2">
              {hiddenBuiltins.map((id) => (
                <li key={id} className="flex flex-wrap items-center gap-2">
                  <span className="text-sm">{WEEKDAY_GROUPING_LABEL[id]}</span>
                  {locked ? null : (
                    <button type="button" className={`border-line bg-card ${CHIP}`} onClick={() => restore(id)}>
                      다시 넣기
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </details>
      {/* 🔴 아래는 묶음을 **만드는** 작업대라 읽기 권한이면 통째로 그리지 않는다(원장 2026-11-05). */}
      {locked ? null : <>
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
          묶음 추가
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
          작성 지우기
        </button>
      </div>
      {note ? <p className="text-sm">{note}</p> : null}
      </>}
    </div>
  );
}
