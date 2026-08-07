"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Loader2, TriangleAlert } from "@/components/icons/eywa-icon-compat";
import { savePeriodsForSubject } from "@/features/periods/server/actions";
import { formatPeriodLines, parsePeriodLines } from "@/features/periods/parse";
import { suggestEndDate, verifyPeriodShape } from "@/features/periods/verify";
import type { PeriodDef } from "@/features/periods/resolve";

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
const INPUT = "border-border bg-card text-foreground rounded-md border px-2 py-1 text-sm tabular-nums";

export type SubjectOption = { value: string; label: string };
type Row = { month: number; start: string; end: string };

const EMPTY_ROWS: Row[] = [];

const short = (iso: string) => {
  const [, mm, dd] = iso.split("-");
  return `${Number(mm)}/${Number(dd)}`;
};

function toRows(defs: readonly PeriodDef[], subjectKey: string): Row[] {
  const bySubject = defs.filter((d) => d.subjectKey === subjectKey && d.classId === null);
  return MONTHS.map((m) => {
    const hit = bySubject.find((d) => d.labelMonth === m);
    return { month: m, start: hit ? short(hit.startDate) : "", end: hit ? short(hit.endDate) : "" };
  });
}

/** 편집 중인 12행 → 파서가 읽는 텍스트. 빈 줄(방학 달)은 빠진다. */
function rowsToText(rows: readonly Row[]): string {
  return rows
    .filter((r) => r.start.trim() && r.end.trim())
    .map((r) => `${r.month}월 ${r.start.trim()}~${r.end.trim()}`)
    .join("\n");
}

export function SessionYearEditor({
  year,
  subjects,
  defs,
  holidays,
}: {
  year: number;
  subjects: SubjectOption[];
  defs: PeriodDef[];
  holidays: string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [subject, setSubject] = useState(subjects[0]?.value ?? "");
  // 과목별 편집 상태를 한 번에 들고 있어 탭 전환에 재조회가 없다(작업 중 값도 보존).
  const [draft, setDraft] = useState<Record<string, Row[]>>(() =>
    Object.fromEntries(subjects.map((s) => [s.value, toRows(defs, s.value)])),
  );
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const pasteRef = useRef<HTMLTextAreaElement>(null);

  // `?? EMPTY_ROWS` — 매 렌더 새 배열이면 아래 useMemo 의존성이 항상 바뀐다(exhaustive-deps).
  const rows = useMemo(() => draft[subject] ?? EMPTY_ROWS, [draft, subject]);
  const saved = useMemo(() => toRows(defs, subject), [defs, subject]);
  const dirty = useMemo(() => rowsToText(rows) !== rowsToText(saved), [rows, saved]);

  const parsed = useMemo(() => parsePeriodLines(year, rowsToText(rows)), [year, rows]);

  /** 월 → 검산 결과. 파싱된 행만. */
  const checks = useMemo(() => {
    const map = new Map<number, ReturnType<typeof verifyPeriodShape>>();
    for (const r of parsed.rows) map.set(r.labelMonth, verifyPeriodShape(r.startDate, r.endDate, holidays));
    return map;
  }, [parsed.rows, holidays]);

  const setRow = (month: number, patch: Partial<Row>) => {
    setMsg(null);
    setDraft((d) => ({
      ...d,
      [subject]: (d[subject] ?? []).map((r) => (r.month === month ? { ...r, ...patch } : r)),
    }));
  };

  const replaceRows = (next: Row[]) => {
    setMsg(null);
    setDraft((d) => ({ ...d, [subject]: next }));
  };

  /** 빈 달을 직전 달 끝 다음날부터 "월~금 각 4회"로 이어서 채운다(제안일 뿐 — 저장 전 확인). */
  const fillForward = () => {
    const next = [...rows];
    let cursor: string | null = null;
    for (let i = 0; i < next.length; i++) {
      const line = parsePeriodLines(year, `${next[i].month}월 ${next[i].start}~${next[i].end}`);
      if (line.rows.length > 0) {
        cursor = line.rows[0].endDate;
        continue;
      }
      if (!cursor) continue; // 첫 달을 사람이 정하기 전엔 이어붙일 기준이 없다
      const d = new Date(`${cursor}T00:00:00Z`);
      do {
        d.setUTCDate(d.getUTCDate() + 1);
      } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
      const start = d.toISOString().slice(0, 10);
      const end = suggestEndDate(start, holidays);
      if (!end) break;
      next[i] = { ...next[i], start: short(start), end: short(end) };
      cursor = end;
    }
    replaceRows(next);
  };

  const copyFrom = (fromSubject: string) => {
    const src = draft[fromSubject] ?? toRows(defs, fromSubject);
    replaceRows(src.map((r) => ({ ...r }))); // 깊은 복사 — 링크 금지
  };

  const applyPaste = () => {
    const text = pasteRef.current?.value ?? "";
    const r = parsePeriodLines(year, text);
    if (r.rows.length === 0) {
      setMsg({ ok: false, text: r.errors[0]?.error ?? "읽을 수 있는 줄이 없습니다" });
      return;
    }
    replaceRows(
      MONTHS.map((m) => {
        const hit = r.rows.find((x) => x.labelMonth === m);
        return { month: m, start: hit ? short(hit.startDate) : "", end: hit ? short(hit.endDate) : "" };
      }),
    );
    setPasteOpen(false);
    setMsg({ ok: true, text: `${r.rows.length}개월을 읽었습니다${r.errors.length ? ` (${r.errors.length}줄은 건너뜀)` : ""}` });
  };

  const save = () => {
    if (parsed.errors.length > 0) {
      setMsg({ ok: false, text: `${parsed.errors[0].lineNo}번째 줄: ${parsed.errors[0].error}` });
      return;
    }
    const fd = new FormData();
    fd.set("subjectKey", subject);
    fd.set("year", String(year));
    fd.set("rows", JSON.stringify(parsed.rows.map((r) => ({ labelMonth: r.labelMonth, startDate: r.startDate, endDate: r.endDate }))));
    startTransition(async () => {
      const res = await savePeriodsForSubject(undefined, fd);
      if (res?.error) setMsg({ ok: false, text: res.error });
      else {
        setMsg({ ok: true, text: `저장했습니다 (${res?.saved ?? 0}개월)` });
        router.refresh();
      }
    });
  };

  if (subjects.length === 0) {
    return <p className="text-text-dim text-sm">먼저 과목 운영 탭에서 과목을 등록해주세요.</p>;
  }

  return (
    <div className="space-y-3">
      {/* 과목 알약 */}
      <div className="toolbar-rail flex flex-wrap items-center gap-1.5">
        {subjects.map((s) => (
          <button
            key={s.value}
            type="button"
            onClick={() => { setSubject(s.value); setMsg(null); }}
            className={`rounded-full px-3 py-1 text-xs font-bold ${
              s.value === subject ? "bg-primary text-primary-foreground" : "bg-surface text-text-dim border-line border"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="border-line overflow-hidden rounded-xl border">
        <table className="w-full text-sm">
          <colgroup>
            <col className="w-14" />
            <col className="w-24" />
            <col className="w-24" />
            <col />
          </colgroup>
          <thead className="bg-surface text-text-dim">
            <tr>
              <th className="px-2 py-1.5 text-left text-[11px] font-bold">월</th>
              <th className="px-2 py-1.5 text-left text-[11px] font-bold">시작</th>
              <th className="px-2 py-1.5 text-left text-[11px] font-bold">끝</th>
              <th className="px-2 py-1.5 text-left text-[11px] font-bold">수업 횟수 (월~금 각 4회 기준)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const check = checks.get(r.month);
              const filled = r.start.trim() && r.end.trim();
              return (
                <tr key={r.month} className="border-line border-t">
                  <td className="text-text-dim px-2 py-1 text-[12px] font-bold">{r.month}월</td>
                  <td className="px-2 py-1">
                    <input
                      value={r.start}
                      onChange={(e) => setRow(r.month, { start: e.target.value })}
                      placeholder="3/6"
                      className={`${INPUT} w-20`}
                      aria-label={`${r.month}월 세션 시작일`}
                    />
                  </td>
                  <td className="px-2 py-1">
                    <input
                      value={r.end}
                      onChange={(e) => setRow(r.month, { end: e.target.value })}
                      placeholder="4/2"
                      className={`${INPUT} w-20`}
                      aria-label={`${r.month}월 세션 끝일`}
                    />
                  </td>
                  <td className="px-2 py-1 text-[12px]">
                    {!filled ? (
                      <span className="text-text-faint">세션 없음 (달력월로 표시됩니다)</span>
                    ) : check?.ok ? (
                      <span className="text-success inline-flex items-center gap-1">
                        <Check className="size-3.5" /> 월·화·수·목·금 각 4회
                      </span>
                    ) : check ? (
                      <span className="text-warning inline-flex items-start gap-1">
                        <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                        <span>{check.warning}</span>
                      </span>
                    ) : (
                      <span className="text-danger">날짜를 읽을 수 없습니다 (예: 3/6)</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 복사·붙여넣기 */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" onClick={fillForward} className="border-line bg-surface rounded-lg border px-2.5 py-1 text-xs font-bold">
          빈 달 이어서 채우기
        </button>
        {subjects
          .filter((s) => s.value !== subject)
          .map((s) => (
            <button
              key={s.value}
              type="button"
              onClick={() => copyFrom(s.value)}
              className="border-line bg-surface text-text-dim inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs"
            >
              <Copy className="size-3.5" /> {s.label}에서 복사
            </button>
          ))}
        <button
          type="button"
          onClick={() => setPasteOpen((v) => !v)}
          className="border-line bg-surface text-text-dim rounded-lg border px-2.5 py-1 text-xs"
        >
          {pasteOpen ? "붙여넣기 닫기" : "한 번에 붙여넣기"}
        </button>
      </div>

      {pasteOpen ? (
        <div className="border-line bg-surface space-y-2 rounded-xl border p-3">
          <p className="text-text-dim text-[12px]">
            한 줄에 한 달씩. <span className="font-bold">3월 3/6~4/2</span> 처럼 쓰면 됩니다(월 라벨은 생략 가능 — 시작일의 달로 봅니다).
          </p>
          <textarea
            ref={pasteRef}
            rows={6}
            defaultValue={formatPeriodLines(parsed.rows.map((r) => ({ labelMonth: r.labelMonth, startDate: r.startDate, endDate: r.endDate })))}
            className={`${INPUT} w-full font-mono`}
          />
          <button type="button" onClick={applyPaste} className="bg-primary text-primary-foreground rounded-lg px-3 py-1.5 text-xs font-bold">
            표에 채우기
          </button>
        </div>
      ) : null}

      {/* 저장 바 */}
      <div className="border-line bg-card sticky bottom-0 flex items-center justify-between gap-3 border-t py-2">
        <div className="min-w-0 text-[12px]">
          {msg ? (
            <span className={msg.ok ? "text-success" : "text-danger"}>{msg.text}</span>
          ) : parsed.errors.length > 0 ? (
            <span className="text-danger">
              {parsed.errors[0].lineNo}번째 줄: {parsed.errors[0].error}
            </span>
          ) : dirty ? (
            <span className="text-warning">저장하지 않은 변경이 있습니다</span>
          ) : (
            <span className="text-text-faint">세션을 비워 두면 그 달은 달력월로 동작합니다</span>
          )}
        </div>
        <button
          type="button"
          onClick={save}
          disabled={pending || !dirty}
          className="bg-primary text-primary-foreground inline-flex shrink-0 items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-bold disabled:opacity-40"
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          저장
        </button>
      </div>
    </div>
  );
}
