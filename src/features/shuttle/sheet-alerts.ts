/**
 * 탑승 학생 시간표 위 알림의 **분류**(순수 · Vitest) — 사용자 2026-11-04 "수정된 내용이 뜨는 것도 추려낸 정보도 분류해서".
 * ① 차 시간과 맞지 않는 수업(빨강 · 확인으로 접는다) — 무엇 때문에 어긋났나로 넷.
 * ② 이번 주 그날만 바뀐 등하원(무채색 · 사실 목록) — 안 탐 / 다른 자리 / 그날만 추가로 탐.
 * 🔑 판정은 새로 하지 않는다 — ①은 `ride-conflicts`가 만든 줄에 종류만 붙이고, ②는 배차 카드의 `change` 표식을 모은다.
 */
import type { RunCard } from "./run-cards";
import { DIRECTION_LABEL, SHUTTLE_DAYS, type DayCode } from "./types";

export type ConflictKind = "makeup" | "changed" | "early" | "late";
export const CONFLICT_KINDS: readonly ConflictKind[] = ["makeup", "changed", "early", "late"];
export const CONFLICT_KIND_LABEL: Record<ConflictKind, string> = {
  makeup: "보강 — 차 타는 시간과 겹침",
  changed: "수업 시간 변경 — 차 타는 시간과 겹침",
  early: "등원 차 도착보다 먼저 시작하는 수업",
  late: "하원 차 출발 뒤에도 남은 수업",
};

/** 종류 순서대로 묶는다 — 빈 묶음은 안 낸다(헤더만 서는 칸이 없게). */
export function groupByKind<K extends string, T extends { kind: K }>(list: readonly T[], order: readonly K[]): { kind: K; items: T[] }[] {
  return order.map((kind) => ({ kind, items: list.filter((x) => x.kind === kind) })).filter((g) => g.items.length > 0);
}

export type DayChangeKind = "skip" | "moved" | "dayOnly";
export const DAY_CHANGE_KINDS: readonly DayChangeKind[] = ["skip", "moved", "dayOnly"];
export const DAY_CHANGE_LABEL: Record<DayChangeKind, string> = {
  skip: "그날 안 탐",
  moved: "그날만 다른 자리로",
  dayOnly: "그날만 추가로 탐",
};
export type DayChangeItem = { kind: DayChangeKind; day: DayCode; studentId: string; name: string; runCardId: string; text: string };

/**
 * 배차 카드에 찍힌 그날만 변경을 한 줄씩 — 요일 → 이름 순.
 * 🔑 자리를 옮긴 아이는 평소 카드('→ 바뀐 자리')와 바뀐 카드(그날만) 두 곳에 서는데, 목록엔 **한 줄**(옮김)만 낸다.
 */
export function dayRideChanges(cards: readonly RunCard[]): DayChangeItem[] {
  const moved = new Set<string>();
  for (const c of cards) for (const r of c.riders) if (r.change?.kind === "moved") moved.add(`${c.day}|${r.id}|${c.direction}`);
  const out: DayChangeItem[] = [];
  for (const c of cards)
    for (const r of c.riders) {
      const ch = r.change;
      if (!ch) continue;
      if (ch.kind === "dayOnly" && moved.has(`${c.day}|${r.id}|${c.direction}`)) continue;
      const where = `${DIRECTION_LABEL[c.direction]} ${c.vehicleName} ${c.runName} · ${r.stopName}${r.stopTime ? ` ${r.stopTime}` : ""}`;
      const text = ch.kind === "moved" ? `${r.name}: ${where} → ${ch.to}` : `${r.name}: ${where}`;
      out.push({ kind: ch.kind, day: c.day, studentId: r.id, name: r.name, runCardId: c.id, text });
    }
  const dayIdx = (d: DayCode) => SHUTTLE_DAYS.indexOf(d);
  return out.sort((a, b) => dayIdx(a.day) - dayIdx(b.day) || a.name.localeCompare(b.name, "ko"));
}
