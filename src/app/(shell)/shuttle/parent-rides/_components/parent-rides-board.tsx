"use client";

import { useState, type ReactNode } from "react";

import { SHUTTLE_CHIP, SHUTTLE_CHIP_OFF, SHUTTLE_CHIP_ON, SHUTTLE_INPUT } from "@/features/shuttle/control-size";
import { matchesName } from "@/features/shuttle/name-search";

/** 호차 하나에 타는 아이 — 카드는 서버가 **그 호차 구간만** 담아 그려 넘긴다. */
export type VehicleRider = { studentId: string; card: ReactNode; inCount: number; outCount: number };

export type BoardStudent = { id: string; name: string; card: ReactNode };

export type BoardVehicle = { id: string; name: string; riders: VehicleRider[] };

type View = "all" | "byVehicle" | string; // string = 호차 id 하나만

/**
 * 학부모 등하원(관리자 뷰) 목록 — [전체] 이름순 / [호차별] 호차마다 묶음 / [N호차] 그 호차만 + **이름 검색**.
 * 🔑 등원과 하원을 다른 차로 타는 아이는 두 호차 묶음에 모두 나온다(각 묶음엔 그 호차 구간만).
 * 🔑 거르기는 화면에서만 한다 — 카드는 서버가 다 그려 두었으니 검색이 즉시 반영된다.
 */
export function ParentRidesBoard({ students, vehicles }: { students: BoardStudent[]; vehicles: BoardVehicle[] }) {
  const [view, setView] = useState<View>("all");
  const [query, setQuery] = useState("");

  const nameOf = new Map(students.map((s) => [s.id, s.name]));
  const hit = (id: string) => matchesName(nameOf.get(id) ?? "", query);
  const shownStudents = students.filter((s) => hit(s.id));
  const shownVehicles = vehicles
    .filter((v) => view === "all" || view === "byVehicle" || view === v.id)
    .map((v) => ({ ...v, riders: v.riders.filter((r) => hit(r.studentId)) }))
    .filter((v) => v.riders.length > 0 || view === v.id);
  const count = (v: BoardVehicle) => v.riders.filter((r) => hit(r.studentId)).length;

  const chip = (on: boolean) => `${SHUTTLE_CHIP} ${on ? SHUTTLE_CHIP_ON : SHUTTLE_CHIP_OFF}`;
  const empty = (
    <div className="border-line text-text-dim rounded-2xl border border-dashed p-8 text-center text-sm">
      {query ? `"${query}" 이름의 아이가 없습니다.` : "이 호차에 타는 아이가 없습니다."}
    </div>
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="아이 이름 검색 (초성도 돼요: ㄱㅁㅈ)"
          aria-label="아이 이름 검색"
          className={`${SHUTTLE_INPUT} w-full sm:w-64`}
        />
        <div role="group" aria-label="보기" className="flex flex-wrap gap-1.5">
          <button type="button" aria-pressed={view === "all"} className={chip(view === "all")} onClick={() => setView("all")}>
            전체 {shownStudents.length}
          </button>
          <button type="button" aria-pressed={view === "byVehicle"} className={chip(view === "byVehicle")} onClick={() => setView("byVehicle")}>
            호차별
          </button>
          {vehicles.map((v) => (
            <button key={v.id} type="button" aria-pressed={view === v.id} className={chip(view === v.id)} onClick={() => setView(v.id)}>
              {v.name} {count(v)}
            </button>
          ))}
        </div>
      </div>

      {view === "all" ? (
        shownStudents.length === 0 ? (
          empty
        ) : (
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {shownStudents.map((s) => (
              <div key={s.id}>{s.card}</div>
            ))}
          </div>
        )
      ) : shownVehicles.length === 0 ? (
        empty
      ) : (
        shownVehicles.map((v) => {
          const ins = v.riders.reduce((n, r) => n + r.inCount, 0);
          const outs = v.riders.reduce((n, r) => n + r.outCount, 0);
          return (
            <section key={v.id} aria-label={v.name} className="flex flex-col gap-2">
              <h2 className="border-line flex items-baseline gap-2 border-b pb-1.5 text-base font-bold">
                {v.name}
                <span className="text-text-dim text-sm font-normal">
                  {v.riders.length}명 · 등원 {ins} · 하원 {outs}
                </span>
              </h2>
              {v.riders.length === 0 ? (
                empty
              ) : (
                <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                  {v.riders.map((r) => (
                    <div key={r.studentId}>{r.card}</div>
                  ))}
                </div>
              )}
            </section>
          );
        })
      )}
    </div>
  );
}
