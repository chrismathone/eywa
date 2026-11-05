"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "@/components/icons/aywa-icon-compat";
import { Button } from "@/components/ui/button";
import type { ChecklistArea } from "@/features/class-review/checklist";
import {
  deleteChecklistTemplate,
  saveChecklistTemplate,
  type ReviewActionState,
} from "@/features/class-review/server/actions";
import { writeLockedNote, writeLockedPlaceholder } from "@/lib/write-lock";

const inputClass =
  "border-line bg-card text-foreground placeholder:text-text-faint focus:border-primary w-full rounded-lg border px-3 py-2 text-sm outline-none transition disabled:cursor-not-allowed disabled:opacity-70";

function SubmitButton({ isNew }: { isNew: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : null}
      {isNew ? "세트 만들기" : "문항 저장"}
    </Button>
  );
}

/**
 * 문항 세트 편집기 — 세트 이름 + 영역 제목 + 문항(textarea 한 줄 = 문항 하나). 영역 1~10개.
 * templateId 없으면 새 세트 생성(저장 시 그 세트 편집 화면으로 이동).
 * 기존 평가지는 생성 시점 스냅샷이라 세트를 고치거나 지워도 안 흔들린다 — 새 평가부터 적용.
 * `canWrite=false`(읽기 권한) — 칸은 잠그고 안내를 띄우며, 영역 추가·삭제·세트 삭제·저장 단추는 그리지 않는다(원장 2026-11-05).
 */
export function TemplateEditor({
  templateId,
  initialName,
  initialAreas,
  canWrite,
}: {
  templateId?: string;
  initialName: string;
  initialAreas: ChecklistArea[];
  /** 서버(page)가 canWriteTenant("class_review")로 정한 값 — 저장·삭제 액션과 같은 판정. */
  canWrite: boolean;
}) {
  const locked = !canWrite;
  const lockedPlaceholder = writeLockedPlaceholder("class_review");
  const [name, setName] = useState(initialName);
  const [areas, setAreas] = useState(() =>
    initialAreas.map((a) => ({ key: a.key, title: a.title, itemsText: a.items.join("\n") })),
  );
  const [state, formAction] = useActionState<ReviewActionState, FormData>(saveChecklistTemplate, undefined);
  const [delState, delAction] = useActionState<ReviewActionState, FormData>(deleteChecklistTemplate, undefined);
  const seenRef = useRef<ReviewActionState>(undefined);
  const seenDelRef = useRef<ReviewActionState>(undefined);
  useEffect(() => {
    if (state && state !== seenRef.current) {
      seenRef.current = state;
      if (state.error) toast.error(state.error);
      else if (state.ok) toast.success(state.notice ?? "저장했습니다");
    }
    if (delState && delState !== seenDelRef.current) {
      seenDelRef.current = delState;
      if (delState.error) toast.error(delState.error);
    }
  }, [state, delState]);

  const areasJson = JSON.stringify(
    areas.map((a) => ({
      key: a.key,
      title: a.title,
      items: a.itemsText.split("\n").map((l) => l.trim()).filter(Boolean),
    })),
  );
  const totalItems = areas.reduce(
    (n, a) => n + a.itemsText.split("\n").filter((l) => l.trim()).length,
    0,
  );

  const handleDelete = () => {
    if (!templateId) return;
    if (!window.confirm(`'${name || "이 세트"}'를 삭제할까요? 이미 만든 평가지는 영향 없습니다.`)) return;
    const fd = new FormData();
    fd.set("templateId", templateId);
    startTransition(() => delAction(fd));
  };

  return (
    <form action={formAction} className="max-w-3xl space-y-4">
      {templateId ? <input type="hidden" name="templateId" value={templateId} /> : null}
      <input type="hidden" name="areasJson" value={areasJson} />

      {/* 세트 이름·문항은 값이 차 있어 placeholder로는 알릴 수 없다 — 편집기 위에 한 줄. */}
      {locked ? <p className="text-text-dim text-sm" role="status">{writeLockedNote("class_review")}</p> : null}

      <div className="bg-card rounded-2xl p-4 shadow-card">
        <label htmlFor="cr-set-name" className="micro mb-1 block">
          세트 이름
        </label>
        <input
          id="cr-set-name"
          name="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={locked}
          placeholder={locked ? lockedPlaceholder : "예: 1번 문항 세트 · 신입 강사용"}
          className={inputClass}
        />
      </div>

      <div className="border-amber/40 bg-amber/5 text-text-dim rounded-xl border px-4 py-3 text-xs">
        세트를 고쳐도 <b>이미 만든 평가지는 만들 당시 문항을 그대로 유지</b>합니다 — 바뀐 문항은 새
        평가부터 적용됩니다. (총점·환산은 문항 수에 맞춰 자동 재계산: 현재 {totalItems}문항 × 4점 ={" "}
        {totalItems * 4}점 만점)
      </div>

      {areas.map((a, i) => (
        <section key={i} className="bg-card rounded-2xl p-4 shadow-card">
          <div className="mb-2 flex items-center gap-2">
            <input
              value={a.title}
              onChange={(e) =>
                setAreas((prev) => prev.map((x, xi) => (xi === i ? { ...x, title: e.target.value } : x)))
              }
              disabled={locked}
              placeholder={locked ? lockedPlaceholder : `영역 ${i + 1} 제목`}
              aria-label={`영역 ${i + 1} 제목`}
              className={`${inputClass} font-bold`}
            />
            {canWrite ? (
              <button
                type="button"
                onClick={() => setAreas((prev) => prev.filter((_, xi) => xi !== i))}
                disabled={areas.length <= 1}
                aria-label={`영역 ${i + 1} 삭제`}
                className="text-text-faint hover:text-danger shrink-0 transition disabled:opacity-25"
              >
                <Trash2 className="size-4" />
              </button>
            ) : null}
          </div>
          <textarea
            value={a.itemsText}
            onChange={(e) =>
              setAreas((prev) => prev.map((x, xi) => (xi === i ? { ...x, itemsText: e.target.value } : x)))
            }
            disabled={locked}
            rows={Math.max(4, a.itemsText.split("\n").length + 1)}
            placeholder={locked ? lockedPlaceholder : "한 줄에 문항 하나씩 (영역당 1~20문항)"}
            aria-label={`영역 ${i + 1} 문항`}
            className={inputClass}
          />
        </section>
      ))}

      {/* 읽기 권한이면 쓰기 단추 줄 자체를 그리지 않는다(비활성으로 남기지 않는다). */}
      {canWrite ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={areas.length >= 10}
            onClick={() =>
              setAreas((prev) => [...prev, { key: `area_${prev.length + 1}`, title: "", itemsText: "" }])
            }
          >
            <Plus className="size-3.5" /> 영역 추가
          </Button>
          <span className="flex items-center gap-2">
            {templateId ? (
              <Button type="button" variant="outline" size="sm" onClick={handleDelete}>
                <Trash2 className="size-3.5" /> 세트 삭제
              </Button>
            ) : null}
            <SubmitButton isNew={!templateId} />
          </span>
        </div>
      ) : null}
    </form>
  );
}
