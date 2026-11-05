"use client";

import { SheetText } from "@/features/teacher-view/interface-label";

import { useActionState, useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, Check, Loader2, Save } from "@/components/icons/aywa-icon-compat";
import { EyIcon } from "@/components/icons/aywa-icons";
import { Button } from "@/components/ui/button";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { submitAction } from "@/components/forms/submit-action";
import { examStats } from "@/features/exams/calc";
import { gradeSortRank } from "@/features/grades/grade-rank";
import { nextGradeSort, type GradeSort, type GradeSortKey } from "@/features/grades/list-prefs";
import { saveGradeScores, type GradeSaveState } from "@/features/grades/server/actions";
import { axisValueOf } from "@/features/grades/subject-axis";
import { monthlyFromTodaysMath, planMonthlyFill, type TodaysMathMonthly } from "@/features/grades/todays-math-monthly";
import { writeLockedNote, writeLockedPlaceholder } from "@/lib/write-lock";
import {
  GRADE_MARK_LABEL,
  gradeMarkKeysFor,
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
 *    함께 받는다. 제도상 안 치는 조합(초등·중1의 중간·기말)은 **서버가 목록에서 아예 뺀다**
 *    (원장 2026-09-22: 회색으로 칠해 두면 적을 줄을 눈으로 골라내야 한다) — 여기 오는 줄은 전부
 *    그 시험을 치는 학생이다.
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
  todaysMath,
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
  /** 같은 달 오늘 수학 월말평가 결과(개발 중 · 학원 설정 토글). null이면 '채우기' 단추가 없다. */
  todaysMath?: TodaysMathMonthly | null;
}) {
  const { selection: sel, rows, marksReady, noExamReady } = sheet;
  // 메모 의존성은 **값**으로 뽑는다 — `sel.maxScore`처럼 속성을 적으면 React Compiler가 `sel` 전체로
  // 추론해 수동 메모를 못 지킨다(lint `preserve-manual-memoization`).
  const { maxScore: selMax, date: selDate, slot: selSlot } = sel;
  const locked = !canWrite || !!lockReason;
  // 🔑 **권한 때문에** 잠긴 칸만 placeholder로 권한을 말한다(원장 2026-11-05, write-lock.ts) — 마이그레이션 미적용으로
  //    잠긴 칸(`lockReason`만 있음)은 권한 문제가 아니라 원래 placeholder 그대로 둔다.
  const lockedPlaceholder = canWrite ? null : writeLockedPlaceholder("exams");
  // 🔴 표식 열은 **시험마다 다르다**(월말평가 = 1차상담 하나, 원장 2026-09-23). 모듈 상수를 돌려주는
  //    순수 함수라 메모가 필요 없다. 감춘 열의 DB 값은 건드리지 않는다(저장은 바뀐 것만 쓴다).
  const markKeys = gradeMarkKeysFor(selSlot);

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
  /** 붙여넣기 결과 한 줄 — 몇 칸을 채웠고 무엇을 건너뛰었는지(조용히 흘리지 않는다). */
  const [pasteNote, setPasteNote] = useState<string | null>(null);
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
      const markSame = markKeys.every((k) => !!row.marks[k] === !!marks[id]?.[k]);
      const reasonNow = off ? "" : (reasons[id] ?? "").trim();
      const noExamSame = row.noExam === !off && (row.noExamReason ?? "") === reasonNow;
      if (!scoreSame || !markSame || !noExamSame) ids.push(id);
    }
    return ids;
  }, [firstRows, parsed, marks, noExam, reasons, selMax, selDate, markKeys]);

  /*
   * 🔴 **묶음은 없다**(원장 2026-09-22 저녁: *"묶음 자체를 없애고 학년을 디폴트로"*) — 묶으면 정렬이
   *    묶음 안에서만 걸려 "학년 오름차순"을 눌러도 화면 전체로는 그렇게 안 보인다. 반만 보고 싶으면
   *    툴바의 반 드롭다운이 그 일을 한다. 🔴 되살리지 말 것.
   * 🔴 Enter 이동에 쓰는 칸 번호는 **정렬한 뒤에** 붙인다(정렬 전 순서로 매기면 아래 칸이 어긋난다).
   */
  const { key: sortKey, dir: sortDir } = sort;
  const visibleRows = useMemo(
    () => sortRows(rows, sortKey, sortDir).map((r, i) => ({ ...r, cellIndex: i })),
    [rows, sortKey, sortDir],
  );
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
      marks: Partial<Record<GradeMarkKey, boolean>>;
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
        // 🔴 **세운 열만** 싣는다 — 감춘 열(월말평가의 2차상담·성적확인)을 false로 보내면 서버가
        //    '끔'으로 읽어 적어 둔 표식을 지운다(적대적 리뷰 2026-09-23).
        marks: Object.fromEntries(markKeys.map((k) => [k, !!marks[id]?.[k]])),
        noExam: on,
        noExamReason: on ? (reasons[id] ?? "").trim() || null : null,
      });
    }
    return JSON.stringify(out);
  }, [firstRows, parsed, marks, noExam, reasons, markKeys]);

  /** 위·아래 칸으로 — Enter는 아래, 방향키는 양쪽(숫자를 세로로 치는 화면의 기본 이동). */
  const focusStep = (index: number, step: 1 | -1) => {
    for (let i = index + step; i >= 0 && i < inputs.current.length; i += step) {
      const el = inputs.current[i];
      if (el && !el.disabled) {
        el.focus();
        el.select();
        return;
      }
    }
  };

  /**
   * 🔑 **여러 값 붙여넣기** — 인쇄된 성적표·엑셀 한 열을 그대로 붙이면 이 칸부터 아래로 채운다.
   *    줄바꿈·탭·쉼표 어느 것으로 끊겨 있어도 받는다(사람이 어디서 복사해 오는지 우리가 못 정한다).
   * ⚠️ 값이 하나뿐이면 브라우저 기본 동작에 맡긴다(한 칸 붙여넣기까지 가로채면 되돌리기가 깨진다).
   */
  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>, index: number) => {
    const text = e.clipboardData.getData("text");
    const values = text
      .split(/[\s,]+/)
      .map((t) => t.trim())
      .filter((t) => t !== "");
    if (values.length < 2) return;
    e.preventDefault();
    const order = visibleRows.slice(index).filter((r) => !noExam[r.studentId]);
    // 🔴 집계는 **updater 밖에서** 미리 한다 — `setScores(prev => …)` 안에서 세면 그 함수가 나중에(또는
    //    StrictMode에서 두 번) 불려 안내 문구가 0이거나 두 배가 된다(codex 리뷰 2026-09-22).
    const usable = Math.min(values.length, order.length);
    const applied: Record<string, string> = {};
    let skipped = 0;
    for (let i = 0; i < usable; i += 1) {
      const v = values[i]!;
      const row = order[i]!;
      if (Number.isFinite(Number(v))) applied[row.studentId] = v;
      else skipped += 1;
    }
    const filled = Object.keys(applied).length;
    setScores((prev) => ({ ...prev, ...applied }));
    // 🔴 건너뛴 값을 조용히 흘리지 않는다 — 대량 붙여넣기에서 한두 칸이 빈 것은 눈으로 못 찾는다.
    //    줄이 모자라 못 넣은 것(overflow)과 숫자가 아니어서 건너뛴 것(skipped)은 **다른 사실**이다.
    const overflow = values.length - usable;
    setPasteNote(
      [
        `${filled}칸 채웠습니다`,
        skipped > 0 ? `숫자가 아닌 값 ${skipped}개는 건너뜀` : null,
        overflow > 0 ? `남은 줄이 없어 ${overflow}개는 못 넣음` : null,
      ]
        .filter(Boolean)
        .join(" · "),
    );
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

  // 오늘 수학 월말평가 채우기 — 빈 칸만 · 만점이 같을 때만(todays-math-monthly.ts). 저장은 평소처럼 아래 저장 단추.
  const monthlyPlan = todaysMath ? planMonthlyFill(todaysMath, rows, { scores, noExam }, selMax) : null;
  const fillFromTodaysMath = () => {
    if (!monthlyPlan) return;
    const n = Object.keys(monthlyPlan.fill).length;
    setScores((prev) => ({ ...prev, ...monthlyPlan.fill }));
    setPasteNote(`오늘 수학 결과로 ${n}칸 채웠습니다 — 확인 후 저장하세요`);
  };

  const applySort = (key: GradeSortKey) => {
    const next = nextGradeSort(sort, key);
    setSort(next);
    // 저장 실패는 화면에 영향이 없다(정렬은 이미 적용됐다) — 조용히 넘긴다.
    void saveSort(next).catch(() => {});
  };

  return (
    // 🔴 폭 상한은 두지 않는다 — 창을 **가득 채우되** 열 비율로 벌린다(원장 2026-09-22:
    //    "페이지는 가득차야지 가득차되 벌리는거지"). 빈 공간은 폭 없는 열이 독식할 때 생긴다.
    // 🔴 세로는 **flex 기둥**이다(등록상담 목록뷰 선례) — 배너·요약·저장 바는 제 높이를 갖고 표가
    //    남는 높이를 전부 가져가 그 안에서 스크롤한다. `max-h`를 dvh 계산으로 박으면 ① 툴바가 한 줄
    //    접힌 만큼 표 아래 빈 띠가 남고 ② 스크롤 자체가 안 된다(그 높이는 DragScrollArea의 **바깥**
    //    `overflow-hidden` 껍데기에 붙어, 진짜 스크롤러인 안쪽 `h-full`이 높이를 못 받고 내용만큼
    //    늘어난 뒤 바깥이 잘라 내기만 했다 — 원장 2026-09-23 *"스크롤이 안되는뎈ㅋㅋㅋ"*).
    <form onSubmit={(e) => submitAction(e, formAction)} className="flex min-h-0 w-full flex-1 flex-col gap-3">
      <input type="hidden" name="year" value={sel.year} />
      <input type="hidden" name="term" value={sel.term} />
      <input type="hidden" name="subject" value={axisValueOf(sel)} />
      <input type="hidden" name="class" value={sel.classId ?? ""} />
      <input type="hidden" name="slot" value={sel.slot} />
      <input type="hidden" name="date" value={sel.date} />
      <input type="hidden" name="max" value={sel.maxScore} />
      <input type="hidden" name="entries" value={entriesJson} />

      {/* 읽기 권한이면 점수가 차 있는 칸은 placeholder가 안 보인다 — 격자 위에 안내 한 줄(writeLockedNote). */}
      {!canWrite || lockReason ? (
        <p className="border-amber/40 bg-amber-soft text-foreground rounded-lg border px-3 py-2 text-sm">
          {canWrite ? lockReason : writeLockedNote("exams")}
        </p>
      ) : null}
      {!lockReason && !marksReady ? (
        <p className="border-amber/40 bg-amber-soft text-foreground rounded-lg border px-3 py-2 text-sm">
          <SheetText value={"성적표 받기 체크는 준비(0284a)가 적용된 뒤에 눌립니다 — 점수 입력·저장은 그대로 됩니다."} /></p>
      ) : null}
      {!lockReason && !noExamReady ? (
        <p className="border-amber/40 bg-amber-soft text-foreground rounded-lg border px-3 py-2 text-sm">
          <SheetText value={"[시험없음]은 준비(0285a)가 적용된 뒤에 눌립니다 — 점수 입력·저장은 그대로 됩니다."} /></p>
      ) : null}

      {/* 요약 줄 — 왼쪽은 **진행**(적은 칸/전체 + 막대), 가운데는 분포, 오른쪽은 이 판의 조건.
          세 덩어리를 가는 세로선으로 가른다(한 줄에 여섯 숫자가 평평하게 늘어서면 뭘 봐야 할지 모른다). */}
      <div className="bg-bg-soft border-line flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border px-4 py-2.5 text-sm">
        <span className="text-text-dim flex items-center gap-2">
          <SheetText value={"입력"} /><span className="text-foreground num font-bold">{live.stats.count}</span>
          <span className="text-text-faint">/ {live.people}<SheetText value={"명"} /></span>
          {/* 🔑 직접 그린 막대가 아니라 `<progress>` — 보조기기가 값으로 읽는다(장식이 아니라 값이다). */}
          <progress
            className="h-1.5 w-24 overflow-hidden rounded-full [&::-webkit-progress-bar]:bg-line/70 [&::-webkit-progress-value]:bg-primary"
            value={live.stats.count}
            max={Math.max(live.people, 1)}
            aria-label="점수 입력 진행"
          />
        </span>
        <Divider />
        <span className="text-text-dim">
          <SheetText value={"평균 "} /><span className="text-foreground num font-bold">{live.stats.avg ?? "—"}</span>
          {live.stats.avgPct != null ? <span className="text-text-faint"> ({live.stats.avgPct}%)</span> : null}
        </span>
        <span className="text-text-dim">
          <SheetText value={"최고 "} /><span className="text-foreground num font-bold">{live.stats.max ?? "—"}</span>
        </span>
        <span className="text-text-dim">
          <SheetText value={"최저 "} /><span className="text-foreground num font-bold">{live.stats.min ?? "—"}</span>
        </span>
        {markKeys.includes("received") ? (
          <>
            <Divider />
            <span className="text-text-dim">
              {GRADE_MARK_LABEL.received}{" "}
              <span className="text-foreground num font-bold">{live.received}</span>
              <span className="text-text-faint">/{live.people}<SheetText value={"명"} /></span>
            </span>
          </>
        ) : null}
        {live.skipped > 0 ? (
          <span className="text-text-dim">
            <SheetText value={"시험없음 "} /><span className="text-foreground num font-bold">{live.skipped}</span><SheetText value={"명"} /></span>
        ) : null}
        <span className="text-text-faint ml-auto">
          <SheetText value={"만점 "} />{sel.maxScore} <SheetText value={"· 시험일 "} />{sel.date}
        </span>
      </div>

      {/* '채우기'는 쓰기 단추라 읽기 권한이면 줄째 그리지 않는다("채울 수 있습니다"라는 말부터 오해다). */}
      {canWrite && monthlyPlan && (Object.keys(monthlyPlan.fill).length > 0 || monthlyPlan.maxMismatch > 0) ? (
        <div className="border-line bg-bg-soft flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-1.5 text-sm">
          <span className="text-text-dim">
            <SheetText value={"오늘 수학 월말평가 — 빈 칸 "} />
            <span className="text-foreground num font-bold">{Object.keys(monthlyPlan.fill).length}</span>
            <SheetText value={"칸을 채울 수 있습니다"} />
          </span>
          {monthlyPlan.maxMismatch > 0 ? (
            <span className="text-text-dim">
              · <SheetText value={"만점이 달라 못 채우는 칸 "} />
              {monthlyPlan.maxMismatch}
              {monthlyPlan.otherMax != null ? ` (오늘 수학 ${monthlyPlan.otherMax}점 만점)` : ""}
            </span>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="ml-auto"
            disabled={locked || Object.keys(monthlyPlan.fill).length === 0}
            onClick={fillFromTodaysMath}
          >
            <SheetText value={"오늘 수학 결과 채우기"} />
          </Button>
        </div>
      ) : null}
      {pasteNote ? (
        <p role="status" className="text-text-dim bg-bg-soft border-line rounded-lg border px-3 py-1.5 text-sm">
          <SheetText value={"붙여넣기 — "} />{pasteNote}
        </p>
      ) : null}
      {/* 🔴 `scrollY` 없이 `sticky`만 붙이면 아무 일도 안 난다 — 이 컨테이너는 기본이 `overflow-y-hidden`이라
          세로는 페이지가 스크롤한다(그러면 머리줄이 그냥 위로 사라진다). 높이를 잡아 **여기서** 스크롤시킨다.
          🔴 높이는 `min-h-0 flex-1`로 **받는다** — 안쪽 스크롤러가 `h-full`이라 바깥이 확정 높이를
          가져야 스크롤이 생긴다(`max-h`만 주면 안쪽은 내용만큼 늘고 바깥이 잘라 내기만 한다). */}
      <DragScrollArea scrollY className="bg-card shadow-card min-h-[14rem] flex-1 rounded-2xl">
        {/* 🔴 최소 폭 — 없으면 좁은 창에서 7열이 서로를 찌그러뜨린다(가로 스크롤도 안 생긴다).
            폭이 모자라면 컨테이너가 가로로 스크롤한다(잡고 끌기도 된다). */}
        <table className="w-full min-w-[880px] table-fixed text-sm [&_td]:whitespace-nowrap">
          <caption className="sr-only">
            {slotLabel} <SheetText value={"점수 입력표 — 이름·학교·학년·점수와 "} />{markKeys.map((k) => GRADE_MARK_LABEL[k]).join("·")} <SheetText value={"체크"} /></caption>
          {/* 🔴 **모든 열에 폭을 준다** — 하나라도 비워 두면 그 열이 남는 폭을 독식해 표 가운데가 빈다.
              `table-fixed`는 남는 폭을 이 비율대로 나눠 주므로 창이 넓어져도 리듬이 유지된다.
              🔴 표식 열이 줄면 그 폭을 **이름·학교·점수가 나눠 갖는다** — 비율을 그대로 두면 남은 체크
              한 칸이 40%를 독식해 표 오른쪽이 텅 빈다(원장 2026-09-23 월말평가). */}
          <colgroup>
            {colWidths(markKeys.length).map((w, i) => (
              <col key={i} style={{ width: `${w}%` }} />
            ))}
          </colgroup>
          {/* 머리줄은 스크롤에 붙는다 — 아래 선은 `border`가 아니라 그림자로(스티키 + border-collapse에선
              테두리가 스크롤과 함께 사라진다, [[#71]]). */}
          <thead className="bg-card sticky top-0 z-10 [&_th]:shadow-[0_1px_0_0_var(--color-line)] [&_th]:whitespace-nowrap">
            <tr>
              <SortHead label="이름" sortKey="name" sort={sort} onSort={applySort} align="text-left" />
              <SortHead label="학교" sortKey="school" sort={sort} onSort={applySort} align="text-left" />
              <SortHead label="학년" sortKey="grade" sort={sort} onSort={applySort} align="text-center" />
              <SortHead
                label={`${slotLabel} 점수`}
                sortKey="score"
                sort={sort}
                onSort={applySort}
                align="text-center"
              />
              {markKeys.map((k) => (
                <th key={k} scope="col" className="micro px-2 py-3 text-center">
                  {GRADE_MARK_LABEL[k]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-line divide-y">
            {visibleRows.map((r) => {
                  const myIndex = r.cellIndex;
                  const id = r.studentId;
                  const isNoExam = !!noExam[id];
                  const value = scores[id] ?? "";
                  const rowMarks = marks[id] ?? { ask1: false, ask2: false, received: false };
                  // 아직 안 적은 줄만 옅은 앰버 — '시험없음'으로 눌러 둔 줄은 미기입이 아니다.
                  // (제도상 안 치는 학생은 서버가 목록에서 뺀다 — 여기 오는 줄은 전부 치는 학생이다.)
                  const missing = !isNoExam && (parsed.get(id) ?? null) === null;
                  // 범위를 벗어난 값은 **적는 순간** 말해 준다(저장 때 전건이 거절되고 나서가 아니라).
                  const typed = parsed.get(id) ?? null;
                  const outOfRange = typed != null && (typed < 0 || typed > selMax);
                  return (
                    <tr
                      /* 키는 **그 줄의 반**으로 — 묶음 키(학년)로 만들면 두 반 학생이 부딪힌다. */
                      key={`${r.classId}:${id}`}
                      className={
                        // 🔴 **아직 안 적은 줄은 배경을 바꾼다**(원장 2026-09-22 *"성적기입이 안된학생은
                        //    노란색 또는 빨강색으로 백그라운드 색변경 눈이 너무 안아플정도로"* → 09-23 재지시
                        //    *"해당 기능도 빠져있음"*). 한때 "황색 벽"이라는 리뷰를 받아 뺐었지만, 원장이
                        //    두 번 요구한 신호다 — 대신 **아주 옅게**(앰버 12% 틴트의 45%≈5%) 깔아 눈이
                        //    아프지 않게 하고, 적는 즉시 흰 줄로 바뀌어 진행이 보이게 한다.
                        // ⚠️ '시험없음'으로 눌러 둔 줄은 미기입이 아니다. 제도상 안 치는 학생은 서버가
                        //    이미 목록에서 뺐다(여기 오는 줄은 전부 그 시험을 치는 학생이다).
                        r.withdrawn
                          ? "bg-bg-soft/40"
                          : missing
                            ? "bg-amber-soft/45 hover:bg-amber-soft/70"
                            : "hover:bg-bg-soft/50"
                      }
                      title={
                        r.withdrawn
                          ? "퇴원한 학생입니다 — 적어 둔 기록이 있어 남겨 둡니다"
                          : undefined
                      }
                    >
                      {/* 🔴 왼쪽 색 띠는 쓰지 않는다(원장 2026-09-16 금지 — `no-left-accent-bar` 가드).
                          미기입 신호는 **줄 배경(옅은 앰버) + 점수 칸 테두리** 둘뿐이다. */}
                      <td className="text-foreground overflow-hidden px-4 py-1.5 text-left font-medium text-ellipsis">
                        {r.name}
                        {/* 🔴 표식은 **퇴원** 하나뿐 — 반이동·과목 변경엔 아무 표식도 붙이지 않는다. */}
                        {r.withdrawn ? <span className="text-text-faint ml-1.5 text-xs"><SheetText value={"퇴원"} /></span> : null}
                      </td>
                      <td className="text-text-dim overflow-hidden px-4 py-1.5 text-left text-sm text-ellipsis">
                        {r.school ?? "—"}
                      </td>
                      <td className="text-text-dim num px-2 py-1.5 text-center text-sm">{r.grade ?? "—"}</td>
                      <td className="px-3 py-1">
                        <div className="mx-auto flex max-w-[16rem] items-center justify-center gap-2">
                            {isNoExam ? (
                              <input
                                type="text"
                                disabled={locked}
                                value={reasons[id] ?? ""}
                                aria-label={`${r.name} 시험없음 사유`}
                                onChange={(e) =>
                                  setReasons((prev) => ({ ...prev, [id]: e.target.value }))
                                }
                                placeholder={lockedPlaceholder ?? "사유 (선택)"}
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
                                  // 🔴 Enter로 폼이 제출되면 한 칸 적을 때마다 저장이 돈다 — 아래 칸으로만 간다.
                                  if (e.key === "Enter" || e.key === "ArrowDown") {
                                    e.preventDefault();
                                    focusStep(myIndex, 1);
                                  } else if (e.key === "ArrowUp") {
                                    e.preventDefault();
                                    focusStep(myIndex, -1);
                                  }
                                }}
                                onPaste={(e) => handlePaste(e, myIndex)}
                                aria-invalid={outOfRange || undefined}
                                placeholder={lockedPlaceholder ?? "—"}
                                title={lockedPlaceholder ?? undefined}
                                className={`bg-background text-foreground num focus:ring-primary/40 min-w-0 flex-1 rounded-md border px-2 py-1 text-center text-sm focus:ring-1 focus:outline-none disabled:opacity-60 ${
                                  outOfRange
                                    ? "border-danger text-danger"
                                    : missing
                                      ? "border-amber/60"
                                      : "border-line"
                                }`}
                                aria-describedby={outOfRange ? `range-${r.classId}-${id}` : undefined}
                              />
                            )}
                            {!isNoExam && monthlyFromTodaysMath(todaysMath, id, value, selMax) ? (
                              <span className="text-primary shrink-0 text-xs font-semibold" title="오늘 수학 채점 결과로 채운 값">
                                <SheetText value={"오늘 수학"} />
                              </span>
                            ) : null}
                            {/* 범위를 벗어나면 **칸 옆에 글자로** 말한다 — `title`만으로는 화면낭독기·터치에
                                아무 말도 안 한 것과 같다(codex 리뷰 2026-09-22). */}
                            {outOfRange ? (
                              <span id={`range-${r.classId}-${id}`} className="text-danger shrink-0 text-xs">
                                0~{selMax}
                              </span>
                            ) : null}
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
                              className={`h-8 shrink-0 rounded-md border px-2 text-xs whitespace-nowrap disabled:opacity-50 ${
                                isNoExam
                                  ? "border-primary/40 bg-primary-soft text-primary font-bold"
                                  : "border-line bg-background text-text-dim hover:text-foreground"
                              }`}
                            >
                              <SheetText value={"시험없음"} /></button>
                        </div>
                      </td>
                      {markKeys.map((k) => {
                        const at = r.marks[k];
                        return (
                          <td key={k} className="p-0 text-center">
                            {/* 🔴 체크 자체는 16px이라 표적이 너무 작다 — **칸 전체**를 누를 수 있게 라벨로 감싼다. */}
                            <label
                              className={`flex min-h-9 cursor-pointer items-center justify-center ${
                                locked || !marksReady ? "cursor-not-allowed" : "hover:bg-foreground/5"
                              }`}
                              title={at ? `${GRADE_MARK_LABEL[k]} ${at.slice(0, 10)}` : GRADE_MARK_LABEL[k]}
                            >
                              <input
                                type="checkbox"
                                className="accent-primary size-[18px] align-middle disabled:opacity-50"
                                checked={rowMarks[k]}
                                disabled={locked || !marksReady}
                                aria-label={`${r.name} ${GRADE_MARK_LABEL[k]}`}
                                onChange={() => toggleMark(id, k)}
                              />
                            </label>
                          </td>
                        );
                      })}
                    </tr>
                  );
            })}
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
              <SheetText value={state.saved === 0 && state.cleared === 0
                ? "바뀐 내용이 없습니다"
                : `저장했습니다 (${state.saved ?? 0}칸${state.cleared ? ` · ${state.cleared}칸 지움` : ""})`} />
            </p>
          ) : null}
          <span className="text-text-dim text-sm">
            <SheetText value={"저장 안 된 칸 "} /><span className="text-foreground num font-bold">{dirtyIds.length}</span><SheetText value={"개"} /></span>
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
    <th
      scope="col"
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
      className={`micro px-4 py-3 ${align}`}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        title="눌러서 정렬"
        className={`hover:text-foreground inline-flex items-center gap-1 ${align === "text-center" ? "justify-center" : ""}`}
      >
        {label}
        {/* 🔴 방향 표시는 **아이콘**으로 — ▲▼ 같은 글자는 아이콘 자리에 서면 안 된다(가드 `aywa-icon-mapping`). */}
        {active ? (
          <EyIcon
            name={sort.dir === "asc" ? "chevronUp" : "chevronDown"}
            size={14}
            className="text-primary size-3.5 shrink-0"
          />
        ) : null}
      </button>
    </th>
  );
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
    if (key === "grade") return gradeSortRank(r.grade);
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

/** 요약 줄의 가는 세로선 — 덩어리를 가른다(색·굵기를 화면마다 새로 적지 않게 한 곳에). */
/**
 * 열 폭 비율(%) — 앞 네 열(이름·학교·학년·점수)을 먼저 정하고 **남는 폭을 표식 열이 똑같이 나눈다**.
 * 합은 항상 100이다(`table-fixed`라 100이 안 되면 남는 폭이 마지막 열로 몰려 표 오른쪽이 텅 빈다).
 * 🔴 표식 열이 줄면 글자 열이 넓어진다 — 체크는 18px 상자라 넓을 이유가 없고, 이름·학교가 잘리는 게
 *    실제 불편이다(원장 2026-09-22 *"이름 학교는 엄청 자리 쓸데없이 많이 차지"*의 반대 방향 균형).
 */
function colWidths(marks: number): number[] {
  const head = marks <= 1 ? [20, 24, 8, 32] : marks === 2 ? [16, 19, 8, 28] : [13, 15, 7, 25];
  if (marks <= 0) return [...head.slice(0, 3), 100 - head[0]! - head[1]! - head[2]!];
  const rest = 100 - head.reduce((a, b) => a + b, 0);
  const each = Math.floor(rest / marks);
  // 나머지는 마지막 열이 받는다(반올림 오차로 합이 99가 되면 그만큼 밀린다).
  return [...head, ...Array.from({ length: marks }, (_, i) => (i === marks - 1 ? rest - each * (marks - 1) : each))];
}

function Divider() {
  return <span className="bg-line hidden h-3 w-px sm:block" aria-hidden />;
}

function SaveButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || disabled}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
      <SheetText value={"점수 저장"} /></Button>
  );
}
