"use client";

import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { isBuiltinTemplateId, revertImplicit, type TemplatePrefs } from "../last-template";
import type { OneScreenStudent } from "../types";
import { listMyReportTemplates } from "@/features/report-templates/server/actions";
import { BUILTIN_ENGLISH_TEMPLATES, DEFAULT_ENGLISH_TEMPLATE, type ReportTemplate } from "@/features/report-templates/defaults";
import { findTemplateIn } from "../english-draft";
import type { ReportsState } from "../session-input";

/**
 * 영어 템플릿 목록·관리 창·반별 기본 템플릿 — 수정 계획 P3-O batch C, `use-english-template-mode.ts`에서 나눔(본문 그대로).
 * 영어 행이 있을 때만 목록을 한 번 받고(취소 플래그 그대로), 비동기 경로용 ref 미러를 effect에서 맞춘다.
 */
export function useEnglishTemplates({
  students,
  initialTemplatePrefs,
  setReports,
}: {
  students: OneScreenStudent[];
  initialTemplatePrefs: TemplatePrefs;
  setReports: Dispatch<SetStateAction<ReportsState>>;
}) {
  // 영어 템플릿 모드(2026-09-10) — 내 템플릿 목록(맨 앞은 기본). **영어 행이 있을 때만** 한 번 불러온다
  // (첫 페인트 밖 · 수학만 가르치는 강사는 호출 0). 실패해도 기본 템플릿은 그대로 쓴다.
  const [englishTemplates, setEnglishTemplates] = useState<ReportTemplate[]>(() => [...BUILTIN_ENGLISH_TEMPLATES]);
  const [templateNotice, setTemplateNotice] = useState<string | null>(null);
  const [templateManagerOpen, setTemplateManagerOpen] = useState(false);
  // 목록을 한 번이라도 받았는가(성공·실패 무관) — 받기 전엔 사용자 템플릿을 "없다"고 단정하지 않는다.
  const [templatesLoaded, setTemplatesLoaded] = useState(false);
  // 영어 템플릿 내 기본값(반별 마지막 선택) — 고를 때마다 바뀐다. 새로 세우는 행(보강 추가 등)이 지금 값을 쓴다.
  const templatePrefsRef = useRef<TemplatePrefs>(initialTemplatePrefs);
  const [templateListFailed, setTemplateListFailed] = useState(false);
  const hasEnglishRows = useMemo(
    () => students.some((s) => s.subjects.some((su) => su.subjectKey === "english")),
    [students],
  );
  useEffect(() => {
    if (!hasEnglishRows) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await listMyReportTemplates();
        if (cancelled) return;
        setEnglishTemplates(res.templates);
        setTemplateNotice(res.notice);
        // 기본값으로 붙여 둔 사용자 템플릿이 목록에 없으면(지움) — 또는 목록이 불완전하면(notice) — 그 빈 행을 코드 기본 템플릿으로
        // 되돌린다. 🔴 안 되돌리면 목록 실패 한 번에 반 전체의 자동작성이 '템플릿 목록 실패'로 멈춘다(적대 리뷰 2026-10-27).
        //    강사가 직접 고른 행은 그대로 둔다(종전대로 알린다).
        const ids = new Set(res.notice ? [] : res.templates.map((tp) => tp.id));
        setReports((prev) => revertImplicit(prev, (id) => !isBuiltinTemplateId(id) && !ids.has(id)));
        // 🔴 안내(notice)가 붙은 목록은 기본 템플릿뿐인 **불완전한** 목록이다(DB 오류·표 없음·권한) — 실패로 친다.
        //    안 치면 사용자 템플릿 행에 '삭제됨' 거짓 칩이 서고, 자동작성이 기본 템플릿으로 바꿔 끼워 선택을 잃었다(적대 재리뷰).
        if (res.notice) setTemplateListFailed(true);
      } catch {
        // 목록을 못 받아도 기본 템플릿으로 계속 쓸 수 있다 — 화면을 막지 않되 **알린다**
        // (말없이 기본으로 바꿔 끼우면 고른 템플릿과 다른 글이 나간다).
        if (!cancelled) {
          setTemplateListFailed(true);
          // 기본값으로만 붙여 둔 사용자 템플릿은 되돌린다(위와 같은 이유) — 강사가 고른 행은 그대로.
          setReports((prev) => revertImplicit(prev, (id) => !isBuiltinTemplateId(id)));
        }
      } finally {
        if (!cancelled) setTemplatesLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hasEnglishRows, setReports]); // setReports는 늘 같은 함수(state 세터) — 예전 [hasEnglishRows]와 같게 돈다
  // 영어 템플릿 목록·로딩 여부 미러 — 일괄 자동작성(비동기 루프) 중 목록이 도착해도 다음 행부터 본다.
  const englishTemplatesRef = useRef(englishTemplates);
  const templatesLoadedRef = useRef(templatesLoaded);
  const templateListFailedRef = useRef(templateListFailed);
  // ref 미러는 render 중이 아니라 effect에서 갱신(react-hooks/refs).
  useEffect(() => {
    englishTemplatesRef.current = englishTemplates;
    templatesLoadedRef.current = templatesLoaded;
    templateListFailedRef.current = templateListFailed;
  });
  /**
   * 이 행이 고른 템플릿. 없거나 지워졌으면 **null** — 호출부가 기본 템플릿으로 채우되 그 사실을 알린다
   * (말없이 다른 템플릿으로 바꿔 끼우면 강사가 고른 것과 다른 글이 나간다, 적대 리뷰 2026-09-10).
   * ⚠️ 비동기 경로(자동작성·저장·복사)는 `englishTemplatesRef.current`를 넘긴다 — 일괄 작성 중 도착한 목록도 본다.
   */
  function findTemplate(
    templateId: string | undefined,
    list: readonly ReportTemplate[] = englishTemplates,
  ): ReportTemplate | null {
    return findTemplateIn(list, templateId, DEFAULT_ENGLISH_TEMPLATE);
  }
  return {
    englishTemplates,
    setEnglishTemplates,
    templateNotice,
    templateManagerOpen,
    setTemplateManagerOpen,
    templatesLoaded,
    templatePrefsRef,
    templateListFailed,
    englishTemplatesRef,
    templatesLoadedRef,
    templateListFailedRef,
    findTemplate,
  };
}
