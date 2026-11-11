"use client";

import { useState } from "react";
import { toast } from "sonner";
import { isMathReportPilot, isPilotAutoWritten, pilotCanEdit } from "../math-report-pilot";
import { pilotSendBlocks } from "../pilot-send-gate";
import { hasTextBesidesAttachments } from "@/features/report-templates/attachment-lines";
import type { EnglishGenStatus } from "../english-draft";
import type { GridRow, RowAction } from "../grid";
import type { ReportsState } from "../session-input";
import type { OneScreenStudent, Subject } from "../types";
import type { SubjectReport } from "./report-card";
import type { useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";
import { useEnglishRefill } from "./use-english-refill";
import { useReportDraftGeneration } from "./use-report-draft-generation";

/**
 * AI 자동작성(카드 과목 버튼 · 표 행 · 표 일괄) — 수정 계획 P3-O 5/10, `onescreen-client.tsx`에서 옮김(동작 그대로).
 *
 * 로딩 표시 셋은 **따로** 둔다: `genSubject`(카드 과목 버튼) · `genKey`(표 행) · `bulkGen`(표 일괄). 하나로 합치면 어느 버튼이
 * 도는지가 바뀐다(계획 — 통일은 별도 변경). 영어 '다시 채우기' 연타 막기(refillBusyRef)·받는 중 고른 템플릿(refillNextRef)도 여기.
 * 영어 템플릿 글 만들기·채우기 본문(generateEnglishDraftFor·refillEnglishInner)은 화면에 남아 `english`로 넘어온다.
 * batch D: 한 행 자동작성 코어 = use-report-draft-generation.ts · 다시 채우기 연타 막기 = use-english-refill.ts(카드·행·일괄 입구와
 *    로딩 표시 셋은 여기 그대로).
 */
export function useAutoWrite({
  ctx: { selected, readonlyView, date, activeDate, showDailyTest, showCheckTest, classNarratives },
  refs: { reportsRef, studentsRef },
  i18n: { t, tf },
  bulkBusy,
  rows: { selectRows, latestRow, latestStudent },
  actions: { readonlyBlocked, patchReport },
  english: { generateEnglishDraftFor, refillEnglishInner },
}: {
  ctx: {
    selected: OneScreenStudent | null;
    readonlyView: boolean;
    /** 조회 대상 날짜 원문(빈값 = 서버 오늘) — 서버 호출에 그대로 싣는다. */
    date: string;
    /** 화면 날짜(빈값이면 오늘로 푼 값) — 작성 시간 기록·멘트 재료. */
    activeDate: string;
    showDailyTest: boolean;
    showCheckTest: boolean;
    /** 반 공통 서술(G6) — 반 id → 서술. */
    classNarratives: Record<string, string>;
  };
  refs: { reportsRef: { readonly current: ReportsState }; studentsRef: { readonly current: OneScreenStudent[] } };
  i18n: { t: ReturnType<typeof useSheetT>; tf: ReturnType<typeof useSheetTf> };
  /** 일괄 저장·발송 진행 중 — 일괄 자동작성의 재진입 잠금(#10). */
  bulkBusy: "save" | "send" | null;
  rows: {
    selectRows: (action: RowAction, keys?: string[]) => GridRow[];
    latestRow: (studentId: string, subjectName: string) => OneScreenStudent | null;
    latestStudent: (student: OneScreenStudent, subjectName: string) => OneScreenStudent;
  };
  actions: {
    readonlyBlocked: () => boolean;
    patchReport: (studentId: string, subjectName: string, fn: (r: SubjectReport) => SubjectReport) => void;
  };
  english: {
    generateEnglishDraftFor: (student: OneScreenStudent, su: Subject, quiet?: boolean) => Promise<EnglishGenStatus>;
    refillEnglishInner: (student: OneScreenStudent, subjectName: string, templateId?: string) => Promise<void>;
  };
}) {
  const [genSubject, setGenSubject] = useState<string | null>(null); // AI 멘트 생성 중인 과목(카드 버튼 로딩)
  const [genKey, setGenKey] = useState<string | null>(null); // 표 행별 자동작성 로딩 키(studentId::과목)
  // 영어 다시 채우기 연타 막기(use-english-refill.ts의 ref 둘 — 훅 순서는 예전 자리 그대로: genKey 다음 · bulkGen 앞).
  const { refillEnglishFor } = useEnglishRefill({ refillEnglishInner, latestStudent });
  const [bulkGen, setBulkGen] = useState(false); // 표 일괄 자동작성 진행중
  // 한 행 자동작성 코어(use-report-draft-generation.ts) — batch D에서 나눴다(본문 그대로).
  const { generateDraftFor } = useReportDraftGeneration({
    ctx: { readonlyView, date, activeDate, showDailyTest, showCheckTest, classNarratives },
    refs: { reportsRef, studentsRef },
    t,
    patchReport,
    generateEnglishDraftFor,
  });
  async function autoWriteSubject(subjectName: string) {
    if (readonlyBlocked()) return;
    if (!selected) return;
    const student = selected; // 클로저 고정 — 생성 중 학생 전환돼도 원래 학생에 반영
    setGenSubject(subjectName);
    try {
      await generateDraftFor(student, subjectName);
    } finally {
      setGenSubject((cur) => (cur === subjectName ? null : cur));
    }
  }
  // 표: 행별 자동작성(genKey로 그 행만 로딩) + 일괄 자동작성(순차). 생성된 draft는 일괄 발송이 그대로 사용.
  async function autoWriteRow(student: OneScreenStudent, subjectName: string) {
    if (readonlyBlocked()) return;
    const key = `${student.id}::${subjectName}`;
    setGenKey(key);
    try {
      await generateDraftFor(student, subjectName);
    } finally {
      setGenKey((cur) => (cur === key ? null : cur));
    }
  }
  async function autoWriteAllVisible(keys?: string[]) {
    if (readonlyBlocked()) return;
    if (bulkGen || bulkBusy) return; // 재진입·중첩 방지
    const eligible = selectRows("autowrite", keys);
    const skipped = keys?.length ? keys.length - eligible.length : 0; // 선택했지만 진도 없어 제외된 행(미선택=전체=0, 음수 방지 #11)
    // ⚠️ 이미 멘트가 있는 행은 **건너뛴다** — 손으로 다듬은 문구를 일괄 재생성이 확인 없이 덮어쓰던 문제(#12 확정).
    //    개별 '자동작성' 버튼(autoWriteRow)은 그 행만 명시 재생성하므로 재생성 의도는 그쪽으로.
    // 사진·PDF 줄만 있는 행은 글이 없는 행이다(영어 — 그 줄은 새 글에 따라온다). 수학 글엔 첨부 줄이 없어 결과가 같다.
    const hasDraft = (r: (typeof eligible)[number]) =>
      hasTextBesidesAttachments(reportsRef.current[r.student.id]?.[r.subject.name]?.draft);
    // 예외 — 새 수학 보고서의 **손대지 않은 자동작성 글**인데 그 뒤 값(출결·점수·태도…)이 바뀐 행은 다시 쓴다(원장 2026-10-26).
    //   그 글은 사람이 다듬은 글이 아니라 옛 값으로 쓴 기계 글이고, 다시 안 쓰면 행마다 눌러야 발송이 풀린다. 고친 글은 그대로 건너뛴다.
    const staleAuto = (r: (typeof eligible)[number]) => {
      const rep = reportsRef.current[r.student.id]?.[r.subject.name];
      const st = latestRow(r.student.id, r.subject.name) ?? r.student;
      return (
        isMathReportPilot(st.id, r.subject.subjectKey) &&
        isPilotAutoWritten(rep?.draft, rep?.autoDraft) &&
        pilotSendBlocks(st, r.subject.name, rep).includes("autowrite")
      );
    };
    // 선생님이 고친 글인데 값이 바뀌어 막힌 행 — AI 없이 바뀐 항목만 맞춘다(고친 말은 그대로, generateDraftFor의 합치기). 원장 2026-10-27.
    const staleEdited = (r: (typeof eligible)[number]) => {
      const rep = reportsRef.current[r.student.id]?.[r.subject.name];
      const st = latestRow(r.student.id, r.subject.name) ?? r.student;
      return (
        isMathReportPilot(st.id, r.subject.subjectKey) &&
        pilotCanEdit(rep?.autoDraft) &&
        !isPilotAutoWritten(rep?.draft, rep?.autoDraft) &&
        pilotSendBlocks(st, r.subject.name, rep).includes("autowrite")
      );
    };
    const rows = eligible.filter((r) => !hasDraft(r) || staleAuto(r) || staleEdited(r));
    const preserved = eligible.length - rows.length;
    if (rows.length === 0) {
      toast.message(
        preserved
          ? tf("os.c.genNonePreserved", { n: preserved })
          : t("os.c.genNone"),
      );
      return;
    }
    setBulkGen(true);
    // 영어 행 결과는 모아서 한 번에 알린다(행마다 토스트를 띄우면 30개가 쌓인다) — 글을 안 바꾼 행은 '완료'에서 뺀다.
    let englishSkipped = 0;
    let templateFallback = false;
    try {
      for (const r of rows) {
        setGenKey(`${r.student.id}::${r.subject.name}`);
        const student = latestRow(r.student.id, r.subject.name) ?? r.student;
        const status = await generateDraftFor(student, r.subject.name, { quiet: true });
        if (status === "loading" || status === "ai_failed" || status === "edited") englishSkipped++;
        else if (status === "template_fallback") templateFallback = true;
      }
    } finally {
      setGenKey(null);
      setBulkGen(false);
    }
    toast.success(
      tf("os.c.genDone", { n: rows.length - englishSkipped }) +
        (preserved ? tf("os.c.genPreserved", { n: preserved }) : "") +
        (skipped ? tf("os.c.genSkipped", { n: skipped }) : ""),
    );
    if (englishSkipped) toast.message(tf("os.tpl.bulkSkipped", { n: englishSkipped }));
    if (templateFallback) toast.message(t("os.tpl.templateMissing"));
  }
  return { genSubject, genKey, bulkGen, refillEnglishFor, autoWriteSubject, autoWriteRow, autoWriteAllVisible };
}
