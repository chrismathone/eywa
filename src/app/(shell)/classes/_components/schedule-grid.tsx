"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp } from "@/components/icons/eywa-icon-compat";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { readableTextColor } from "@/lib/color-utils";

type Period = { id: string; startTime: string; endTime: string };
type InitialSlot = {
  dayOfWeek: string;
  startTime: string;
  teacherId?: string | null;
  classroomId?: string | null;
};
type Opt = { id: string; name: string };

const DAYS = [
  { key: "mon", label: "월" },
  { key: "tue", label: "화" },
  { key: "wed", label: "수" },
  { key: "thu", label: "목" },
  { key: "fri", label: "금" },
  { key: "sat", label: "토" },
  { key: "sun", label: "일" },
];
const WEEKDAY_DAYS = DAYS.slice(0, 5);
const WEEKEND_DAYS = DAYS.slice(5);
const DAY_LABEL: Record<string, string> = Object.fromEntries(DAYS.map((d) => [d.key, d.label]));
const dayIndex = (k: string) => DAYS.findIndex((d) => d.key === k);
const isWeekendDay = (k: string) => k === "sat" || k === "sun";

const cellKey = (day: string, periodId: string) => `${day}__${periodId}`;

/**
 * 반 스케줄 = 요일 × 교시 클릭 그리드 (ijw 패리티). **평일(월~금)과 주말(토/일)은 교시 시각이 달라
 * (평일 14:30~ / 주말 09:00~) 두 표로 분리** — 같은 "N교시"라도 평일·주말 시각이 다르므로 셀의 시각은
 * 그 요일이 평일이면 weekdayPeriods, 주말이면 weekendPeriods에서 가져온다. 선택 상태·제출 hidden은 공유.
 *
 * 세부옵션 "교시별 부담임/강의실": 선택한 교시마다 담임과 다른 강사(부담임)·다른 강의실을 지정 가능.
 * NULL(미지정)이면 반의 담임/기본 강의실을 상속. 제출은 schedule_{day,start,end,teacher,classroom}_${i}.
 */
export function ScheduleGrid({
  weekdayPeriods,
  weekendPeriods,
  initial,
  teacherId,
  teacherOptions,
  classroomOptions,
  bgColor,
}: {
  weekdayPeriods: Period[];
  weekendPeriods: Period[];
  initial: InitialSlot[];
  /** 반 담임(폼에서 lift) — 셀 기본 표시 이름 + 부담임 드롭다운의 "담임" 기본값. */
  teacherId: string | null;
  teacherOptions: Opt[];
  classroomOptions: Opt[];
  /** 반 색(폼 라이브 값) — 선택 셀을 이 색으로 미리보기(시간표와 동일). 없으면 기본 초록. */
  bgColor?: string | null;
}) {
  const weekdayById = useMemo(() => new Map(weekdayPeriods.map((p) => [p.id, p])), [weekdayPeriods]);
  const weekendById = useMemo(() => new Map(weekendPeriods.map((p) => [p.id, p])), [weekendPeriods]);
  // 요일이 평일이냐 주말이냐에 따라 교시 시각을 다른 표에서 해석.
  const periodFor = (day: string, id: string): Period | undefined =>
    (isWeekendDay(day) ? weekendById : weekdayById).get(id);

  // 초기: 기존 스케줄의 (요일,시작시각)을 교시로 역매핑(요일 종류별 표로) + 오버라이드 복원(마운트 1회).
  const initState = useMemo(() => {
    const wdStartToId = new Map(weekdayPeriods.map((p) => [p.startTime, p.id]));
    const weStartToId = new Map(weekendPeriods.map((p) => [p.startTime, p.id]));
    const sel = new Set<string>();
    const st: Record<string, string> = {};
    const sc: Record<string, string> = {};
    for (const s of initial) {
      const map = isWeekendDay(s.dayOfWeek) ? weStartToId : wdStartToId;
      const id = map.get(s.startTime.slice(0, 5));
      if (!id) continue;
      const k = cellKey(s.dayOfWeek, id);
      sel.add(k);
      if (s.teacherId) st[k] = s.teacherId;
      if (s.classroomId) sc[k] = s.classroomId;
    }
    return { sel, st, sc };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 마운트 시 한 번만(이후 사용자 선택 보존)
  }, []);

  const [selected, setSelected] = useState<Set<string>>(initState.sel);
  const [slotTeacher, setSlotTeacher] = useState<Record<string, string>>(initState.st);
  const [slotClassroom, setSlotClassroom] = useState<Record<string, string>>(initState.sc);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const teacherNameOf = (id: string | null | undefined) =>
    id ? (teacherOptions.find((t) => t.id === id)?.name ?? null) : null;
  const homeTeacherName = teacherNameOf(teacherId);
  const classroomNameOf = (id: string | null | undefined) =>
    id ? (classroomOptions.find((c) => c.id === id)?.name ?? null) : null;

  // 유효 선택(현재 교시표 기준 — 요일 종류별로 그 교시가 존재해야), 요일→교시 순 정렬.
  const activeKeys = useMemo(
    () =>
      [...selected]
        .filter((k) => {
          const [day, id] = k.split("__");
          return !!periodFor(day, id);
        })
        .sort((a, b) => {
          const [da, pa] = a.split("__");
          const [db, pb] = b.split("__");
          return dayIndex(da) - dayIndex(db) || Number(pa) - Number(pb);
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- periodFor는 weekday/weekendById에서 파생
    [selected, weekdayById, weekendById],
  );
  const activeSet = useMemo(() => new Set(activeKeys), [activeKeys]);

  const rows = activeKeys.map((k) => {
    const [day, id] = k.split("__");
    const p = periodFor(day, id)!;
    return { key: k, day, periodId: id, start: p.startTime, end: p.endTime };
  });

  const toggle = (day: string, periodId: string) => {
    const k = cellKey(day, periodId);
    const removing = selected.has(k);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
    if (removing) {
      setSlotTeacher((prev) => {
        const n = { ...prev };
        delete n[k];
        return n;
      });
      setSlotClassroom((prev) => {
        const n = { ...prev };
        delete n[k];
        return n;
      });
    }
  };

  const setTeacher = (k: string, v: string) =>
    setSlotTeacher((prev) => {
      const n = { ...prev };
      if (v) n[k] = v;
      else delete n[k];
      return n;
    });
  const setClassroom = (k: string, v: string) =>
    setSlotClassroom((prev) => {
      const n = { ...prev };
      if (v) n[k] = v;
      else delete n[k];
      return n;
    });

  const teacherSelectOptions = [
    { value: "", label: homeTeacherName ? `담임 · ${homeTeacherName}` : "담임 (미정)" },
    ...teacherOptions.map((t) => ({ value: t.id, label: t.name })),
  ];
  const classroomSelectOptions = [
    { value: "", label: "기본 강의실" },
    ...classroomOptions.map((c) => ({ value: c.id, label: c.name })),
  ];

  // 평일/주말 한 표 — days(요일 부분집합) × periodList(그 종류 교시)로 클릭 그리드 렌더.
  const renderTable = (
    caption: string,
    days: { key: string; label: string }[],
    periodList: Period[],
  ) => {
    if (periodList.length === 0) return null;
    return (
      <div className="space-y-1">
        <p className="text-muted-foreground text-[11px] font-medium">{caption}</p>
        <div className="border-border overflow-hidden rounded-md border">
          <table className="w-full table-fixed border-collapse text-center text-xs">
            <thead>
              <tr className="bg-muted/40">
                <th className="border-border text-muted-foreground w-10 border-b border-r py-1.5 font-medium">
                  교시
                </th>
                {days.map((d) => (
                  <th
                    key={d.key}
                    className="border-border text-foreground border-b border-r py-1.5 font-medium last:border-r-0"
                  >
                    {d.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {periodList.map((p) => (
                <tr key={p.id}>
                  <th className="border-border bg-muted/20 text-muted-foreground border-b border-r py-1 font-normal leading-tight last:border-b-0">
                    <div className="text-foreground text-[11px] font-semibold">{p.id}</div>
                    <div className="num text-[9px]">{p.startTime}</div>
                  </th>
                  {days.map((d) => {
                    const k = cellKey(d.key, p.id);
                    const on = activeSet.has(k);
                    const override = slotTeacher[k];
                    const eff = override ? teacherNameOf(override) : homeTeacherName;
                    const preview = on && bgColor;
                    return (
                      <td key={d.key} className="border-border border-b border-r p-0 last:border-r-0">
                        <button
                          type="button"
                          aria-pressed={on}
                          aria-label={`${d.label} ${p.id}교시`}
                          onClick={() => toggle(d.key, p.id)}
                          style={preview ? { background: bgColor, color: readableTextColor(bgColor) } : undefined}
                          className={`block h-9 w-full px-0.5 transition ${
                            on
                              ? preview
                                ? `hover:brightness-95 ${override ? "ring-2 ring-inset ring-purple-700" : ""}`
                                : `${override ? "bg-purple/85 hover:bg-purple" : "bg-primary/85 hover:bg-primary"} text-primary-foreground`
                              : "hover:bg-muted text-transparent"
                          }`}
                          title={on && override ? `부담임 · ${eff}` : undefined}
                        >
                          <span className="block truncate text-[10px] font-semibold leading-none">
                            {on ? (eff ?? "●") : "·"}
                          </span>
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-3">
      {/* 제출용 hidden input — 선택 셀을 교시 시각(평일/주말 각 표에서 해석) + 오버라이드로 변환 */}
      {rows.map((r, i) => (
        <div key={`${r.key}-${i}`}>
          <input type="hidden" name={`schedule_day_${i}`} value={r.day} />
          <input type="hidden" name={`schedule_start_${i}`} value={r.start} />
          <input type="hidden" name={`schedule_end_${i}`} value={r.end} />
          <input type="hidden" name={`schedule_teacher_${i}`} value={slotTeacher[r.key] ?? ""} />
          <input type="hidden" name={`schedule_classroom_${i}`} value={slotClassroom[r.key] ?? ""} />
        </div>
      ))}

      {/* 평일(5요일)·주말(2요일) 두 표를 요일 수 비례(5:2)로 나란히. ⚠️ auto 트랙은 w-full table을
          컨테이너 전폭으로 부풀려 반대편을 0폭으로 짜부시킴 → minmax(0,Nfr)로 비례+수축 허용. */}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,5fr)_minmax(0,2fr)] lg:items-start">
        {renderTable("평일 (월~금)", WEEKDAY_DAYS, weekdayPeriods)}
        {renderTable("주말 (토·일)", WEEKEND_DAYS, weekendPeriods)}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-xs">
          <span className="text-foreground font-semibold">{rows.length}</span>개 교시 선택 · 칸을 눌러 수업 교시를 지정
        </p>
        {rows.length > 0 ? (
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="text-primary inline-flex items-center gap-0.5 text-xs hover:underline"
          >
            {showAdvanced ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
            교시별 부담임/강의실 설정
          </button>
        ) : null}
      </div>

      {showAdvanced && rows.length > 0 ? (
        <div className="border-border space-y-2 rounded-md border p-3">
          <p className="text-muted-foreground text-[11px]">
            교시별로 담임과 다른 강사(부담임)·다른 강의실을 지정할 수 있습니다. 비워두면 반의 담임·기본 강의실을 따릅니다.
          </p>
          {rows.map((r) => (
            <div key={r.key} className="flex flex-wrap items-center gap-2">
              <span className="text-foreground w-16 shrink-0 text-xs font-medium">
                {DAY_LABEL[r.day]} {r.periodId}교시
              </span>
              <SearchableSelect
                className="w-40"
                value={slotTeacher[r.key] ?? ""}
                onValueChange={(v) => setTeacher(r.key, v)}
                options={teacherSelectOptions}
                ariaLabel={`${DAY_LABEL[r.day]} ${r.periodId}교시 강사`}
              />
              <SearchableSelect
                className="w-40"
                value={slotClassroom[r.key] ?? ""}
                onValueChange={(v) => setClassroom(r.key, v)}
                options={classroomSelectOptions}
                ariaLabel={`${DAY_LABEL[r.day]} ${r.periodId}교시 강의실`}
              />
              {slotClassroom[r.key] ? (
                <span className="text-text-faint text-[10px]">{classroomNameOf(slotClassroom[r.key])}</span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
