"use client";

/**
 * 템플릿 관리 창의 두 조각 — **넣을 칸 칩**과 **미리보기**(2026-09-11 그림 칸을 더하며 창에서 떼어 냈다).
 *
 * 🔑 그림 칸(`{시험결과지}`·`{학습분석지}`)은 글이 아니라 **자리**다 — 칩 모양을 글 칸과 가르고, 미리보기는 그 줄을
 *    자리 상자로 그린다. 실제 그림은 보고서를 저장할 때 서버가 인재원 자료로 채운다(image-slots.ts).
 */
import { useSheetT } from "@/features/teacher-view/lang-context";
import { ENGLISH_TEMPLATE_TOKENS } from "../defaults";
import { splitImageSlots, type ImageSlotKey } from "../image-slots";

const SLOT_LABEL_KEY: Record<ImageSlotKey, "os.tpl.slotExam" | "os.tpl.slotStudy"> = {
  시험결과지: "os.tpl.slotExam",
  학습분석지: "os.tpl.slotStudy",
};

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

/** 미리보기 — 채운 글 그대로, 그림 자리 줄만 자리 상자로(학부모 카드가 그 자리에 그림을 그린다). */
export function TemplatePreview({ text }: { text: string }) {
  const t = useSheetT();
  const segments = splitImageSlots(text);
  return (
    <div className="border-line bg-bg-soft/50 flex min-h-9 flex-col gap-2 rounded-lg border px-3 py-2">
      {segments.map((seg, i) =>
        seg.kind === "text" ? (
          <p key={i} className="text-sm leading-relaxed break-keep whitespace-pre-wrap">
            {seg.text}
          </p>
        ) : (
          <div
            key={i}
            className="border-primary/40 bg-primary-soft text-primary rounded-lg border border-dashed px-3 py-3 text-center text-xs font-bold"
          >
            {t(SLOT_LABEL_KEY[seg.key])}
          </div>
        ),
      )}
    </div>
  );
}
