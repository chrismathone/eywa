"use client";

/**
 * 영어 행 보고서 카드의 **템플릿 칸**(2026-09-10) — 템플릿 고르기 · 다음 시간 테스트 · 다시 채우기 · 글 복사
 * · 사진·PDF 넣기(2026-09-11, 글의 커서 줄에 첨부 자리를 넣는다) · 인재원 한 줄(english-jj-status-line.tsx).
 *
 * 수학 행에는 붙지 않는다(카드가 영어 행에서만 이 노드를 그린다). 배선(상태·저장·AI·업로드)은 onescreen-client에
 * 두고 이 조각은 자리만 차지한다 — report-card의 `todayInputs`와 같은 슬롯 규약(props 규칙).
 * ⚠️ 카드의 멘트 열 fieldset 안에 들어가므로 결석·발송 완료·열람 전용이면 칸이 함께 잠긴다(따로 잠그지 않는다).
 */
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { SearchableSelect, type ComboOption } from "@/components/ui/searchable-select";
import { useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";
import { builtinTemplateLabelKey, type ReportTemplate } from "@/features/report-templates/defaults";
import { EnglishMediaButton } from "./english-media-button";
import { JjStatusLine, type EnglishJjStatus } from "./english-jj-status-line";
import { JjExamPicker, type JjExamPickState } from "./english-jj-exam-picker";

export type { EnglishJjStatus } from "./english-jj-status-line";

export type EnglishTemplateState = {
  templateId: string;
  nextTest: string;
  /** EiE 일일 보고서(원장 2026-11-06) — 단어 테스트 피드백 · 재시험. `wordFields` = 그 칸을 쓰는 템플릿이라 칸을 연다. */
  wordFeedback: string;
  wordRetest: boolean;
  wordFields: boolean;
  /** 지금 글에 학생 이름이 없다(저장값이 아니라 **지금 글** 기준 — 새로고침·일괄 작성 뒤에도 맞다). */
  nameMissing: boolean;
  /** 템플릿이나 진도·숙제·테스트 칸이 마지막으로 채운 글과 달라졌다(다시 채우기 필요). */
  stale: boolean;
  /** AI 인사말·코멘트가 고치기 전 값으로 쓰였다 — 저장·다시 채우기로는 안 풀리고 자동작성을 다시 눌러야 한다. */
  aiStale: boolean;
  /** 템플릿 글인데 AI 글이 아직 없다(AI 칸 템플릿으로 바꾼 뒤 등) — 해법은 자동작성. */
  needsAi: boolean;
  /** 글의 템플릿이 목록에서 사라졌다(삭제) — 다시 골라야 한다. */
  templateGone: boolean;
  /** 지금 글을 실제로 만든 템플릿 — 드롭다운(`templateId`)이 대기 중인 선택이면 둘이 다르다. */
  appliedTemplateId: string;
  /** 그 행의 인재원 하루치(그림 칸 재료) 요약. */
  jj: EnglishJjStatus;
  /** 결과지 고르기 재료 — 인재원 자료를 받았을 때만(미연결·실패·받는 중엔 null). */
  jjPick: JjExamPickState | null;
  /** 짝을 이을 수 있는 사람인가 — 미연결 줄에 짝 잇기 링크를 달지(아니면 관리자에게 요청하라고 적는다). */
  canLinkJj: boolean;
  /** 글 속 사진·PDF — 올리는 중 · 첨부가 가득 참(서버 상한과 같은 수). */
  media: { busy: boolean; full: boolean };
};

export type EnglishTemplateHandlers = {
  onTemplate: (templateId: string) => void;
  onNextTest: (text: string) => void;
  onWordFeedback: (text: string) => void;
  onWordRetest: (on: boolean) => void;
  onRefill: () => void;
  onCopy: () => void;
  onManage: () => void;
  /**
   * 인재원 하루치 **새로** 받기 — 모든 상태에서 보인다(수업 중 본 시험·방금 이은 짝을 바로 반영하게, 적대 리뷰 2026-09-11).
   */
  onJjRetry: () => void;
  /** 결과지 고르기를 바꿨다(`null` = 기본으로) — 부모가 새 고르기로 다시 받는다. */
  onJjPick: (pick: string[] | null) => void;
  /** 고른(사진이면 자른) 파일 — 부모가 올리고 글의 커서 줄에 첨부 자리를 넣는다. */
  onInsertFile: (file: File) => void;
};

/** 알림 칩 한 개 — 모양이 모두 같다(앰버 = 사람이 손쓸 일). */
function Chip({ children }: { children: string }) {
  return (
    <span className="border-amber/40 bg-amber-soft text-amber rounded-pill border px-2 py-0.5 text-xs font-bold">
      {children}
    </span>
  );
}

export function EnglishTemplatePanel({
  templates,
  state,
  notice,
  handlers,
}: {
  templates: readonly ReportTemplate[];
  state: EnglishTemplateState;
  /** 템플릿 목록을 못 불러왔을 때의 안내(한글 한 줄) — 기본 템플릿은 그대로 쓸 수 있다. */
  notice: string | null;
  handlers: EnglishTemplateHandlers;
}) {
  const t = useSheetT();
  const tf = useSheetTf();
  // 칩에 적을 템플릿 이름(기본 템플릿은 화면 언어를 따른다) — 목록에 없으면 이름을 지어내지 않는다.
  const templateName = (id: string) => {
    const tp = templates.find((x) => x.id === id);
    return tp ? (tp.builtIn ? t(builtinTemplateLabelKey(tp.id)) : tp.name) : "—";
  };
  const options = useMemo<ComboOption[]>(
    () =>
      templates.map((tp) => ({
        value: tp.id,
        // 기본 템플릿 이름은 화면 언어를 따른다(사용자 템플릿 이름은 사용자가 적은 그대로).
        label: tp.builtIn ? t(builtinTemplateLabelKey(tp.id)) : tp.name,
        hint: tp.builtIn ? t("os.tpl.builtIn") : undefined,
      })),
    [templates, t],
  );
  return (
    <div className="border-line bg-bg-soft/40 flex flex-col gap-2 rounded-lg border p-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-text-dim shrink-0 text-xs font-bold">{t("os.tpl.label")}</span>
        <SearchableSelect
          options={options}
          value={state.templateId}
          onValueChange={(v) => v && handlers.onTemplate(v)}
          ariaLabel={t("os.tpl.label")}
          placeholder={t("os.tpl.label")}
          searchPlaceholder={t("os.tpl.search")}
          className="min-w-0 flex-1"
          // 이웃 입력칸과 같은 치수(FieldSelect 규약: h-8 · px-2 · text-xs · rounded-lg).
          triggerClassName="border-line bg-card text-foreground focus:border-primary h-8 w-full rounded-lg border px-2 text-xs outline-none"
        />
        <Button variant="outline" size="sm" onClick={handlers.onManage}>
          {t("os.tpl.manage")}
        </Button>
      </div>
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
          <label className="flex flex-col gap-1">
            <span className="text-text-faint text-xs font-bold">{t("os.tpl.wordFeedback")}</span>
            <textarea
              value={state.wordFeedback}
              onChange={(e) => handlers.onWordFeedback(e.target.value)}
              placeholder={t("os.tpl.wordFeedbackPh")}
              rows={2}
              maxLength={1000}
              // iOS 확대 방지 — 좁은 화면만 16px(아래 입력칸과 같은 규약).
              className="border-line bg-card focus:border-primary rounded-lg border px-2 py-1 text-base outline-none sm:text-xs"
            />
          </label>
        </>
      ) : null}
      <label className="flex flex-col gap-1">
        <span className="text-text-faint text-xs font-bold">{t(state.wordFields ? "os.tpl.nextWordTest" : "os.tpl.nextTest")}</span>
        <input
          value={state.nextTest}
          onChange={(e) => handlers.onNextTest(e.target.value)}
          placeholder={t("os.tpl.nextTestPh")}
          // iOS는 16px 미만 입력칸에 초점이 가면 화면을 확대한다 — 좁은 화면만 16px(카드 다른 칸과 같은 규약).
          className="border-line bg-card focus:border-primary h-8 rounded-lg border px-2 text-base outline-none sm:text-xs"
        />
      </label>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button variant="ghost" size="sm" onClick={handlers.onRefill} title={t("os.tpl.refillTitle")}>
          {t("os.tpl.refill")}
        </Button>
        <Button variant="ghost" size="sm" onClick={handlers.onCopy}>
          {t("os.tpl.copy")}
        </Button>
        {state.templateGone ? <Chip>{t("os.tpl.templateGone")}</Chip> : null}
        {state.stale ? <Chip>{t("os.tpl.stale")}</Chip> : null}
        {state.needsAi ? (
          <Chip>
            {/* 글의 템플릿이 목록에 없으면(삭제) 이름을 적지 않는다 — '템플릿 없음' 칩이 따로 선다. */}
            {state.appliedTemplateId !== state.templateId && templates.some((x) => x.id === state.appliedTemplateId)
              ? tf("os.tpl.needAiPending", { current: templateName(state.appliedTemplateId) })
              : t("os.tpl.needAi")}
          </Chip>
        ) : null}
        {state.aiStale ? <Chip>{t("os.tpl.aiStale")}</Chip> : null}
        {state.nameMissing ? <Chip>{t("os.tpl.nameMissing")}</Chip> : null}
      </div>
      {/* 글 속 사진·PDF — 커서가 있던 줄 아래에 들어간다(학부모 링크·PDF·ClassNote 이미지에 그 자리 그대로). */}
      <div className="flex flex-wrap items-center gap-1.5">
        <EnglishMediaButton disabled={state.media.full} busy={state.media.busy} onFile={handlers.onInsertFile} />
        <span className="text-text-faint min-w-0 flex-1 text-xs break-keep">
          {state.media.full ? t("os.media.full") : t("os.media.help")}
        </span>
      </div>
      <JjStatusLine jj={state.jj} canLink={state.canLinkJj} onRetry={handlers.onJjRetry} />
      {state.jjPick ? <JjExamPicker state={state.jjPick} onPick={handlers.onJjPick} /> : null}
      {notice ? <p className="text-text-faint text-xs">{notice}</p> : null}
    </div>
  );
}
