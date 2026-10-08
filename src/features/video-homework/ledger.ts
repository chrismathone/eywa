import { roundCounts, roundPairKey, type LedgerRound, type RoundStatus } from "./rounds";
import type { VideoHomeworkLedgerRow } from "./types";

export type LedgerFilters = {
  /** 고른 반들 — 비어 있으면 전체 반. */
  classIds: string[]; subject: string; school: string; grade: string; query: string;
  status: "all" | RoundStatus;
  sort: "name" | "missing" | "completion";
};
export const DEFAULT_LEDGER_FILTERS: LedgerFilters = {
  classIds: [], subject: "all", school: "all", grade: "all", query: "", status: "all", sort: "name",
};
export const ledgerPairKey = roundPairKey;
/** (반 × 학생) → 그 학생의 회차 목록(`buildLedgerRounds` 결과). 요약·필터·표·CSV가 전부 이 한 벌을 읽는다. */
export type LedgerRounds = ReadonlyMap<string, LedgerRound[]>;
const NO_ROUNDS: LedgerRound[] = [];
export const roundsOf = (rounds: LedgerRounds, row: { classId: string; studentId: string }) => rounds.get(roundPairKey(row)) ?? NO_ROUNDS;

/** 보일 회차 하나의 열쇠 — `반:학생:숙제일`. */
export const ownRoundKey = (pair: { classId: string; studentId: string }, homeworkDate: string) => `${roundPairKey(pair)}:${homeworkDate}`;

/**
 * 화면에 세울 회차만 남긴다 — 강사뷰 '영상 제출 현황'(원장 2026-10-03 *"각 강사뷰에서는 내가 출제한것만"*).
 * 🔴 판정(영상 짝·같은 날 규칙·지문)은 **전체 회차로 먼저** 하고(`buildLedgerRounds`) 보이는 칸만 거른다 — 거른 뒤에 짝을 지으면
 *    남이 낸 숙제 칸이 빠진 자리로 영상이 옮겨 붙어 관리자 화면과 판정이 갈린다. 숙제일 없는 옛 기록(c:)은 낸 사람을 몰라 빠진다.
 *    회차 번호(1회·2회)는 남은 칸끼리의 순서다.
 */
export function keepLedgerRounds(rounds: LedgerRounds, keep: ReadonlySet<string>): LedgerRounds {
  return new Map([...rounds].map(([pair, list]) => [pair, list.filter((round) => !!round.homeworkDate && keep.has(`${pair}:${round.homeworkDate}`))]));
}
export const ledgerCounts = (row: VideoHomeworkLedgerRow, rounds: LedgerRounds) => roundCounts(roundsOf(rounds, row));
/** 칸·CSV·읽어 주는 이름이 같이 쓰는 상태 글자. */
/** ▶(영상 바로가기)·'수동' 표시 — 완료 칸만. 영상이 짝지어졌으면 영상, 없으면 사람이 영상 없이 찍은 손 기록('수동'). */
export const roundSource = (round: Pick<LedgerRound, "status" | "videoId">): "video" | "manual" | null =>
  round.status !== "submitted" ? null : round.videoId ? "video" : "manual";
export const roundStatusLabel = (round: Pick<LedgerRound, "status" | "auto">) =>
  round.status === "submitted" ? (round.auto ? "완료(영상)" : "완료") : round.status === "missing" ? "미수행" : "미확인";

export function groupLedgerRows(rows: VideoHomeworkLedgerRow[], rounds: LedgerRounds) {
  const groups = new Map<string, { classId: string; className: string; subject: string; teacherName?: string | null; rows: VideoHomeworkLedgerRow[]; roundCount: number; homeworkDates: string[] }>();
  for (const row of rows) {
    const group = groups.get(row.classId) ?? { classId: row.classId, className: row.className, subject: row.subject, teacherName: row.teacherName, rows: [], roundCount: 0, homeworkDates: [] };
    group.rows.push(row);
    // 열 수 = 그 반에서 회차가 가장 많은 학생. 검색으로 학생이 가려져도 열은 그대로다.
    group.roundCount = Math.max(group.roundCount, roundsOf(rounds, row).length);
    // 반에 숙제가 나간 날 = 그 반 학생들의 숙제 날짜 합 — 빈 칸에 결석·숙제없음을 채우는 기준(no-homework.ts).
    for (const round of roundsOf(rounds, row)) if (round.homeworkDate && !group.homeworkDates.includes(round.homeworkDate)) group.homeworkDates.push(round.homeworkDate);
    groups.set(row.classId, group);
  }
  for (const group of groups.values()) group.homeworkDates.sort();
  return [...groups.values()].sort((a, b) => a.className.localeCompare(b.className, "ko"));
}
export type LedgerGroup = ReturnType<typeof groupLedgerRows>[number];

export function filterLedgerRows(rows: VideoHomeworkLedgerRow[], rounds: LedgerRounds, filters: LedgerFilters) {
  const words = filters.query.trim().toLocaleLowerCase("ko").split(/\s+/).filter(Boolean);
  const counts = new Map(rows.map((row) => [ledgerPairKey(row), ledgerCounts(row, rounds)]));
  return rows.filter((row) => {
    if (filters.classIds.length && !filters.classIds.includes(row.classId) || filters.subject !== "all" && row.subject !== filters.subject ||
      filters.school !== "all" && (row.school || "미등록") !== filters.school || filters.grade !== "all" && (row.grade || "미등록") !== filters.grade) return false;
    const haystack = `${row.studentName} ${row.className} ${row.school ?? ""} ${row.grade ?? ""} ${row.subject}`.toLocaleLowerCase("ko");
    if (!words.every((word) => haystack.includes(word))) return false;
    return filters.status === "all" || counts.get(ledgerPairKey(row))![filters.status] > 0;
  }).sort((a, b) => {
    const aCount = counts.get(ledgerPairKey(a))!;
    const bCount = counts.get(ledgerPairKey(b))!;
    if (filters.sort === "missing" && aCount.missing !== bCount.missing) return bCount.missing - aCount.missing;
    if (filters.sort === "completion") {
      const delta = aCount.submitted / (aCount.total || 1) - bCount.submitted / (bCount.total || 1);
      if (delta) return delta;
    }
    return a.studentName.localeCompare(b.studentName, "ko") || a.studentId.localeCompare(b.studentId);
  });
}

export function ledgerSummary(rows: VideoHomeworkLedgerRow[], rounds: LedgerRounds) {
  return rows.reduce((sum, row) => {
    const counts = ledgerCounts(row, rounds);
    return { submitted: sum.submitted + counts.submitted, missing: sum.missing + counts.missing, unchecked: sum.unchecked + counts.unchecked };
  }, { submitted: 0, missing: 0, unchecked: 0 });
}

export function ledgerCsv(groups: LedgerGroup[], rounds: LedgerRounds) {
  const width = Math.max(0, ...groups.map((group) => group.roundCount));
  const header = ["반", "과목", "학생", "학교", "학년", "완료", "미수행", "미확인",
    ...Array.from({ length: width }, (_, i) => [`${i + 1}회 숙제일`, `${i + 1}회 상태`, `${i + 1}회 제출일`]).flat()];
  const values = groups.flatMap((group) => group.rows.map((row) => {
    const counts = ledgerCounts(row, rounds);
    const own = roundsOf(rounds, row);
    return [row.className, row.subject, row.studentName, row.school ?? "", row.grade ?? "", counts.submitted, counts.missing, counts.unchecked,
      ...Array.from({ length: width }, (_, i) => {
        const round = own[i];
        // 숙제일을 모르는 옛 기록은 검사한 날을 적는다(없는 숙제일을 지어내지 않는다).
        return round ? [round.homeworkDate ?? `검사 ${round.date}`, roundStatusLabel(round), round.submittedDate ?? ""] : ["", "", ""];
      }).flat()];
  }));
  const escape = (value: string | number) => {
    const text = String(value);
    const safe = /^[=+@\-\t\r]/.test(text) ? `'${text}` : text;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  return "﻿" + [header, ...values].map((row) => row.map(escape).join(",")).join("\r\n");
}
