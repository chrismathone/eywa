"use client";

import type { ReactNode } from "react";
import dynamic from "next/dynamic";
import { isBuiltinTemplateId, revertImplicit } from "../last-template";
import { REPORT_ATTACHMENT_MAX } from "../attachment-utils";
import { hasVideoAttachment } from "../report-video";
import { EnglishTemplatePanel } from "./english-template-panel";
import { DEFAULT_ENGLISH_TEMPLATE } from "@/features/report-templates/defaults";
import { usesWordTokens } from "../english-draft";
import { rowKey } from "../grid";
import type { OneScreenStudent } from "../types";
import type { useSheetT } from "@/features/teacher-view/lang-context";
import type { CardColumnContext, CardColumnEnglish, CardColumnRow, CardColumnRowActions } from "./onescreen-card-types";

// 템플릿 관리 창(2026-09-10) — 영어 행에서 '템플릿 관리'를 누를 때만 쓰므로 첫 로드에서 뺀다(B5 — 화면의 다른 지연 로드 뷰와 같은 이유).
const TemplateManager = dynamic(
  () => import("@/features/report-templates/components/template-manager").then((m) => m.TemplateManager),
  { ssr: false },
);

/**
 * 영어 행 템플릿 칸과 템플릿 관리 창 — 수정 계획 P3-O batch D, `onescreen-card-column.tsx`에서 옮김(JSX 그대로).
 * 컴포넌트가 아니라 **그리기 함수**다 — 영어 행이 아니면(관리 창이 닫혀 있으면) 예전처럼 `null`(요소 트리 그대로).
 */
export function cardTemplatePanel({
  selected,
  ctx: { canLinkIjw, uploadingAttKey },
  row: { previewSubject, previewReport },
  english: {
    englishTemplates,
    templateNotice,
    templateListFailed,
    setTemplateManagerOpen,
    findTemplate,
    englishRowFlags,
    englishJjStatusOf,
    englishJjPickOf,
    copyEnglishText,
    jj,
    rowOutOfClass,
    setEnglishTemplateFor,
    setNextTestFor,
    setWordFeedbackFor,
    setWordRetestFor,
    refillEnglishFor,
    insertEnglishMediaFor,
  },
  rowActions: { addAttachmentsFor },
  t,
}: {
  selected: OneScreenStudent;
  ctx: Pick<CardColumnContext, "canLinkIjw" | "uploadingAttKey">;
  row: Pick<CardColumnRow, "previewSubject" | "previewReport">;
  english: Omit<CardColumnEnglish, "setEnglishTemplates" | "templateManagerOpen">;
  rowActions: Pick<CardColumnRowActions, "addAttachmentsFor">;
  t: ReturnType<typeof useSheetT>;
}): ReactNode {
  return (
    previewSubject?.subjectKey === "english" ? (
      <EnglishTemplatePanel
        templates={englishTemplates}
        state={{
          // 고른 선택이 대기 중이면 그걸 보여 준다('AI 글 없음' 칩이 자동작성을 권한다).
          templateId:
            previewReport?.pendingTemplateId ?? previewReport?.templateId ?? DEFAULT_ENGLISH_TEMPLATE.id,
          // 지금 글을 실제로 만든 템플릿 — 대기 중이면 칩이 그 이름을 함께 적는다(드롭다운과 글이 다를 때).
          appliedTemplateId: previewReport?.templateId ?? DEFAULT_ENGLISH_TEMPLATE.id,
          nextTest: previewReport?.nextTest ?? "",
          wordFeedback: previewReport?.wordFeedback ?? "",
          wordRetest: previewReport?.wordRetest === true,
          // 단어 테스트 칸을 쓰는 템플릿(EiE 일일 보고서)일 때만 피드백·재시험 칸을 연다.
          wordFields: usesWordTokens(
            findTemplate(previewReport?.pendingTemplateId ?? previewReport?.templateId) ?? DEFAULT_ENGLISH_TEMPLATE,
          ),
          // 경고 셋은 저장값이 아니라 **지금 글·칸** 기준(english-draft.ts) — 새로고침·일괄 작성 뒤에도 맞다.
          ...englishRowFlags(selected, previewSubject, previewReport),
          jj: englishJjStatusOf(selected.id),
          jjPick: englishJjPickOf(selected.id),
          canLinkJj: canLinkIjw,
          media: {
            busy: uploadingAttKey === rowKey(selected.id, previewSubject.name),
            full: (previewReport?.attachments?.length ?? 0) >= REPORT_ATTACHMENT_MAX,
            hasVideo: hasVideoAttachment(previewReport?.attachments),
          },
        }}
        notice={templateNotice ?? (templateListFailed ? t("os.tpl.listFailed") : null)}
        handlers={{
          onTemplate: (id) => setEnglishTemplateFor(selected, previewSubject.name, id),
          onNextTest: (v) => setNextTestFor(selected.id, previewSubject.name, v),
          onWordFeedback: (v) => setWordFeedbackFor(selected.id, previewSubject.name, v),
          onWordRetest: (on) => setWordRetestFor(selected.id, previewSubject.name, on),
          onRefill: () => void refillEnglishFor(selected, previewSubject.name),
          onCopy: () => void copyEnglishText(selected, previewSubject.name),
          onManage: () => setTemplateManagerOpen(true),
          onJjRetry: () =>
            void jj.ensure(selected.id, {
              outOfClass: rowOutOfClass(selected, previewSubject),
              force: true,
              manual: true, // 사람이 누른 것 — 멈춤 차단기도 무시한다
            }),
          onJjPick: (pick) =>
            void jj.choose(selected.id, pick, { outOfClass: rowOutOfClass(selected, previewSubject) }),
          onInsertFile: (file) => void insertEnglishMediaFor(selected, previewSubject.name, file),
          // 영상(2026-11-06) — 사진·PDF와 같은 올리기 함수(저장 보장·게이트 동일) · 글 속 자리 줄은 넣지 않는다.
          onVideoFile: (file) => void addAttachmentsFor(selected, previewSubject.name, [file]),
        }}
      />
    ) : null
  );
}

/** 템플릿 관리 창 — 열려 있을 때만 그린다(지연 로드 그대로). */
export function cardTemplateManager({
  ctx: { teacherName, activeDate },
  row: { setReports },
  english: { englishTemplates, setEnglishTemplates, templateNotice, templateListFailed, templateManagerOpen, setTemplateManagerOpen },
  t,
}: {
  ctx: Pick<CardColumnContext, "teacherName" | "activeDate">;
  row: Pick<CardColumnRow, "setReports">;
  english: Pick<
    CardColumnEnglish,
    "englishTemplates" | "setEnglishTemplates" | "templateNotice" | "templateListFailed" | "templateManagerOpen" | "setTemplateManagerOpen"
  >;
  t: ReturnType<typeof useSheetT>;
}): ReactNode {
  return (
    templateManagerOpen ? (
      <TemplateManager
        open
        onOpenChange={setTemplateManagerOpen}
        templates={englishTemplates}
        onTemplatesChange={(list) => {
          setEnglishTemplates(list);
          // 관리 창에서 지운 사용자 템플릿을 기본값으로 붙여 둔 빈 행은 되돌린다(첫 목록 때와 같은 판정).
          const ids = new Set(list.map((tp) => tp.id));
          setReports((prev) => revertImplicit(prev, (id) => !isBuiltinTemplateId(id) && !ids.has(id)));
        }}
        teacherName={teacherName}
        notice={templateNotice ?? (templateListFailed ? t("os.tpl.listFailed") : null)}
        // 미리보기 그림 칸의 예시 자료 날짜 — 보고 있는 날짜로(결과지 제출일·학습 기간이 그 날짜로 적힌다).
        sampleDate={activeDate}
      />
    ) : null
  );
}
