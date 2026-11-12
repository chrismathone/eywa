"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp } from "@/components/icons/aywa-icon-compat";
import { buildPeriodMatcher } from "@/features/classes/grid-slots";
import { periodSoloLabel } from "@/features/timetable/lib/periods";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  LAB_ROOM_LABEL,
  SPECIAL_SLOT_LABELS,
  parseSeatValue,
  seatSelectValue,
  specialSlotLabel,
} from "@/features/timetable/lib/teacher-label";
import { LAB_SEPARATE_LABEL, LAB_SEPARATE_TEXT_CLASS } from "@/features/timetable/lib/lab-separate";
import { readableTextColor } from "@/lib/color-utils";

type Period = { id: string; startTime: string; endTime: string; label?: string };
type InitialSlot = {
  dayOfWeek: string;
  startTime: string;
  /** 종료시각 — 시작시각이 같은 교시가 둘 이상일 때(EiE 4교시 vs IJW 1교시 = 둘 다 16:20) 어느 교시인지 가른다. */
  endTime?: string | null;
  teacherId?: string | null;
  classroomId?: string | null;
  /** 저장된 표시 라벨 — 자리(LAB·JJ)면 드롭다운이 그 자리로 열린다. */
  slotTeacherLabel?: string | null;
  /** LAB '따로 수업(*LAB)' 표식(0271a). */
  labSeparate?: boolean;
};

/** 담당 칸 값 중 LAB 자리. 표식 토글은 이 값일 때만 선다. */
const LAB_SEAT_VALUE = seatSelectValue(LAB_ROOM_LABEL);

/**
 * 읽어주기·목록에 쓰는 교시 이름 — 학원설정 이름 → (내장표면) "N교시" → **이름을 비웠으면 시간대**.
 * 규칙은 periods.ts가 단일 소스다(여기서 다시 적지 말 것 — 두 벌이 되면 화면마다 갈린다).
 */
const periodName = (p: Period) => periodSoloLabel(p);
/**
 * 교시 열 안에 쓰는 짧은 표기 — 이름이 없으면 번호만(열 제목이 이미 '교시'라 중복을 피한다).
 * 위와 폴백이 다르므로(번호 vs "N교시") 여기만 따로 쓴다. 학원장이 **이름을 비우면 빈칸**으로 둔다
 * (바로 아래 줄에 시간대가 이미 있다, 2026-08-13). `typeof` 판정 이유는 periodListLabel 주석 참조.
 */
const periodCellName = (p: Period) => (typeof p.label === "string" ? p.label.trim() : p.id);
type Opt = { id: string; name: string };
/** 담당 선택지 — 강사 퍼스널 색(users.bg_color·text_color, 0054a)을 함께 싣는다. 없으면 반 색으로 칠한다. */
type TeacherOpt = Opt & { bgColor?: string | null; textColor?: string | null };
type Fill = { bg: string; text: string };

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
  allowSeats,
  outsideCount = 0,
  onJumpToOutside,
  labSeparateEnabled = false,
}: {
  weekdayPeriods: Period[];
  weekendPeriods: Period[];
  initial: InitialSlot[];
  /** 반 담임(폼에서 lift) — 셀 기본 표시 이름 + 부담임 드롭다운의 "담임" 기본값. */
  teacherId: string | null;
  teacherOptions: TeacherOpt[];
  classroomOptions: Opt[];
  /**
   * 반 색(폼 라이브 값) — **자리(LAB·JJ) 칸**과 퍼스널 색이 없는 강사 칸만 이 색으로 칠한다.
   * 강사 칸은 그 강사의 퍼스널 색(원장 2026-09-18 *"주간 스케줄 색상을 선생님 고유 컬러 색으로
   * (반색상은 선생님이 아닌 랩실 등에만)"* — 통합뷰 칸과 같은 색). 둘 다 없으면 기본 브랜드색.
   */
  bgColor?: string | null;
  /**
   * 담당 드롭다운에 **자리(JJ·LAB)** 를 선택지로 넣을지(영어 전용). 자리는 사람이 아니라 방이라
   * 계정이 없다 — 고르면 담당은 비고 표시 라벨만 그 자리가 된다(teacher-label.ts).
   */
  allowSeats?: boolean;
  /**
   * 교시표에 **없는** 시작시각으로 살아 있는 슬롯 수(= 아래 '시각 직접 입력' 행 수).
   * 🔴 이 격자는 교시표에 있는 시각만 칸으로 만든다 — 그래서 `rows.length`(선택 교시 수)만
   *    보면 "다 고쳤다"로 읽히는데 실제 슬롯은 더 많을 수 있다(원장 2026-08-24
   *    *"토요일로 수정했는데도 일요일에 여전히 반이 남아있네"* — 격자에 없던 요일이 두 달 버텼다).
   */
  outsideCount?: number;
  /** 배지를 눌렀을 때 아래 '시각 직접 입력'으로 데려간다(없으면 배지는 눌리지 않는 표시만). */
  onJumpToOutside?: () => void;
  /**
   * LAB 교시 옆 **'따로 수업(*LAB)' 토글**을 세우고 값을 보낼지(원장 2026-09-17). 끄면 토글도 hidden도 없다 —
   * 서버가 기존 값을 승계한다. 표식을 못 읽었거나(0271a 미적용·조회 실패) 생성 폼이면 끈다(모른 채 "꺼짐"을
   * 보내면 켜 둔 표식이 저장 한 번에 꺼진다).
   */
  labSeparateEnabled?: boolean;
}) {
  const weekdayById = useMemo(() => new Map(weekdayPeriods.map((p) => [p.id, p])), [weekdayPeriods]);
  const weekendById = useMemo(() => new Map(weekendPeriods.map((p) => [p.id, p])), [weekendPeriods]);
  // 요일이 평일이냐 주말이냐에 따라 교시 시각을 다른 표에서 해석.
  const periodFor = (day: string, id: string): Period | undefined =>
    (isWeekendDay(day) ? weekendById : weekdayById).get(id);

  // 초기: 기존 스케줄의 (요일,시각)을 교시로 역매핑(요일 종류별 표로) + 오버라이드 복원(마운트 1회).
  // 매핑 규칙(시작시각만으로는 EiE 4교시/IJW 1교시를 못 가른다)은 buildPeriodMatcher에 있다 — 순수·Vitest.
  const initState = useMemo(() => {
    const matchWeekday = buildPeriodMatcher(weekdayPeriods);
    const matchWeekend = buildPeriodMatcher(weekendPeriods);
    const sel = new Set<string>();
    const st: Record<string, string> = {};
    const sc: Record<string, string> = {};
    const ls: Record<string, boolean> = {};
    for (const s of initial) {
      const id = (isWeekendDay(s.dayOfWeek) ? matchWeekend : matchWeekday)(s);
      if (!id) continue;
      const k = cellKey(s.dayOfWeek, id);
      sel.add(k);
      // 자리(LAB·JJ)는 teacher_id가 비어 있고 라벨에만 있다 — 라벨을 먼저 본다(안 그러면 화면이
      // "담임 (미정)"으로 열리고, 그대로 저장하면 자리 배치가 조용히 지워진다).
      // 초안 복원은 자리를 라벨이 아니라 담당 칸 값(`seat:LAB`)으로만 들고 온다 — 둘 다 본다(리뷰 2026-09-17).
      const seat = specialSlotLabel(s.slotTeacherLabel) ?? parseSeatValue(s.teacherId);
      if (seat) st[k] = seatSelectValue(seat);
      else if (s.teacherId) st[k] = s.teacherId;
      if (s.classroomId) sc[k] = s.classroomId;
      if (seat === LAB_ROOM_LABEL && s.labSeparate) ls[k] = true;
    }
    return { sel, st, sc, ls };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 마운트 시 한 번만(이후 사용자 선택 보존)
  }, []);

  const [selected, setSelected] = useState<Set<string>>(initState.sel);
  const [slotTeacher, setSlotTeacher] = useState<Record<string, string>>(initState.st);
  const [slotClassroom, setSlotClassroom] = useState<Record<string, string>>(initState.sc);
  // LAB '따로 수업(*LAB)' 표식 — 칸 키 → 켜짐. LAB이 아닌 칸의 값은 안 남긴다(아래 setTeacher·toggle).
  const [labSeparate, setLabSeparate] = useState<Record<string, boolean>>(initState.ls);
  // 토글을 못 여는 폼이면 칸도 평소 LAB으로 그린다(보내지도 않는 값을 켜진 것처럼 보이지 않게).
  const isLabSeparateCell = (k: string) => labSeparateEnabled && slotTeacher[k] === LAB_SEAT_VALUE && labSeparate[k] === true;
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showSeatOptions, setShowSeatOptions] = useState(true);

  // 자리(LAB·JJ)면 그 이름 그대로 — users에 없으니 이름 조회는 실패한다(셀이 빈 채로 보임).
  const teacherNameOf = (id: string | null | undefined) =>
    id ? (parseSeatValue(id) ?? teacherOptions.find((t) => t.id === id)?.name ?? null) : null;
  const visibleTeacherValue = (key: string) => {
    const value = slotTeacher[key] ?? "";
    return !allowSeats && parseSeatValue(value) ? "" : value;
  };
  const homeTeacherName = teacherNameOf(teacherId);
  const classroomNameOf = (id: string | null | undefined) =>
    id ? (classroomOptions.find((c) => c.id === id)?.name ?? null) : null;

  // 강사 id → 퍼스널 색. 칸마다 find를 돌지 않게 한 번 접는다.
  const teacherFillById = useMemo(() => {
    const m = new Map<string, Fill>();
    for (const t of teacherOptions)
      if (t.bgColor) m.set(t.id, { bg: t.bgColor, text: t.textColor || readableTextColor(t.bgColor) });
    return m;
  }, [teacherOptions]);
  /**
   * 선택 칸의 색 — 담당이 **사람**이면 그 강사의 퍼스널 색, **자리(LAB·JJ)**면 반 색.
   * 퍼스널 색이 없는 강사도 반 색으로 떨어진다(칸이 무색이 되면 선택했는지가 안 보인다). 둘 다 없으면 null.
   */
  const cellFill = (k: string): Fill | null => {
    const override = slotTeacher[k];
    const isSeat = override ? parseSeatValue(override) !== null : false;
    const personId = isSeat ? null : (override ?? teacherId);
    const personal = personId ? teacherFillById.get(personId) : undefined;
    if (personal) return personal;
    return bgColor ? { bg: bgColor, text: readableTextColor(bgColor) } : null;
  };

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
    // name = 학원설정 이름(예 "EiE 4교시") — 없으면 "4교시". 아래 목록·읽어주기 라벨이 이 이름을 쓴다.
    const name = p.label?.trim() || `${id}교시`;
    return { key: k, day, periodId: id, name, start: p.startTime, end: p.endTime };
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
      setLabSeparate((prev) => {
        const n = { ...prev };
        delete n[k];
        return n;
      });
    }
  };

  const setTeacher = (k: string, v: string) => {
    setSlotTeacher((prev) => {
      const n = { ...prev };
      if (v) n[k] = v;
      else delete n[k];
      return n;
    });
    // LAB을 풀면 표식도 함께 끈다 — 남겨 두면 다시 LAB으로 되돌릴 때 예전 표식이 유령처럼 되살아난다.
    if (v !== LAB_SEAT_VALUE)
      setLabSeparate((prev) => {
        if (!prev[k]) return prev;
        const n = { ...prev };
        delete n[k];
        return n;
      });
  };
  const setClassroom = (k: string, v: string) =>
    setSlotClassroom((prev) => {
      const n = { ...prev };
      if (v) n[k] = v;
      else delete n[k];
      return n;
    });

  const teacherSelectOptions = [
    { value: "", label: homeTeacherName ? `담임 · ${homeTeacherName}` : "담임 (미정)" },
    // 자리(LAB·JJ)를 사람 위에 둔다 — 영어는 이 배치가 흔해서 목록 아래로 밀면 매번 스크롤해야 한다.
    ...(allowSeats && showSeatOptions
      ? SPECIAL_SLOT_LABELS.map((s) => ({ value: seatSelectValue(s), label: `${s} (자리)` }))
      : []),
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
        <p className="text-muted-foreground text-xs font-medium">{caption}</p>
        <div className="border-border overflow-hidden rounded-md border">
          <table className="w-full table-fixed border-collapse text-center text-xs">
            <thead>
              <tr className="bg-muted/40">
                {/* 교시 열은 시작~종료 시각(예 14:20~15:00)을 한 줄로 담아야 해 폭을 넉넉히 준다.
                    table-fixed라 이 폭이 그대로 확정되고 나머지를 요일이 나눠 갖는다.
                    6.5rem(104px) = 2026-09-08 v5 글자 기준 실측 — 11자(`HH:MM~HH:MM`) × ~8.5px + 여백.
                    옛 4.5rem(72px)은 xs 14px에서 좌우 ~10px씩 잘렸다(overflow-hidden이라 진짜로 사라짐).
                    시간표 rich-card-group.tsx `LABEL_W = 104`와 같은 문자열·같은 크기라 값을 맞춘다. */}
                <th className="border-border text-muted-foreground w-[6.5rem] border-b border-r py-1.5 font-medium">
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
                  <th className="border-border bg-muted/20 text-muted-foreground border-b border-r px-0.5 py-1 font-normal leading-tight last:border-b-0">
                    {/* 교시 이름은 학원설정(과목 운영 → 평일 교시)이 단일 소스 — 코드가 "N교시"를 지어내지 않는다. */}
                    <div className="text-foreground break-keep text-xs font-bold">
                      {periodCellName(p)}
                    </div>
                    {/* 시작만 보이면 몇 분짜리 수업인지 알 수 없다 — 종료 시각까지 한 줄로. */}
                    <div className="num whitespace-nowrap text-xs">
                      {p.startTime}~{p.endTime}
                    </div>
                  </th>
                  {days.map((d) => {
                    const k = cellKey(d.key, p.id);
                    const on = activeSet.has(k);
                    const override = visibleTeacherValue(k);
                    const eff = override ? teacherNameOf(override) : homeTeacherName;
                    const fill = on ? cellFill(k) : null;
                    return (
                      <td key={d.key} className="border-border border-b border-r p-0 last:border-r-0">
                        <button
                          type="button"
                          aria-pressed={on}
                          aria-label={`${d.label} ${periodName(p)}`}
                          onClick={() => toggle(d.key, p.id)}
                          style={fill ? { background: fill.bg, color: fill.text } : undefined}
                          className={`block h-9 w-full px-0.5 transition ${
                            on
                              ? fill
                                ? `hover:brightness-95 ${override ? "ring-2 ring-inset ring-purple-700" : ""}`
                                : `${override ? "bg-purple/85 hover:bg-purple" : "bg-primary/85 hover:bg-primary"} text-primary-foreground`
                              : "hover:bg-muted text-transparent"
                          }`}
                          title={on && override ? `부담임 · ${eff}` : undefined}
                        >
                          {/* leading-tight — `*LAB` 밑줄이 줄 상자 밖으로 나가 truncate(overflow)에 잘리지 않게(leading-none이면 잘린다). */}
                          <span
                            className={`block truncate text-xs font-bold leading-tight ${
                              on && isLabSeparateCell(k) ? LAB_SEPARATE_TEXT_CLASS : ""
                            }`}
                          >
                            {on ? (isLabSeparateCell(k) ? LAB_SEPARATE_LABEL : (eff ?? "●")) : "·"}
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
          {/* 표식은 **켤 수 있는 폼에서만** 보낸다 — 안 보내면 서버가 기존 값을 승계한다(labSeparateEnabled 주석). */}
          {labSeparateEnabled ? (
            <input type="hidden" name={`schedule_labsep_${i}`} value={isLabSeparateCell(r.key) ? "1" : "0"} />
          ) : null}
        </div>
      ))}

      {/* 평일(5요일)·주말(2요일) 두 표를 요일 수 비례(5:2)로 나란히. ⚠️ auto 트랙은 w-full table을
          컨테이너 전폭으로 부풀려 반대편을 0폭으로 짜부시킴 → minmax(0,Nfr)로 비례+수축 허용. */}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,5fr)_minmax(0,2fr)] lg:items-start">
        {renderTable("평일 (월~금)", WEEKDAY_DAYS, weekdayPeriods)}
        {renderTable("주말 (토·일)", WEEKEND_DAYS, weekendPeriods)}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-muted-foreground text-xs">
            <span className="text-foreground font-bold">{rows.length}</span>개 교시 선택 · 칸을 눌러 수업 교시를 지정
          </p>
          {/* 🔴 격자가 표현 못 하는 슬롯을 **눈에 띄게** 알린다 — 격자만 보고 "다 지웠다"고 읽히면
              엉뚱한 요일에 반이 남는다(그 행은 아래 '시각 직접 입력'에만 있고, 그래서 저장 때 보존된다). */}
          {outsideCount > 0 ? (
            <button
              type="button"
              onClick={onJumpToOutside}
              disabled={!onJumpToOutside}
              title="이 격자에 칸이 없는 시각입니다 — 아래 '시각 직접 입력'에서 고치거나 지웁니다"
              className="bg-amber-soft text-amber inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold disabled:cursor-default"
            >
              교시표 밖 시각 {outsideCount}개
              {onJumpToOutside ? <span className="font-medium">· 아래에서 확인</span> : null}
            </button>
          ) : null}
        </div>
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
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-muted-foreground text-xs">
              교시별로 담임과 다른 강사(부담임)·다른 강의실을 지정할 수 있습니다. 비워두면 반의 담임·기본 강의실을 따릅니다.
            </p>
            {allowSeats ? (
              <label className="text-foreground inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium">
                <input
                  type="checkbox"
                  checked={showSeatOptions}
                  onChange={(e) => setShowSeatOptions(e.target.checked)}
                  className="accent-primary"
                  aria-label="LAB/JJ 자리 선택 표시"
                />
                LAB/JJ 자리 선택
              </label>
            ) : null}
          </div>
          {rows.map((r) => {
            const showLabToggle = labSeparateEnabled && slotTeacher[r.key] === LAB_SEAT_VALUE;
            return (
              <div key={r.key} className="flex flex-wrap items-center gap-2">
                {/* 교시 이름이 길어질 수 있어(예 "EiE 4교시") 고정폭 대신 최소폭 + 줄바꿈 없음. */}
                <span className="text-foreground min-w-16 shrink-0 whitespace-nowrap text-xs font-medium">
                  {DAY_LABEL[r.day]} {r.name}
                </span>
                <SearchableSelect
                  className="w-40"
                  value={visibleTeacherValue(r.key)}
                  onValueChange={(v) => setTeacher(r.key, v)}
                  options={teacherSelectOptions}
                  ariaLabel={`${DAY_LABEL[r.day]} ${r.name} 강사`}
                />
                <SearchableSelect
                  className="w-40"
                  value={slotClassroom[r.key] ?? ""}
                  onValueChange={(v) => setClassroom(r.key, v)}
                  options={classroomSelectOptions}
                  ariaLabel={`${DAY_LABEL[r.day]} ${r.name} 강의실`}
                />
                {/* 강의실 이름 칸은 최소폭을 잡는다 — 뒤에 서는 '따로 수업' 토글이 행마다 같은 자리에 오게. */}
                {slotClassroom[r.key] || showLabToggle ? (
                  <span className="text-text-faint min-w-[5.5rem] shrink-0 whitespace-nowrap text-xs">
                    {classroomNameOf(slotClassroom[r.key])}
                  </span>
                ) : null}
                {/* 랩실 토글은 **줄 맨 끝**(강의실 옆) — 가운데 끼우면 LAB 행만 강의실 칸이 밀려 열이 어긋난다
                    (원장 2026-09-18). 켜면 시간표 칸이 `*LAB`(밑줄 + 이탤릭)이 된다(원장 2026-09-17). */}
                {showLabToggle ? (
                  <button
                    type="button"
                    aria-pressed={labSeparate[r.key] === true}
                    onClick={() => setLabSeparate((prev) => ({ ...prev, [r.key]: !prev[r.key] }))}
                    aria-label={`${DAY_LABEL[r.day]} ${r.name} 따로 수업(*LAB)`}
                    className={`inline-flex h-(--control-h) items-center gap-1.5 rounded-lg border px-2 text-xs font-bold transition ${
                      labSeparate[r.key]
                        ? "border-blue bg-blue-soft text-blue"
                        : "border-line text-foreground hover:bg-muted"
                    }`}
                  >
                    <span
                      aria-hidden
                      className={`relative inline-block h-3.5 w-6 rounded-full transition ${labSeparate[r.key] ? "bg-blue" : "bg-neutral-fill"}`}
                    >
                      <span
                        className={`absolute top-0.5 size-2.5 rounded-full bg-white transition-all ${labSeparate[r.key] ? "left-3" : "left-0.5"}`}
                      />
                    </span>
                    따로 수업
                    <span className={labSeparate[r.key] ? LAB_SEPARATE_TEXT_CLASS : "opacity-50"}>{LAB_SEPARATE_LABEL}</span>
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
