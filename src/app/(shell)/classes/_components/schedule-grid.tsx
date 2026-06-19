"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { SearchableSelect } from "@/components/ui/searchable-select";

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
const DAY_LABEL: Record<string, string> = Object.fromEntries(DAYS.map((d) => [d.key, d.label]));
const dayIndex = (k: string) => DAYS.findIndex((d) => d.key === k);

const cellKey = (day: string, periodId: string) => `${day}__${periodId}`;

/**
 * 반 스케줄 = 요일(월~일) × 교시 클릭 그리드 (ijw 패리티). 셀을 눌러 토글하면 그 교시 시각으로
 * class_schedules 행이 생성된다. 셀에는 담임 이름을 표시(교시별 부담임이 있으면 그 이름).
 *
 * 세부옵션 "교시별 부담임/강의실": 선택한 교시마다 담임과 다른 강사(부담임)·다른 강의실을 지정 가능.
 * NULL(미지정)이면 반의 담임/기본 강의실을 상속(class_schedules.teacher_id/classroom_id). 제출은
 * schedule_{day,start,end,teacher,classroom}_${i} hidden input — 서버액션이 그대로 읽어 저장.
 */
export function ScheduleGrid({
  periods,
  initial,
  teacherId,
  teacherOptions,
  classroomOptions,
}: {
  periods: Period[];
  initial: InitialSlot[];
  /** 반 담임(폼에서 lift) — 셀 기본 표시 이름 + 부담임 드롭다운의 "담임" 기본값. */
  teacherId: string | null;
  teacherOptions: Opt[];
  classroomOptions: Opt[];
}) {
  // 초기: 기존 스케줄의 (요일,시작시각)을 교시로 역매핑 + 교시별 오버라이드 복원(마운트 1회).
  const initState = useMemo(() => {
    const startToId = new Map(periods.map((p) => [p.startTime, p.id]));
    const sel = new Set<string>();
    const st: Record<string, string> = {};
    const sc: Record<string, string> = {};
    for (const s of initial) {
      const id = startToId.get(s.startTime.slice(0, 5));
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

  const periodById = useMemo(() => new Map(periods.map((p) => [p.id, p])), [periods]);
  const validIds = useMemo(() => new Set(periods.map((p) => p.id)), [periods]);

  // 유효 선택(현재 교시표 기준), 요일→교시 순 정렬.
  const activeKeys = useMemo(
    () =>
      [...selected]
        .filter((k) => validIds.has(k.split("__")[1]))
        .sort((a, b) => {
          const [da, pa] = a.split("__");
          const [db, pb] = b.split("__");
          return dayIndex(da) - dayIndex(db) || Number(pa) - Number(pb);
        }),
    [selected, validIds],
  );
  const activeSet = useMemo(() => new Set(activeKeys), [activeKeys]);

  const rows = activeKeys.map((k) => {
    const [day, id] = k.split("__");
    const p = periodById.get(id)!;
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
      // 셀 해제 시 그 교시 오버라이드 정리
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

  return (
    <div className="space-y-2">
      {/* 제출용 hidden input — 선택 셀을 교시 시각 + 교시별 오버라이드로 변환(서버액션 포맷) */}
      {rows.map((r, i) => (
        <div key={`${r.key}-${i}`}>
          <input type="hidden" name={`schedule_day_${i}`} value={r.day} />
          <input type="hidden" name={`schedule_start_${i}`} value={r.start} />
          <input type="hidden" name={`schedule_end_${i}`} value={r.end} />
          <input type="hidden" name={`schedule_teacher_${i}`} value={slotTeacher[r.key] ?? ""} />
          <input type="hidden" name={`schedule_classroom_${i}`} value={slotClassroom[r.key] ?? ""} />
        </div>
      ))}

      <div className="border-border overflow-hidden rounded-md border">
        <table className="w-full table-fixed border-collapse text-center text-xs">
          <thead>
            <tr className="bg-muted/40">
              <th className="border-border text-muted-foreground w-10 border-b border-r py-1.5 font-medium">
                교시
              </th>
              {DAYS.map((d) => (
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
            {periods.map((p) => (
              <tr key={p.id}>
                <th className="border-border bg-muted/20 text-muted-foreground border-b border-r py-1 font-normal leading-tight last:border-b-0">
                  <div className="text-foreground text-[11px] font-semibold">{p.id}</div>
                  <div className="num text-[9px]">{p.startTime}</div>
                </th>
                {DAYS.map((d) => {
                  const k = cellKey(d.key, p.id);
                  const on = activeSet.has(k);
                  const override = slotTeacher[k];
                  const eff = override ? teacherNameOf(override) : homeTeacherName;
                  return (
                    <td key={d.key} className="border-border border-b border-r p-0 last:border-r-0">
                      <button
                        type="button"
                        aria-pressed={on}
                        aria-label={`${d.label} ${p.id}교시`}
                        onClick={() => toggle(d.key, p.id)}
                        className={`block h-9 w-full px-0.5 transition ${
                          on
                            ? `${override ? "bg-purple/85 hover:bg-purple" : "bg-primary/85 hover:bg-primary"} text-primary-foreground`
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

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-xs">
          <span className="text-foreground font-semibold">{rows.length}</span>개 교시 선택 ·
          칸을 눌러 수업 교시를 지정
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
                <span className="text-text-faint text-[10px]">
                  {classroomNameOf(slotClassroom[r.key])}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
