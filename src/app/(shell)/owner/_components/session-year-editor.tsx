"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Loader2 } from "@/components/icons/eywa-icon-compat";
import { Button } from "@/components/ui/button";
import { FormActionBar } from "@/components/forms/form-action-bar";
import { useUnsavedGuard } from "@/components/workspace/use-unsaved-guard";
import { savePeriodsForSubject } from "@/features/periods/server/actions";
import { formatPeriodLines, parsePeriodLines } from "@/features/periods/parse";
import { findTeachingGapDays, suggestEndDate, verifyPeriodShape } from "@/features/periods/verify";
import type { PeriodDef } from "@/features/periods/resolve";
import { SessionMonthTable, type Row } from "./session-month-table";

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

export type SubjectOption = { value: string; label: string };

/**
 * 표시는 "3/6"이지만 **라벨 연도가 아닌 날짜는 연도까지** 찍는다("2025-12-28").
 * 1월 세션은 전해 12월에 시작하는 게 정상이라(세션이 28~30일 단위로 흘러간다) 연도를 버리면
 * 저장→표시→재저장 왕복에서 그 행이 한 해 뒤로 밀린다.
 */
const cell = (iso: string, year: number) => {
  if (Number(iso.slice(0, 4)) !== year) return iso;
  const [, mm, dd] = iso.split("-");
  return `${Number(mm)}/${Number(dd)}`;
};

function toRows(defs: readonly PeriodDef[], subjectKey: string, year: number): Row[] {
  const mine = defs.filter((d) => d.subjectKey === subjectKey && d.classId === null);
  return MONTHS.map((m) => {
    const hit = mine.find((d) => d.labelMonth === m);
    return { month: m, start: hit ? cell(hit.startDate, year) : "", end: hit ? cell(hit.endDate, year) : "" };
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
  const formRef = useRef<HTMLFormElement>(null);
  const pasteRef = useRef<HTMLTextAreaElement>(null);
  const [pending, startTransition] = useTransition();
  const [subject, setSubject] = useState(subjects[0]?.value ?? "");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const { markSaved } = useUnsavedGuard({ formRef });

  /**
   * 편집한 것만 담는다(키 = 연도:과목). 없으면 서버 defs에서 파생 →
   * ① 연도를 바꾸면 그 해 값이 그대로 보이고(옛 해 값이 남아 다른 해를 덮어쓰지 않는다)
   * ② 저장 성공 시 이 키를 지우면 서버 최신값을 따라간다(stale 방지).
   */
  const [draft, setDraft] = useState<Record<string, Row[]>>({});
  const dkey = `${year}:${subject}`;

  const saved = useMemo(() => toRows(defs, subject, year), [defs, subject, year]);
  const rows = useMemo(() => draft[dkey] ?? saved, [draft, dkey, saved]);
  const dirty = useMemo(() => rowsToText(rows) !== rowsToText(saved), [rows, saved]);
  const parsed = useMemo(() => parsePeriodLines(year, rowsToText(rows)), [year, rows]);

  /** 월 → 검산 결과 / 월 → 오류 문구(표는 줄 번호가 아니라 월로 읽힌다). */
  const checks = useMemo(() => {
    const m = new Map<number, ReturnType<typeof verifyPeriodShape>>();
    for (const r of parsed.rows) m.set(r.labelMonth, verifyPeriodShape(r.startDate, r.endDate, holidays));
    return m;
  }, [parsed.rows, holidays]);
  const errByMonth = useMemo(() => {
    const m = new Map<number, string>();
    for (const e of parsed.errors) if (e.labelMonth) m.set(e.labelMonth, e.error);
    return m;
  }, [parsed.errors]);

  /** 인접 세션 사이에 어느 세션에도 안 속하는 수업일이 있나(경고만). */
  const gapNote = useMemo(() => {
    const sorted = [...parsed.rows].sort((a, b) => a.labelMonth - b.labelMonth);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const next = sorted[i];
      if (next.labelMonth !== prev.labelMonth + 1) continue; // 방학으로 비운 달은 건너뜀
      const gap = findTeachingGapDays(prev.endDate, next.startDate, holidays);
      if (gap.length > 0) {
        const [, mm, dd] = gap[0].split("-");
        return `${prev.labelMonth}월과 ${next.labelMonth}월 사이 ${Number(mm)}/${Number(dd)}${gap.length > 1 ? ` 외 ${gap.length - 1}일` : ""}이 어느 세션에도 속하지 않습니다`;
      }
    }
    return null;
  }, [parsed.rows, holidays]);

  /** 다른 과목에 저장 안 된 편집이 남아 있나(저장은 현재 과목만 한다). */
  const pendingSubjects = useMemo(
    () =>
      subjects.filter(
        (s) =>
          s.value !== subject &&
          draft[`${year}:${s.value}`] &&
          rowsToText(draft[`${year}:${s.value}`]) !== rowsToText(toRows(defs, s.value, year)),
      ),
    [subjects, subject, draft, year, defs],
  );

  const write = (next: Row[], note?: { ok: boolean; text: string } | null) => {
    setDraft((d) => ({ ...d, [dkey]: next }));
    setMsg(note ?? null);
    // 컨트롤드 입력이라 폼 스냅샷이 자동으로 안 바뀐다 — 미저장 가드에 변경을 알린다.
    queueMicrotask(() => formRef.current?.dispatchEvent(new Event("input", { bubbles: true })));
  };

  const setRow = (month: number, patch: Partial<Row>) =>
    write(rows.map((r) => (r.month === month ? { ...r, ...patch } : r)));

  /** 빈 달을 직전 달 끝 다음날부터 "월~금 각 4회"로 이어서 채운다(제안일 뿐 — 저장 전 확인). */
  const fillForward = () => {
    const next = [...rows];
    let cursor: string | null = null;
    let filled = 0;
    let stoppedAt: number | null = null;
    for (let i = 0; i < next.length; i++) {
      const typed = next[i].start.trim() || next[i].end.trim();
      if (typed) {
        // ⚠️ 사람이 넣은 값은 절대 덮지 않는다. 다만 그 행이 안 읽히면 이어붙일 기준이 없으니 끊는다
        //    (깨진 행을 건너뛰고 이어 붙이면 나중에 고쳤을 때 구간이 겹쳐 저장이 거부된다).
        const line = parsePeriodLines(year, `${next[i].month}월 ${next[i].start}~${next[i].end}`);
        if (line.rows.length === 0) {
          stoppedAt = next[i].month;
          break;
        }
        cursor = line.rows[0].endDate;
        continue;
      }
      if (!cursor) continue; // 첫 달을 사람이 정하기 전엔 기준이 없다
      const d = new Date(`${cursor}T00:00:00Z`);
      do {
        d.setUTCDate(d.getUTCDate() + 1);
      } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
      const start = d.toISOString().slice(0, 10);
      const end = suggestEndDate(start, holidays);
      if (!end) break;
      next[i] = { ...next[i], start: cell(start, year), end: cell(end, year) };
      cursor = end;
      filled++;
    }
    if (filled === 0) {
      write(next, {
        ok: false,
        text: stoppedAt
          ? `${stoppedAt}월 날짜를 읽을 수 없어 멈췄습니다`
          : "먼저 한 달의 시작·끝을 넣어주세요 — 그 다음 달부터 이어서 채웁니다",
      });
      return;
    }
    write(next, {
      ok: true,
      text: `${filled}개월을 채웠습니다${stoppedAt ? ` (${stoppedAt}월에서 멈춤)` : ""} — 저장 전이라 고치실 수 있어요`,
    });
  };

  const copyFrom = (fromSubject: string) => {
    const src = draft[`${year}:${fromSubject}`] ?? toRows(defs, fromSubject, year);
    write(src.map((r) => ({ ...r })), { ok: true, text: "복사했습니다 — 저장해야 반영됩니다" }); // 깊은 복사(링크 금지)
  };

  const applyPaste = () => {
    const r = parsePeriodLines(year, pasteRef.current?.value ?? "");
    if (r.rows.length === 0) {
      setMsg({ ok: false, text: r.errors[0]?.error ?? "읽을 수 있는 줄이 없습니다" });
      return;
    }
    // 다른 해가 섞여 들어오면 조용히 채우지 않는다(그 해 시트에서 입력해야 한다).
    const alien = r.rows.find((x) => Number(x.startDate.slice(0, 4)) !== year && Number(x.startDate.slice(0, 4)) !== year - 1);
    if (alien) {
      setMsg({ ok: false, text: `${year}년 시트인데 ${alien.startDate.slice(0, 4)}년 날짜가 섞여 있습니다 — 그 해 시트에서 입력해주세요` });
      return;
    }
    setPasteOpen(false);
    write(
      MONTHS.map((m) => {
        const hit = r.rows.find((x) => x.labelMonth === m);
        return { month: m, start: hit ? cell(hit.startDate, year) : "", end: hit ? cell(hit.endDate, year) : "" };
      }),
      { ok: true, text: `${r.rows.length}개월을 읽었습니다${r.errors.length ? ` (${r.errors.length}줄은 건너뜀)` : ""}` },
    );
  };

  const save = () => {
    if (parsed.errors.length > 0) {
      const e = parsed.errors[0];
      setMsg({ ok: false, text: e.labelMonth ? `${e.labelMonth}월: ${e.error}` : e.error });
      return;
    }
    const fd = new FormData();
    fd.set("subjectKey", subject);
    fd.set("year", String(year));
    fd.set(
      "rows",
      JSON.stringify(parsed.rows.map((r) => ({ labelMonth: r.labelMonth, startDate: r.startDate, endDate: r.endDate }))),
    );
    startTransition(async () => {
      const res = await savePeriodsForSubject(undefined, fd);
      if (res?.error) {
        setMsg({ ok: false, text: res.error });
        return;
      }
      // 이 과목의 편집분을 비워 서버 최신값(router.refresh 후 defs)을 따라가게 한다.
      setDraft((d) => {
        const rest = { ...d };
        delete rest[dkey];
        return rest;
      });
      const label = subjects.find((s) => s.value === subject)?.label ?? "";
      setMsg({
        ok: true,
        text:
          `저장했습니다 (${label} ${res?.saved ?? 0}개월)` +
          (pendingSubjects.length > 0 ? ` — ${pendingSubjects.map((s) => s.label).join("·")}은 아직 저장 전입니다` : ""),
      });
      markSaved();
      router.refresh();
    });
  };

  if (subjects.length === 0) {
    return <p className="text-text-dim text-sm">먼저 과목 운영 탭에서 과목을 등록해주세요.</p>;
  }

  const status = msg ? (
    <span className={msg.ok ? "text-green" : "text-danger"}>{msg.text}</span>
  ) : parsed.errors.length > 0 ? (
    <span className="text-danger">
      {parsed.errors[0].labelMonth ? `${parsed.errors[0].labelMonth}월: ` : ""}
      {parsed.errors[0].error}
    </span>
  ) : gapNote ? (
    <span className="text-amber">{gapNote} — 의도한 것이면 그대로 저장하세요</span>
  ) : dirty ? (
    <span className="text-amber">저장하지 않은 변경이 있습니다</span>
  ) : (
    <span className="text-text-faint">세션을 비워 두면 그 달은 달력월로 동작합니다</span>
  );

  return (
    <form
      ref={formRef}
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      className="space-y-3"
    >
      <div className="toolbar-rail flex flex-wrap items-center gap-1.5">
        {subjects.map((s) => {
          const has = draft[`${year}:${s.value}`];
          const unsaved =
            has && rowsToText(has) !== rowsToText(toRows(defs, s.value, year)) && s.value !== subject;
          return (
            <button
              key={s.value}
              type="button"
              onClick={() => {
                setSubject(s.value);
                setMsg(null);
              }}
              className={`rounded-full px-3 py-1 text-xs font-bold ${
                s.value === subject ? "bg-primary text-primary-foreground" : "bg-surface text-text-dim border-line border"
              }`}
            >
              {s.label}
              {unsaved ? <span className="text-amber ml-1" aria-label="저장 안 됨">•</span> : null}
            </button>
          );
        })}
      </div>

      <SessionMonthTable rows={rows} checks={checks} errByMonth={errByMonth} onChange={setRow} />

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
            한 줄에 한 달씩. <span className="font-bold">3월 3/6~4/2</span> 처럼 쓰면 됩니다(월 라벨은 생략 가능 — 시작일의
            달로 봅니다). 전해에 시작하는 1월 세션은 <span className="font-bold">1월 {year - 1}-12-28~1/24</span>처럼 연도까지
            적어주세요.
          </p>
          <textarea
            ref={pasteRef}
            rows={6}
            defaultValue={formatPeriodLines(parsed.rows, year)}
            className="border-border bg-card text-foreground w-full rounded-md border px-2 py-1 font-mono text-sm"
          />
          <button type="button" onClick={applyPaste} className="bg-primary text-primary-foreground rounded-lg px-3 py-1.5 text-xs font-bold">
            표에 채우기
          </button>
        </div>
      ) : null}

      <FormActionBar className="justify-between">
        <div className="min-w-0 text-[12px]">{status}</div>
        <Button type="submit" disabled={pending || !dirty} className="shrink-0">
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          저장
        </Button>
      </FormActionBar>
    </form>
  );
}
