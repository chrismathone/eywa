"use client";

import { useMemo, useState, useTransition } from "react";

import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  dayRunsEndTime,
  regularRunClosed,
  ridePairConflict,
  runStartTime,
  type RegularStop,
  type VehicleFleet,
  type VehicleRoute,
} from "../parent-rides";
import { changeRegularRide } from "../../ride-change/server/parent-regular-ride-actions";
import { DIRECTION_LABEL, dayLabel, type DayCode, type Direction } from "../../types";
import { useKstNow } from "../../components/kst-clock";

const REASON_MAX = 100;

/**
 * 학부모 **고정 시간 변경** — 고른 요일의 정기 배정(매주 반복)을 다른 회차·정류장으로 바꾼다(사용자 2026-09-29).
 *
 * 🔑 지금 고정 시간을 먼저 보여 주고(등원/하원 각각), 다른 시간을 고르면 그 요일의 고정 시간이 바뀐다. 사유 필수.
 * 🔑 요일 하나만 바뀐다 — "매주 수요일"만 바꾸면 월·화·목·금은 그대로다.
 * 🔑 **고른 요일이 오늘이면 이미 출발한(10분 전 지난) 회차는 고를 수 없다**(사용자 2026-09-30 — 오늘 명단에 바로
 *    먹어서 오류가 나기 쉽다). 오늘 **모든 회차가 끝나면** 다시 전부 고를 수 있다. 다른 요일은 늘 열려 있다.
 *    판정은 서버와 같은 `regularRunClosed`(여기는 안내, 서버가 다시 막는다 — [[#77]]).
 * 🔑 정류장 이름·시각뿐이다 — 다른 아이 정보는 재료에 없다.
 */
export function RegularRideDialog({
  kids,
  weekday,
  onDate,
  today,
  regular,
  fleet,
  defaultOpen = false,
}: {
  kids: { id: string; name: string }[];
  weekday: DayCode;
  /** 고른 요일 칩의 날짜 — 오늘이면 지난 회차를 잠근다. 이번 주의 지난 요일이어도 된다(매주 반복 — 다음 그 요일부터 적용). */
  onDate: string;
  today: string;
  regular: readonly RegularStop[];
  fleet: readonly VehicleFleet[];
  /** 처음부터 열어 둔다 — 월별 화면에서 요일을 고르면 곧바로 이 창이 뜬다(사용자 2026-10-02). */
  defaultOpen?: boolean;
}) {
  const [kidId, setKidId] = useState(kids[0]?.id ?? "");
  const [direction, setDirection] = useState<Direction>("in");
  const current = regular.find((r) => r.studentId === kidId && r.direction === direction)?.runStopId ?? null;
  // 처음 보이는 호차 = 지금 고정 자리의 호차(처음부터 열려 뜨는 월별 화면에서도 맞게).
  const [vehicleId, setVehicleId] = useState(
    () => fleet.find((v) => v.routes.some((r) => r.stops.some((s) => s.id === current)))?.id ?? fleet[0]?.id ?? "",
  );
  const [pick, setPick] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const where = (runStopId: string | null) => {
    if (!runStopId) return null;
    for (const v of fleet)
      for (const r of v.routes) {
        const s = r.stops.find((x) => x.id === runStopId);
        if (s) return { vehicleId: v.id, text: `${v.name} ${r.runName} · ${s.time ?? "--:--"} ${s.name}` };
      }
    return null;
  };
  const currentAt = where(current);
  const vehicle = fleet.find((v) => v.id === vehicleId);
  const day = dayLabel(weekday);

  // 서버 렌더에선 시각이 없어(null) 아무것도 잠그지 않는다 — 브라우저에서 채워지면 잠근다.
  const now = useKstNow();
  const dayEnd = useMemo(() => dayRunsEndTime(fleet.flatMap((v) => v.routes)), [fleet]);
  const closed = (stops: VehicleRoute["stops"]) =>
    now ? regularRunClosed(runStartTime(stops), dayEnd, onDate, today, now.minutes) : false;
  const anyClosed = fleet.some((v) => v.routes.some((r) => closed(r.stops)));
  const routeOf = (runStopId: string | null) =>
    runStopId ? fleet.flatMap((v) => v.routes).find((r) => r.stops.some((s) => s.id === runStopId)) : undefined;
  // 🔑 지금 고정 회차가 오늘 이미 출발했으면 이 아이·방향은 운행이 끝날 때까지 못 바꾼다 — 옮기면 새 고정이
  //    오늘 명단에도 먹어 같은 방향이 두 번 잡힌다(사용자 2026-09-30, 서버도 같은 판정).
  const currentRoute = routeOf(current);
  const currentClosed = !!currentRoute && closed(currentRoute.stops);
  // 창을 열어 둔 사이 고른 회차가 출발 10분 전을 넘기면 저장을 막는다.
  const pickRoute = routeOf(pick);
  const pickClosed = !!pickRoute && closed(pickRoute.stops);
  const locked = currentClosed;
  // 🔑 짝 규칙(사용자 2026-09-30) — 그 요일 **반대 방향 고정 자리**와 같은 회차 금지 · 등원이 하원보다 빨라야.
  //    판정은 서버와 같은 `ridePairConflict`(여기는 안내, 서버가 다시 막는다).
  const otherStopId = regular.find((r) => r.studentId === kidId && r.direction !== direction)?.runStopId ?? null;
  const otherRoute = routeOf(otherStopId);
  const other = otherRoute
    ? { runId: otherRoute.runId, time: otherRoute.stops.find((s) => s.id === otherStopId)?.time ?? null }
    : null;
  const otherWord = direction === "in" ? "하원" : "등원";
  const pairBlock = (runId: string, time: string | null) => ridePairConflict(direction, { runId, time }, other);
  const pickBlocked = pick && pickRoute ? pairBlock(pickRoute.runId, pickRoute.stops.find((s) => s.id === pick)?.time ?? null) : null;

  // 열 때·아이/방향을 바꿀 때 — 지금 고정 자리의 호차부터, 고른 것·문구는 비운다.
  function resetFor(nextKid: string, nextDir: Direction) {
    const at = where(regular.find((r) => r.studentId === nextKid && r.direction === nextDir)?.runStopId ?? null);
    setVehicleId(at?.vehicleId ?? fleet[0]?.id ?? "");
    setPick(null);
    setNotice(null);
  }

  function save() {
    if (!pick) return;
    const runStopId = pick;
    startTransition(async () => {
      const res = await changeRegularRide({ studentId: kidId, weekday, ioKind: direction, runStopId, reason });
      if ("error" in res) {
        setNotice({ tone: "error", text: res.error });
        return;
      }
      setPick(null);
      setReason("");
      setNotice({ tone: "ok", text: res.message });
    });
  }

  const chip = (active: boolean) =>
    `h-8 rounded-full px-3 text-sm font-bold ${active ? "bg-primary text-primary-foreground" : "bg-bg-soft text-foreground"}`;

  return (
    <Dialog defaultOpen={defaultOpen} onOpenChange={(open) => { if (open) { setReason(""); resetFor(kidId, direction); } }}>
      {/* 날짜·현재 시각과 한 줄에 들어가게 작게(사용자 2026-09-29 "버튼이 커서 다음 줄로 밀렸네"). */}
      <DialogTrigger className="border-primary text-primary inline-flex h-6 shrink-0 items-center rounded-full border px-2 text-xs font-bold whitespace-nowrap">
        고정시간 변경
      </DialogTrigger>
      <DialogContent className="gap-3">
        <DialogHeader className="pr-8">
          <DialogTitle className="text-base font-bold">매주 {day}요일 고정 시간 변경</DialogTitle>
          <DialogDescription>
            {day}요일마다 타는 시간을 바꿔요. 다른 요일은 그대로예요. 하루만 바꾸려면 [{DIRECTION_LABEL[direction]} 수정하기]를 쓰세요.
          </DialogDescription>
        </DialogHeader>

        {kids.length > 1 ? (
          <div role="group" aria-label="자녀 선택" className="flex flex-wrap gap-1.5">
            {kids.map((k) => (
              <button key={k.id} type="button" aria-pressed={k.id === kidId} className={chip(k.id === kidId)}
                onClick={() => { setKidId(k.id); resetFor(k.id, direction); }}>
                {k.name}
              </button>
            ))}
          </div>
        ) : null}

        <div role="group" aria-label="등원/하원" className="grid grid-cols-2 gap-1.5">
          {(["in", "out"] as const).map((d) => (
            <button key={d} type="button" aria-pressed={d === direction} className={chip(d === direction)}
              onClick={() => { setDirection(d); resetFor(kidId, d); }}>
              {DIRECTION_LABEL[d]}
            </button>
          ))}
        </div>

        <p className="bg-bg-soft rounded-lg px-3 py-2 text-sm break-keep">
          <span className="text-text-dim block text-xs font-bold">지금 고정 시간 ({day}요일 {DIRECTION_LABEL[direction]})</span>
          <span className="font-bold">{currentAt?.text ?? "고정 시간이 없어요"}</span>
        </p>

        {fleet.length > 1 ? (
          <div role="group" aria-label="호차 선택" className="flex flex-wrap gap-1">
            {fleet.map((v) => (
              <button key={v.id} type="button" aria-pressed={v.id === vehicleId}
                className={`h-7 rounded-full px-2.5 text-xs font-bold ${v.id === vehicleId ? "bg-primary text-primary-foreground" : "bg-bg-soft text-foreground"}`}
                onClick={() => setVehicleId(v.id)}>
                {v.name}
              </button>
            ))}
          </div>
        ) : null}

        {locked ? (
          <p className="bg-amber-soft rounded-lg px-3 py-2 text-xs font-bold break-keep">
            오늘 {DIRECTION_LABEL[direction]} 차가 이미 출발해서 지금은 바꿀 수 없어요.{" "}
            {dayEnd ? `오늘 운행이 모두 끝나면(${dayEnd}) 바꿀 수 있어요.` : "오늘 운행이 모두 끝나면 바꿀 수 있어요."}
          </p>
        ) : anyClosed ? (
          <p className="bg-bg-soft rounded-lg px-3 py-2 text-xs font-bold break-keep">
            오늘 이미 출발한 회차는 고를 수 없어요.{" "}
            {dayEnd ? `오늘 운행이 모두 끝나면(${dayEnd}) 다시 고를 수 있어요.` : "오늘 운행이 모두 끝나면 다시 고를 수 있어요."}
          </p>
        ) : null}

        <ol className="flex flex-col gap-2">
          {(vehicle?.routes ?? []).map((r) => {
            const isClosed = closed(r.stops);
            const otherRun = !!other && other.runId === r.runId;
            return (
              <li key={r.runId} className={`border-line rounded-xl border px-3 py-2 ${isClosed || otherRun ? "bg-bg-soft" : ""}`}>
                <p className="flex flex-wrap items-baseline gap-x-1.5 text-sm font-bold">
                  {r.runName}
                  {r.departTime ? <span className="num text-text-dim font-medium">· {r.departTime} 출발</span> : null}
                  {isClosed ? <span className="text-text-dim text-xs font-bold">· 운행 시작 — 고를 수 없어요</span> : null}
                  {!isClosed && otherRun ? (
                    <span className="text-text-dim text-xs font-bold">· {otherWord} 회차라 고를 수 없어요</span>
                  ) : null}
                </p>
                <ol className={`mt-1 flex flex-col ${isClosed || otherRun ? "opacity-50 grayscale" : ""}`}>
                  {r.stops.map((s) => {
                    const isCurrent = s.id === current;
                    const picked = s.id === pick;
                    const pairBlocked = s.kind === "stop" && !!pairBlock(r.runId, s.time);
                    const can = s.kind === "stop" && !isCurrent && !isClosed && !locked && !pairBlocked;
                    const row = (
                      <>
                        <span className="num text-text-dim w-11 shrink-0">{s.time ?? "--:--"}</span>
                        <span className={`min-w-0 flex-1 break-keep ${isCurrent || picked ? "font-bold" : s.kind === "stop" ? "" : "text-text-dim"}`}>
                          {s.name}
                        </span>
                        {isCurrent ? (
                          <span className="bg-primary text-primary-foreground shrink-0 rounded-full px-2 py-0.5 text-xs font-bold">지금 고정</span>
                        ) : null}
                        {picked ? (
                          <span className="border-primary text-primary bg-card shrink-0 rounded-full border px-2 py-0.5 text-xs font-bold">바꿀 시간</span>
                        ) : null}
                      </>
                    );
                    return (
                      <li key={s.id}>
                        {can ? (
                          <button type="button" aria-pressed={picked} onClick={() => { setNotice(null); setPick(picked ? null : s.id); }}
                            className={`flex w-full items-center gap-2 rounded-md px-1 py-1 text-left text-sm ${picked ? "bg-primary/10" : "hover:bg-bg-soft"}`}>
                            {row}
                          </button>
                        ) : (
                          <div className={`flex items-center gap-2 px-1 py-1 text-sm ${pairBlocked && !isCurrent && !otherRun ? "opacity-45" : ""}`}>{row}</div>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </li>
            );
          })}
        </ol>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-bold">
            바꾸는 이유 <span className="text-danger">*</span>
          </span>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={REASON_MAX} rows={2}
            placeholder="예: 수요일 학원 수업 시간이 바뀌었어요"
            className="border-line bg-card rounded-lg border px-3 py-2 text-sm" />
        </label>

        {notice ? (
          <p role="status" className={`text-center text-sm font-bold break-keep ${notice.tone === "ok" ? "text-primary" : "text-danger"}`}>
            {notice.text}
          </p>
        ) : null}

        <div className="flex flex-col gap-2">
          {pickClosed ? (
            <p className="text-danger text-center text-sm font-bold break-keep">고른 회차가 방금 출발 10분 전을 넘겼어요. 다른 시간을 골라 주세요.</p>
          ) : null}
          {pickBlocked ? <p className="text-danger text-center text-sm font-bold break-keep">{pickBlocked}</p> : null}
          <button type="button" onClick={save} disabled={!pick || pickClosed || locked || !!pickBlocked || !reason.trim() || pending}
            className="bg-primary text-primary-foreground flex h-11 w-full items-center justify-center rounded-lg text-sm font-bold disabled:opacity-40">
            {pending ? "저장하는 중…" : `매주 ${day}요일 고정 시간으로 저장`}
          </button>
          <DialogClose className="bg-card border-line flex h-11 w-full items-center justify-center rounded-lg border text-sm font-bold">
            닫기
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  );
}
