"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { EyIcon } from "@/components/icons/aywa-icons";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { DEFAULT_LEDGER_FILTERS, filterLedgerRows, groupLedgerRows, keepLedgerRounds, ledgerCsv, ledgerPairKey, ledgerSummary, teacherLedgerKeep, type LedgerFilters } from "../ledger";
import { buildLedgerRounds } from "../rounds";
import type { BlankFacts } from "../no-homework";
import type { VideoArrival, VideoHomeworkLedgerRow, VideoHomeworkMark } from "../types";
import { useLedgerMarks } from "./use-ledger-marks";
import { useLedgerRefresh } from "./ledger-refresh";
import { ClassLedger } from "./class-ledger";
import { LedgerToolbar } from "./ledger-toolbar";
import { RoundEditor, type ActiveCell } from "./round-editor";
import { LedgerVideoDialog } from "./ledger-video-dialog";
import { VideoAssignmentDialog } from "./video-assignment-dialog";
import { IssueMenu, type IssueMenuTarget } from "./issue-menu";
import styles from "./video-homework-management.module.css";

const NO_VIDEOS: VideoArrival[] = [];
const NO_FACTS: BlankFacts = {};
const unique = (values: string[]) => [...new Set(values)].sort((a, b) => a.localeCompare(b, "ko", { numeric: true })).map((value) => ({ value, label: value }));

/** 미확인으로 지웠지만 숙제로 남은 칸(`반:학생:숙제일`, use-ledger-marks.ts)을 그 줄의 옮겨 남긴 숙제로 더한다 — 서버 값을 다시 받기 전에도 칸이 선다. */
function withKept(rows: VideoHomeworkLedgerRow[], kept: ReadonlySet<string>): VideoHomeworkLedgerRow[] {
  if (!kept.size) return rows;
  const byPair = new Map<string, string[]>();
  for (const key of kept) {
    const cut = key.lastIndexOf(":");
    byPair.set(key.slice(0, cut), [...(byPair.get(key.slice(0, cut)) ?? []), key.slice(cut + 1)]);
  }
  return rows.map((row) => {
    const dates = byPair.get(ledgerPairKey(row))?.filter((date) => !row.assignedDates.includes(date));
    return dates?.length ? { ...row, assignedDates: [...row.assignedDates, ...dates].sort(), kept: [...(row.kept ?? []), ...dates].sort() } : row;
  });
}

export function VideoHomeworkManagement({ rows: serverRows, initialMarks, videos = NO_VIDEOS, blankFacts = NO_FACTS, videosKnown = true, showTeacher = false, fromDate, toDate, today, initialFilters = DEFAULT_LEDGER_FILTERS, keepRounds, teacherRounds, teacherOptions }: {
  rows: VideoHomeworkLedgerRow[]; initialMarks: VideoHomeworkMark[]; videos?: VideoArrival[]; blankFacts?: BlankFacts; videosKnown?: boolean;
  showTeacher?: boolean;
  fromDate: string; toDate: string; today: string; initialFilters?: LedgerFilters;
  /** 보일 회차(`반:학생:숙제일`, `ownRoundKey`) — 주면 그 칸만 세운다(강사뷰 = 내가 낸 숙제). 없으면 전부(관리자 화면). */
  keepRounds?: readonly string[];
  /** 관리자 화면 강사 필터 — 강사 id → 그 강사가 낸 칸(`ownRoundKey`). 선택지가 없으면(강사뷰) 필터도 없다. */
  teacherRounds?: Readonly<Record<string, readonly string[]>>;
  teacherOptions?: { value: string; label: string }[];
}) {
  const [filters, setFilters] = useState(initialFilters);
  const query = useDeferredValue(filters.query);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [active, setActive] = useState<ActiveCell | null>(null);
  const [playing, setPlaying] = useState<ActiveCell | null>(null);
  // 영상 배정 창 — 칸에서 열면 그 칸의 숙제일을 먼저 골라 둔다.
  const [assigning, setAssigning] = useState<{ row: VideoHomeworkLedgerRow; date?: string } | null>(null);
  const refresh = useLedgerRefresh();
  const { marks, kept, progress, save } = useLedgerMarks(initialMarks, refresh);
  const rows = useMemo(() => withKept(serverRows, kept), [serverRows, kept]);
  // 숙제없음 칸의 '숙제 출제' · 따로 낸 숙제 칸의 '출제 취소'(원장 2026-10-13) — 처리와 새로고침은 메뉴가 한다.
  const [menu, setMenu] = useState<IssueMenuTarget | null>(null);
  const busy = progress !== null;
  // 회차·완료 판정은 한 벌 — 표·요약·필터·CSV가 전부 이 결과를 읽는다(저장 직후에도 같은 규칙으로 다시 센다).
  // 관리자 화면에서 강사를 고르면 그 강사가 낸 칸만 — 강사뷰의 keepRounds와 같은 열쇠라 그 강사의 강사뷰와 같은 칸이 선다.
  // 🔴 선택지에 없는 강사(출제 취소·기록 저장 뒤 새로고침으로 사라짐)는 전체로 본다 — 사용자 id가 드롭다운·주소에 남지 않게.
  const teacher = teacherOptions?.some((option) => option.value === filters.teacher) ? filters.teacher : "all";
  const byTeacher = useMemo(() => (keepRounds ? null : teacherLedgerKeep(teacherRounds, teacher)), [keepRounds, teacherRounds, teacher]);
  const keep = useMemo(() => (keepRounds ? new Set(keepRounds) : byTeacher?.keys ?? null), [keepRounds, byTeacher]);
  // 판정은 전체 회차로 먼저 하고, 보일 칸만 거른다(keepLedgerRounds — 거른 뒤 짝을 지으면 관리자 화면과 판정이 갈린다).
  const allRounds = useMemo(() => buildLedgerRounds({ rows, marks: marks.values(), videos, fromDate, toDate }), [rows, marks, videos, fromDate, toDate]);
  const rounds = useMemo(() => (keep ? keepLedgerRounds(allRounds, keep) : allRounds), [allRounds, keep]);
  // 배정 창의 '자동 연결됨' — 거르기 전 칸으로(강사뷰에서 동료가 낸 숙제에 붙은 영상도) · 기간 밖 숙제까지(장부는 기간 앞뒤를 넓혀 읽어 짝을
  // 짓고 화면에만 기간 안 칸을 세운다 — 기간 안 칸만 보면 9/29 숙제에 붙은 10/2 영상이 '연결 안 됨'으로 보인다, 2026-10-15). 같은 재료 · 기간만 풀어서.
  const linked = useMemo(() => {
    if (!assigning) return undefined;
    const pair = buildLedgerRounds({ rows, marks: marks.values(), videos, fromDate: "0000-01-01", toDate: "9999-12-31" }).get(ledgerPairKey(assigning.row)) ?? [];
    return new Map(pair.flatMap((round) => round.videoId && round.homeworkDate ? [[round.videoId, round.homeworkDate] as const] : []));
  }, [assigning, rows, marks, videos]);
  // 강사를 고르면 그 강사가 낸 칸이 있는 반 × 학생만 — 대상 외 학생은 남은 칸이 있을 때만 선다(강사뷰 page.tsx와 같은 규칙).
  const shownRows = useMemo(() => (byTeacher
    ? rows.filter((row) => byTeacher.pairs.has(ledgerPairKey(row)) && (row.tracked || !!rounds.get(ledgerPairKey(row))?.length))
    : rows), [rows, byTeacher, rounds]);
  const groups = useMemo(() => groupLedgerRows(shownRows, rounds), [shownRows, rounds]);
  // 지금 걸린 필터 — 고른 반 중 목록에 없는 반(강사를 바꿨거나 새로고침으로 사라짐)은 뺀다('반 N개'인데 목록이 비는 일이 없게).
  // 표·툴바·주소는 전부 이 값을 읽고, 다음에 필터를 바꿀 때 이 값 위에 쓴다(`update`) — 사라진 강사·반이 상태에 남았다가
  // 나중에 저절로 다시 걸리지 않게.
  const shown = useMemo(() => {
    const classIds = filters.classIds.filter((id) => groups.some((group) => group.classId === id));
    return classIds.length === filters.classIds.length && teacher === filters.teacher ? filters : { ...filters, classIds, teacher };
  }, [filters, groups, teacher]);
  const visible = useMemo(() => filterLedgerRows(shownRows, rounds, { ...shown, query }), [shownRows, rounds, shown, query]);
  const classCounts = useMemo(() => {
    const byClass = new Map<string, number>();
    for (const row of filterLedgerRows(shownRows, rounds, { ...shown, query, classIds: [] })) byClass.set(row.classId, (byClass.get(row.classId) ?? 0) + 1);
    return byClass;
  }, [shownRows, rounds, shown, query]);
  const visibleGroups = useMemo(() => {
    const byClass = new Map<string, VideoHomeworkLedgerRow[]>();
    for (const row of visible) byClass.set(row.classId, [...(byClass.get(row.classId) ?? []), row]);
    return groups.flatMap((group) => byClass.get(group.classId)?.length ? [{ ...group, rows: byClass.get(group.classId)! }] : []);
  }, [groups, visible]);
  // 과목·학교·학년 선택지도 거른 줄에서 — 강사를 고르면 그 강사가 다루지 않는 과목은 안 선다.
  const options = useMemo(() => ({ subjects: unique(shownRows.map((row) => row.subject)),
    schools: unique(shownRows.map((row) => row.school || "미등록")), grades: unique(shownRows.map((row) => row.grade || "미등록")), teachers: teacherOptions ?? [] }), [shownRows, teacherOptions]);
  const summary = ledgerSummary(visible, rounds);
  const filterKey = JSON.stringify(shown);
  function update<K extends keyof LedgerFilters>(key: K, value: LedgerFilters[K]) {
    setFilters((current) => ({ ...current, classIds: shown.classIds, teacher: shown.teacher, [key]: value }));
  }
  useEffect(() => {
    // 이 화면의 필터는 계정에 저장하지 않는다 — 주소에만 남긴다(새로고침·링크 공유용).
    const timer = setTimeout(() => {
      const url = new URL(window.location.href);
      const values = { class: shown.classIds.join(","), subject: shown.subject, school: shown.school, grade: shown.grade, q: shown.query.trim(), status: shown.status, sort: shown.sort, teacher: shown.teacher };
      for (const [key, value] of Object.entries(values)) {
        if (!value || value === "all" || key === "sort" && value === "name") url.searchParams.delete(key);
        else url.searchParams.set(key, value);
      }
      url.searchParams.set("from", fromDate); url.searchParams.set("to", toDate);
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    }, 250);
    return () => clearTimeout(timer);
  }, [shown, fromDate, toDate]);
  function download() {
    const url = URL.createObjectURL(new Blob([ledgerCsv(visibleGroups, rounds)], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `영상숙제-${fromDate}-${toDate}.csv`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <div className={styles.ledger} aria-busy={busy}>
    <LedgerToolbar filters={shown} update={update} reset={() => setFilters({ ...DEFAULT_LEDGER_FILTERS })}
      classes={groups.map((group) => ({ value: group.classId, label: group.className, count: classCounts.get(group.classId) ?? 0 }))}
      options={options} fromDate={fromDate} toDate={toDate} today={today} busy={busy} onDownload={visible.length ? download : null} />
    <div className={styles.summary} aria-live="polite"><span>검색 결과 <strong>{visible.length}</strong>명·반 <span className={styles.dim}>/ {shownRows.length}</span></span>
      <span className={styles.green}>완료 <strong>{summary.submitted}</strong>회</span><span className={styles.red}>미수행 <strong>{summary.missing}</strong>회</span><span className={styles.amber}>미확인 <strong>{summary.unchecked}</strong>회</span>
      <div className={styles.expandActions}><button type="button" onClick={() => setCollapsed(new Set())}>모두 펼치기</button><button type="button" onClick={() => setCollapsed(new Set(visibleGroups.map((group) => group.classId)))}>모두 접기</button></div>
    </div>
    <p className={styles.hint}>수업보고서에 영상 과제가 나간 수업과 따로 낸 숙제만 회차로 셉니다 — 1회·2회는 학생마다의 순서라 같은 회차도 날짜가 다를 수 있습니다.
      칸 위 날짜 = 숙제가 나간 날 · <EyIcon name="check" size={12} className="inline-block align-middle" /> 뒤 날짜 = 제출일 · 날짜 없이 완료 = 제출일 미기록 · ▶ = 영상 재생 · 초록 테두리 = 영상으로 자동 완료(반이 확인된 영상만 자동으로 셉니다) · × 미수행 · 미확인 = 숙제가 나갔는데 아직 확인 전. 미확인 칸을 누르면 오늘 날짜로 완료됩니다.</p>
    {byTeacher ? <p className={styles.hint}>강사를 고르면 그 강사가 낸 숙제 칸만 셉니다(그 강사의 강사뷰와 같은 칸) — 숙제를 낸 사람을 모르는 옛 기록은 &lsquo;전체 강사&rsquo;에서만 보입니다.</p> : null}
    {progress ? <p className={styles.saving} role="status">기록 저장 중 {progress.done} / {progress.total}건</p> : null}
    {visibleGroups.length ? visibleGroups.map((group) => <ClassLedger key={`${group.classId}:${filterKey}`} group={group} rounds={rounds} blankFacts={blankFacts} videosKnown={videosKnown} showTeacher={showTeacher} today={today} busy={busy} save={save} onEdit={setActive} onPlay={setPlaying} onAssign={(row) => setAssigning({ row })} onIssueMenu={setMenu}
      collapsed={collapsed.has(group.classId)} onToggle={() => setCollapsed((current) => { const next = new Set(current); if (next.has(group.classId)) next.delete(group.classId); else next.add(group.classId); return next; })} />)
      : <div className={styles.empty}><strong>{shownRows.length ? "조건에 맞는 학생이 없습니다." : "조회 기간에 영상 과제가 나간 수업이 없습니다."}</strong><p>{shownRows.length ? "검색어와 필터를 조정해 주세요." : "원스크린에서 '영상 과제'를 켜고 저장한 수업부터 회차가 생깁니다."}</p></div>}
    <Dialog open={active !== null} onOpenChange={(open) => { if (!open && !busy) setActive(null); }}>
      <DialogContent showCloseButton={!busy}>
        {active ? <RoundEditor key={`${ledgerPairKey(active.row)}:${active.round.key}`} cell={active} today={today} busy={busy} save={save} onClose={() => setActive(null)}
          // 영상이 없는 칸에서 열면 그 숙제를 골라 둔다(그 칸에 붙이려고 연 것이다). 영상이 붙은 칸의 '배정 변경'은 옮길 곳을 고르는 것이라 종전대로.
          onAssign={() => { setAssigning({ row: active.row, date: active.round.videoId ? undefined : active.round.homeworkDate ?? undefined }); setActive(null); }} /> : null}
      </DialogContent>
    </Dialog>
    <LedgerVideoDialog cell={playing} video={playing ? videos.find((video) => video.id === playing.round.videoId
      && video.studentId === playing.row.studentId && video.classId === playing.row.classId) ?? null : null} onClose={() => setPlaying(null)} />
    {menu ? <IssueMenu key={`${ledgerPairKey(menu.row)}:${menu.kind}:${menu.date}`} target={menu} onClose={() => setMenu(null)} /> : null}
    {assigning ? <VideoAssignmentDialog key={`${ledgerPairKey(assigning.row)}:${assigning.date ?? ""}`} row={assigning.row} initialDate={assigning.date}
      fromDate={fromDate} toDate={toDate} onClose={() => setAssigning(null)} linked={linked} /> : null}
  </div>;
}
