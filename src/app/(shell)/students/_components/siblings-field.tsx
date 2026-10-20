"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "@/components/icons/aywa-icon-compat";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { loadSiblingOptions } from "@/features/students/server/sibling-actions";
import type { SiblingOption } from "@/features/students/siblings";

/**
 * 학생 수정 화면의 '형제' 칸(원장 2026-10-19 *"수동 배정도 가능하게 해주고. (수동 이전에 매핑되는 학생 있으면 자동 추천 및 입력)"*).
 * - 처음엔 학부모 휴대폰·이름이 같은 원생(자동 판정)과 이미 지정한 형제가 들어 있다 — 아니면 ×로 뺀다(뺀 자동 추천은 다시 안 들어온다).
 * - 학부모 이름만 같고 휴대폰이 다른 원생은 '확인 후보'로만 보인다(눌러야 들어간다).
 * - 다른 원생은 이름으로 찾아 넣는다. 목록은 칸을 처음 열 때 불러온다.
 * 저장은 학생 수정 저장과 함께(`updateStudent` → `saveStudentSiblings`). 값은 숨은 칸으로 싣는다 — 초안 자동저장에서는 뺀다(폼이 `exclude`).
 */
export const SIBLING_FIELD_NAMES = ["siblingsField", "siblings", "siblingsInitial", "siblingsSuggested"];

export function SiblingsField({ studentId, initial, review, suggested }: {
  studentId: string;
  initial: SiblingOption[];
  review: SiblingOption[];
  /** 지금 자동 판정이 형제라 하는 원생 전부 — 화면에서 뺀 것은 저장 때 '형제 아님'이 된다(지정해 둔 것을 빼도 다시 안 들어온다). */
  suggested: string[];
}) {
  const [chosen, setChosen] = useState<SiblingOption[]>(initial);
  const [options, setOptions] = useState<SiblingOption[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const hiddenRef = useRef<HTMLInputElement>(null);
  const first = useRef(true);

  // 미저장 가드·동시편집 가드는 폼의 input 이벤트로 바뀐 것을 안다 — 숨은 칸은 이벤트를 안 내니 대신 낸다.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    hiddenRef.current?.dispatchEvent(new Event("input", { bubbles: true }));
  }, [chosen]);

  const load = async () => {
    if (state === "loading" || state === "ready") return;
    setState("loading");
    const res = await loadSiblingOptions(studentId);
    if (!res.ok) {
      setState("error");
      return;
    }
    setOptions(res.options);
    setState("ready");
  };
  const add = (o: SiblingOption | undefined) => {
    if (o && !chosen.some((c) => c.value === o.value)) setChosen((prev) => [...prev, { ...o, auto: false }]);
  };
  const remove = (value: string) => setChosen((prev) => prev.filter((c) => c.value !== value));
  const pending = review.filter((r) => !chosen.some((c) => c.value === r.value));

  return (
    <div className="space-y-2 sm:col-span-2 lg:col-span-3">
      <input type="hidden" name="siblingsField" value="1" />
      <input ref={hiddenRef} type="hidden" name="siblings" value={JSON.stringify(chosen.map((c) => c.value))} />
      {/* 저장은 바꾼 것만 — 열 때의 칩(initial)과 남은 칩(siblings)을 견준다(`planSiblingSave`). */}
      <input type="hidden" name="siblingsInitial" value={JSON.stringify(initial.map((o) => o.value))} />
      <input type="hidden" name="siblingsSuggested" value={JSON.stringify(suggested)} />
      <span className="text-sm font-medium">형제</span>
      <div className="flex flex-wrap items-center gap-1.5">
        {chosen.map((c) => (
          <span key={c.value} className="bg-bg-soft border-border inline-flex items-center gap-1.5 rounded-full border py-1 pr-1.5 pl-3 text-sm">
            {c.label}
            {c.hint ? <span className="text-text-dim text-xs">{c.hint}</span> : null}
            {c.auto ? <span className="text-primary text-xs">자동 추천</span> : null}
            <button type="button" onClick={() => remove(c.value)} aria-label={`${c.label} 빼기`} className="text-text-dim hover:text-foreground rounded-full p-0.5">
              <X className="size-3.5" />
            </button>
          </span>
        ))}
        <SearchableSelect
          options={options.filter((o) => !chosen.some((c) => c.value === o.value))}
          value=""
          onValueChange={(v) => add(options.find((o) => o.value === v))}
          onOpenChange={(open) => { if (open) void load(); }}
          requireQuery
          placeholder="+ 원생 이름으로 찾기"
          searchPlaceholder={state === "loading" ? "목록을 불러오는 중…" : state === "error" ? "목록을 불러오지 못했습니다" : "원생 이름"}
          ariaLabel="형제 추가"
          className="min-w-48 flex-1 sm:max-w-xs"
          portal
        />
      </div>
      {pending.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-text-dim">학부모 이름만 같은 원생(연락처 다름):</span>
          {pending.map((r) => (
            <button key={r.value} type="button" onClick={() => add(r)} className="border-border hover:bg-bg-soft rounded-full border px-2.5 py-0.5">
              + {r.label} <span className="text-text-dim">{r.hint}</span>
            </button>
          ))}
        </div>
      ) : null}
      {initial.some((o) => o.auto) ? (
        <p className="text-text-dim text-xs">학부모 휴대폰·이름이 같은 원생을 미리 넣어 두었습니다(자동 추천). 형제가 아니면 ×로 빼세요.</p>
      ) : null}
    </div>
  );
}
