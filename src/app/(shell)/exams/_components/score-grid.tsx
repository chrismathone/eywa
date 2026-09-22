"use client";

import { Fragment, useActionState, useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, Check, Loader2, Save } from "@/components/icons/aywa-icon-compat";
import { Button } from "@/components/ui/button";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { submitAction } from "@/components/forms/submit-action";
import { examStats, rankByScore } from "@/features/exams/calc";
import { pct } from "@/lib/calc/grades";
import { saveGradeScores, type GradeSaveState } from "@/features/grades/server/actions";
import { axisValueOf } from "@/features/grades/subject-axis";
import type { GradeSheet, GradeSheetRow } from "@/features/grades/types";

/**
 * 성적 입력 격자 — **반 명단 × 점수 한 열**(원장 2026-09-22 선택: *"시험 하나씩 한 열"*).
 *
 * 🔑 값은 **학생 단위**로 든다 — 한 학생이 같은 과목 반을 둘 들으면 줄이 둘인데 학교 시험 성적은
 *    하나라서, 한쪽에 적으면 다른 줄도 **그 자리에서 같이 바뀐다**(저장 뒤에야 맞춰지면 사람이
 *    두 번 적는다).
 * 🔑 Enter = 아래 칸으로. 숫자를 세로로 쭉 치는 화면이라 이게 기본 이동이다.
 * ⚠️ 저장은 **바뀐 칸만** 서버로 간다(액션이 다시 대조한다) — 여기선 '저장 안 된 칸 N개'만 센다.
 */
export function ScoreGrid({
  sheet,
  canWrite,
  slotLabel,
  lockReason,
}: {
  sheet: GradeSheet;
  canWrite: boolean;
  slotLabel: string;
  /** 입력을 잠그는 한글 사유(권한 없음·0281a 미적용). 없으면 입력 가능. */
  lockReason: string | null;
}) {
  const { selection: sel, rows } = sheet;
  // 메모 의존성은 **값**으로 뽑는다 — `sel.maxScore`처럼 속성을 적으면 React Compiler가 `sel` 전체로
  // 추론해 수동 메모를 못 지킨다(lint `preserve-manual-memoization`).
  const { maxScore: selMax, date: selDate, classId: selClassId } = sel;
  const locked = !canWrite || !!lockReason;

  // 학생 단위 초기값 — 같은 학생의 두 줄은 값이 같다(서버가 학생 키로 읽어 온다).
  const initial = useMemo(() => {
    const m: Record<string, string> = {};
    for (const r of rows) if (!(r.studentId in m)) m[r.studentId] = r.score == null ? "" : String(r.score);
    return m;
  }, [rows]);
  const [scores, setScores] = useState<Record<string, string>>(initial);
  const [state, formAction] = useActionState<GradeSaveState, FormData>(saveGradeScores, undefined);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);

  const parsed = useMemo(() => {
    const out = new Map<string, number | null>();
    for (const id of Object.keys(scores)) {
      const t = (scores[id] ?? "").trim();
      out.set(id, t === "" ? null : Number.isFinite(Number(t)) ? Number(t) : null);
    }
    return out;
  }, [scores]);

  // 저장 대상(=바뀐 칸) — 서버와 같은 판정으로 센다(다르면 "저장했는데 그대로"가 된다).
  const dirtyIds = useMemo(() => {
    const seen = new Map<string, GradeSheetRow>();
    for (const r of rows) if (!seen.has(r.studentId)) seen.set(r.studentId, r);
    const ids: string[] = [];
    for (const [id, row] of seen) {
      const next = parsed.get(id) ?? null;
      const same =
        next === row.score &&
        (next === null || (row.maxScore === selMax && row.takenOn === selDate));
      if (!same) ids.push(id);
    }
    return ids;
  }, [rows, parsed, selMax, selDate]);

  // 반 묶음 — '전체'로 볼 때 어느 반인지 알 수 있게(반 하나만 볼 땐 머리줄을 세우지 않는다).
  const groups = useMemo(() => {
    const byClass = new Map<string, { className: string; rows: GradeSheetRow[] }>();
    for (const r of rows) {
      const g = byClass.get(r.classId) ?? { className: r.className, rows: [] };
      g.rows.push(r);
      byClass.set(r.classId, g);
    }
    // 🔴 Enter 이동에 쓰는 칸 번호는 **여기서 붙인다** — 렌더 중에 카운터를 증가시키면 컴파일러가 JSX를
    //    메모했을 때 번호가 어긋난다(엉뚱한 칸으로 점프).
    let idx = -1;
    return [...byClass.entries()].map(([classId, g]) => ({
      classId,
      className: g.className,
      // 석차는 **반 안에서** 매긴다(반을 섞어 세우면 학교가 다른 학생끼리 줄 세우는 꼴).
      rows: rankByScore(g.rows.map((r) => ({ ...r, score: parsed.get(r.studentId) ?? null }))).map((r) => {
        idx += 1;
        return { ...r, cellIndex: idx };
      }),
    }));
  }, [rows, parsed]);

  const live = useMemo(() => {
    const seen = new Set<string>();
    const cells: { score: number | null; maxScore: number | null }[] = [];
    for (const r of rows) {
      if (seen.has(r.studentId)) continue; // 같은 학생을 두 번 세지 않는다
      seen.add(r.studentId);
      cells.push({ score: parsed.get(r.studentId) ?? null, maxScore: selMax });
    }
    return { stats: examStats(cells), people: seen.size };
  }, [rows, parsed, selMax]);

  const entriesJson = useMemo(() => {
    const seen = new Set<string>();
    const out: { studentId: string; score: number | null }[] = [];
    for (const r of rows) {
      if (seen.has(r.studentId)) continue;
      seen.add(r.studentId);
      out.push({ studentId: r.studentId, score: parsed.get(r.studentId) ?? null });
    }
    return JSON.stringify(out);
  }, [rows, parsed]);

  const focusNext = (index: number) => {
    for (let i = index + 1; i < inputs.current.length; i += 1) {
      const el = inputs.current[i];
      if (el && !el.disabled) {
        el.focus();
        el.select();
        return;
      }
    }
  };

  return (
    <form onSubmit={(e) => submitAction(e, formAction)} className="space-y-3">
      <input type="hidden" name="year" value={sel.year} />
      <input type="hidden" name="term" value={sel.term} />
      <input type="hidden" name="subject" value={axisValueOf(sel)} />
      <input type="hidden" name="class" value={sel.classId ?? ""} />
      <input type="hidden" name="slot" value={sel.slot} />
      <input type="hidden" name="date" value={sel.date} />
      <input type="hidden" name="max" value={sel.maxScore} />
      <input type="hidden" name="entries" value={entriesJson} />

      {lockReason ? (
        <p className="border-amber/40 bg-amber-soft text-foreground rounded-lg border px-3 py-2 text-sm">
          {lockReason}
        </p>
      ) : null}

      <div className="bg-bg-soft border-line flex flex-wrap items-center gap-4 rounded-xl border px-4 py-2.5 text-sm">
        <span className="text-text-dim">
          입력 <span className="text-foreground num font-bold">{live.stats.count}</span>/{live.people}명
        </span>
        <span className="text-text-dim">
          평균 <span className="text-foreground num font-bold">{live.stats.avg ?? "—"}</span>
          {live.stats.avgPct != null ? <span className="text-text-faint"> ({live.stats.avgPct}%)</span> : null}
        </span>
        <span className="text-text-dim">
          최고 <span className="text-foreground num font-bold">{live.stats.max ?? "—"}</span>
        </span>
        <span className="text-text-dim">
          최저 <span className="text-foreground num font-bold">{live.stats.min ?? "—"}</span>
        </span>
        <span className="text-text-faint">만점 {sel.maxScore} · 시험일 {sel.date}</span>
      </div>

      <DragScrollArea className="bg-card shadow-card rounded-2xl">
        <table className="w-full text-sm [&_td]:whitespace-nowrap">
          <thead className="border-line border-b [&_th]:whitespace-nowrap">
            <tr>
              <th className="micro px-4 py-3 text-center">이름</th>
              <th className="micro px-4 py-3 text-center">학교</th>
              <th className="micro px-4 py-3 text-center">학년</th>
              <th className="micro px-4 py-3 text-center">{slotLabel} 점수</th>
              <th className="micro px-4 py-3 text-center">백분율</th>
              <th className="micro px-4 py-3 text-center">반 석차</th>
            </tr>
          </thead>
          <tbody className="divide-line divide-y">
            {groups.map((g) => (
              <Fragment key={g.classId}>
                {selClassId ? null : (
                  <tr className="bg-bg-soft">
                    <td colSpan={6} className="text-foreground px-4 py-1.5 text-sm font-bold">
                      {g.className}
                      <span className="text-text-faint ml-2 text-xs font-normal">{g.rows.length}명</span>
                    </td>
                  </tr>
                )}
                {g.rows.map((r) => {
                  const myIndex = r.cellIndex;
                  const value = scores[r.studentId] ?? "";
                  const p = pct(parsed.get(r.studentId) ?? null, selMax);
                  return (
                    <tr
                      key={`${g.classId}:${r.studentId}`}
                      className={r.onRoster ? "hover:bg-bg-soft/50" : "bg-bg-soft/40"}
                      title={r.onRoster ? undefined : "이 학기에 이 반 수강이 끝난 학생입니다"}
                    >
                      <td className="text-foreground px-4 py-2 text-left font-medium">
                        {r.name}
                        {r.onRoster ? null : <span className="text-text-faint ml-1.5 text-xs">종료</span>}
                      </td>
                      <td className="text-text-dim px-4 py-2 text-left text-sm">{r.school ?? "—"}</td>
                      <td className="text-text-dim px-4 py-2 text-left text-sm">{r.grade ?? "—"}</td>
                      <td className="px-4 py-1.5 text-center">
                        <input
                          ref={(el) => {
                            inputs.current[myIndex] = el;
                          }}
                          type="number"
                          inputMode="decimal"
                          step="0.5"
                          min="0"
                          max={selMax}
                          disabled={locked}
                          value={value}
                          aria-label={`${r.name} ${slotLabel} 점수`}
                          onChange={(e) =>
                            setScores((prev) => ({ ...prev, [r.studentId]: e.target.value }))
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              // 🔴 Enter로 폼이 제출되면 한 칸 적을 때마다 저장이 돈다 — 아래 칸으로만 간다.
                              e.preventDefault();
                              focusNext(myIndex);
                            }
                          }}
                          placeholder="—"
                          className="border-line bg-background text-foreground num focus:ring-primary/40 w-24 rounded-md border px-2 py-1 text-center text-sm focus:ring-1 focus:outline-none disabled:opacity-60"
                        />
                      </td>
                      <td className="text-text-dim num px-4 py-2 text-center text-sm">
                        {p == null ? "—" : `${p}%`}
                      </td>
                      <td className="text-text-dim num px-4 py-2 text-center text-sm">
                        {r.rank == null ? "—" : `${r.rank}위`}
                      </td>
                    </tr>
                  );
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
      </DragScrollArea>

      {locked ? null : (
        /* 하단 고정 저장 바 — `.sticky-save-bar` 마커가 셸의 main 하단 패딩을 없앤다([[#110]]). */
        <div className="sticky-save-bar border-line/60 bg-card sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-end gap-3 border-t px-4 py-3">
          {state?.error ? (
            <p className="text-danger inline-flex items-center gap-1.5 text-sm">
              <AlertCircle className="size-4" />
              {state.error}
            </p>
          ) : state?.ok && dirtyIds.length === 0 ? (
            <p className="text-green inline-flex items-center gap-1.5 text-sm">
              <Check className="size-4" />
              {state.saved === 0 && state.cleared === 0
                ? "바뀐 점수가 없습니다"
                : `저장했습니다 (${state.saved ?? 0}칸${state.cleared ? ` · ${state.cleared}칸 지움` : ""})`}
            </p>
          ) : null}
          <span className="text-text-dim text-sm">
            저장 안 된 칸 <span className="text-foreground num font-bold">{dirtyIds.length}</span>개
          </span>
          <SaveButton disabled={dirtyIds.length === 0} />
        </div>
      )}
    </form>
  );
}

function SaveButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || disabled}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
      점수 저장
    </Button>
  );
}
