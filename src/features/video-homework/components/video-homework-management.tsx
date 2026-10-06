"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { EyIcon } from "@/components/icons/aywa-icons";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { DEFAULT_LEDGER_FILTERS, filterLedgerRows, groupLedgerRows, keepLedgerRounds, ledgerCsv, ledgerPairKey, ledgerSummary, type LedgerFilters } from "../ledger";
import { buildLedgerRounds } from "../rounds";
import type { BlankFacts } from "../no-homework";
import type { VideoArrival, VideoHomeworkLedgerRow, VideoHomeworkMark } from "../types";
import { useLedgerMarks } from "./use-ledger-marks";
import { ClassLedger } from "./class-ledger";
import { LedgerToolbar } from "./ledger-toolbar";
import { RoundEditor, type ActiveCell } from "./round-editor";
import { LedgerVideoDialog } from "./ledger-video-dialog";
import styles from "./video-homework-management.module.css";

const NO_VIDEOS: VideoArrival[] = [];
const NO_FACTS: BlankFacts = {};
const unique = (values: string[]) => [...new Set(values)].sort((a, b) => a.localeCompare(b, "ko", { numeric: true })).map((value) => ({ value, label: value }));

export function VideoHomeworkManagement({ rows, initialMarks, videos = NO_VIDEOS, blankFacts = NO_FACTS, videosKnown = true, fromDate, toDate, today, initialFilters = DEFAULT_LEDGER_FILTERS, keepRounds }: {
  rows: VideoHomeworkLedgerRow[]; initialMarks: VideoHomeworkMark[]; videos?: VideoArrival[]; blankFacts?: BlankFacts; videosKnown?: boolean;
  fromDate: string; toDate: string; today: string; initialFilters?: LedgerFilters;
  /** 보일 회차(`반:학생:숙제일`, `ownRoundKey`) — 주면 그 칸만 세운다(강사뷰 = 내가 낸 숙제). 없으면 전부(관리자 화면). */
  keepRounds?: readonly string[];
}) {
  const [filters, setFilters] = useState(initialFilters);
  const query = useDeferredValue(filters.query);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [active, setActive] = useState<ActiveCell | null>(null);
  const [playing, setPlaying] = useState<ActiveCell | null>(null);
  const { marks, progress, save } = useLedgerMarks(initialMarks);
  const busy = progress !== null;
  // 회차·완료 판정은 한 벌 — 표·요약·필터·CSV가 전부 이 결과를 읽는다(저장 직후에도 같은 규칙으로 다시 센다).
  const keep = useMemo(() => (keepRounds ? new Set(keepRounds) : null), [keepRounds]);
  // 판정은 전체 회차로 먼저 하고, 보일 칸만 거른다(keepLedgerRounds — 거른 뒤 짝을 지으면 관리자 화면과 판정이 갈린다).
  const rounds = useMemo(() => {
    const all = buildLedgerRounds({ rows, marks: marks.values(), videos, fromDate, toDate });
    return keep ? keepLedgerRounds(all, keep) : all;
  }, [rows, marks, videos, fromDate, toDate, keep]);
  const groups = useMemo(() => groupLedgerRows(rows, rounds), [rows, rounds]);
  const visible = useMemo(() => filterLedgerRows(rows, rounds, { ...filters, query }), [rows, rounds, filters, query]);
  const classCounts = useMemo(() => {
    const byClass = new Map<string, number>();
    for (const row of filterLedgerRows(rows, rounds, { ...filters, query, classIds: [] })) byClass.set(row.classId, (byClass.get(row.classId) ?? 0) + 1);
    return byClass;
  }, [rows, rounds, filters, query]);
  const visibleGroups = useMemo(() => {
    const byClass = new Map<string, VideoHomeworkLedgerRow[]>();
    for (const row of visible) byClass.set(row.classId, [...(byClass.get(row.classId) ?? []), row]);
    return groups.flatMap((group) => byClass.get(group.classId)?.length ? [{ ...group, rows: byClass.get(group.classId)! }] : []);
  }, [groups, visible]);
  const options = useMemo(() => ({ subjects: unique(rows.map((row) => row.subject)),
    schools: unique(rows.map((row) => row.school || "미등록")), grades: unique(rows.map((row) => row.grade || "미등록")) }), [rows]);
  const summary = ledgerSummary(visible, rounds);
  const filterKey = JSON.stringify(filters);
  function update<K extends keyof LedgerFilters>(key: K, value: LedgerFilters[K]) { setFilters((current) => ({ ...current, [key]: value })); }
  useEffect(() => {
    // 이 화면의 필터는 계정에 저장하지 않는다 — 주소에만 남긴다(새로고침·링크 공유용).
    const timer = setTimeout(() => {
      const url = new URL(window.location.href);
      const values = { class: filters.classIds.join(","), subject: filters.subject, school: filters.school, grade: filters.grade, q: filters.query.trim(), status: filters.status, sort: filters.sort };
      for (const [key, value] of Object.entries(values)) {
        if (!value || value === "all" || key === "sort" && value === "name") url.searchParams.delete(key);
        else url.searchParams.set(key, value);
      }
      url.searchParams.set("from", fromDate); url.searchParams.set("to", toDate);
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    }, 250);
    return () => clearTimeout(timer);
  }, [filters, fromDate, toDate]);
  function download() {
    const url = URL.createObjectURL(new Blob([ledgerCsv(visibleGroups, rounds)], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `영상숙제-${fromDate}-${toDate}.csv`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <div className={styles.ledger} aria-busy={busy}>
    <LedgerToolbar filters={filters} update={update} reset={() => setFilters({ ...DEFAULT_LEDGER_FILTERS })}
      classes={groups.map((group) => ({ value: group.classId, label: group.className, count: classCounts.get(group.classId) ?? 0 }))}
      options={options} fromDate={fromDate} toDate={toDate} today={today} busy={busy} onDownload={visible.length ? download : null} />
    <div className={styles.summary} aria-live="polite"><span>검색 결과 <strong>{visible.length}</strong>명·반 <span className={styles.dim}>/ {rows.length}</span></span>
      <span className={styles.green}>완료 <strong>{summary.submitted}</strong>회</span><span className={styles.red}>미수행 <strong>{summary.missing}</strong>회</span><span className={styles.amber}>미확인 <strong>{summary.unchecked}</strong>회</span>
      <div className={styles.expandActions}><button type="button" onClick={() => setCollapsed(new Set())}>모두 펼치기</button><button type="button" onClick={() => setCollapsed(new Set(visibleGroups.map((group) => group.classId)))}>모두 접기</button></div>
    </div>
    <p className={styles.hint}>수업보고서에 영상 과제가 나간 수업만 회차로 셉니다 — 1회·2회는 학생마다의 순서라 같은 회차도 날짜가 다를 수 있습니다.
      칸 위 날짜 = 숙제가 나간 날 · <EyIcon name="check" size={12} className="inline-block align-middle" /> 뒤 날짜 = 제출일 · <span className={styles.autoTag}>영상</span> = 학부모 영상 도착으로 자동 완료(반이 확인된 영상만 자동으로 셉니다) · × 미수행 · 미확인 = 숙제가 나갔는데 아직 확인 전. 미확인 칸을 누르면 오늘 날짜로 완료됩니다.</p>
    {progress ? <p className={styles.saving} role="status">기록 저장 중 {progress.done} / {progress.total}건</p> : null}
    {visibleGroups.length ? visibleGroups.map((group) => <ClassLedger key={`${group.classId}:${filterKey}`} group={group} rounds={rounds} blankFacts={blankFacts} videosKnown={videosKnown} today={today} busy={busy} save={save} onEdit={setActive} onPlay={setPlaying}
      collapsed={collapsed.has(group.classId)} onToggle={() => setCollapsed((current) => { const next = new Set(current); if (next.has(group.classId)) next.delete(group.classId); else next.add(group.classId); return next; })} />)
      : <div className={styles.empty}><strong>{rows.length ? "조건에 맞는 학생이 없습니다." : "조회 기간에 영상 과제가 나간 수업이 없습니다."}</strong><p>{rows.length ? "검색어와 필터를 조정해 주세요." : "원스크린에서 '영상 과제'를 켜고 저장한 수업부터 회차가 생깁니다."}</p></div>}
    <Dialog open={active !== null} onOpenChange={(open) => { if (!open && !busy) setActive(null); }}>
      <DialogContent showCloseButton={!busy}>
        {active ? <RoundEditor key={`${ledgerPairKey(active.row)}:${active.round.key}`} cell={active} today={today} busy={busy} save={save} onClose={() => setActive(null)} /> : null}
      </DialogContent>
    </Dialog>
    <LedgerVideoDialog cell={playing} video={playing ? videos.find((video) => video.id === playing.round.videoId
      && video.studentId === playing.row.studentId && video.classId === playing.row.classId) ?? null : null} onClose={() => setPlaying(null)} />
  </div>;
}
