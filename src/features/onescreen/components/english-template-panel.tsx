"use client";

/**
 * 영어 행 보고서 카드의 **템플릿 칸**(2026-09-10) — 템플릿 고르기 · 다음 시간 테스트 · 다시 채우기 · 글 복사.
 *
 * 수학 행에는 붙지 않는다(카드가 영어 행에서만 이 노드를 그린다). 배선(상태·저장·AI)은 onescreen-client에
 * 두고 이 조각은 자리만 차지한다 — report-card의 `todayInputs`와 같은 슬롯 규약(props 규칙).
 * ⚠️ 카드의 멘트 열 fieldset 안에 들어가므로 결석·발송 완료·열람 전용이면 칸이 함께 잠긴다(따로 잠그지 않는다).
 */
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { SearchableSelect, type ComboOption } from "@/components/ui/searchable-select";
import { useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";
import type { ReportTemplate } from "@/features/report-templates/defaults";

export type EnglishTemplateState = {
  templateId: string;
  nextTest: string;
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
};

export type EnglishTemplateHandlers = {
  onTemplate: (templateId: string) => void;
  onNextTest: (text: string) => void;
  onRefill: () => void;
  onCopy: () => void;
  onManage: () => void;
};

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
    return tp ? (tp.builtIn ? t("os.tpl.builtinName") : tp.name) : "—";
  };
  const options = useMemo<ComboOption[]>(
    () =>
      templates.map((tp) => ({
        value: tp.id,
        // 기본 템플릿 이름은 화면 언어를 따른다(사용자 템플릿 이름은 사용자가 적은 그대로).
        label: tp.builtIn ? t("os.tpl.builtinName") : tp.name,
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
      <label className="flex flex-col gap-1">
        <span className="text-text-faint text-xs font-bold">{t("os.tpl.nextTest")}</span>
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
        {state.templateGone ? (
          <span className="border-amber/40 bg-amber-soft text-amber rounded-pill border px-2 py-0.5 text-xs font-bold">
            {t("os.tpl.templateGone")}
          </span>
        ) : null}
        {state.stale ? (
          <span className="border-amber/40 bg-amber-soft text-amber rounded-pill border px-2 py-0.5 text-xs font-bold">
            {t("os.tpl.stale")}
          </span>
        ) : null}
        {state.needsAi ? (
          <span className="border-amber/40 bg-amber-soft text-amber rounded-pill border px-2 py-0.5 text-xs font-bold">
            {/* 글의 템플릿이 목록에 없으면(삭제) 이름을 적지 않는다 — '템플릿 없음' 칩이 따로 선다. */}
            {state.appliedTemplateId !== state.templateId &&
            templates.some((x) => x.id === state.appliedTemplateId)
              ? tf("os.tpl.needAiPending", { current: templateName(state.appliedTemplateId) })
              : t("os.tpl.needAi")}
          </span>
        ) : null}
        {state.aiStale ? (
          <span className="border-amber/40 bg-amber-soft text-amber rounded-pill border px-2 py-0.5 text-xs font-bold">
            {t("os.tpl.aiStale")}
          </span>
        ) : null}
        {state.nameMissing ? (
          <span className="border-amber/40 bg-amber-soft text-amber rounded-pill border px-2 py-0.5 text-xs font-bold">
            {t("os.tpl.nameMissing")}
          </span>
        ) : null}
      </div>
      {notice ? <p className="text-text-faint text-xs">{notice}</p> : null}
    </div>
  );
}
