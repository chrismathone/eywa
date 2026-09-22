"use client";

import { Fragment, useActionState, useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, Check, Loader2, Save } from "@/components/icons/aywa-icon-compat";
import { Button } from "@/components/ui/button";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { submitAction } from "@/components/forms/submit-action";
import { examStats } from "@/features/exams/calc";
import { notApplicableReason } from "@/features/grades/applies";
import { nextGradeSort, type GradeSort, type GradeSortKey } from "@/features/grades/list-prefs";
import { saveGradeScores, type GradeSaveState } from "@/features/grades/server/actions";
import { axisValueOf } from "@/features/grades/subject-axis";
import {
  GRADE_MARK_KEYS,
  GRADE_MARK_LABEL,
  type GradeMarkKey,
  type GradeSheet,
  type GradeSheetRow,
} from "@/features/grades/types";

/**
 * 성적 입력 격자 — **반 명단 × 점수 한 열 + 성적표 받기 단계 3칸**(원장 2026-09-22).
 *
 * 🔑 값은 **학생 단위**로 든다 — 한 학생이 같은 과목 반을 둘 들으면 줄이 둘인데 학교 시험 성적은
 *    하나라서, 한쪽에 적으면 다른 줄도 **그 자리에서 같이 바뀐다**(저장 뒤에야 맞춰지면 두 번 적는다).
 * 🔑 Enter = 아래 칸으로. 숫자를 세로로 쭉 치는 화면이라 이게 기본 이동이다.
 * 🔑 체크 3칸(라벨은 `GRADE_MARK_LABEL` 단일 소스)은 **성적표를 받아 오는 과정**이다 — DB엔 누른
 *    **시각**이 남고 마우스 오버로 그 날짜를 말한다.
 * 🔑 **시험없음**(원장 2026-09-22 *"학생별 시험이 없는 학생도 존재"*)은 사람이 누르는 축이고 사유를
 *    함께 받는다. 제도상 안 치는 조합(초등·중1의 중간·기말)은 **서버가 `applies:false`로** 내려주며
 *    그런 칸은 입력·버튼 없이 `해당 없음`만 선다 — 둘은 다른 축이다(하나는 사정, 하나는 제도).
 * 🔴 머리줄과 본문의 정렬을 **열마다 같게** 맞춘다(원장 제보: "TH랑 TD랑 안 맞음") — 글자 칸은 왼쪽,
 *    숫자·체크는 가운데. 폭은 `colgroup`으로 고정해 값이 들고 나도 열이 밀리지 않는다.
 * ⚠️ 저장은 **바뀐 칸만** 서버로 간다(액션이 다시 대조한다) — 여기선 '저장 안 된 칸 N개'만 센다.
 */
export function ScoreGrid({
  sheet,
  canWrite,
  slotLabel,
  lockReason,
  sort: sortSeed,
  saveSort,
}: {
  sheet: GradeSheet;
  canWrite: boolean;
  slotLabel: string;
  /** 입력을 잠그는 한글 사유(권한 없음·마이그레이션 미적용). 없으면 입력 가능. */
  lockReason: string | null;
  /** 계정에 저장된 정렬(서버가 준 초깃값). */
  sort: GradeSort;
  /** 정렬이 바뀌면 계정에 남긴다 — 실패해도 화면은 그대로(주소는 안 바뀐다). */
  saveSort: (next: GradeSort) => Promise<{ ok: boolean }>;
}) {
  const { selection: sel, rows, marksReady, noExamReady } = sheet;
  // 메모 의존성은 **값**으로 뽑는다 — `sel.maxScore`처럼 속성을 적으면 React Compiler가 `sel` 전체로
  // 추론해 수동 메모를 못 지킨다(lint `preserve-manual-memoization`).
  const { maxScore: selMax, date: selDate, classId: selClassId, slot: selSlot } = sel;
  const locked = !canWrite || !!lockReason;

  // 학생 단위 초기값 — 같은 학생의 두 줄은 값이 같다(서버가 학생 키로 읽어 온다).
  const firstRows = useMemo(() => {
    const m = new Map<string, GradeSheetRow>();
    for (const r of rows) if (!m.has(r.studentId)) m.set(r.studentId, r);
    return m;
  }, [rows]);
  const [scores, setScores] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const [id, r] of firstRows) m[id] = r.score == null ? "" : String(r.score);
    return m;
  });
  const [marks, setMarks] = useState<Record<string, Record<GradeMarkKey, boolean>>>(() => {
    const m: Record<string, Record<GradeMarkKey, boolean>> = {};
    for (const [id, r] of firstRows) {
      m[id] = { ask1: !!r.marks.ask1, ask2: !!r.marks.ask2, received: !!r.marks.received };
    }
    return m;
  });
  const [noExam, setNoExam] = useState<Record<string, boolean>>(() => {
    const m: Record<string, boolean> = {};
    for (const [id, r] of firstRows) m[id] = r.noExam;
    return m;
  });
  const [reasons, setReasons] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const [id, r] of firstRows) m[id] = r.noExamReason ?? "";
    return m;
  });
  // 정렬은 **화면 안 상태**다 — 주소를 바꾸면 격자가 다시 마운트되어 적다 만 점수가 날아간다.
  const [sort, setSort] = useState<GradeSort>(sortSeed);
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
  // 🔴 제도상 해당 없는 칸(`applies:false`)은 세지 않는다 — 저장에도 안 실린다.
  const dirtyIds = useMemo(() => {
    const ids: string[] = [];
    for (const [id, row] of firstRows) {
      if (!row.applies) continue;
      const off = !noExam[id];
      const next = off ? (parsed.get(id) ?? null) : null;
      const scoreSame =
        next === row.score && (next === null || (row.maxScore === selMax && row.takenOn === selDate));
      const markSame = GRADE_MARK_KEYS.every((k) => !!row.marks[k] === !!marks[id]?.[k]);
      const reasonNow = off ? "" : (reasons[id] ?? "").trim();
      const noExamSame = row.noExam === !off && (row.noExamReason ?? "") === reasonNow;
      if (!scoreSame || !markSame || !noExamSame) ids.push(id);
    }
    return ids;
  }, [firstRows, parsed, marks, noExam, reasons, selMax, selDate]);

  // 반 묶음 — '전체'로 볼 때 어느 반인지 알 수 있게(반 하나만 볼 땐 머리줄을 세우지 않는다).
  // 🔴 정렬은 **묶음 안에서만** 한다(반을 섞으면 어느 반을 적고 있는지 알 수 없다).
  const { key: sortKey, dir: sortDir } = sort;
  const groups = useMemo(() => {
    const byClass = new Map<string, { className: string; rows: GradeSheetRow[] }>();
    for (const r of rows) {
      const g = byClass.get(r.classId) ?? { className: r.className, rows: [] };
      g.rows.push(r);
      byClass.set(r.classId, g);
    }
    // 🔴 Enter 이동에 쓰는 칸 번호는 **정렬한 뒤에** 붙인다 — 렌더 중에 카운터를 증가시키거나 정렬 전
    //    순서로 매기면 아래 칸이 화면과 어긋난다.
    let idx = -1;
    return [...byClass.entries()].map(([classId, g]) => ({
      classId,
      className: g.className,
      rows: sortRows(g.rows, sortKey, sortDir).map((r) => {
        idx += 1;
        return { ...r, cellIndex: idx };
      }),
    }));
  }, [rows, sortKey, sortDir]);

  // 요약은 **치는 학생만** 센다 — 초등만 있는 반에서 "입력 0/204명"은 거짓 신호다(원장 제보 화면).
  const live = useMemo(() => {
    const cells: { score: number | null; maxScore: number | null }[] = [];
    let received = 0;
    let skipped = 0;
    let people = 0;
    for (const [id, row] of firstRows) {
      if (!row.applies) continue;
      // 🔴 '시험없음'은 **분모에서도 뺀다** — 적을 수 없는 학생을 분모에 두면 `입력 8/10명`이 영영
      //    안 채워지고, 사람이 못 채운 둘을 찾아 헤맨다. 대신 옆에 `시험없음 N명`으로 따로 적는다.
      if (noExam[id]) {
        skipped += 1;
        continue;
      }
      people += 1;
      cells.push({ score: parsed.get(id) ?? null, maxScore: selMax });
      if (marks[id]?.received) received += 1;
    }
    return { stats: examStats(cells), people, received, skipped };
  }, [firstRows, parsed, marks, noExam, selMax]);

  const entriesJson = useMemo(() => {
    const out: {
      studentId: string;
      score: number | null;
      marks: Record<GradeMarkKey, boolean>;
      noExam: boolean;
      noExamReason: string | null;
    }[] = [];
    for (const [id, row] of firstRows) {
      if (!row.applies) continue; // 제도상 없는 시험은 행을 만들지 않는다
      const on = !!noExam[id];
      out.push({
        studentId: id,
        // 🔴 '시험없음'과 점수는 같이 못 선다 — 켜져 있으면 점수는 비워 보낸다.
        score: on ? null : (parsed.get(id) ?? null),
        marks: marks[id] ?? { ask1: false, ask2: false, received: false },
        noExam: on,
        noExamReason: on ? (reasons[id] ?? "").trim() || null : null,
      });
    }
    return JSON.stringify(out);
  }, [firstRows, parsed, marks, noExam, reasons]);

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

  const toggleMark = (studentId: string, key: GradeMarkKey) =>
    setMarks((prev) => {
      const cur = prev[studentId] ?? { ask1: false, ask2: false, received: false };
      return { ...prev, [studentId]: { ...cur, [key]: !cur[key] } };
    });

  const toggleNoExam = (studentId: string) => {
    const on = !noExam[studentId];
    setNoExam((prev) => ({ ...prev, [studentId]: on }));
    // 켜면 점수를 비우고, 끄면 사유를 비운다(둘이 같이 남으면 어느 쪽이 사실인지 알 수 없다).
    if (on) setScores((prev) => ({ ...prev, [studentId]: "" }));
    else setReasons((prev) => ({ ...prev, [studentId]: "" }));
  };

  const applySort = (key: GradeSortKey) => {
    const next = nextGradeSort(sort, key);
    setSort(next);
    // 저장 실패는 화면에 영향이 없다(정렬은 이미 적용됐다) — 조용히 넘긴다.
    void saveSort(next).catch(() => {});
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
      {!lockReason && !marksReady ? (
        <p className="border-amber/40 bg-amber-soft text-foreground rounded-lg border px-3 py-2 text-sm">
          성적표 받기 체크는 준비(0284a)가 적용된 뒤에 눌립니다 — 점수 입력·저장은 그대로 됩니다.
        </p>
      ) : null}
      {!lockReason && !noExamReady ? (
        <p className="border-amber/40 bg-amber-soft text-foreground rounded-lg border px-3 py-2 text-sm">
          [시험없음]은 준비(0285a)가 적용된 뒤에 눌립니다 — 점수 입력·저장은 그대로 됩니다.
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
        <span className="text-text-dim">
          {GRADE_MARK_LABEL.received}{" "}
          <span className="text-foreground num font-bold">{live.received}</span>/{live.people}명
        </span>
        {live.skipped > 0 ? (
          <span className="text-text-dim">
            시험없음 <span className="text-foreground num font-bold">{live.skipped}</span>명
          </span>
        ) : null}
        <span className="text-text-faint">
          만점 {sel.maxScore} · 시험일 {sel.date}
        </span>
      </div>

      <DragScrollArea className="bg-card shadow-card rounded-2xl">
        <table className="w-full table-fixed text-sm [&_td]:whitespace-nowrap">
          {/* 폭 고정 — 값이 들고 나도 열이 밀리지 않는다(학교만 남는 폭을 가져간다). */}
          <colgroup>
            <col className="w-40" />
            <col />
            <col className="w-20" />
            <col className="w-52" />
            <col className="w-24" />
            <col className="w-24" />
            <col className="w-24" />
          </colgroup>
          <thead className="border-line border-b [&_th]:whitespace-nowrap">
            <tr>
              <SortHead label="이름" sortKey="name" sort={sort} onSort={applySort} align="text-left" />
              <SortHead label="학교" sortKey="school" sort={sort} onSort={applySort} align="text-left" />
              <SortHead label="학년" sortKey="grade" sort={sort} onSort={applySort} align="text-left" />
              <SortHead
                label={`${slotLabel} 점수`}
                sortKey="score"
                sort={sort}
                onSort={applySort}
                align="text-center"
              />
              {GRADE_MARK_KEYS.map((k) => (
                <th key={k} className="micro px-2 py-3 text-center">
                  {GRADE_MARK_LABEL[k]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-line divide-y">
            {groups.map((g) => (
              <Fragment key={g.classId}>
                {selClassId ? null : (
                  <tr className="bg-bg-soft">
                    <td colSpan={7} className="text-foreground px-4 py-1.5 text-sm font-bold">
                      {g.className}
                      <span className="text-text-faint ml-2 text-xs font-normal">{g.rows.length}명</span>
                    </td>
                  </tr>
                )}
                {g.rows.map((r) => {
                  const myIndex = r.cellIndex;
                  const id = r.studentId;
                  const isNoExam = !!noExam[id];
                  const value = scores[id] ?? "";
                  const rowMarks = marks[id] ?? { ask1: false, ask2: false, received: false };
                  // 아직 안 적은 줄만 옅은 앰버 — '시험없음'으로 눌러 둔 줄과 제도상 없는 줄은 미기입이 아니다.
                  const missing = r.applies && !isNoExam && (parsed.get(id) ?? null) === null;
                  const naReason = r.applies ? null : notApplicableReason(selSlot, r.grade);
                  return (
                    <tr
                      key={`${g.classId}:${id}`}
                      className={
                        !r.onRoster ? "bg-bg-soft/40" : missing ? "bg-amber-soft" : "hover:bg-bg-soft/50"
                      }
                      title={r.onRoster ? undefined : "이 학기에 이 반 수강이 끝난 학생입니다"}
                    >
                      <td className="text-foreground overflow-hidden px-4 py-2 text-left font-medium text-ellipsis">
                        {r.name}
                        {r.onRoster ? null : <span className="text-text-faint ml-1.5 text-xs">종료</span>}
                      </td>
                      <td className="text-text-dim overflow-hidden px-4 py-2 text-left text-sm text-ellipsis">
                        {r.school ?? "—"}
                      </td>
                      <td className="text-text-dim px-4 py-2 text-left text-sm">{r.grade ?? "—"}</td>
                      <td className="px-3 py-1.5">
                        {!r.applies ? (
                          <div className="text-text-faint text-center text-sm" title={naReason ?? undefined}>
                            해당 없음
                            {r.score != null ? (
                              <span className="num ml-1" title="예전에 적어 둔 점수입니다">
                                ({r.score})
                              </span>
                            ) : null}
                          </div>
                        ) : (
                          <div className="flex items-center justify-center gap-1.5">
                            {isNoExam ? (
                              <input
                                type="text"
                                disabled={locked}
                                value={reasons[id] ?? ""}
                                aria-label={`${r.name} 시험없음 사유`}
                                onChange={(e) =>
                                  setReasons((prev) => ({ ...prev, [id]: e.target.value }))
                                }
                                placeholder="사유 (선택)"
                                className="border-line bg-background text-foreground focus:ring-primary/40 min-w-0 flex-1 rounded-md border px-2 py-1 text-sm focus:ring-1 focus:outline-none disabled:opacity-60"
                              />
                            ) : (
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
                                onChange={(e) => setScores((prev) => ({ ...prev, [id]: e.target.value }))}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    // 🔴 Enter로 폼이 제출되면 한 칸 적을 때마다 저장이 돈다 — 아래 칸으로만 간다.
                                    e.preventDefault();
                                    focusNext(myIndex);
                                  }
                                }}
                                placeholder="—"
                                className="border-line bg-background text-foreground num focus:ring-primary/40 min-w-0 flex-1 rounded-md border px-2 py-1 text-center text-sm focus:ring-1 focus:outline-none disabled:opacity-60"
                              />
                            )}
                            <button
                              type="button"
                              disabled={locked || !noExamReady}
                              onClick={() => toggleNoExam(id)}
                              aria-pressed={isNoExam}
                              title={
                                isNoExam
                                  ? "다시 누르면 점수를 적을 수 있습니다"
                                  : "이 학생은 이 시험을 보지 않았습니다"
                              }
                              className={`shrink-0 rounded-md border px-1.5 py-1 text-xs whitespace-nowrap disabled:opacity-50 ${
                                isNoExam
                                  ? "border-primary/40 bg-primary-soft text-primary font-bold"
                                  : "border-line bg-background text-text-dim hover:text-foreground"
                              }`}
                            >
                              시험없음
                            </button>
                          </div>
                        )}
                      </td>
                      {GRADE_MARK_KEYS.map((k) => {
                        const at = r.marks[k];
                        return (
                          <td key={k} className="px-2 py-2 text-center">
                            <input
                              type="checkbox"
                              className="accent-primary size-4 align-middle disabled:opacity-50"
                              checked={rowMarks[k]}
                              disabled={locked || !marksReady}
                              aria-label={`${r.name} ${GRADE_MARK_LABEL[k]}`}
                              title={at ? `${GRADE_MARK_LABEL[k]} ${at.slice(0, 10)}` : GRADE_MARK_LABEL[k]}
                              onChange={() => toggleMark(id, k)}
                            />
                          </td>
                        );
                      })}
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
                ? "바뀐 내용이 없습니다"
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

/**
 * 정렬 가능한 열 머리 — 누르면 오름↔내림↔해제(`nextGradeSort`).
 * ⚠️ 본문과 **같은 정렬**로 세운다(글자 열은 왼쪽, 점수는 가운데) — 버튼이 되었다고 가운데로 옮기지 말 것.
 */
function SortHead({
  label,
  sortKey,
  sort,
  onSort,
  align,
}: {
  label: string;
  sortKey: GradeSortKey;
  sort: GradeSort;
  onSort: (key: GradeSortKey) => void;
  align: string;
}) {
  const active = sort.key === sortKey;
  return (
    <th className={`micro px-4 py-3 ${align}`}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        title="눌러서 정렬"
        className={`hover:text-foreground inline-flex items-center gap-1 ${align === "text-center" ? "justify-center" : ""}`}
      >
        {label}
        {active ? (
          <span className="text-primary" aria-hidden>
            {sort.dir === "asc" ? "▲" : "▼"}
          </span>
        ) : null}
      </button>
    </th>
  );
}

/** 학년 문자열(`초6`·`중1`·`고2`)의 정렬 순서 — 초 < 중 < 고, 같은 급이면 숫자. 모르는 값은 맨 뒤. */
const GRADE_LEVEL: Record<string, number> = { 초: 0, 중: 1, 고: 2 };
function gradeRank(grade: string | null): number | null {
  const s = String(grade ?? "").replace(/\s+/g, "");
  if (!s) return null;
  const level = GRADE_LEVEL[s[0] ?? ""];
  const num = Number((s.match(/\d+/) ?? ["0"])[0]);
  if (level === undefined) return null; // `7세` 같은 값은 뒤로 — 학년 축이 아니다
  return level * 100 + (Number.isFinite(num) ? num : 0);
}

/**
 * 묶음 안 정렬. 🔴 **값이 없는 칸은 방향과 상관없이 항상 뒤로** — 내림차순을 눌렀다고 빈 칸이 맨 위에
 * 올라오면 적을 곳을 못 찾는다.
 * 🔴 점수는 **저장된 값**으로 센다(지금 치고 있는 값이 아니라) — 한 글자 칠 때마다 줄이 튀면 못 적는다.
 */
function sortRows(
  rows: readonly GradeSheetRow[],
  key: GradeSortKey | null,
  dir: "asc" | "desc",
): GradeSheetRow[] {
  if (!key) return [...rows];
  const d = dir === "desc" ? -1 : 1;
  const valueOf = (r: GradeSheetRow): string | number | null => {
    if (key === "name") return r.name;
    if (key === "school") return r.school;
    if (key === "grade") return gradeRank(r.grade);
    return r.score;
  };
  return [...rows].sort((a, b) => {
    const va = valueOf(a);
    const vb = valueOf(b);
    if (va == null && vb == null) return a.name.localeCompare(b.name, "ko");
    if (va == null) return 1;
    if (vb == null) return -1;
    const cmp =
      typeof va === "number" && typeof vb === "number"
        ? va - vb
        : String(va).localeCompare(String(vb), "ko");
    return cmp !== 0 ? cmp * d : a.name.localeCompare(b.name, "ko");
  });
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
