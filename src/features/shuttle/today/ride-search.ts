/**
 * 오늘 등하원 **학생 찾아가기**(순수 · Vitest) — 사용자 2026-10-20 *"아이들 검색을 통해 해당 아이열을 빠르게
 * 셀랙해서 갈수있도록"*.
 *
 * 🔑 거르는 검색이 아니라 **찾아가는 검색**이다 — 고르면 그 학생의 호차로 바꾸고 그 줄로 스크롤한다. 목록을 좁히면
 *    같은 회차의 다른 아이들이 사라져 "이 정류장에 몇 명 남았나"를 놓친다.
 * 🔑 판정은 출석부 검색과 **같은 함수**(`matchesStudentSearch`) — 두 화면이 같은 검색어에 다른 답을 내지 않게.
 * ⚠️ 한 학생이 그날 여러 회차를 타면(등원·하원) 줄마다 하나씩 낸다 — 무엇을 찾는지는 사람이 고른다.
 * ⚠️ 오늘 안 타는 줄(회색)도 낸다 — 화면에 남아 있는 줄이고, "왜 안 타지?"를 찾으러 오는 경우가 많다.
 */
import { isSearchActive, matchesStudentSearch } from "@/features/attendance/student-search";
import type { Direction } from "../types";
import { firstTime, type VehicleGroup } from "./today-board";

export type RideHit = {
  /** 줄 키(`RideRow.key`) — 화면이 `data-ride-key`로 찾아 스크롤한다. */
  rowKey: string;
  runId: string;
  /** 호차 칸 키 — 고르면 이 호차로 토글을 옮긴다. */
  vehicleKey: string;
  vehicleName: string;
  studentName: string;
  /** "침산초4" — 동명이인을 가른다. 모르면 빈 문자열. */
  schoolGrade: string;
  stopName: string;
  /** 그 줄 시각, 없으면 회차 첫 시각. */
  time: string;
  ioKind: Direction;
};

/** 검색 결과 상한 — 폰 화면에 다 들어가는 수. 그 이상은 글자를 더 치게 한다. */
export const RIDE_SEARCH_LIMIT = 8;

/** 검색어에 맞는 줄 — 호차·시각 순(화면에 놓인 순서 그대로). */
export function searchRides(groups: readonly VehicleGroup[], query: string): RideHit[] {
  if (!isSearchActive(query)) return [];
  const out: RideHit[] = [];
  for (const g of groups) {
    for (const { run, rows } of g.runs) {
      const runTime = firstTime(run);
      for (const r of rows) {
        if (!matchesStudentSearch(query, [r.studentName])) continue;
        out.push({
          rowKey: r.key,
          runId: run.id,
          vehicleKey: g.key,
          vehicleName: g.vehicleName,
          studentName: r.studentName,
          schoolGrade: r.schoolGrade ?? "",
          stopName: r.stopName,
          time: r.atTime?.slice(0, 5) || runTime,
          ioKind: r.ioKind,
        });
        if (out.length >= RIDE_SEARCH_LIMIT) return out;
      }
    }
  }
  return out;
}
