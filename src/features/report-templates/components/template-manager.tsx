"use client";

/**
 * 내 보고서 템플릿 관리(2026-09-10) — 목록 · 새로 만들기 · 기본 템플릿 복사 · 고치기 · 지우기 · 미리보기.
 *
 * 🔑 칸(토큰)은 **눌러서 넣는다** — 손으로 `{다음테스트}`를 치다 오타가 나면 그 줄이 조용히 빠지므로
 *    (fill.ts 규칙 4) 입력은 칩이 대신하고, 저장은 validate.ts가 막는다(서버 액션이 같은 검사를 한다).
 * 🔑 미리보기는 실제 채우기 함수(fillReportTemplate)를 그대로 쓴다 — 여기 보이는 글이 학부모가 받는 모양이다.
 */
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";
import {
  BUILTIN_ENGLISH_TEMPLATE,
  ENGLISH_TEMPLATE_TOKENS,
  TEMPLATE_BODY_MAX,
  TEMPLATE_DECORATION_TOKENS,
  TEMPLATE_NAME_MAX,
  TEMPLATE_PREVIEW_SAMPLE,
  type ReportTemplate,
} from "../defaults";
import { fillReportTemplate } from "../fill";
import { deleteMyReportTemplate, saveMyReportTemplate } from "../server/actions";

/** 편집 중인 한 벌 — id가 null이면 아직 저장 안 한 새 템플릿. 기본 템플릿은 읽기 전용. */
type Editing = { id: string | null; name: string; body: string; builtIn: boolean };

const editingOf = (tp: ReportTemplate): Editing => ({
  id: tp.builtIn ? null : tp.id,
  name: tp.name,
  body: tp.body,
  builtIn: tp.builtIn,
});

export function TemplateManager({
  open,
  onOpenChange,
  templates,
  onTemplatesChange,
  teacherName,
  notice,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templates: readonly ReportTemplate[];
  onTemplatesChange: (next: ReportTemplate[]) => void;
  /** 미리보기의 `{작성자}` — 지금 사용자 이름. */
  teacherName: string;
  notice: string | null;
}) {
  const t = useSheetT();
  const tf = useSheetTf();
  const [editing, setEditing] = useState<Editing>(() => editingOf(BUILTIN_ENGLISH_TEMPLATE));
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const teacher = teacherName.trim();
  const preview = useMemo(
    () =>
      fillReportTemplate(
        editing.body,
        { ...TEMPLATE_PREVIEW_SAMPLE, 작성자: teacher ? `${teacher} 선생님` : TEMPLATE_PREVIEW_SAMPLE.작성자 },
        // 실제 채우기와 같은 규칙(꾸밈 토큰) — 미리보기가 학부모 글과 다른 모양을 보여 주지 않게.
        { decorationTokens: TEMPLATE_DECORATION_TOKENS },
      ),
    [editing.body, teacher],
  );
  // 기본 템플릿 이름은 화면 언어를 따른다(사용자 템플릿 이름은 사용자가 적은 그대로).
  const nameOf = (tp: ReportTemplate) => (tp.builtIn ? t("os.tpl.builtinName") : tp.name);
  const isSelected = (tp: ReportTemplate) => (tp.builtIn ? editing.builtIn : editing.id === tp.id);

  function insertToken(key: string) {
    if (editing.builtIn) return;
    const el = bodyRef.current;
    const token = `{${key}}`;
    const start = el?.selectionStart ?? editing.body.length;
    const end = el?.selectionEnd ?? start;
    setEditing((e) => ({ ...e, body: e.body.slice(0, start) + token + e.body.slice(end) }));
    // 넣은 뒤 커서를 토큰 뒤로 — 칩을 연달아 누르면 순서대로 이어 붙는다.
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  async function save() {
    if (editing.builtIn || busy) return;
    setBusy(true);
    try {
      const res = await saveMyReportTemplate({ id: editing.id, name: editing.name, body: editing.body });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      const saved = res.template;
      const exists = templates.some((x) => x.id === saved.id);
      onTemplatesChange(exists ? templates.map((x) => (x.id === saved.id ? saved : x)) : [...templates, saved]);
      setEditing(editingOf(saved));
      toast.success(t("os.tpl.saved"));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    const id = editing.id;
    if (editing.builtIn || !id || busy) return;
    if (!window.confirm(t("os.tpl.deleteConfirm"))) return;
    setBusy(true);
    try {
      const res = await deleteMyReportTemplate(id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      onTemplatesChange(templates.filter((x) => x.id !== id));
      setEditing(editingOf(BUILTIN_ENGLISH_TEMPLATE));
      toast.success(t("os.tpl.deleted"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{t("os.tpl.mgrTitle")}</DialogTitle>
          <DialogDescription>{t("os.tpl.mgrDesc")}</DialogDescription>
        </DialogHeader>
        {notice ? (
          <p className="border-amber/40 bg-amber-soft text-amber rounded-lg border px-2.5 py-1.5 text-xs">{notice}</p>
        ) : null}
        <div className="grid gap-4 md:grid-cols-[200px_minmax(0,1fr)]">
          <nav className="flex flex-col gap-1">
            {templates.map((tp) => (
              <button
                key={tp.id}
                type="button"
                onClick={() => setEditing(editingOf(tp))}
                className={`rounded-lg border px-2.5 py-1.5 text-left text-xs font-bold break-keep ${
                  isSelected(tp) ? "border-primary bg-primary-soft text-primary" : "border-line text-text-dim hover:bg-bg-soft"
                }`}
              >
                {nameOf(tp)}
                {tp.builtIn ? <span className="text-text-faint ml-1 font-medium">· {t("os.tpl.builtIn")}</span> : null}
              </button>
            ))}
            <Button variant="outline" size="sm" onClick={() => setEditing({ id: null, name: "", body: "", builtIn: false })}>
              {t("os.tpl.new")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setEditing({
                  id: null,
                  name: tf("os.tpl.copyName", { name: t("os.tpl.builtinName") }),
                  body: BUILTIN_ENGLISH_TEMPLATE.body,
                  builtIn: false,
                })
              }
            >
              {t("os.tpl.copyBuiltIn")}
            </Button>
          </nav>
          <div className="flex min-w-0 flex-col gap-2">
            {editing.builtIn ? <p className="text-text-faint text-xs">{t("os.tpl.builtInReadonly")}</p> : null}
            <label className="flex flex-col gap-1">
              <span className="text-text-dim text-xs font-bold">{t("os.tpl.name")}</span>
              <input
                value={editing.name}
                readOnly={editing.builtIn}
                maxLength={TEMPLATE_NAME_MAX}
                onChange={(e) => setEditing((x) => ({ ...x, name: e.target.value }))}
                className="border-line bg-card focus:border-primary h-8 rounded-lg border px-2 text-base outline-none sm:text-sm"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-text-dim text-xs font-bold">{t("os.tpl.body")}</span>
              <textarea
                ref={bodyRef}
                value={editing.body}
                readOnly={editing.builtIn}
                maxLength={TEMPLATE_BODY_MAX}
                onChange={(e) => setEditing((x) => ({ ...x, body: e.target.value }))}
                className="border-line bg-card focus:border-primary scrollbar-thin min-h-[220px] resize-y rounded-lg border px-3 py-2 text-base leading-relaxed outline-none sm:text-sm"
              />
            </label>
            <div className="flex flex-col gap-1">
              <span className="text-text-faint text-xs font-bold">{t("os.tpl.tokens")}</span>
              <div className="flex flex-wrap gap-1">
                {ENGLISH_TEMPLATE_TOKENS.map((tok) => (
                  <button
                    key={tok.key}
                    type="button"
                    disabled={editing.builtIn}
                    onClick={() => insertToken(tok.key)}
                    title={`${tok.label} — ${tok.source}`}
                    className="border-line text-text-dim hover:bg-bg-soft rounded-md border px-1.5 py-0.5 text-xs font-bold disabled:opacity-50"
                  >
                    {`{${tok.key}}`}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-text-faint text-xs font-bold">{t("os.tpl.preview")}</span>
              {preview.unknownTokens.length ? (
                <p className="text-amber text-xs font-bold">
                  {tf("os.tpl.unknown", { tokens: preview.unknownTokens.map((k) => `{${k}}`).join(", ") })}
                </p>
              ) : null}
              <p className="border-line bg-bg-soft/50 rounded-lg border px-3 py-2 text-sm leading-relaxed break-keep whitespace-pre-wrap">
                {preview.text}
              </p>
            </div>
            {editing.builtIn ? null : (
              <div className="flex flex-wrap justify-end gap-1.5">
                {editing.id ? (
                  <Button variant="ghost" size="sm" onClick={() => void remove()} disabled={busy}>
                    {t("os.tpl.delete")}
                  </Button>
                ) : null}
                <Button size="sm" onClick={() => void save()} disabled={busy}>
                  {t("os.tpl.save")}
                </Button>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
