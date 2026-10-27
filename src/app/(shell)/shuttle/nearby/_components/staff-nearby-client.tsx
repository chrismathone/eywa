"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { EyIcon } from "@/components/icons/aywa-icons";
import { cn } from "@/lib/utils";
import type { AcademyLocation } from "@/features/shuttle/map/academy-location";
import type { NetRun, NetStop } from "@/features/shuttle/parent/nearby";
import { locateForStaff } from "@/features/shuttle/parent/server/nearby-actions";
import type { NearbyStudent } from "@/features/shuttle/parent/server/staff-nearby";
import type { MapStop } from "@/features/shuttle/map/components/parent-live-map";
import { getRunRoadPath } from "@/features/shuttle/map/server/route-path";
import type { RunRoadPath } from "@/features/shuttle/map/server/route-path-core";
import { DIRECTION_LABEL } from "@/features/shuttle/types";
import { NearbyView, type NearbyPoint } from "@/app/(parent)/parent/nearby/_components/nearby-view";

const NO_SCHOOL = "학교 미입력";

/**
 * 관리자 '가까운 노선 찾기'(사용자 2026-10-26) — 왼쪽 = **재원생을 학교별로**, 오른쪽 = 학부모와 같은 찾기 화면(내 위치 버튼 없음).
 * · 학생을 누르면 **이미 배정된 탈 곳**(등원 정류장 우선)에서 찾고, 배정이 없을 때만 **집 주소**로 찾는다(사용자 2026-10-26).
 *   둘 다 없으면 누를 수 없고 "위치 없음"이라고 적는다.
 * · 학교 이름을 누르면 그 **학교** 자리로 찾는다(학교 앞 정류장 안내용).
 * 🔑 찾은 자리는 오른쪽 화면을 `key`로 **다시 마운트**해 넘긴다(검색으로 찍은 것과 같은 흐름 — 상태를 둘로 나누지 않는다).
 * 🔑 주소는 화면에 적지 않는다(위치 찾기에만 쓴다).
 */
export function StaffNearbyClient({
  appKey,
  academy,
  stops,
  runs,
  students,
  studentsError,
}: {
  appKey: string;
  academy: AcademyLocation;
  stops: NetStop[];
  runs: NetRun[];
  students: NearbyStudent[];
  studentsError: string | null;
}) {
  const [q, setQ] = useState("");
  const [target, setTarget] = useState<{ key: string; point: NearbyPoint } | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [, start] = useTransition();

  /** 학교별 묶음 — 학교 가나다순(미입력은 맨 뒤), 안에서는 학년 → 이름. 검색어는 이름·학교 둘 다 본다. */
  const groups = useMemo(() => {
    const needle = q.trim();
    const list = needle ? students.filter((s) => s.name.includes(needle) || s.school.includes(needle)) : students;
    const by = new Map<string, NearbyStudent[]>();
    for (const s of list) {
      const k = s.school || NO_SCHOOL;
      by.set(k, [...(by.get(k) ?? []), s]);
    }
    return [...by.entries()]
      .sort(([a], [b]) => (a === NO_SCHOOL ? 1 : b === NO_SCHOOL ? -1 : a.localeCompare(b, "ko")))
      .map(([school, list]) => ({
        school,
        list: list.sort((a, b) => (Number(a.grade) || 0) - (Number(b.grade) || 0) || a.name.localeCompare(b.name, "ko")),
      }));
  }, [students, q]);

  function locate(key: string, query: string, label: string) {
    setMsg(null);
    setPendingKey(key);
    start(async () => {
      const res = await locateForStaff(query, { lat: academy.lat, lng: academy.lng });
      setPendingKey(null);
      if ("error" in res) {
        setMsg(res.error);
        return;
      }
      setTarget({ key: `${key}:${Date.now()}`, point: { ...res, label } });
    });
  }

  const activeKey = target?.key.split(":").slice(0, 2).join(":");
  /** 회차 id → "1호차 1회차" — 학생 줄에 '탈 곳' 대신 이렇게 적는다(사용자 2026-10-26). */
  const runLabel = useMemo(() => new Map(runs.map((r) => [r.id, `${r.vehicleName} ${r.runName}`])), [runs]);

  /**
   * 🚌 **호차 · 회차 버튼**(사용자 2026-10-26 "검색바 밑에 호차별 그리고 회차별 버튼 — 누르면 실시간 위치처럼 노선들을 다").
   * 호차를 누르면 그 차의 회차 노선이 **전부**, 회차를 누르면 그 회차만 지도에 그린다(도로 경로 = 실시간 위치와 같은 getRunRoadPath).
   * 같은 호차를 다시 누르면 끈다. 회차마다 한 번만 묻는다(서버도 캐시).
   */
  const vehicles = useMemo(() => {
    const first = (r: NetRun) => r.stops.find((x) => x.time)?.time ?? "99:99";
    const by = new Map<string, NetRun[]>();
    for (const r of runs) by.set(r.vehicleName, [...(by.get(r.vehicleName) ?? []), r]);
    return [...by.entries()]
      .sort(([a], [b]) => a.localeCompare(b, "ko", { numeric: true }))
      .map(([name, list]) => ({ name, runs: [...list].sort((a, b) => first(a).localeCompare(first(b))) }));
  }, [runs]);
  const [pick, setPick] = useState<{ vehicle: string; runId: string | null } | null>(null);
  /** 리셋할 때마다 올린다 — 오른쪽 찾기 화면(검색어·결과)까지 새로 마운트해 비운다. */
  const [resetN, setResetN] = useState(0);
  const pickedRuns = useMemo(() => {
    const v = vehicles.find((x) => x.name === pick?.vehicle);
    if (!v) return [];
    return pick?.runId ? v.runs.filter((r) => r.id === pick.runId) : v.runs;
  }, [vehicles, pick]);
  const [roads, setRoads] = useState<Record<string, RunRoadPath>>({});
  const pickedKey = pickedRuns.map((r) => r.id).join(",");
  useEffect(() => {
    let alive = true;
    for (const id of pickedKey ? pickedKey.split(",") : []) {
      void getRunRoadPath(id).then((res) => {
        if (alive) setRoads((prev) => (prev[id] ? prev : { ...prev, [id]: res }));
      });
    }
    return () => {
      alive = false;
    };
  }, [pickedKey]);
  const routeLines = useMemo(
    () => pickedRuns.flatMap((r) => { const x = roads[r.id]; return x?.ok ? x.legs.map((l) => ({ path: l.path, kind: l.kind })) : []; }),
    [pickedRuns, roads],
  );
  const routeStops: MapStop[] = useMemo(() => {
    const byId = new Map(stops.map((s) => [s.id, s]));
    const out = new Map<string, MapStop>();
    for (const r of pickedRuns) for (const c of r.stops) {
      const s = byId.get(c.stopId);
      if (s && !out.has(s.id)) out.set(s.id, { stopId: s.id, name: s.name, lat: s.lat, lng: s.lng });
    }
    return [...out.values()];
  }, [pickedRuns, stops]);
  /** 노선 상태 한 줄 — 불러오는 중 / 못 그린 회차와 사유(위치 없는 정류장 등). 다 그렸으면 없음. */
  const routeStatus =
    pickedRuns.length === 0
      ? null
      : pickedRuns.some((r) => !roads[r.id])
        ? "노선을 불러오는 중…"
        : pickedRuns
            .flatMap((r) => {
              const x = roads[r.id];
              return x && !x.ok ? [`${r.runName}: ${x.error}`] : [];
            })
            .join(" · ") || null;

  const chip = (on: boolean) =>
    cn("h-11 shrink-0 cursor-pointer rounded-lg px-3 text-sm font-bold", on ? "bg-primary text-primary-foreground" : "border-line text-foreground hover:bg-muted border");
  const routeButtons = vehicles.length ? (
    <div className="flex flex-col gap-1.5">
      <div role="group" aria-label="호차" className="flex flex-wrap gap-1.5">
        {vehicles.map((v) => (
          <button
            key={v.name}
            type="button"
            aria-pressed={pick?.vehicle === v.name}
            onClick={() => setPick((p) => (p?.vehicle === v.name && !p.runId ? null : { vehicle: v.name, runId: null }))}
            className={chip(pick?.vehicle === v.name)}
          >
            {v.name}
          </button>
        ))}
        {/* 리셋(사용자 2026-10-26) — 고른 호차·회차, 찍은 장소·학생, 검색 결과를 모두 비우고 처음 화면으로. */}
        <button
          type="button"
          onClick={() => {
            setPick(null);
            setTarget(null);
            setMsg(null);
            setResetN((n) => n + 1);
          }}
          className="border-line text-text-dim hover:bg-muted flex h-11 shrink-0 cursor-pointer items-center gap-1 rounded-lg border px-3 text-sm font-bold"
        >
          <EyIcon name="undo" size={14} />
          리셋
        </button>
      </div>
      {pick ? (
        <div role="group" aria-label="회차" className="flex flex-wrap gap-1.5">
          <button type="button" aria-pressed={!pick.runId} onClick={() => setPick({ vehicle: pick.vehicle, runId: null })} className={chip(!pick.runId)}>
            전체
          </button>
          {vehicles.find((v) => v.name === pick.vehicle)?.runs.map((r) => (
            <button
              key={r.id}
              type="button"
              aria-pressed={pick.runId === r.id}
              onClick={() => setPick({ vehicle: pick.vehicle, runId: r.id })}
              className={chip(pick.runId === r.id)}
            >
              {DIRECTION_LABEL[r.direction]} {r.runName}
              <span className="num ml-1 font-normal opacity-80">{r.stops.find((x) => x.time)?.time ?? ""}</span>
            </button>
          ))}
        </div>
      ) : null}
      {pick ? (
        <p className="text-primary text-xs font-bold break-keep">
          검색하면 {pick.runId ? runLabel.get(pick.runId) : `${pick.vehicle} 전체 회차`} 안에서만 가까운 정류장을 찾아요.
        </p>
      ) : null}
      {routeStatus ? <p className="text-text-dim text-xs break-keep">{routeStatus}</p> : null}
    </div>
  ) : null;

  return (
    <div className="grid w-full gap-3 md:grid-cols-[17rem_minmax(0,1fr)]">
      <aside className="bg-card flex min-h-0 flex-col gap-2 rounded-2xl p-3 shadow-[var(--shadow-card)] md:sticky md:top-3 md:max-h-[calc(100dvh-8rem)]">
        <p className="text-sm font-bold">학생 찾기 <span className="num text-text-dim font-normal">{students.length}명</span></p>
        <label className="relative">
          <span className="sr-only">학생·학교 검색</span>
          <EyIcon name="search" size={16} className="text-text-faint pointer-events-none absolute top-1/2 left-3 -translate-y-1/2" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="이름·학교"
            className="border-line focus:border-primary h-11 w-full rounded-xl border pr-3 pl-9 text-base outline-none"
          />
        </label>
        <p className="text-text-dim text-xs break-keep">학생을 누르면 정해진 탈 곳(없으면 집 주소)으로, 학교 이름을 누르면 학교 자리로 가까운 정류장을 찾아요.</p>
        {studentsError ? <p className="text-danger text-sm font-bold">{studentsError}</p> : null}
        {msg ? <p className="text-danger text-sm font-bold break-keep">{msg}</p> : null}
        <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
          {groups.length === 0 ? (
            <p className="text-text-dim py-4 text-center text-sm">{q ? "찾는 학생이 없어요" : "재원생이 없어요"}</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {groups.map(({ school, list }) => {
                const schoolKey = `school:${school}`;
                return (
                  <li key={school} className="flex flex-col gap-1">
                    {school === NO_SCHOOL ? (
                      <span className="text-text-dim px-1 text-sm font-bold">{school} <span className="num font-normal">{list.length}</span></span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => locate(schoolKey, school, school)}
                        className={cn(
                          "hover:bg-muted flex items-center justify-between rounded-lg px-1 py-1 text-left text-sm font-bold",
                          activeKey === schoolKey && "bg-primary-soft text-primary",
                        )}
                        title={`${school} 자리로 찾기`}
                      >
                        <span className="break-keep">
                          {school} <span className="num text-text-dim font-normal">{list.length}</span>
                        </span>
                        <span className="text-text-dim text-xs font-normal">{pendingKey === schoolKey ? "찾는 중…" : "학교로 찾기"}</span>
                      </button>
                    )}
                    <ul className="flex flex-col">
                      {list.map((s) => {
                        const key = `student:${s.id}`;
                        const canFind = !!(s.boardStop || s.address);
                        const pickStudent = () => {
                          // 탈 곳이 정해진 아이는 그 정류장 자리 그대로(조회 없음) — 주소보다 먼저.
                          if (s.boardStop) {
                            setMsg(null);
                            const run = runLabel.get(s.boardStop.runId);
                            // 지도에도 그 아이 회차 노선을 바로 띄운다(사용자 2026-10-26) — 호차·회차 버튼을 누른 것과 같다.
                            const vehicle = runs.find((r) => r.id === s.boardStop!.runId)?.vehicleName;
                            if (vehicle) setPick({ vehicle, runId: s.boardStop.runId });
                            setTarget({
                              key: `${key}:${Date.now()}`,
                              point: { lat: s.boardStop.lat, lng: s.boardStop.lng, label: `${s.name}${run ? ` · ${run}` : ""} · ${s.boardStop.name}` },
                            });
                          } else if (s.address) locate(key, s.address, `${s.name} 집`);
                        };
                        return (
                          <li key={s.id}>
                            <button
                              type="button"
                              disabled={!canFind}
                              onClick={pickStudent}
                              className={cn(
                                "flex min-h-11 w-full items-center justify-between gap-2 rounded-lg px-2 text-left text-sm",
                                canFind ? "hover:bg-muted cursor-pointer" : "cursor-default",
                                activeKey === key && "bg-primary-soft text-primary font-bold",
                              )}
                            >
                              <span className="truncate">
                                {s.name}
                                {s.grade ? <span className="num text-text-dim ml-1 text-xs">{s.grade}학년</span> : null}
                              </span>
                              <span className="text-text-dim shrink-0 text-xs">
                                {pendingKey === key ? "찾는 중…" : s.boardStop ? (runLabel.get(s.boardStop.runId) ?? "배정됨") : s.address ? "집 주소" : "위치 없음"}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>
      <div className="min-w-0">
        <NearbyView
          key={`${target?.key ?? "none"}#${resetN}`}
          appKey={appKey}
          academy={academy}
          stops={stops}
          // 🔑 호차·회차를 골라 둔 채 검색하면 **그 회차 안에서만** 추천한다(사용자 2026-10-26). 안 골랐으면 전체.
          runs={pickedRuns.length ? pickedRuns : runs}
          showMyLocation={false}
          wide
          initialPoint={target?.point ?? null}
          belowSearch={routeButtons}
          routeLines={routeLines}
          routeStops={routeStops}
        />
      </div>
    </div>
  );
}
