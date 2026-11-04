"use client";

import { useMemo, useState } from "react";
import { EyIcon } from "@/components/icons/aywa-icons";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { useSubjectMaps } from "@/features/owner/operations-context";
import { SUBJECT_BORDER, SUBJECT_SOFT } from "@/features/owner/subjects";
import { makeupShift, minutesLabel } from "@/features/shuttle/rider-day-check";
import { conflictKey } from "@/features/shuttle/conflict-acks";
import { SHUTTLE_ACTION } from "@/features/shuttle/control-size";
import {
  findClassAfterDeparture,
  findClassBeforeArrival,
  findRideConflicts,
} from "@/features/shuttle/ride-conflicts";
import { ackRideConflicts } from "@/features/shuttle/server/conflict-acks";
import { ridingRiders, type RunCard } from "@/features/shuttle/run-cards";
import type { StudentAssignment } from "@/features/shuttle/student-assignments";
import {
  CONFLICT_KIND_LABEL,
  CONFLICT_KINDS,
  DAY_CHANGE_KINDS,
  DAY_CHANGE_LABEL,
  dayRideChanges,
  groupByKind,
  type ConflictKind,
} from "@/features/shuttle/sheet-alerts";
import {
  dayLabel,
  DIRECTION_LABEL,
  type DayCode,
  type Season,
} from "@/features/shuttle/types";
import { cn } from "@/lib/utils";
import { RiderDayEdit } from "./rider-day-edit";

export type SheetClass = {
  id: string;
  day: string;
  start: string;
  end: string;
  className: string;
  subject: string;
  /** 교시 담당 → 반 담임. 모르면 "". */
  teacher: string;
  /** 보강 예약 카드(0264a) — 정규 수업이 아니라 그날만 오는 학생. */
  makeup?: boolean;
  /** 최근(14일 안)에 시간이 바뀐 수업이면 바뀐 날(배치 시작일). */
  changedFrom?: string;
  /** 보강 카드만 `from`(원래 수업 — 결석한 날 그 반 교시)을 싣는다. */
  students: {
    id: string;
    name: string;
    schoolGrade: string;
    from?: MakeupFrom;
  }[];
};

/** 보강의 원래 수업 — 결석한 날(`date`·`day`)과 그날 그 반 교시 구간(모르면 null). */
export type MakeupFrom = {
  date: string;
  day: string;
  start: string | null;
  end: string | null;
};

type Mode = "time" | "teacher";
type Show = "all" | "class" | "run";
const NO_TEACHER = "담당 미정";
const NO_TIME = "시각 미정";
const minutesOf = (hm: string) =>
  Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
const teacherOf = (c: SheetClass) => c.teacher || NO_TEACHER;
const vehicleRow = (r: RunCard) => `🚌 ${r.vehicleName}`;

/**
 * 탑승 학생 시간표 시트 — **열 = 월~금 고정**(사용자 2026-10-27 "월화수목금을 기본 베이스로").
 * 칸에 **수업 카드**와 **배차 카드**(회차 × 요일, 그날 타는 아이)가 시각 순으로 함께 선다(사용자 2026-10-29 "차량 배차를 수업처럼 따로 빼서").
 * 보기 두 가지(사용자 2026-10-29 "선생님이 많고 시간대도 겹친다 — 가시성"):
 *   · **시간별** — 줄 = 시작 시각. 같은 시각이면 배차 → 수업(선생님 이름순).
 *   · **선생님별** — 줄 = 선생님(수업) + 호차(배차). 칸 = 그날 그 줄의 카드(시각 순).
 * 📌 보강은 점선 카드에 **원래 수업 → 얼마나 옮겼나**를 적고, 그날 그 아이가 타는 배차 카드에도 "보강 18:00~19:50"과
 *    배차와 안 맞는 정도(예: 하원 차 출발 50분 뒤에 끝남)를 적는다. 한 학생이 겹치는 두 수업에 있으면 이름을 빨갛게.
 */
export function RiderWeekSheet({
  classes,
  runCards,
  acks,
  week,
  today,
  season,
  changesFailed = false,
  assignments = {},
  canWrite = false,
}: {
  classes: SheetClass[];
  runCards: RunCard[];
  /** 그날만 변경 저장에 쓰는 시즌(학기중·방학중). */
  season: Season;
  /** 그 주 그날만 변경을 못 읽었으면 true — 평소 배정만 보인다는 사실을 밝힌다. */
  changesFailed?: boolean;
  /** 학생별 평소 배정(그 시즌) — 수정 카드의 [고정으로 변경]이 노선 편성 편집기로 연다. */
  assignments?: Record<string, StudentAssignment[]>;
  /** 셔틀 편성 쓰기 권한 — 없으면 [고정으로 변경]을 잠근다. */
  canWrite?: boolean;
  /** 이 계정이 이미 확인한 겹침 열쇠(`conflictKey`) — 이 겹침은 다시 안 띄운다. */
  acks: string[];
  week: { day: DayCode; ymd: string; rest: string | null }[];
  today: string;
}) {
  const subjects = useSubjectMaps();
  /** 확인한 열쇠 — 누르는 즉시 화면에서 지우고(낙관), 저장은 계정에(`ackRideConflicts`). */
  const [acked, setAcked] = useState<ReadonlySet<string>>(() => new Set(acks));
  const [ackMsg, setAckMsg] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("time");
  const [show, setShow] = useState<Show>("all");
  const [teacher, setTeacher] = useState<string | null>(null);
  const [vehicle, setVehicle] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const needle = q.trim();
  /**
   * 알림 속 아이를 누르면 **그 아이 시간표만**(사용자 2026-11-04 "그쪽 섹션으로 이동 말고 그 아이 시간표만 다 띄우게").
   * 이름 검색이 아니라 학생 id로 거른다(동명이인·접미사 이름이 섞이지 않게). 검색창에 치면 풀린다.
   */
  const [only, setOnly] = useState<{ id: string; name: string } | null>(null);
  const filtering = !!needle || !!only;
  const hit = (s: { id: string; name: string; schoolGrade: string }) =>
    only
      ? s.id === only.id
      : !needle || s.name.includes(needle) || s.schoolGrade.includes(needle);
  function showStudent(id: string, name: string) {
    setOnly({ id, name });
    setQ("");
    setShow("all");
    setTeacher(null);
    setVehicle(null);
  }

  const teachers = useMemo(
    () =>
      [...new Set(classes.map(teacherOf))].sort((a, b) =>
        a.localeCompare(b, "ko"),
      ),
    [classes],
  );
  const vehicles = useMemo(
    () =>
      [...new Set(runCards.map((r) => r.vehicleName))].sort((a, b) =>
        a.localeCompare(b, "ko", { numeric: true }),
      ),
    [runCards],
  );

  const shownClasses = useMemo(
    () =>
      show === "run"
        ? []
        : classes
            .filter((c) => !teacher || teacherOf(c) === teacher)
            .map((c) =>
              filtering ? { ...c, students: c.students.filter(hit) } : c,
            )
            .filter((c) => c.students.length > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hit는 needle·only에서 파생
    [classes, teacher, needle, only, show],
  );
  const shownRuns = useMemo(
    () =>
      show === "class"
        ? []
        : runCards
            .filter((r) => !vehicle || r.vehicleName === vehicle)
            .map((r) =>
              filtering ? { ...r, riders: r.riders.filter(hit) } : r,
            )
            .filter((r) => r.riders.length > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hit는 needle·only에서 파생
    [runCards, vehicle, needle, only, show],
  );

  /** 그날 시간이 겹치는 두 수업에 함께 든 학생 — `요일|학생id`(전체 명단으로 판정). */
  const clashes = useMemo(() => {
    const out = new Set<string>();
    const byDay = new Map<string, SheetClass[]>();
    for (const c of classes) byDay.set(c.day, [...(byDay.get(c.day) ?? []), c]);
    for (const [day, list] of byDay)
      list.forEach((a, i) =>
        list.slice(i + 1).forEach((b) => {
          if (
            a.id === b.id ||
            !(
              minutesOf(a.start) < minutesOf(b.end) &&
              minutesOf(b.start) < minutesOf(a.end)
            )
          )
            return;
          const inB = new Set(b.students.map((s) => s.id));
          for (const s of a.students)
            if (inB.has(s.id)) out.add(`${day}|${s.id}`);
        }),
      );
    return out;
  }, [classes]);
  /** 요일 × 학생 → 그날 보강(배차 카드에 적는다). */
  const makeupOf = useMemo(() => {
    const out = new Map<string, { start: string; end: string }>();
    for (const c of classes)
      if (c.makeup)
        for (const s of c.students)
          out.set(`${c.day}|${s.id}`, { start: c.start, end: c.end });
    return out;
  }, [classes]);
  const ymdOf = (day: string) => week.find((w) => w.day === day)?.ymd ?? "";
  /**
   * 검색 중이면 **찾은 학생 것만** — 카드 명단뿐 아니라 경고(위 알림·카드 안 문구·확인 버튼)도 그 학생 것만(사용자 2026-10-30
   * *"검색해서 아이들을 볼 때는 해당 학생 내용만"*). 검색이 없으면 null(전부).
   */
  const searchIds = useMemo(() => {
    if (!filtering) return null;
    const out = new Set<string>();
    for (const s of [
      ...classes.flatMap((c) => c.students),
      ...runCards.flatMap((r) => r.riders),
    ])
      if (hit(s)) out.add(s.id);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hit는 needle·only에서 파생
  }, [classes, runCards, needle, only]);
  const riderCount = new Set([
    ...classes.flatMap((c) => c.students.map((s) => s.id)),
    ...runCards.flatMap((r) => r.riders.map((s) => s.id)),
  ]).size;

  /**
   * 🚨 **수업 ↔ 배차 겹침**(사용자 2026-10-29 "반짝이면서 '수정된 내용이 있습니다'") — 수업 시간이 바뀌거나 보강이 생겨 그 아이가
   * 차에 있을 시간과 수업이 겹치면, 겹친 수업 카드·배차 카드 **둘 다** 깜빡이고 무엇이 겹쳤는지 적는다. 판정은 순수 `findRideConflicts`(전체 명단).
   */
  // 🔑 **바뀐 수업·보강만** 본다(사용자 2026-10-29 "아이들이 배차를 바꾼 건 수정으로 나타내지 않아 — 수업 시간이 바뀌거나 보강일 때만").
  // 확인 버튼으로 접은 겹침은 빼고 센다(카드 안 문구도 함께 사라진다).
  // + **등원 도착보다 먼저 시작하는 수업**·**하원 출발 뒤까지 남은 수업**은 바뀌지 않은 수업도 함께 잡는다(사용자 2026-10-30). 같은 학생·수업·배차는 한 줄로.
  // 겹침은 **그날 실제로 차에 있는 아이**로 본다 — 그날만 안 타거나 다른 차로 옮긴 아이는 평소 카드에서 뺀다.
  const ridingCards = useMemo(
    () => runCards.map((r) => ({ ...r, riders: ridingRiders(r) })),
    [runCards],
  );
  const conflicts = useMemo(() => {
    const seen = new Set<string>();
    // 종류 = 무엇 때문에 어긋났나(사용자 2026-11-04 "분류해서") — 판정은 그대로, 만든 함수로 종류만 붙인다.
    const makeupIds = new Set(classes.filter((c) => c.makeup).map((c) => c.id));
    const tag =
      (kind: ConflictKind) =>
      (c: ReturnType<typeof findRideConflicts>[number]) => ({ ...c, kind });
    return [
      ...findRideConflicts(
        classes.filter((c) => c.makeup || c.changedFrom),
        ridingCards,
      ).map((c) => tag(makeupIds.has(c.classId) ? "makeup" : "changed")(c)),
      ...findClassBeforeArrival(classes, ridingCards).map(tag("early")),
      ...findClassAfterDeparture(classes, ridingCards).map(tag("late")),
    ].filter((c) => {
      const k = conflictKey(c);
      if (acked.has(k) || seen.has(k)) return false;
      if (searchIds && !searchIds.has(c.studentId)) return false;
      seen.add(k);
      return true;
    });
  }, [classes, ridingCards, acked, searchIds]);
  const conflictGroups = useMemo(
    () => groupByKind(conflicts, CONFLICT_KINDS),
    [conflicts],
  );
  /** 이번 주 그날만 바뀐 등하원 — 배차 카드의 표식을 모은 사실 목록(검색 중이면 찾은 학생 것만). */
  const dayChangeGroups = useMemo(
    () =>
      groupByKind(
        dayRideChanges(runCards).filter(
          (x) => !searchIds || searchIds.has(x.studentId),
        ),
        DAY_CHANGE_KINDS,
      ),
    [runCards, searchIds],
  );
  function acknowledge() {
    const keys = conflicts.map(conflictKey);
    setAcked((prev) => new Set([...prev, ...keys]));
    setAckMsg(null);
    void ackRideConflicts(keys).then((res) => {
      if (!res.ok)
        setAckMsg(
          res.error ?? "확인을 저장하지 못했어요 — 새로고침하면 다시 보여요",
        );
    });
  }
  const conflictsOf = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const c of conflicts) {
      m.set(c.classId, [...(m.get(c.classId) ?? []), c.text]);
      m.set(c.runCardId, [...(m.get(c.runCardId) ?? []), c.text]);
    }
    return m;
  }, [conflicts]);

  type Item = { kind: "class"; c: SheetClass } | { kind: "run"; r: RunCard };
  const items: Item[] = useMemo(
    () => [
      ...shownRuns.map((r) => ({ kind: "run" as const, r })),
      ...shownClasses.map((c) => ({ kind: "class" as const, c })),
    ],
    [shownRuns, shownClasses],
  );
  const startOf = (it: Item) =>
    it.kind === "class" ? it.c.start : (it.r.start ?? NO_TIME);
  const rowOf = (it: Item) =>
    mode === "teacher"
      ? it.kind === "class"
        ? teacherOf(it.c)
        : vehicleRow(it.r)
      : startOf(it);

  const rows = useMemo(() => {
    const keys = [...new Set(items.map(rowOf))];
    if (mode === "teacher") {
      // 선생님 → 호차 배차 순(배차 줄은 🚌로 시작).
      return keys
        .sort(
          (a, b) =>
            Number(a.startsWith("🚌")) - Number(b.startsWith("🚌")) ||
            (a === NO_TEACHER
              ? 1
              : b === NO_TEACHER
                ? -1
                : a.localeCompare(b, "ko", { numeric: true })),
        )
        .map((k) => ({
          key: k,
          label: k,
          sub: `${items.filter((it) => rowOf(it) === k).length}개`,
        }));
    }
    return keys
      .sort((a, b) =>
        a === NO_TIME ? 1 : b === NO_TIME ? -1 : a.localeCompare(b),
      )
      .map((k) => ({ key: k, label: k, sub: null as string | null }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rowOf는 mode에서 파생
  }, [items, mode]);
  const cell = (day: string, rowKey: string) =>
    items
      .filter(
        (it) =>
          (it.kind === "class" ? it.c.day : it.r.day) === day &&
          rowOf(it) === rowKey,
      )
      .sort((a, b) =>
        mode === "teacher"
          ? startOf(a).localeCompare(startOf(b))
          : Number(a.kind === "class") - Number(b.kind === "class") ||
            (a.kind === "class" && b.kind === "class"
              ? teacherOf(a.c).localeCompare(teacherOf(b.c), "ko")
              : 0),
      );

  const chip = (on: boolean) =>
    cn(
      "h-11 shrink-0 cursor-pointer rounded-lg px-3 text-sm font-bold",
      on
        ? "bg-primary text-primary-foreground"
        : "border-line text-foreground hover:bg-muted border",
    );
  const select =
    "border-line focus:border-primary h-11 rounded-xl border px-2 text-base outline-none";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="보기" className="flex gap-1.5">
          <button
            type="button"
            aria-pressed={mode === "time"}
            onClick={() => setMode("time")}
            className={chip(mode === "time")}
          >
            시간별
          </button>
          <button
            type="button"
            aria-pressed={mode === "teacher"}
            onClick={() => setMode("teacher")}
            className={chip(mode === "teacher")}
          >
            선생님·호차별
          </button>
        </div>
        <div role="group" aria-label="보일 것" className="flex gap-1.5">
          {(
            [
              ["all", "수업+배차"],
              ["class", "수업만"],
              ["run", "배차만"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              aria-pressed={show === k}
              onClick={() => setShow(k)}
              className={chip(show === k)}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-sm">
          <span className="text-text-dim shrink-0">선생님</span>
          <select
            value={teacher ?? ""}
            onChange={(e) => setTeacher(e.target.value || null)}
            className={select}
          >
            <option value="">전체 ({teachers.length}명)</option>
            {teachers.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-sm">
          <span className="text-text-dim shrink-0">호차</span>
          <select
            value={vehicle ?? ""}
            onChange={(e) => setVehicle(e.target.value || null)}
            className={select}
          >
            <option value="">전체</option>
            {vehicles.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="relative w-full max-w-xs">
          <span className="sr-only">이름·학교 찾기</span>
          <EyIcon
            name="search"
            size={16}
            className="text-text-faint pointer-events-none absolute top-1/2 left-3 -translate-y-1/2"
          />
          <input
            type="search"
            value={q}
            onChange={(e) => {
              setOnly(null);
              setQ(e.target.value);
            }}
            placeholder="학생 이름·학교"
            className={cn(select, "w-full pr-3 pl-9")}
          />
        </label>
        {only ? (
          <span className="bg-primary-soft text-primary flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-bold">
            {only.name} 시간표만 보는 중
            <button
              type="button"
              onClick={() => setOnly(null)}
              className="bg-card text-foreground cursor-pointer rounded-md px-2 py-0.5 text-xs font-bold hover:underline"
            >
              전체 보기
            </button>
          </span>
        ) : null}
        <span className="text-text-dim text-sm">
          탑승 학생 <b className="num text-foreground">{riderCount}</b>명 ·
          선생님 <b className="num text-foreground">{teachers.length}</b>명
        </span>
      </div>

      {conflicts.length > 0 ? (
        <div
          role="alert"
          className="border-danger bg-danger-soft rounded-xl border-2 px-3 py-2 text-sm"
        >
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-danger flex items-center gap-1.5 font-bold">
              <span
                aria-hidden
                className="bg-danger inline-block size-2.5 rounded-full motion-safe:animate-ping"
              />
              수정된 내용이 있습니다 — 차 타는 시간과 맞지 않는 수업{" "}
              {conflicts.length}건
            </p>
            {/* 확인 = 이 계정에서 이 겹침들을 접는다(사용자 2026-10-29). 수업이 또 바뀌거나 새 보강이 생기면 다시 뜬다. */}
            <button
              type="button"
              onClick={acknowledge}
              className={cn(
                SHUTTLE_ACTION,
                "bg-card border-danger text-danger hover:bg-danger-soft ml-auto shrink-0 cursor-pointer rounded-md border px-3 text-xs font-bold",
              )}
            >
              확인
            </button>
          </div>
          {conflictGroups.map((g) => (
            <div key={g.kind} className="mt-1.5">
              <p className="text-danger text-xs font-bold">
                {CONFLICT_KIND_LABEL[g.kind]} {g.items.length}건
              </p>
              <ul className="flex flex-col gap-0.5 pl-2">
                {g.items.map((c) => (
                  <li key={`${c.classId}|${c.runCardId}|${c.studentId}`}>
                    {/* 누르면 그 아이 시간표만(사용자 2026-11-04 — 10-29의 "그 수업 카드로 이동"을 바꿨다). */}
                    <button
                      type="button"
                      onClick={() => showStudent(c.studentId, c.name)}
                      className="text-foreground cursor-pointer text-left break-keep hover:underline"
                    >
                      {(() => {
                        const d = classes.find((x) => x.id === c.classId)?.day;
                        return d ? `${dayLabel(d as DayCode)} · ` : "";
                      })()}
                      {c.text}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}

      {dayChangeGroups.length > 0 ? (
        <div className="border-line bg-card rounded-xl border px-3 py-2 text-sm">
          <p className="font-bold">
            이번 주 그날만 바뀐 등하원{" "}
            {dayChangeGroups.reduce((n, g) => n + g.items.length, 0)}건
          </p>
          {dayChangeGroups.map((g) => (
            <div key={g.kind} className="mt-1.5">
              <p
                className={cn(
                  "text-xs font-bold",
                  g.kind === "skip" ? "text-danger" : "text-amber",
                )}
              >
                {DAY_CHANGE_LABEL[g.kind]} {g.items.length}건
              </p>
              <ul className="flex flex-col gap-0.5 pl-2">
                {g.items.map((x) => (
                  <li key={`${x.runCardId}|${x.studentId}|${x.kind}`}>
                    <button
                      type="button"
                      onClick={() => showStudent(x.studentId, x.name)}
                      className="cursor-pointer text-left break-keep hover:underline"
                    >
                      {dayLabel(x.day)} · {x.text}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}

      {ackMsg ? (
        <p className="text-danger text-sm font-bold">{ackMsg}</p>
      ) : null}
      {changesFailed ? (
        <p className="text-danger text-sm font-bold">
          그날만 바꾼 등하원을 불러오지 못했어요 — 지금은 평소 배정만 보여요.
          잠시 뒤 새로고침해 주세요.
        </p>
      ) : null}

      {classes.length === 0 && runCards.length === 0 ? (
        <p className="border-line bg-card text-text-dim rounded-2xl border border-dashed p-6 text-center text-sm break-keep">
          이번 주에 셔틀 탑승 학생의 수업·배차가 없어요.
        </p>
      ) : (
        <DragScrollArea className="bg-card rounded-2xl shadow-[var(--shadow-card)]">
          <table className="w-full min-w-[56rem] table-fixed border-collapse">
            <colgroup>
              <col className={mode === "teacher" ? "w-28" : "w-16"} />
              {week.map((w) => (
                <col key={w.ymd} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th className="bg-card border-line sticky top-0 left-0 z-20 border-r border-b px-2 py-2.5 text-sm font-bold">
                  {mode === "teacher" ? "선생님·호차" : "시작"}
                </th>
                {week.map((w) => (
                  <th
                    key={w.ymd}
                    className={cn(
                      "bg-card border-line sticky top-0 z-10 border-b px-2 py-1.5 text-center",
                      w.ymd === today && "bg-primary-soft",
                    )}
                  >
                    <span
                      className={cn(
                        "text-sm font-bold",
                        w.rest
                          ? "text-danger"
                          : w.ymd === today
                            ? "text-primary"
                            : "",
                      )}
                    >
                      {dayLabel(w.day)}
                    </span>{" "}
                    <span className="num text-text-dim text-sm">
                      {Number(w.ymd.slice(5, 7))}/{Number(w.ymd.slice(8, 10))}
                    </span>
                    {w.rest ? (
                      <span className="text-danger block text-xs font-bold">
                        {w.rest}
                      </span>
                    ) : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="text-text-dim py-8 text-center text-sm"
                  >
                    조건에 맞는 수업·배차가 없어요
                  </td>
                </tr>
              ) : (
                rows.map((row, i) => (
                  <tr
                    key={row.key}
                    className={cn(
                      "border-line border-b last:border-b-0",
                      i % 2 === 1 && "bg-bg-soft/50",
                    )}
                  >
                    <th
                      scope="row"
                      className="bg-card border-line sticky left-0 z-10 border-r px-1.5 py-1 text-center align-top"
                    >
                      <span
                        className={cn(
                          "block font-bold break-keep",
                          mode === "time" ? "num text-sm" : "text-xs",
                        )}
                      >
                        {row.label}
                      </span>
                      {row.sub ? (
                        <span className="num text-text-dim block text-xs">
                          {row.sub}
                        </span>
                      ) : null}
                    </th>
                    {week.map((w) => {
                      const list = w.rest ? [] : cell(w.day, row.key);
                      return (
                        <td
                          key={w.ymd}
                          className={cn(
                            "border-line-faint border-l p-1 align-top",
                            w.rest && "bg-att-weekend",
                            w.ymd === today && !w.rest && "bg-primary-softer",
                          )}
                        >
                          <div className="flex flex-col gap-1">
                            {list.map((it) =>
                              it.kind === "run" ? (
                                <RunBox
                                  key={it.r.id}
                                  r={it.r}
                                  makeupOf={(id) =>
                                    makeupOf.get(`${w.day}|${id}`) ?? null
                                  }
                                  alerts={conflictsOf.get(it.r.id) ?? []}
                                  date={w.ymd}
                                  dayEditable={w.ymd >= today}
                                  season={season}
                                  assignmentsOf={(id) => assignments[id] ?? []}
                                  canWrite={canWrite}
                                />
                              ) : (
                                <ClassCard
                                  key={it.c.id}
                                  c={it.c}
                                  color={subjects.colorOf(it.c.subject)}
                                  subjectLabel={subjects.labelOf(it.c.subject)}
                                  head={mode === "time" ? "teacher" : "time"}
                                  clashOf={(id) =>
                                    clashes.has(`${w.day}|${id}`)
                                  }
                                  shiftOf={(s) =>
                                    shiftLabel(
                                      s.from,
                                      ymdOf(it.c.day),
                                      it.c.start,
                                    )
                                  }
                                  alerts={conflictsOf.get(it.c.id) ?? []}
                                  focused={false}
                                />
                              ),
                            )}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </DragScrollArea>
      )}
    </div>
  );
}

/**
 * 카드 안 주의 문구 — "수정된 내용이 있습니다" + 무엇이 겹쳤나. 🔑 **카드 모양은 그대로**, 이 문구만 깜빡인다
 * (사용자 2026-10-29 "카드랑 다 이렇게 뜨니 구별이 안 간다 — 안에 문구랑 반짝이기만"). 동작 줄이기 설정이면 깜빡이지 않는다.
 */
function AlertHead({ alerts }: { alerts: string[] }) {
  if (alerts.length === 0) return null;
  return (
    <div className="text-danger mb-0.5 text-xs motion-safe:animate-pulse">
      <p className="font-bold">⚠ 수정된 내용이 있습니다</p>
      {alerts.map((a) => (
        <p key={a} className="break-keep">
          {a}
        </p>
      ))}
    </div>
  );
}

/** 보강 이동 한 줄 — "원래 10/28(수) 16:00~17:50 → 2일 뒤 · 2시간 늦게". */
function shiftLabel(
  from: MakeupFrom | undefined,
  toYmd: string,
  toStart: string,
): string | null {
  if (!from || !toYmd) return null;
  const m = makeupShift(from.date, from.start, toYmd, toStart);
  const fromLabel = `${Number(from.date.slice(5, 7))}/${Number(from.date.slice(8, 10))}(${dayLabel(from.day as DayCode)})${from.start ? ` ${from.start}~${from.end}` : ""}`;
  const parts = [
    m.days ? `${Math.abs(m.days)}일 ${m.days > 0 ? "뒤" : "앞"}` : "같은 날",
    m.startMin
      ? `${minutesLabel(m.startMin)} ${m.startMin > 0 ? "늦게" : "일찍"}`
      : null,
  ].filter(Boolean);
  return `원래 ${fromLabel} → ${parts.join(" · ")}`;
}

/** 배차 카드 — 등원(파랑)·하원(보라) · 호차 회차 · 시각 · 그날 타는 아이(정류장·시각). 보강 있는 아이는 보강 시각과 안 맞는 정도. */
function RunBox({
  r,
  makeupOf,
  alerts,
  date,
  dayEditable,
  season,
  assignmentsOf,
  canWrite,
}: {
  r: RunCard;
  makeupOf: (studentId: string) => { start: string; end: string } | null;
  alerts: string[];
  /** 그날만 수정을 열 수 있는 날짜(오늘 이후) — 지난 날이면 null(보기만). */
  /** 그 카드의 날짜(YYYY-MM-DD). */
  date: string;
  /** 당일만 수정을 열 수 있나(오늘 이후). */
  dayEditable: boolean;
  season: Season;
  assignmentsOf: (studentId: string) => StudentAssignment[];
  canWrite: boolean;
}) {
  const inbound = r.direction === "in";
  const riding = ridingRiders(r).length;
  return (
    <div className="bg-muted border-line-strong rounded-md border p-1">
      <AlertHead alerts={alerts} />
      <p className="flex flex-wrap items-baseline gap-x-1 text-xs">
        <span
          className={cn(
            "rounded px-1 text-xs font-bold text-white",
            inbound ? "bg-green" : "bg-purple",
          )}
        >
          🚌 {DIRECTION_LABEL[r.direction]}
        </span>
        <b className="break-keep">
          {r.vehicleName} {r.runName}
        </b>
        <span className="num text-text-dim ml-auto text-xs">{riding}명</span>
      </p>
      <p className="num text-text-dim text-xs">
        {r.start ?? NO_TIME}~{r.end ?? NO_TIME} · 학원{" "}
        {inbound ? "도착" : "출발"} <b>{r.academyTime ?? NO_TIME}</b>
      </p>
      <ul className="mt-0.5 flex flex-wrap gap-0.5">
        {r.riders.map((s) => {
          const away = s.change?.kind === "skip" || s.change?.kind === "moved";
          const mk = away ? null : makeupOf(s.id);
          // 보강과 배차가 안 맞는 정도 — 하원은 보강이 차 출발보다 늦게 끝나면, 등원은 차 도착보다 보강이 일찍 시작하면.
          const gap =
            mk && r.academyTime
              ? inbound
                ? minutesOf(r.academyTime) - minutesOf(mk.start)
                : minutesOf(mk.end) - minutesOf(r.academyTime)
              : 0;
          const body = (
            <>
              <b className={cn(away && "line-through")}>{s.name}</b>
              <span
                className={cn(
                  "num text-text-dim ml-1 text-xs",
                  away && "line-through",
                )}
              >
                {s.stopName}
                {s.stopTime ? ` ${s.stopTime}` : ""}
              </span>
              {s.change?.kind === "skip" ? (
                <span className="text-danger block text-xs font-bold">
                  그날 안 탐
                </span>
              ) : null}
              {s.change?.kind === "moved" ? (
                <span className="text-amber block text-xs font-bold break-keep">
                  그날만 → {s.change.to}
                </span>
              ) : null}
              {s.change?.kind === "dayOnly" ? (
                <span className="text-amber block text-xs font-bold">
                  그날만 여기서
                </span>
              ) : null}
              {mk ? (
                <span
                  className={cn(
                    "block text-xs font-bold break-keep",
                    gap > 0 ? "text-danger" : "text-amber",
                  )}
                >
                  보강 {mk.start}~{mk.end}
                  {gap > 0
                    ? inbound
                      ? ` — 차 도착 전 ${minutesLabel(gap)}에 시작`
                      : ` — 차 출발 ${minutesLabel(gap)} 뒤에 끝남`
                    : ""}
                </span>
              ) : null}
            </>
          );
          const chip = cn(
            "bg-card block rounded px-1 py-px text-xs leading-tight",
            (mk || s.change) && "w-full",
          );
          return (
            <li
              key={`${s.id}|${s.change?.kind ?? ""}`}
              className={cn((mk || s.change) && "w-full")}
            >
              <RiderDayEdit
                studentId={s.id}
                studentName={s.name}
                runId={r.runId}
                ioKind={r.direction}
                date={date}
                dayEditable={dayEditable}
                place={`${r.vehicleName} ${r.runName} · ${s.stopName}${s.stopTime ? ` ${s.stopTime}` : ""}`}
                season={season}
                assignments={assignmentsOf(s.id)}
                canWrite={canWrite}
                className={chip}
              >
                {body}
              </RiderDayEdit>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** 수업 카드 — 머리(선생님 또는 시각) · 과목·반·인원 · 학생. 보강은 점선 앰버 + 원래 수업에서 얼마나 옮겼나. */
function ClassCard({
  c,
  color,
  subjectLabel,
  head,
  clashOf,
  shiftOf,
  alerts,
  focused,
}: {
  c: SheetClass;
  color: keyof typeof SUBJECT_BORDER;
  subjectLabel: string;
  head: "teacher" | "time";
  clashOf: (studentId: string) => boolean;
  shiftOf: (s: SheetClass["students"][number]) => string | null;
  alerts: string[];
  focused: boolean;
}) {
  return (
    // 보강도 **수업 카드 색 그대로**(과목색) — 테두리만 점선. 주황 테두리는 빨간 경고처럼 보여 헷갈렸다(사용자 2026-10-29).
    // 알림 글에서 이동해 오면 잠깐 바깥 링(카드 색은 그대로).
    <div
      data-card-id={c.id}
      tabIndex={-1}
      className={cn(
        "rounded-md border p-1 outline-none",
        SUBJECT_BORDER[color],
        c.makeup && "border-dashed",
        focused && "ring-foreground ring-2 ring-offset-2",
      )}
    >
      <AlertHead alerts={alerts} />
      <p className="flex flex-wrap items-baseline gap-x-1 text-xs">
        {head === "teacher" ? (
          <>
            <b className="break-keep">{teacherOf(c)}</b>
            <span className="num text-text-dim text-xs">
              {c.start}~{c.end}
            </span>
          </>
        ) : (
          <b className="num">
            {c.start}~{c.end}
          </b>
        )}
        <span className="num text-text-dim ml-auto text-xs">
          {c.students.length}명
        </span>
      </p>
      <p className="flex flex-wrap items-center gap-1 text-xs">
        {c.makeup ? (
          <span className="bg-amber-soft text-amber rounded px-1 font-bold">
            보강
          </span>
        ) : null}
        {c.changedFrom ? (
          <span className="bg-amber-soft text-amber rounded px-1 font-bold">
            시간 변경 {Number(c.changedFrom.slice(5, 7))}/
            {Number(c.changedFrom.slice(8, 10))}부터
          </span>
        ) : null}
        <span className={cn("rounded px-1 font-bold", SUBJECT_SOFT[color])}>
          {subjectLabel}
        </span>
        <span className="text-text-dim break-keep">{c.className}</span>
      </p>
      <ul className="mt-0.5 flex flex-wrap gap-0.5">
        {c.students.map((s) => {
          const clash = clashOf(s.id);
          const shift = shiftOf(s);
          return (
            <li
              key={s.id}
              title={
                clash ? "같은 날 시간이 겹치는 다른 수업에도 있어요" : undefined
              }
              className={cn(
                "bg-card rounded px-1 py-px text-xs leading-tight",
                clash && "ring-danger text-danger ring-1",
                shift && "w-full",
              )}
            >
              <b>{s.name}</b>
              {s.schoolGrade ? (
                <span className="text-text-dim ml-1 text-xs">
                  {s.schoolGrade}
                </span>
              ) : null}
              {shift ? (
                <span className="text-amber block text-xs font-bold break-keep">
                  {shift}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
