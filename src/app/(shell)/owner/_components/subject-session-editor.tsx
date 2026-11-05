"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, TriangleAlert } from "@/components/icons/aywa-icon-compat";
import { savePeriodsForSubject } from "@/features/periods/server/actions";
import { parsePeriodLines, formatPeriodLines } from "@/features/periods/parse";
import { suggestEndDate, verifyPeriodShape } from "@/features/periods/verify";
import { overlappingMonths } from "@/features/periods/calendar-grid";
import type { PeriodDef } from "@/features/periods/resolve";
import { SessionCalendar, type PaintedMonth } from "./session-calendar";
import { useWriteLock } from "./write-lock-context";

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
/**
 * 요약 칩 표기 — 편집 연도와 **다른 해**면 연도까지 찍는다.
 * 안 그러면 정상 12월 세션(12/1~12/26)과 전해 12월에 시작한 1월 세션(12/28~1/24)이 화면에서
 * 구분되지 않는다(formatPeriodLines가 같은 이유로 이미 그렇게 한다).
 */
const short = (iso: string, year: number) =>
  Number(iso.slice(0, 4)) === year ? `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}` : iso;

/**
 * 한 과목의 세션 기간 편집 — 구 출석부(D:\attendance) 세션 설정과 같은 모양:
 * 12개월 달력을 드래그해 칠하고, 아래 요약 칩으로 확인한다.
 *
 * ⚠️ 상위 '과목 운영' 폼(SectionForm) 안에 들어가므로 **자체 `<form>`을 두지 않는다**(중첩 form 금지).
 *    세션은 tenant_settings가 아니라 별도 테이블(0189a)이라 저장도 전용 액션으로 따로 나간다 —
 *    즉 위 '저장'과 이 '세션 저장'은 서로 다른 것을 저장한다(버튼 라벨로 구분).
 */
export function SubjectSessionEditor({
  subjectKey,
  subjectLabel,
  year,
  defs,
  holidays,
}: {
  subjectKey: string;
  subjectLabel: string;
  year: number;
  defs: PeriodDef[];
  holidays: string[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const { locked } = useWriteLock();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");

  const saved = useMemo<PaintedMonth[]>(
    () =>
      defs
        .filter((d) => d.subjectKey === subjectKey && d.classId === null && d.labelYear === year)
        .map((d) => ({ labelMonth: d.labelMonth, start: d.startDate, end: d.endDate })),
    [defs, subjectKey, year],
  );
  const [painted, setPainted] = useState<PaintedMonth[] | null>(null);
  const rows = painted ?? saved;
  const key = (list: readonly PaintedMonth[]) =>
    [...list].sort((a, b) => a.labelMonth - b.labelMonth).map((r) => `${r.labelMonth}:${r.start}:${r.end}`).join("|");
  const dirty = key(rows) !== key(saved);

  const paint = (labelMonth: number, s: string, e: string) => {
    // 겹치면 **칠하지 않고** 먼저 알린다 — DB가 EXCLUDE로 막으므로(0189a) 그대로 두면 저장 단계에서야
    // 실패한다. 같은 달을 다시 칠하는 건 교체라 겹침이 아니다.
    const clash = overlappingMonths({ labelMonth, start: s, end: e }, rows);
    if (clash.length > 0) {
      setMsg({
        ok: false,
        text: `${clash.join("·")}월 세션과 겹칩니다 — 그 달을 먼저 지우거나 시작·끝을 조정해주세요`,
      });
      return;
    }
    setMsg(null);
    setPainted([...rows.filter((r) => r.labelMonth !== labelMonth), { labelMonth, start: s, end: e }]);
  };
  const clear = (labelMonth: number) => {
    setMsg(null);
    setPainted(rows.filter((r) => r.labelMonth !== labelMonth));
  };

  /** 칠한 마지막 달 다음부터 빈 달을 "월~금 각 4회"로 이어 채운다(제안일 뿐). */
  const fillForward = () => {
    const next = [...rows];
    let cursor: string | null = null;
    let filled = 0;
    for (const m of MONTHS) {
      const has = next.find((r) => r.labelMonth === m);
      if (has) {
        cursor = has.end;
        continue;
      }
      if (!cursor) continue;
      const d = new Date(`${cursor}T00:00:00Z`);
      do {
        d.setUTCDate(d.getUTCDate() + 1);
      } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
      const s = d.toISOString().slice(0, 10);
      const e = suggestEndDate(s, holidays);
      if (!e) break;
      next.push({ labelMonth: m, start: s, end: e });
      cursor = e;
      filled++;
    }
    setPainted(next);
    setMsg(
      filled === 0
        ? { ok: false, text: "먼저 한 달을 달력에서 칠해주세요 — 그 다음 달부터 이어서 채웁니다" }
        : { ok: true, text: `${filled}개월을 채웠습니다 (저장 전이라 고치실 수 있어요)` },
    );
  };

  const applyPaste = () => {
    const r = parsePeriodLines(year, pasteText);
    if (r.rows.length === 0) {
      setMsg({ ok: false, text: r.errors[0]?.error ?? "읽을 수 있는 줄이 없습니다" });
      return;
    }
    setPainted(r.rows.map((x) => ({ labelMonth: x.labelMonth, start: x.startDate, end: x.endDate })));
    setPasteOpen(false);
    setMsg({ ok: true, text: `${r.rows.length}개월을 읽었습니다` });
  };

  const save = () => {
    const fd = new FormData();
    fd.set("subjectKey", subjectKey);
    fd.set("year", String(year));
    fd.set(
      "rows",
      JSON.stringify(rows.map((r) => ({ labelMonth: r.labelMonth, startDate: r.start, endDate: r.end }))),
    );
    start(async () => {
      const res = await savePeriodsForSubject(undefined, fd);
      if (res?.error) {
        setMsg({ ok: false, text: res.error });
        return;
      }
      setPainted(null); // 서버 값을 따라가게(저장 후 stale 방지)
      setMsg({ ok: true, text: `저장했습니다 (${res?.saved ?? 0}개월)` });
      router.refresh();
    });
  };

  const sorted = [...rows].sort((a, b) => a.labelMonth - b.labelMonth);

  return (
    <div className="space-y-3">
      {/* 연도 전환 — searchParam이라 과목 운영 면 전체가 그 해로 바뀐다(과목마다 따로 놀지 않게). */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-text-dim text-xs">연도</span>
        {[year - 1, year, year + 1].map((y) => (
          <Link
            key={y}
            href={`/owner?tab=subjects&year=${y}`}
            scroll={false}
            className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
              y === year ? "bg-primary text-primary-foreground" : "bg-card text-text-dim border-line border"
            }`}
          >
            {y}년
          </Link>
        ))}
        {dirty ? <span className="text-amber text-xs">— 연도를 바꾸면 저장 전 변경은 사라집니다</span> : null}
      </div>

      <SessionCalendar year={year} painted={rows} holidays={holidays} onPaint={paint} onClear={clear} />

      {/* 설정된 세션 요약 — 구 출석부와 달리 **월/일을 모두** 보여준다(끝 월을 알 수 없던 문제). */}
      <div className="border-line rounded-lg border p-2.5">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-text-dim text-xs font-bold">설정된 세션 ({sorted.length}개월)</span>
          {sorted.length > 0 && !locked ? (
            <button type="button" onClick={() => setPainted([])} className="text-text-faint hover:text-danger text-xs">
              전체 지우기
            </button>
          ) : null}
        </div>
        {sorted.length === 0 ? (
          <p className="text-text-faint text-xs">
            아직 없습니다 — 비워 두면 이 과목은 <b>달력월</b>로 동작합니다.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {sorted.map((r) => {
              const v = verifyPeriodShape(r.start, r.end, holidays);
              return (
                <span
                  key={r.labelMonth}
                  title={v.warning ?? v.note ?? "월~금 각 4회"}
                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${
                    v.ok ? "border-line bg-card text-text-dim" : "border-amber/40 bg-amber-soft text-amber"
                  }`}
                >
                  <b className="text-foreground">{r.labelMonth}월</b>
                  <span className="num">
                    {short(r.start, year)}~{short(r.end, year)}
                  </span>
                  {!v.ok ? <TriangleAlert className="size-3" aria-hidden /> : null}
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* 🔴 읽기 권한이면 채우기·붙여넣기·세션 저장을 그리지 않는다(원장 2026-11-05 — 저장은 운영 설정 쓰기와 같은 판정). */}
      {locked ? null : (
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" onClick={fillForward} className="border-line bg-card rounded-lg border px-2.5 py-1 text-xs font-bold">
          빈 달 이어서 채우기
        </button>
        <button
          type="button"
          onClick={() => {
            setPasteText(formatPeriodLines(sorted.map((r) => ({ labelMonth: r.labelMonth, startDate: r.start, endDate: r.end })), year));
            setPasteOpen((v) => !v);
          }}
          className="border-line bg-card text-text-dim rounded-lg border px-2.5 py-1 text-xs"
        >
          {pasteOpen ? "붙여넣기 닫기" : "글자로 입력·복사"}
        </button>
        <div className="ml-auto flex items-center gap-2">
          {msg ? (
            <span className={`text-xs ${msg.ok ? "text-green" : "text-danger"}`}>{msg.text}</span>
          ) : dirty ? (
            <span className="text-amber text-xs">저장하지 않은 변경이 있습니다</span>
          ) : null}
          <button
            type="button"
            onClick={save}
            disabled={pending || !dirty}
            className="bg-primary text-primary-foreground inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold disabled:opacity-40"
          >
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {subjectLabel} 세션 저장
          </button>
        </div>
      </div>
      )}

      {pasteOpen && !locked ? (
        <div className="border-line bg-card space-y-2 rounded-lg border p-2.5">
          <p className="text-text-dim text-xs">
            한 줄에 한 달씩 — <b>3월 3/6~4/2</b>. 전해에 시작하는 1월 세션은 <b>1월 {year - 1}-12-28~1/24</b>처럼 연도까지.
          </p>
          <textarea
            rows={6}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            className="border-border bg-card text-foreground w-full rounded-md border px-2 py-1 font-mono text-sm"
          />
          <button type="button" onClick={applyPaste} className="bg-primary text-primary-foreground rounded-lg px-3 py-1.5 text-xs font-bold">
            달력에 반영
          </button>
        </div>
      ) : null}
    </div>
  );
}
