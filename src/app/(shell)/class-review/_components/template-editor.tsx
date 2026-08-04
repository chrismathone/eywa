"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "@/components/icons/eywa-icon-compat";
import { Button } from "@/components/ui/button";
import type { ChecklistArea } from "@/features/class-review/checklist";
import { saveChecklistTemplate, type ReviewActionState } from "@/features/class-review/server/actions";

const inputClass =
  "border-line bg-card text-foreground placeholder:text-text-faint focus:border-primary w-full rounded-lg border px-3 py-2 text-sm outline-none transition";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : null}
      문항 저장
    </Button>
  );
}

/**
 * 문항 편집기 — 영역 제목 + 문항(textarea 한 줄 = 문항 하나). 영역 추가/삭제 가능(1~10개).
 * ⚠️ 문항 수·순서를 바꾸면 **기존 채점의 문항 매칭이 어긋난다** — 진행 중 참관이 있으면 마친 뒤 바꾸는 게 안전.
 */
export function TemplateEditor({ initialAreas }: { initialAreas: ChecklistArea[] }) {
  const [areas, setAreas] = useState(() =>
    initialAreas.map((a) => ({ key: a.key, title: a.title, itemsText: a.items.join("\n") })),
  );
  const [state, formAction] = useActionState<ReviewActionState, FormData>(saveChecklistTemplate, undefined);
  const seenRef = useRef<ReviewActionState>(undefined);
  useEffect(() => {
    if (!state || state === seenRef.current) return;
    seenRef.current = state;
    if (state.error) toast.error(state.error);
    else if (state.ok) toast.success(state.notice ?? "저장했습니다");
  }, [state]);

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

  return (
    <form action={formAction} className="max-w-3xl space-y-4">
      <input type="hidden" name="areasJson" value={areasJson} />

      <div className="border-amber/40 bg-amber/5 text-text-dim rounded-xl border px-4 py-3 text-xs">
        문항 수나 순서를 바꾸면 <b>이미 저장된 채점의 문항 매칭이 어긋날 수 있습니다</b> — 진행 중인 참관을
        마친 뒤 바꾸는 것을 권장합니다. (총점·환산은 문항 수에 맞춰 자동 재계산: 현재 {totalItems}문항 ×
        4점 = {totalItems * 4}점 만점)
      </div>

      {areas.map((a, i) => (
        <section key={i} className="border-line bg-card rounded-2xl border p-4 shadow-card">
          <div className="mb-2 flex items-center gap-2">
            <input
              value={a.title}
              onChange={(e) =>
                setAreas((prev) => prev.map((x, xi) => (xi === i ? { ...x, title: e.target.value } : x)))
              }
              placeholder={`영역 ${i + 1} 제목`}
              aria-label={`영역 ${i + 1} 제목`}
              className={`${inputClass} font-bold`}
            />
            <button
              type="button"
              onClick={() => setAreas((prev) => prev.filter((_, xi) => xi !== i))}
              disabled={areas.length <= 1}
              aria-label={`영역 ${i + 1} 삭제`}
              className="text-text-faint hover:text-danger shrink-0 transition disabled:opacity-25"
            >
              <Trash2 className="size-4" />
            </button>
          </div>
          <textarea
            value={a.itemsText}
            onChange={(e) =>
              setAreas((prev) => prev.map((x, xi) => (xi === i ? { ...x, itemsText: e.target.value } : x)))
            }
            rows={Math.max(4, a.itemsText.split("\n").length + 1)}
            placeholder="한 줄에 문항 하나씩 (영역당 1~20문항)"
            aria-label={`영역 ${i + 1} 문항`}
            className={inputClass}
          />
        </section>
      ))}

      <div className="flex items-center justify-between">
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
        <SubmitButton />
      </div>
    </form>
  );
}
