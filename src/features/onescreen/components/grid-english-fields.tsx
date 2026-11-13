"use client";

/**
 * 표 모드 영어 행의 템플릿 칸(원장 2026-11-12 *"다음시간 테스트 영상 업로드 우리 카드에서 추가한게 표에서없음 영어일때"*)
 * — 카드의 [`EnglishTemplatePanel`](./english-template-panel.tsx)과 **같은 setter·같은 판정**으로 다음 시간 테스트 ·
 * 단어 테스트 재시험·피드백(그 칸을 쓰는 템플릿일 때만) · 영상 올리기를 표에도 둔다.
 * 템플릿 고르기·다시 채우기·글 속 사진은 카드에서(표 칸은 좁고, 글 속 자리 넣기는 커서 위치가 필요하다).
 * ⚠️ 잠금은 부르는 쪽 fieldset이 맡는다(결석·발송 완료·열람 전용이면 함께 잠긴다).
 */
import { useSheetT } from "@/features/teacher-view/lang-context";
import { TEXTAREA_AUTOSIZE } from "@/lib/ui/textarea";
import { DEFAULT_ENGLISH_TEMPLATE, type ReportTemplate } from "@/features/report-templates/defaults";
import { REPORT_ATTACHMENT_MAX } from "../attachment-utils";
import { usesWordTokens } from "../english-draft";
import { rowKey } from "../grid";
import { hasVideoAttachment } from "../report-video";
import type { OneScreenStudent, Subject } from "../types";
import { EnglishVideoButton } from "./english-media-button";
import type { SubjectReport } from "./report-card";

export type GridEnglishFieldsState = {
  nextTest: string;
  wordFeedback: string;
  wordRetest: boolean;
  /** 단어 테스트 칸을 쓰는 템플릿(EiE 일일 보고서)이라 재시험·피드백 칸을 연다 — 카드와 같은 `usesWordTokens`. */
  wordFields: boolean;
  media: { busy: boolean; full: boolean; hasVideo: boolean };
};

export type GridEnglishFieldsHandlers = {
  onNextTest: (text: string) => void;
  onWordFeedback: (text: string) => void;
  onWordRetest: (on: boolean) => void;
  onVideoFile: (file: File) => void;
};

const INPUT = "border-line bg-card focus:border-primary w-full min-w-0 rounded-sm border px-2 text-xs outline-none";

export function GridEnglishFields({ state, handlers, studentName }: {
  state: GridEnglishFieldsState;
  handlers: GridEnglishFieldsHandlers;
  studentName: string;
}) {
  const t = useSheetT();
  const nextLabel = t(state.wordFields ? "os.tpl.nextWordTest" : "os.tpl.nextTest");
  return (
    <div className="flex flex-col gap-1">
      {state.wordFields ? (
        <>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={state.wordRetest}
              onChange={(e) => handlers.onWordRetest(e.target.checked)}
              className="accent-danger size-4"
            />
            <span className="text-foreground text-xs font-bold">{t("os.tpl.wordRetest")}</span>
          </label>
          <textarea
            rows={1}
            value={state.wordFeedback}
            onChange={(e) => handlers.onWordFeedback(e.target.value)}
            placeholder={t("os.tpl.wordFeedback")}
            title={t("os.tpl.wordFeedbackPh")}
            aria-label={`${studentName} ${t("os.tpl.wordFeedback")}`}
            maxLength={1000}
            className={`${TEXTAREA_AUTOSIZE} ${INPUT} min-h-8 py-[0.3rem] leading-[1.2]`}
          />
        </>
      ) : null}
      <input
        value={state.nextTest}
        onChange={(e) => handlers.onNextTest(e.target.value)}
        // 칸 이름을 placeholder로(표는 좁다) — 예시는 툴팁으로(오늘 과제 칸과 같은 처방).
        placeholder={nextLabel}
        title={t("os.tpl.nextTestPh")}
        aria-label={`${studentName} ${nextLabel}`}
        className={`${INPUT} h-8`}
      />
      <div className="flex flex-wrap items-center gap-1.5">
        <EnglishVideoButton disabled={state.media.full || state.media.hasVideo} busy={state.media.busy} onFile={handlers.onVideoFile} />
        {state.media.hasVideo ? <span className="text-text-faint text-xs break-keep" title={t("os.video.has")}>{t("os.video.hasShort")}</span> : null}
      </div>
    </div>
  );
}

/**
 * 표 행마다 칸 값·setter를 묶는다 — 카드(`cardTemplatePanel`)가 같은 행에서 읽는 값과 같은 출처
 * (고른 템플릿 = 대기 중인 선택 → 지금 템플릿 → 기본 · 첨부 상한·영상 한 개·올리는 중 표시).
 */
export function gridEnglishFieldsOf(deps: {
  findTemplate: (templateId: string | undefined) => ReportTemplate | null;
  uploadingAttKey: string | null;
  setNextTestFor: (studentId: string, subjectName: string, text: string) => void;
  setWordFeedbackFor: (studentId: string, subjectName: string, text: string) => void;
  setWordRetestFor: (studentId: string, subjectName: string, on: boolean) => void;
  addAttachmentsFor: (student: OneScreenStudent, subjectName: string, files: File[]) => unknown;
}) {
  return (student: OneScreenStudent, subject: Subject, rep: SubjectReport | undefined) => ({
    state: {
      nextTest: rep?.nextTest ?? "",
      wordFeedback: rep?.wordFeedback ?? "",
      wordRetest: rep?.wordRetest === true,
      wordFields: usesWordTokens(deps.findTemplate(rep?.pendingTemplateId ?? rep?.templateId) ?? DEFAULT_ENGLISH_TEMPLATE),
      media: {
        busy: deps.uploadingAttKey === rowKey(student.id, subject.name),
        full: (rep?.attachments?.length ?? 0) >= REPORT_ATTACHMENT_MAX,
        hasVideo: hasVideoAttachment(rep?.attachments),
      },
    },
    handlers: {
      onNextTest: (v: string) => deps.setNextTestFor(student.id, subject.name, v),
      onWordFeedback: (v: string) => deps.setWordFeedbackFor(student.id, subject.name, v),
      onWordRetest: (on: boolean) => deps.setWordRetestFor(student.id, subject.name, on),
      onVideoFile: (file: File) => void deps.addAttachmentsFor(student, subject.name, [file]),
    },
  });
}
