"use client";

import { EyIcon } from "@/components/icons/aywa-icons";
import { Button } from "@/components/ui/button";
import { ATTITUDE } from "../attitude";
import { canRemoveMakeupRow } from "../makeup-remove-plan";
import { ReportCard } from "./report-card";
import { ONESCREEN_EMPTY_SPAN } from "./onescreen-card-layout";
import type { OneScreenStudent } from "../types";
import type {
  CardColumnCardActions,
  CardColumnContext,
  CardColumnEnglish,
  CardColumnRow,
  CardColumnRowActions,
} from "./onescreen-card-types";
import { cardReasonSlots } from "./onescreen-card-reasons";
import { cardTodayInputs } from "./onescreen-card-today-inputs";
import { cardTemplateManager, cardTemplatePanel } from "./onescreen-card-english";
import { useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";

/**
 * 카드 뷰 가운데 열(보고서 작성) — 수정 계획 P3-O 10/10, `onescreen-client.tsx`의 `reportColumn` JSX를 그대로 옮긴 것.
 * 선택 학생이 없으면 '학생을 고르세요' 빈 칸. 상태는 전부 화면이 들고, 여기는 그리기와 배선만 한다
 * (화면 문구 사전은 같은 공급자에서 직접 읽는다).
 * batch D: 묶음 props 모양 = onescreen-card-types.ts · 카드 칸(사유 셋 · 오늘 진도·테스트 · 영어 템플릿 칸·관리 창)은
 *    onescreen-card-reasons.tsx · onescreen-card-today-inputs.tsx · onescreen-card-english.tsx의 **그리기 함수**다(요소 트리 그대로).
 *    머리·빈 칸·보고서 카드 조립(key · 선택 학생이 있을 때만 마운트)은 여기 그대로다.
 */
export function OneScreenCardColumn({
  selected,
  ctx,
  row,
  card,
  rowActions,
  english,
}: {
  selected: OneScreenStudent | null;
  ctx: CardColumnContext;
  row: CardColumnRow;
  card: CardColumnCardActions;
  rowActions: CardColumnRowActions;
  english: CardColumnEnglish;
}) {
  const {
    view,
    readonlyView,
    classnoteOn,
    showAttachments,
    canEditAttendance,
    noticeMode,
    academyNoticeMode,
    genSubject,
    attPending,
    attUrls,
    uploadingAttKey,
  } = ctx;
  const { previewSubject, previewReport, subjectIdx, reports } = row;
  const {
    setAttitude,
    setHomework,
    setTextbook,
    setHomeworkToday,
    toggleMakeup,
    toggleVideoHomework,
    toggleVideoSubmitLink,
    setVideoHomeworkDue,
    setSubjectDraft,
    setSubjectTrend,
    setNote,
    autoWriteSubject,
    sendSubject,
    queueClassnote,
    revokeShare,
    reissueShare,
    addAttachments,
    removeAttachment,
    setBulkOpen,
    setCardSubject,
    openNoticeForStudent,
  } = card;
  const {
    removeMakeupRow,
    pickMakeupClass,
    joinMakeupRow,
    splitMakeupRow,
    checkMakeup,
    isTrendHiddenFor,
    toggleTrendHiddenFor,
    setAttendanceFor,
  } = rowActions;
  const { englishRowFlags } = english;
  const t = useSheetT();
  const tf = useSheetTf();
  return (
    selected ? (
      /* 가운데(보고서 작성) — 넘치면 이 열만 스크롤. 열 개수는 배율 상자 안 컨테이너 폭이 정한다.
         한 열로 쌓이면 높이를 압축하지 않고 페이지가 스크롤된다. 표의 상세 창은 기존 열 스크롤을 쓴다. */
      <div className="scrollbar-thin flex min-h-0 min-w-0 flex-col gap-3 lg:min-h-0 lg:overflow-y-auto lg:pr-1 @max-[846px]/oscard:overflow-visible">
        <header className="flex items-center gap-1.5">
          <EyIcon name="report" size={14} className="text-primary" />
          <h2 className="text-foreground text-sm font-bold">{t("os.c.reportHeading")}</h2>
          {view === "card" ? <Button variant="outline" size="sm" onClick={() => setBulkOpen(true)}>{t("os.card.bulk")}</Button> : null}
          {classnoteOn ? (
            <button
              type="button"
              onClick={() => openNoticeForStudent(selected.id)}
              title={t("os.c.parentNoticeTitle")}
              className="border-line text-text-dim hover:bg-bg-soft ml-auto rounded-lg border px-2 py-0.5 text-xs font-bold"
            >
              {t("os.c.parentNotice")}
            </button>
          ) : null}
        </header>
        <ReportCard
          key={selected.id}
          student={selected}
          reports={reports[selected.id] ?? {}}
          trendOptOut={{
            hidden: (subjectName) => isTrendHiddenFor(selected.id, subjectName),
            toggle: (subjectName) => toggleTrendHiddenFor(selected.id, subjectName),
          }}
          attendance={{
            readOnly: !canEditAttendance,
            pendingKeys: attPending,
            onSet: (classId, s, extra) => setAttendanceFor(selected.id, classId, s, extra),
          }}
          fields={{
            readonlyView: readonlyView,
            attitudes: ATTITUDE,
            generatingSubject: genSubject,
            attachmentUrls: attUrls,
            uploadingSubject:
              selected && uploadingAttKey?.startsWith(`${selected.id}::`)
                ? uploadingAttKey.slice(selected.id.length + 2)
                : null,
            attachmentsHidden: !showAttachments,
            // 실효 모드 = 강사 오버라이드 ?? 학원 기본 — 상단 토글이 하단 보고서 입력 구성을 실제로 바꾼다.
            noticeMode: noticeMode ?? academyNoticeMode,
            // 과목 칩 선택을 부모가 들고 있다 — 옆 열 미리보기가 "지금 보는 과목"을 그려야 하기 때문.
            subjectIndex: subjectIdx,
            // 영어 행 — 학부모 링크 복사도 발송·복사와 같은 확인을 거친다(링크는 저장된 글을 그대로 보여 준다).
            shareCopyWarning:
              previewSubject?.subjectKey === "english" &&
              englishRowFlags(selected, previewSubject, previewReport).outdated
                ? t("os.tpl.outdatedLink")
                : null,
          }}
          rowActions={{
            onAttitude: setAttitude,
            onHomework: setHomework,
            onTextbook: setTextbook,
            onHomeworkToday: setHomeworkToday,
            onMakeup: toggleMakeup,
            onVideoHomework: toggleVideoHomework,
            onVideoSubmitLink: toggleVideoSubmitLink,
            onVideoHomeworkDue: setVideoHomeworkDue,
            onRemoveMakeup: (subjectName) => void removeMakeupRow(selected, subjectName),
            onJoinMakeup: (subjectName) => void joinMakeupRow(selected, subjectName),
            onSplitMakeup: (subjectName) => void splitMakeupRow(selected, subjectName),
            onPickMakeupClass: (subjectName) => void pickMakeupClass(selected, subjectName),
            onCheckMakeup: (subjectName, outcome) => void checkMakeup(selected, subjectName, outcome),
            canRemoveMakeup: (subjectName) =>
              canRemoveMakeupRow(reports[selected.id]?.[subjectName]?.classnoteStatus ?? null),
            onSubjectDraft: setSubjectDraft,
            onSubjectTrend: setSubjectTrend,
            onNote: setNote,
            onAutoWrite: autoWriteSubject,
            onSend: sendSubject,
            onQueueClassnote: queueClassnote,
            onRevoke: revokeShare,
            onReissue: reissueShare,
            onAddFiles: addAttachments,
            onRemoveAttachment: removeAttachment,
            onSubjectIndex: (i) => setCardSubject({ id: selected.id, idx: i }),
          }}
          slots={{
            // 사유 칸 셋(숙제 미제출 · 수업 태도 의견 · 보강 사유 — 이 차례로) — onescreen-card-reasons.tsx.
            ...cardReasonSlots({ selected, ctx, row, rowActions }),
            // 오늘 진도·테스트 = 보고서 카드의 첫 열 — 카드엔 노드만 넘긴다(onescreen-card-today-inputs.tsx).
            todayInputs: cardTodayInputs({ selected, ctx, row, card, rowActions, tf }),
            // 영어 행 템플릿 칸(2026-09-10) — 영어 행에서만 그린다(카드도 영어 행일 때만 이 자리를 쓴다).
            templatePanel: cardTemplatePanel({ selected, ctx, row, english, rowActions, t }),
          }}
        />
        {cardTemplateManager({ ctx, row, english, t })}
      </div>
    ) : (
      <div className={`bg-card border-line shadow-card text-text-faint flex items-center justify-center rounded-2xl border p-10 text-sm ${ONESCREEN_EMPTY_SPAN}`}>
        {t("os.c.pickStudent")}
      </div>
    )
  );
}
