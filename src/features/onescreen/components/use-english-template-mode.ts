"use client";

import type { Dispatch, SetStateAction } from "react";
import type { TemplatePrefs } from "../last-template";
import type { OneScreenStudent, Subject } from "../types";
import type { ReportsState } from "../session-input";
import type { useEnglishJj } from "./use-english-jj";
import type { useSheetT } from "@/features/teacher-view/lang-context";
import type { PatchReport } from "./english-template-types";
import { useEnglishTemplates } from "./use-english-templates";
import { useEnglishOutput } from "./use-english-output";
import { useEnglishGenerate } from "./use-english-generate";

/**
 * 영어 템플릿 모드(2026-09-10) — 수정 계획 P3-O 7/10, `onescreen-client.tsx`에서 옮김(동작 그대로).
 *
 * 내 템플릿 목록(영어 행이 있을 때만 한 번 받는다)·목록 상태·템플릿 관리 창·반별 기본 템플릿(templatePrefsRef)과,
 * 영어 행의 사실·글 판정(옛 값 기준인가 · 내보내기 전 확인)·템플릿 글 만들기·다시 채우기 본문·글 복사를 낸다.
 * 비동기 경로(일괄 자동작성·저장·복사)는 목록을 **ref**로 읽는다 — 루프 중 도착한 목록도 다음 행부터 본다.
 * 다시 채우기 연타 막기·자동작성 로딩 표시는 use-auto-write.ts, 템플릿 고르기(setEnglishTemplateFor)는 화면에 있다.
 * batch C: 목록 = use-english-templates.ts · 판정·내보내기 = use-english-output.ts(본문은 english-row-facts.ts) ·
 * 만들기·다시 채우기 = use-english-generate.ts로 나눴다. 화면 호출은 그대로다.
 */
export function useEnglishTemplateMode({
  students,
  initialTemplatePrefs,
  activeDate,
  report,
  classNarratives,
  jj,
  refs,
  state: { setReports, patchReport },
  rowOutOfClass,
  t,
}: {
  students: OneScreenStudent[];
  initialTemplatePrefs: TemplatePrefs;
  activeDate: string;
  /** 영어 글 사실 줄 재료 — 테스트 사용 여부 · 담당자 이름. */
  report: { showDailyTest: boolean; showCheckTest: boolean; teacherName: string };
  /** 반 공통 서술(G6) — 반 id → 서술. */
  classNarratives: Record<string, string>;
  /** 영어 행의 인재원 하루치(use-english-jj.ts) — 화면과 같은 캐시를 쓴다. */
  jj: ReturnType<typeof useEnglishJj>;
  refs: { reportsRef: { readonly current: ReportsState }; studentsRef: { readonly current: OneScreenStudent[] } };
  state: { setReports: Dispatch<SetStateAction<ReportsState>>; patchReport: PatchReport };
  rowOutOfClass: (student: OneScreenStudent, su: Subject | undefined) => boolean;
  t: ReturnType<typeof useSheetT>;
}) {
  const templates = useEnglishTemplates({ students, initialTemplatePrefs, setReports });
  const output = useEnglishOutput({ activeDate, report, jj, reportsRef: refs.reportsRef, patchReport, templates, t });
  const { generateEnglishDraftFor, refillEnglishInner } = useEnglishGenerate({
    activeDate,
    classNarratives,
    jj,
    refs,
    patchReport,
    rowOutOfClass,
    templates,
    englishFactsOf: output.englishFactsOf,
    t,
  });
  return {
    englishTemplates: templates.englishTemplates,
    setEnglishTemplates: templates.setEnglishTemplates,
    templateNotice: templates.templateNotice,
    templateManagerOpen: templates.templateManagerOpen,
    setTemplateManagerOpen: templates.setTemplateManagerOpen,
    templatePrefsRef: templates.templatePrefsRef,
    templateListFailed: templates.templateListFailed,
    englishTemplatesRef: templates.englishTemplatesRef,
    findTemplate: templates.findTemplate,
    englishJjStatusOf: output.englishJjStatusOf,
    englishJjPickOf: output.englishJjPickOf,
    englishJjSnapshotOf: output.englishJjSnapshotOf,
    englishPreviewDraft: output.englishPreviewDraft,
    englishRowFlags: output.englishRowFlags,
    englishTemplateNotReady: output.englishTemplateNotReady,
    confirmEnglishOutput: output.confirmEnglishOutput,
    outdatedEnglishRows: output.outdatedEnglishRows,
    freshEnglishDraft: output.freshEnglishDraft,
    generateEnglishDraftFor,
    refillEnglishInner,
    copyEnglishText: output.copyEnglishText,
  };
}
