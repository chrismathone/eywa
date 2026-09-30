"use client";

import { useMemo, useState } from "react";
import { VideoHomeworkProvider, useVideoHomework } from "./video-homework-provider";
import { EyIcon } from "@/components/icons/aywa-icons";
import { EmbedHiddenInput } from "@/components/embed-link";
import type { VideoHomeworkMark, VideoHomeworkStatus } from "../types";
import type { VideoHomeworkHistoryRow, VideoHomeworkRosterRow } from "../server/queries";

type Filter = "all" | "unchecked" | "submitted" | "missing";
const PAGE_SIZE = 50;
const CHOICES = [
  { value: "submitted", label: "완료", symbol: "check", tone: "border-emerald-300 bg-emerald-50 text-emerald-700" },
  { value: "missing", label: "미제출", symbol: "close", tone: "border-rose-300 bg-rose-50 text-rose-700" },
] as const;
const STATUS_NAME: Record<VideoHomeworkStatus, string> = {
  submitted: "완료", missing: "미제출",
};
const pairKey = (classId: string, studentId: string) => `${classId}:${studentId}`;

function csvCell(value: string | number) {
  const text = String(value);
  const safe = /^[=+@\-\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

function downloadCsv(name: string, headers: string[], data: (string | number)[][]) {
  const csv = "\uFEFF" + [headers, ...data].map((values) => values.map(csvCell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function DownloadButton({ rows }: { rows: VideoHomeworkRosterRow[] }) {
  const { checkDate, marks } = useVideoHomework();
  return <button type="button" className="border-line bg-card hover:bg-bg-soft rounded-lg border px-3 py-2 text-xs font-semibold"
    onClick={() => {
      const byPair = new Map(marks.map((mark) => [pairKey(mark.classId, mark.studentId), mark]));
      const header = ["검사일", "직전 보고서일", "반", "과목", "학생", "학교", "학년", "영상 제출 검사"];
      const data = rows.map((row) => {
        const mark = byPair.get(pairKey(row.classId, row.studentId));
        return [checkDate, mark?.homeworkDate ?? "", row.className, row.subject, row.studentName,
          row.school ?? "", row.grade ?? "", mark ? STATUS_NAME[mark.status] : "미확인"];
      });
      downloadCsv(`eywa-video-homework-${checkDate}.csv`, header, data);
    }}>이 날짜 CSV</button>;
}

function ManagementTable({ rows, canEdit, today }: { rows: VideoHomeworkRosterRow[]; canEdit: boolean; today: string }) {
  const { checkDate, marks, pending, change } = useVideoHomework();
  const [classId, setClassId] = useState("all");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(0);
  const classes = useMemo(() => [...new Map(rows.map((row) => [row.classId, row.className])).entries()], [rows]);
  const byPair = useMemo(() => new Map(marks.map((mark) => [pairKey(mark.classId, mark.studentId), mark])), [marks]);
  const scoped = rows.filter((row) => {
    if (classId !== "all" && row.classId !== classId) return false;
    if (query && !`${row.studentName} ${row.className} ${row.school ?? ""} ${row.grade ?? ""}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())) return false;
    return true;
  });
  const visible = scoped.filter((row) => {
    const status = byPair.get(pairKey(row.classId, row.studentId))?.status;
    return filter === "all" || (filter === "unchecked" && !status) ||
      (filter === "submitted" && status === "submitted") || (filter === "missing" && status === "missing");
  });
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const paged = visible.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const checkedCount = scoped.filter((row) => byPair.has(pairKey(row.classId, row.studentId))).length;
  const submittedCount = scoped.filter((row) => {
    const status = byPair.get(pairKey(row.classId, row.studentId))?.status;
    return status === "submitted";
  }).length;

  return <div className="space-y-4">
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="border-line bg-card rounded-xl border p-4"><p className="text-text-dim text-xs">해당 수업일의 학생·반</p><strong className="text-2xl">{scoped.length}</strong><span className="text-text-dim ml-1 text-xs">건</span></div>
      <div className="border-line bg-card rounded-xl border p-4"><p className="text-text-dim text-xs">영상 제출 검사</p><strong className="text-2xl">{checkedCount}</strong><span className="text-text-dim ml-1 text-xs">/ {scoped.length}건</span></div>
      <div className="border-line bg-card rounded-xl border p-4"><p className="text-text-dim text-xs">확인한 숙제의 완료율</p><strong className="text-2xl">{checkedCount ? Math.round(submittedCount / checkedCount * 100) : 0}%</strong><span className="text-text-dim ml-1 text-xs">{submittedCount} / {checkedCount}</span></div>
    </div>
    <div className="border-line bg-card rounded-xl border p-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <form action="/lesson-reports/video-homework" method="get" className="flex items-center gap-1.5">
          <EmbedHiddenInput />
          <label htmlFor="video-homework-date" className="text-text-dim text-xs font-semibold">수업 날짜</label>
          <input id="video-homework-date" type="date" name="date" defaultValue={checkDate} max={today} className="border-line bg-card rounded-lg border px-2 py-1.5 text-sm" />
          <button type="submit" className="border-primary bg-primary text-white rounded-lg border px-3 py-1.5 text-xs font-semibold">날짜 보기</button>
        </form>
        <select aria-label="반 선택" value={classId} onChange={(event) => { setClassId(event.target.value); setPage(0); }} className="border-line bg-card rounded-lg border px-3 py-2 text-sm">
          <option value="all">전체 반</option>{classes.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <input aria-label="학생 검색" value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} placeholder="학생·반·학교 검색" className="border-line bg-card min-w-40 flex-1 rounded-lg border px-3 py-2 text-sm" />
        <select aria-label="검사 상태" value={filter} onChange={(event) => { setFilter(event.target.value as Filter); setPage(0); }} className="border-line bg-card rounded-lg border px-3 py-2 text-sm">
          <option value="all">전체 상태</option><option value="unchecked">미확인</option><option value="submitted">완료</option><option value="missing">미제출</option>
        </select>
        <DownloadButton rows={visible} />
      </div>
      <p className="text-text-dim mt-2 text-xs">회차 번호 대신 수업 날짜로 기록합니다. 강사는 원스크린에서 지난 숙제를 이 날짜에 한 번 검사합니다.</p>
    </div>
    <div className="border-line bg-card overflow-x-auto rounded-xl border shadow-sm">
      <table className="w-full min-w-[650px] border-collapse text-left text-xs">
        <thead className="bg-bg-soft text-text-dim border-line border-b"><tr>
          <th className="px-3 py-3">학생</th><th className="px-3 py-3">반·과목</th>
          <th className="px-3 py-3">직전 보고서일</th><th className="px-3 py-3">영상 제출 검사</th>
        </tr></thead>
        <tbody>{paged.map((row) => {
          const key = pairKey(row.classId, row.studentId);
          const mark = byPair.get(key);
          const busy = pending.has(key);
          return <tr key={key} className="border-line border-b last:border-b-0">
            <td className="px-3 py-2"><strong className="block">{row.studentName}</strong><span className="text-text-dim">{row.school} {row.grade}</span></td>
            <td className="px-3 py-2">{row.className} · {row.subject}</td>
            <td className="text-text-dim px-3 py-2">{mark?.homeworkDate ?? "—"}</td>
            <td className="px-3 py-2"><div className="flex flex-wrap items-center gap-1">
              {CHOICES.map((choice) => <button key={choice.value} type="button" disabled={!canEdit || busy}
                aria-pressed={mark?.status === choice.value}
                onClick={() => void change(row.classId, row.studentId, mark?.status === choice.value ? null : choice.value)}
                className={`inline-flex items-center gap-1 rounded-md border px-2 py-1.5 font-semibold disabled:opacity-50 ${mark?.status === choice.value ? choice.tone : "border-line bg-card text-text-dim hover:border-primary"}`}>
                <EyIcon name={choice.symbol} size={14} /> {choice.label}
              </button>)}
              {!mark ? <span className="text-text-faint ml-1">미확인</span> : null}
            </div></td>
          </tr>;
        })}</tbody>
      </table>
      {!paged.length && <p className="text-text-dim px-4 py-8 text-center text-sm">조건에 맞는 학생이 없습니다.</p>}
    </div>
    <div className="flex items-center justify-between text-xs"><span className="text-text-dim">{visible.length}건 중 {paged.length}건 표시</span><div className="flex items-center gap-2">
      <button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)} className="border-line rounded border px-2 py-1 disabled:opacity-40">이전</button>
      <span>{currentPage + 1} / {pageCount}</span>
      <button type="button" disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)} className="border-line rounded border px-2 py-1 disabled:opacity-40">다음</button>
    </div></div>
  </div>;
}

function HistoryTable({ rows, history, fromDate, toDate, today }: {
  rows: VideoHomeworkRosterRow[]; history: VideoHomeworkHistoryRow[]; fromDate: string; toDate: string; today: string;
}) {
  const { checkDate, marks } = useVideoHomework();
  const [classId, setClassId] = useState("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const currentPair = useMemo(() => new Map(rows.map((row) => [pairKey(row.classId, row.studentId), row])), [rows]);
  const periodMarks = useMemo(() => {
    if (checkDate < fromDate || checkDate > toDate) return history;
    return [...history.filter((row) => row.checkDate !== checkDate ||
      !currentPair.has(pairKey(row.classId, row.studentId))), ...marks.flatMap((mark): VideoHomeworkHistoryRow[] => {
      const row = currentPair.get(pairKey(mark.classId, mark.studentId));
      return row ? [{ ...row, ...mark }] : [];
    })];
  }, [checkDate, currentPair, fromDate, history, marks, toDate]);
  const groups = useMemo(() => {
    const byPair = new Map<string, { row: VideoHomeworkHistoryRow; dates: VideoHomeworkHistoryRow[] }>();
    for (const row of periodMarks) {
      const key = pairKey(row.classId, row.studentId);
      const group = byPair.get(key);
      if (group) group.dates.push(row);
      else byPair.set(key, { row, dates: [row] });
    }
    return [...byPair.values()].map((group) => ({
      ...group, dates: group.dates.sort((a, b) => b.checkDate.localeCompare(a.checkDate)),
    })).sort((a, b) => a.row.className.localeCompare(b.row.className, "ko") ||
      a.row.studentName.localeCompare(b.row.studentName, "ko"));
  }, [periodMarks]);
  const classes = useMemo(() => [...new Map(groups.map(({ row }) => [row.classId, row.className])).entries()], [groups]);
  const visible = groups.filter(({ row }) =>
    (classId === "all" || row.classId === classId) &&
    (!query || `${row.studentName} ${row.className} ${row.school ?? ""} ${row.grade ?? ""}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())));
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const paged = visible.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const completed = visible.reduce((sum, group) => sum + group.dates.filter((row) => row.status !== "missing").length, 0);
  const checked = visible.reduce((sum, group) => sum + group.dates.length, 0);

  return <section className="space-y-3" aria-label="기간별 영상 제출 집계">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h2 className="text-lg font-bold">기간별 학생 집계</h2>
        <p className="text-text-dim text-xs">검사일이 실제 수업 날짜입니다. 날짜별 결과를 펼쳐 볼 수 있습니다.</p></div>
      <form action="/lesson-reports/video-homework" method="get" className="flex flex-wrap items-center gap-2">
        <EmbedHiddenInput />
        <input type="hidden" name="date" value={checkDate} />
        <label className="text-text-dim text-xs font-semibold">시작일 <input type="date" name="from" defaultValue={fromDate} max={today}
          className="border-line bg-card ml-1 rounded-lg border px-2 py-1.5 text-sm" /></label>
        <label className="text-text-dim text-xs font-semibold">종료일 <input type="date" name="to" defaultValue={toDate} max={today}
          className="border-line bg-card ml-1 rounded-lg border px-2 py-1.5 text-sm" /></label>
        <button type="submit" className="border-primary bg-primary rounded-lg border px-3 py-1.5 text-xs font-semibold text-white">기간 조회</button>
      </form>
    </div>
    <div className="border-line bg-card rounded-xl border p-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="기간 집계 반 선택" value={classId} onChange={(event) => { setClassId(event.target.value); setPage(0); }}
          className="border-line bg-card rounded-lg border px-3 py-2 text-sm">
          <option value="all">전체 반</option>{classes.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <input aria-label="기간 집계 학생 검색" value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }}
          placeholder="학생·반·학교 검색" className="border-line bg-card min-w-40 flex-1 rounded-lg border px-3 py-2 text-sm" />
        <span className="text-text-dim text-xs">{visible.length}명·반 · 제출 {completed}/{checked}회 검사</span>
        <button type="button" className="border-line bg-card hover:bg-bg-soft rounded-lg border px-3 py-2 text-xs font-semibold"
          onClick={() => downloadCsv(`eywa-video-homework-summary-${fromDate}-${toDate}.csv`,
            ["반", "과목", "학생", "학교", "학년", "검사 횟수", "완료", "미제출", "제출 합계"],
            visible.map(({ row, dates }) => [row.className, row.subject, row.studentName, row.school ?? "", row.grade ?? "",
              dates.length, dates.filter((item) => item.status === "submitted").length,
              dates.filter((item) => item.status === "missing").length,
              dates.filter((item) => item.status !== "missing").length]))}>집계 CSV</button>
        <button type="button" className="border-line bg-card hover:bg-bg-soft rounded-lg border px-3 py-2 text-xs font-semibold"
          onClick={() => downloadCsv(`eywa-video-homework-dates-${fromDate}-${toDate}.csv`,
            ["검사일", "직전 보고서일", "반", "과목", "학생", "학교", "학년", "검사 결과"],
            visible.flatMap(({ dates }) => dates.map((row) => [row.checkDate, row.homeworkDate ?? "", row.className,
              row.subject, row.studentName, row.school ?? "", row.grade ?? "", STATUS_NAME[row.status]])))}>날짜별 CSV</button>
      </div>
    </div>
    <div className="border-line bg-card overflow-x-auto rounded-xl border shadow-sm">
      <table className="w-full min-w-[650px] border-collapse text-left text-xs">
        <thead className="bg-bg-soft text-text-dim border-line border-b"><tr>
          <th className="px-3 py-3">학생</th><th className="px-3 py-3">반·과목</th><th className="px-3 py-3">검사</th>
          <th className="px-3 py-3">완료</th><th className="px-3 py-3">미제출</th><th className="px-3 py-3">날짜별 기록</th>
        </tr></thead>
        <tbody>{paged.map(({ row, dates }) => <tr key={pairKey(row.classId, row.studentId)} className="border-line border-b last:border-b-0">
          <td className="px-3 py-2"><strong className="block">{row.studentName}</strong><span className="text-text-dim">{row.school} {row.grade}</span></td>
          <td className="px-3 py-2">{row.className} · {row.subject}</td>
          <td className="px-3 py-2 font-semibold">{dates.length}회</td>
          <td className="px-3 py-2 text-emerald-700">{dates.filter((item) => item.status === "submitted").length}회</td>
          <td className="px-3 py-2 text-rose-700">{dates.filter((item) => item.status === "missing").length}회</td>
          <td className="px-3 py-2"><details><summary className="text-primary cursor-pointer font-semibold">날짜 보기</summary>
            <ul className="mt-1 space-y-1">{dates.map((item) => <li key={item.checkDate}>
              {item.checkDate} · {STATUS_NAME[item.status]}{item.homeworkDate ? ` · 직전 보고서 ${item.homeworkDate}` : ""}
            </li>)}</ul></details></td>
        </tr>)}</tbody>
      </table>
      {!visible.length && <p className="text-text-dim px-4 py-8 text-center text-sm">기간 내 검사 기록이 없습니다.</p>}
    </div>
    <div className="flex items-center justify-between text-xs"><span className="text-text-dim">{visible.length}명·반 중 {paged.length}명·반 표시</span><div className="flex items-center gap-2">
      <button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)} className="border-line rounded border px-2 py-1 disabled:opacity-40">이전</button>
      <span>{currentPage + 1} / {pageCount}</span>
      <button type="button" disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)} className="border-line rounded border px-2 py-1 disabled:opacity-40">다음</button>
    </div></div>
  </section>;
}

export function VideoHomeworkManagement({ rows, marks, history, checkDate, fromDate, toDate, today, canEdit }: {
  rows: VideoHomeworkRosterRow[]; marks: VideoHomeworkMark[]; history: VideoHomeworkHistoryRow[];
  checkDate: string; fromDate: string; toDate: string; today: string; canEdit: boolean;
}) {
  return <VideoHomeworkProvider key={checkDate} initial={marks} checkDate={checkDate}>
    <ManagementTable rows={rows} canEdit={canEdit} today={today} />
    <HistoryTable key={`${fromDate}:${toDate}`} rows={rows} history={history} fromDate={fromDate} toDate={toDate} today={today} />
  </VideoHomeworkProvider>;
}
