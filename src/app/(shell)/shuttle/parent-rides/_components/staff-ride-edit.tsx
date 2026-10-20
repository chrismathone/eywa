"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "@/components/icons/aywa-icon-compat";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ridePairConflict, type RideLeg, type VehicleFleet } from "@/features/shuttle/parent/parent-rides";
import { FocusedRun, RunHeader } from "@/features/shuttle/parent/components/vehicle-route-parts";
import { DIRECTION_LABEL, type Direction, type Season } from "@/features/shuttle/types";
import {
  listStaffRideStudents,
  loadStaffRideDay,
  staffAbsentRide,
  staffChangeRideStop,
  staffResetRide,
  type StaffRideStudent,
} from "@/features/shuttle/ride-change/server/staff-ride-actions";

const REASON_MAX = 100;
const BIG_BTN = "flex h-11 w-full items-center justify-center rounded-lg text-sm font-bold disabled:opacity-40";
const LINE_BTN = `${BIG_BTN} bg-card border-line border`;

type Day = { legs: RideLeg[]; fleet: VehicleFleet[]; dayLabel: string; today: string };
type Mode = "move" | "absent";
type Notice = { tone: "ok" | "error"; text: string } | null;

/** 그 방향의 지금 구간 — 타는 구간 먼저, 없으면 안 타는 구간, 그것도 없으면 없음(그날 일정 없음). */
const legOf = (legs: readonly RideLeg[], dir: Direction) =>
  legs.find((l) => l.direction === dir && !l.skipped) ?? legs.find((l) => l.direction === dir) ?? null;

const timeOf = (leg: RideLeg) => leg.route.find((s) => s.mine)?.time ?? leg.plannedTime;

/**
 * 월별 상세의 **[관리자 수정하기]**(사용자 2026-10-20) — 한 창 안에서 세 단계:
 * ① 아이 고르기(이름 검색 · 스크롤) → ② 그 아이의 그날 배차(등원·하원) → ③ **시간·호차 이동** 또는 **결석**을 갈라 저장.
 * 🔑 이동 = 다른 호차·회차의 정류장을 골라 그 방향만 옮긴다(사유 선택) · 결석 = 등원·하원 둘 다 안 탄다(사유 필수).
 *    두 갈래를 버튼 색부터 나눠 "결석인지 시간 이동인지"가 섞이지 않게 한다.
 * 🔑 사유는 줄 메모로 남아 **학부모 화면에도** 보인다(`RideLeg.changeNote`).
 * 🔑 저장은 오늘 등하원 [수정]과 같은 직원 액션 — 서버가 날짜·마감·짝 규칙·이미 탔는지를 다시 본다([[#77]]).
 */
export function StaffRideEdit({
  date,
  season,
  initialStudent,
  shuttleIds,
  onBack,
}: {
  date: string;
  season: Season;
  /** 표 칸(아이 × 날짜)에서 열었으면 그 아이부터. */
  initialStudent: StaffRideStudent | null;
  /** 이 달 셔틀을 타는 아이 — 목록에서 '셔틀' 표시 · 위로 올린다. */
  shuttleIds: ReadonlySet<string>;
  onBack: () => void;
}) {
  const router = useRouter();
  const [students, setStudents] = useState<StaffRideStudent[] | null>(null);
  const [student, setStudent] = useState<StaffRideStudent | null>(initialStudent);
  const [query, setQuery] = useState("");
  const [day, setDay] = useState<Day | null>(null);
  const [mode, setMode] = useState<Mode>("move");
  const [dir, setDir] = useState<Direction>("in");
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [focusRunId, setFocusRunId] = useState<string | null>(null);
  const [pickStopId, setPickStopId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  const [loading, startLoading] = useTransition();
  const [pending, startSaving] = useTransition();

  // ① 아이 목록 — 처음 한 번만 읽는다.
  useEffect(() => {
    if (students || student) return;
    startLoading(async () => {
      const res = await listStaffRideStudents();
      if ("error" in res) setNotice({ tone: "error", text: res.error });
      else setStudents(res.students);
    });
  }, [students, student]);

  // ② 아이를 고르면 그날 배차 + 전체 노선.
  useEffect(() => {
    if (!student) return;
    startLoading(async () => {
      const res = await loadStaffRideDay({ studentId: student.id, onDate: date, season });
      if ("error" in res) {
        setNotice({ tone: "error", text: res.error });
        return;
      }
      setDay(res);
      const first = legOf(res.legs, "in") ? "in" : legOf(res.legs, "out") ? "out" : "in";
      setDir(first);
      setVehicleId(legOf(res.legs, first)?.vehicleId ?? res.fleet[0]?.id ?? null);
    });
  }, [student, date, season]);

  function pickStudent(s: StaffRideStudent) {
    setStudent(s);
    setDay(null);
    setMode("move");
    resetPick();
    setReason("");
    setNotice(null);
  }

  function backToList() {
    setStudent(null);
    setDay(null);
    setNotice(null);
  }

  function resetPick() {
    setFocusRunId(null);
    setPickStopId(null);
  }

  function changeDir(next: Direction) {
    setDir(next);
    resetPick();
    setNotice(null);
    if (day) setVehicleId(legOf(day.legs, next)?.vehicleId ?? vehicleId);
  }

  /** 저장 뒤 — 그날 배차를 다시 읽고 월별 달력·표도 새로 그린다. */
  function afterSave(text: string) {
    setNotice({ tone: "ok", text });
    resetPick();
    setReason("");
    router.refresh();
    if (!student) return;
    startLoading(async () => {
      const res = await loadStaffRideDay({ studentId: student.id, onDate: date, season });
      if (!("error" in res)) setDay(res);
    });
  }

  function run(save: () => Promise<{ ok: true; message: string } | { error: string }>) {
    setNotice(null);
    startSaving(async () => {
      const res = await save();
      if ("error" in res) setNotice({ tone: "error", text: res.error });
      else afterSave(res.message);
    });
  }

  // ─── ① 아이 고르기 ───
  if (!student) {
    const q = query.replace(/\s+/g, "");
    const list = (students ?? [])
      .filter((s) => !q || s.name.replace(/\s+/g, "").includes(q))
      .sort((a, b) => Number(shuttleIds.has(b.id)) - Number(shuttleIds.has(a.id)));
    return (
      <div className="flex min-h-0 flex-col gap-3">
        <p className="text-sm font-bold">수정할 아이를 고르세요</p>
        <div className="relative">
          <Search aria-hidden className="text-text-faint pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            type="search"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="아이 이름 검색"
            aria-label="아이 이름 검색"
            className="h-11 pr-10 pl-9"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="검색 지우기"
              className="text-text-dim hover:text-foreground absolute top-1/2 right-0 flex size-11 -translate-y-1/2 items-center justify-center"
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>
        <ul className="border-line max-h-[50vh] overflow-y-auto rounded-xl border" aria-label="아이 목록">
          {students === null ? (
            <li className="text-text-dim p-4 text-center text-sm">{loading ? "아이 목록을 불러오는 중…" : "아이 목록이 없습니다"}</li>
          ) : list.length === 0 ? (
            <li className="text-text-dim p-4 text-center text-sm">&lsquo;{query.trim()}&rsquo; 이름의 아이가 없습니다.</li>
          ) : (
            list.map((s) => (
              <li key={s.id} className="border-line-faint border-b last:border-b-0">
                <button
                  type="button"
                  onClick={() => pickStudent(s)}
                  className="hover:bg-bg-soft flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left"
                >
                  <span className="font-bold">{s.name}</span>
                  <span className="text-text-faint text-xs">{s.schoolGrade}</span>
                  {shuttleIds.has(s.id) ? <span className="text-primary ml-auto text-xs font-bold">셔틀</span> : null}
                </button>
              </li>
            ))
          )}
        </ul>
        {notice ? <NoticeLine notice={notice} /> : null}
        <button type="button" onClick={onBack} className={LINE_BTN}>
          상세로 돌아가기
        </button>
      </div>
    );
  }

  // ─── ② 그날 배차 + ③ 이동/결석 ───
  const leg = day ? legOf(day.legs, dir) : null;
  const otherLeg = day ? legOf(day.legs, dir === "in" ? "out" : "in") : null;
  const other = otherLeg && !otherLeg.skipped ? { runId: otherLeg.runId, time: timeOf(otherLeg) } : null;
  const mine = leg && !leg.skipped ? { runId: leg.runId, stopId: leg.route.find((s) => s.mine)?.id ?? null } : { runId: "", stopId: null };
  const vehicle = day?.fleet.find((v) => v.id === vehicleId) ?? null;
  const routes = vehicle?.routes ?? [];
  const focused = focusRunId ? routes.find((r) => r.runId === focusRunId) ?? null : null;
  const verb = dir === "in" ? "타는" : "내리는";
  const pairBlock = (runId: string, time: string | null) => ridePairConflict(dir, { runId, time }, other);
  const pickTime = focused?.stops.find((s) => s.id === pickStopId)?.time ?? null;
  const pickBlocked = focused && pickStopId ? pairBlock(focused.runId, pickTime) : null;
  const rodeAny = (day?.legs ?? []).some((l) => l.status === "boarded" || l.status === "extra");
  const absentNow = !!day && day.legs.length > 0 && day.legs.every((l) => l.skipped && (l.changeNote ?? "").startsWith("결석"));

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="bg-amber rounded-md px-2 py-0.5 text-xs font-bold text-white">관리자 수정</span>
        <span className="font-bold">{student.name}</span>
        <span className="text-text-faint text-xs">{student.schoolGrade}</span>
        <button type="button" onClick={backToList} className="text-primary ml-auto text-sm font-bold">
          다른 아이 고르기
        </button>
      </div>

      {/* ② 그날 배차 — 등원·하원 한 줄씩. */}
      <section className="bg-bg-soft flex flex-col gap-1 rounded-lg px-3 py-2 text-sm" aria-label="그날 배차">
        <p className="text-text-dim text-xs font-bold">{day ? day.dayLabel : "배차를 불러오는 중…"} · 지금 배차</p>
        {day
          ? (["in", "out"] as const).map((d) => {
              const l = legOf(day.legs, d);
              return (
                <p key={d} className="flex flex-wrap items-baseline gap-x-2 break-keep">
                  <span className="text-text-dim font-bold">{DIRECTION_LABEL[d]}</span>
                  {!l ? (
                    <span className="text-text-dim">일정 없음</span>
                  ) : l.skipped ? (
                    <b className="text-danger">안 탐{l.changeNote ? ` — ${l.changeNote}` : ""}</b>
                  ) : (
                    <>
                      <span>
                        {l.vehicleName} {l.runName} · <b>{l.stopName}</b> <span className="num">{timeOf(l) ?? ""}</span>
                      </span>
                      {l.added ? <span className="text-primary text-xs font-bold">오늘만 변경{l.changeNote ? ` · ${l.changeNote}` : ""}</span> : null}
                    </>
                  )}
                </p>
              );
            })
          : null}
      </section>

      {/* ③ 이동 / 결석 — 색부터 갈라 섞이지 않게. */}
      <div role="group" aria-label="수정 종류" className="grid grid-cols-2 gap-2">
        <button
          type="button"
          aria-pressed={mode === "move"}
          onClick={() => {
            setMode("move");
            setNotice(null);
          }}
          className={cn(BIG_BTN, "border", mode === "move" ? "bg-primary text-primary-foreground border-primary" : "border-line bg-card")}
        >
          시간·호차 이동
        </button>
        <button
          type="button"
          aria-pressed={mode === "absent"}
          onClick={() => {
            setMode("absent");
            resetPick();
            setNotice(null);
          }}
          className={cn(BIG_BTN, "border", mode === "absent" ? "bg-danger border-danger text-white" : "border-danger/40 bg-danger-soft text-danger")}
        >
          결석
        </button>
      </div>

      {!day ? null : mode === "absent" ? (
        <section className="flex flex-col gap-2">
          <p className="text-sm break-keep">
            <b className="text-danger">결석</b> — 그날 <b>등원·하원 모두</b> 셔틀을 타지 않아요. 출석부는 바뀌지 않아요.
          </p>
          {rodeAny ? (
            <p className="text-danger text-sm font-bold">이미 셔틀을 탄 날이라 결석으로 바꿀 수 없어요.</p>
          ) : absentNow ? (
            <p className="text-text-dim text-sm font-bold">이미 결석으로 저장돼 있어요. 다시 타게 하려면 [시간·호차 이동]에서 되돌리세요.</p>
          ) : null}
          <ReasonField value={reason} onChange={setReason} required placeholder="예: 감기로 결석 — 어머니 전화" />
          <button
            type="button"
            disabled={pending || rodeAny || !reason.trim()}
            onClick={() => run(() => staffAbsentRide({ studentId: student.id, onDate: date, reason }))}
            className={cn(BIG_BTN, "bg-danger text-white")}
          >
            {pending ? "저장하는 중…" : "결석으로 저장"}
          </button>
        </section>
      ) : (
        <section className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <div role="group" aria-label="등원·하원" className="flex gap-1">
              {(["in", "out"] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={dir === d}
                  onClick={() => changeDir(d)}
                  className={cn("h-9 rounded-full px-3 text-sm font-bold", dir === d ? "bg-foreground text-background" : "bg-bg-soft")}
                >
                  {DIRECTION_LABEL[d]}
                </button>
              ))}
            </div>
            {!focused && day.fleet.length > 1 ? (
              <div role="group" aria-label="호차 선택" className="flex flex-wrap gap-1">
                {day.fleet.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    aria-pressed={v.id === vehicleId}
                    onClick={() => setVehicleId(v.id)}
                    className={cn(
                      "h-9 rounded-full px-3 text-sm font-bold",
                      v.id === vehicleId ? "bg-primary text-primary-foreground" : "bg-bg-soft text-foreground",
                    )}
                  >
                    {v.name}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <p className="text-primary text-xs font-bold break-keep">
            {focused ? `${verb} 곳을 누른 뒤 저장하세요` : `옮길 회차를 누르세요 · 다른 호차는 위에서 고릅니다`}
          </p>

          {focused ? (
            <FocusedRun
              route={focused}
              mine={mine}
              pickStopId={pickStopId}
              verb={verb}
              selectable
              closed={false}
              blockOf={(time) => pairBlock(focused.runId, time)}
              onPick={(id) => setPickStopId(id === pickStopId || (focused.runId === mine.runId && id === mine.stopId) ? null : id)}
            />
          ) : routes.length === 0 ? (
            <p className="text-text-dim text-sm">이 호차는 등록된 노선이 없어요.</p>
          ) : (
            <ol className="flex flex-col gap-2">
              {routes.map((r) => {
                const current = r.runId === mine.runId;
                const otherRun = !!other && other.runId === r.runId;
                return (
                  <li key={r.runId}>
                    <button
                      type="button"
                      onClick={() => {
                        setFocusRunId(r.runId);
                        setPickStopId(null);
                        setNotice(null);
                      }}
                      className={cn(
                        "w-full rounded-xl border px-3 py-2.5 text-left",
                        current ? "border-primary" : "border-line",
                        otherRun ? "bg-bg-soft opacity-50 grayscale" : "hover:bg-bg-soft",
                      )}
                    >
                      <RunHeader route={r} current={current} verb={verb} closed={false} />
                      {otherRun ? (
                        <p className="text-text-dim text-xs font-bold">{dir === "in" ? "하원" : "등원"} 회차라 고를 수 없어요</p>
                      ) : null}
                      <p className="text-text-dim mt-0.5 text-xs break-keep">
                        {r.stops
                          .filter((s) => s.kind === "stop")
                          .map((s) => `${s.time ?? "--:--"} ${s.name}`)
                          .join(" · ")}
                      </p>
                    </button>
                  </li>
                );
              })}
            </ol>
          )}

          {focused ? (
            <>
              <ReasonField value={reason} onChange={setReason} placeholder="예: 학원 수업 시간 변경 — 2호차 3회차로" />
              <button
                type="button"
                disabled={!pickStopId || pending || !!pickBlocked}
                onClick={() =>
                  pickStopId &&
                  run(() => staffChangeRideStop({ studentId: student.id, onDate: date, ioKind: dir, runStopId: pickStopId, reason }))
                }
                className={cn(BIG_BTN, "bg-primary text-primary-foreground")}
              >
                {pending ? "저장하는 중…" : `${DIRECTION_LABEL[dir]} 이동 저장`}
              </button>
              <button type="button" onClick={resetPick} className={LINE_BTN}>
                전체 회차 보기
              </button>
            </>
          ) : null}
          {leg && (leg.added || leg.skipped) ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => staffResetRide({ studentId: student.id, onDate: date, ioKind: dir }))}
              className={cn(BIG_BTN, "border-primary text-primary border")}
            >
              {leg.skipped ? `평소대로 다시 ${dir === "in" ? "타기" : "내리기"}` : `평소 ${verb} 곳으로 되돌리기`}
            </button>
          ) : null}
        </section>
      )}

      {notice ? <NoticeLine notice={notice} /> : null}
      <button type="button" onClick={onBack} className={LINE_BTN}>
        상세로 돌아가기
      </button>
    </div>
  );
}

function ReasonField({
  value,
  onChange,
  placeholder,
  required = false,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  required?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-bold">
        사유 {required ? <span className="text-danger">*</span> : <span className="text-text-faint font-medium">(선택)</span>}
        <span className="text-text-faint ml-1 text-xs font-medium">학부모 화면에도 보여요</span>
      </span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={REASON_MAX}
        rows={2}
        placeholder={placeholder}
        className="border-line bg-card rounded-lg border px-3 py-2 text-sm"
      />
      <span className="num text-text-dim self-end text-xs">
        {value.trim().length}/{REASON_MAX}
      </span>
    </label>
  );
}

function NoticeLine({ notice }: { notice: NonNullable<Notice> }) {
  return (
    <p role="status" className={cn("text-center text-sm font-bold break-keep", notice.tone === "ok" ? "text-primary" : "text-danger")}>
      {notice.text}
    </p>
  );
}
