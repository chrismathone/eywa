"use client";

/**
 * 템플릿 관리 창의 두 조각 — **넣을 칸 칩**과 **미리보기**(2026-09-11 그림 칸을 더하며 창에서 떼어 냈다).
 *
 * 🔑 그림 칸(`{시험결과지}`·`{학습분석지}`)은 글이 아니라 **자리**다 — 칩 모양을 글 칸과 가른다. 실제 그림은 보고서를
 *    저장할 때 서버가 그 학생의 인재원 자료로 채운다(image-slots.ts).
 * 🔑 미리보기는 그 자리에 **실제 결과지 부품**을 예시 자료로 그린다(사용자 2026-09-11 *"들어갑니다 말고 들어가야 할 것
 *    같애 — 그래야 선생님이 뭔지 아닌지 볼 수 있지"*). 폭은 학부모 카드와 같은 512px, 예시 자료라는 사실은 그 위에 적는다
 *    (ijw/sample.ts — 미리보기 전용, 학부모 카드엔 절대 안 쓴다).
 */
import { useMemo } from "react";
import { JjExamSheet } from "@/features/ijw/components/jj-exam-sheet";
import { JjStudySheet } from "@/features/ijw/components/jj-study-sheet";
import { jjSampleFor } from "@/features/ijw/sample";
import { useSheetT } from "@/features/teacher-view/lang-context";
import { ENGLISH_TEMPLATE_TOKENS } from "../defaults";
import { splitImageSlots } from "../image-slots";

/** 넣을 칸 칩 — 누르면 커서 자리에 들어간다(그림 칸은 한 줄을 통째로 차지한다). */
export function TemplateTokenChips({
  disabled,
  onInsert,
}: {
  disabled: boolean;
  onInsert: (key: string, image: boolean) => void;
}) {
  const t = useSheetT();
  return (
    <div className="flex flex-col gap-1">
      <span className="text-text-faint text-xs font-bold">{t("os.tpl.tokens")}</span>
      <div className="flex flex-wrap gap-1">
        {ENGLISH_TEMPLATE_TOKENS.map((tok) => (
          <button
            key={tok.key}
            type="button"
            disabled={disabled}
            onClick={() => onInsert(tok.key, !!tok.image)}
            title={`${tok.label} — ${tok.source}`}
            className={`rounded-md border px-1.5 py-0.5 text-xs font-bold disabled:opacity-50 ${
              tok.image ? "border-primary/40 bg-primary-soft text-primary" : "border-line text-text-dim hover:bg-bg-soft"
            }`}
          >
            {`{${tok.key}}`}
          </button>
        ))}
      </div>
      <p className="text-text-faint text-xs">{t("os.tpl.slotHelp")}</p>
    </div>
  );
}

/**
 * 미리보기 — 채운 글 그대로, 그림 자리 줄엔 예시 자료로 그린 **실제** 결과지(학부모 카드가 그 자리에 그리는 것과 같은 부품).
 * `sampleDate` = 예시 자료의 날짜(원스크린 대상 날짜) — 결과지의 제출일·학습 기간이 그 날짜로 적힌다.
 */
export function TemplatePreview({ text, sampleDate }: { text: string; sampleDate: string }) {
  const t = useSheetT();
  const sample = useMemo(() => jjSampleFor(sampleDate), [sampleDate]);
  const segments = splitImageSlots(text);
  return (
    <div className="border-line bg-bg-soft/50 rounded-lg border px-3 py-2">
      <div className="mx-auto flex min-h-5 w-full max-w-lg flex-col gap-2">
        {segments.map((seg, i) =>
          seg.kind === "text" ? (
            <p key={i} className="text-sm leading-relaxed break-keep whitespace-pre-wrap">
              {seg.text}
            </p>
          ) : seg.kind === "slot" ? (
            <div key={i} className="flex flex-col gap-1">
              <p className="text-primary text-xs font-bold">{t("os.tpl.sampleSheet")}</p>
              {seg.key === "시험결과지" ? (
                <JjExamSheet exam={sample.exam} layout="card" />
              ) : (
                <JjStudySheet study={sample.study} layout="card" />
              )}
            </div>
          ) : (
            // 사진·PDF 자리 줄은 템플릿에 못 넣는다(저장이 거절한다 — validate.ts). 미리보기에서 먼저 알린다.
            <p key={i} className="text-amber text-xs font-bold break-keep">
              {t("os.tpl.attachmentInTemplate")}
            </p>
          ),
        )}
      </div>
    </div>
  );
}
