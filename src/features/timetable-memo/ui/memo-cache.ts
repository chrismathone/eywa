"use client";

import type { SheetDoc } from "../doc";

/**
 * 이 문서(탭)에서 **마지막으로 저장한 판 · 지금 보내는 중인 판** — 지점×과목마다 한 벌.
 * 🔴 왜: Next는 뒤로/앞으로 가기에서 서버가 예전에 준 화면 데이터를 그대로 다시 쓴다. 그러면 방금 저장한 판보다
 *    옛 판(옛 version)이 열리고, 다음 저장이 "다른 분이 먼저 저장"으로 걸리며, 덮어쓰기를 고르면 **내 저장이 지워진다**
 *    (적대 리뷰 2026-10-19). 열 때 서버 판과 견줘 **더 새것**으로 시작한다.
 * 화면을 떠나며 보낸 저장이 아직 안 끝났으면(보내는 중) 그 판으로 시작하고, 그 저장이 끝날 때까지 다음 저장을 기다린다.
 * 페이지를 새로 불러오면 비워진다(그땐 서버 판이 늘 최신이다).
 */
export type SavedSheet = { doc: SheetDoc; version: number; updatedAt: string | null };
/** 보내는 중 — `base`는 그 저장이 기대한 version, `done`은 성공하면 새 version · 실패면 null. */
export type SheetFlight = { doc: SheetDoc; base: number; done: Promise<number | null> };

const latest = new Map<string, SavedSheet>();
const flights = new Map<string, SheetFlight>();

export function rememberSaved(key: string, entry: SavedSheet) {
  const cur = latest.get(key);
  if (!cur || entry.version >= cur.version) latest.set(key, entry);
}

export function trackFlight(key: string, flight: SheetFlight) {
  flights.set(key, flight);
  void flight.done.finally(() => {
    if (flights.get(key) === flight) flights.delete(key);
  });
}

/**
 * 열 때 시작할 판 — 보내는 중인 판(가장 새 편집) → 이 탭의 마지막 저장 판(서버 것보다 version이 높을 때) → 서버 판.
 * 보내는 중이면 `flight`도 함께 준다(그 결과로 version을 맞춘 뒤에야 저장을 연다).
 */
export function startingSheet(
  key: string,
  server: SavedSheet,
): SavedSheet & { flight: Promise<number | null> | null } {
  const saved = latest.get(key);
  const best = saved && saved.version > server.version ? saved : server;
  const flight = flights.get(key);
  if (flight && flight.base >= best.version) return { doc: flight.doc, version: flight.base, updatedAt: best.updatedAt, flight: flight.done };
  return { ...best, flight: null };
}
