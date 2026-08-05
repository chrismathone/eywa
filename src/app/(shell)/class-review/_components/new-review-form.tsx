"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { Loader2 } from "@/components/icons/eywa-icon-compat";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { createClassReview, type ReviewActionState } from "@/features/class-review/server/actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : null}
      평가 만들기
    </Button>
  );
}

/**
 * 새 평가 폼 — 강사(필수) + 과목·문항 세트(선택) + 평가자 방식 두 가지(원장 지시 2026-08-04):
 * ① 평가자 지정(최대 3명) ② 선착순 3명(지정 없이, 권한자 중 먼저 채점한 3명이 평가자).
 * 반명·회차·수업시간·학생수는 입력받지 않고, **날짜도 안 받는다**(2026-08-05 — 생성 당일 자동).
 * 호칭은 "평가자"(원장 지시 2026-08-05 — "참관자 아니고 평가자") — 데이터 키(observer*)는 불변.
 */
export function NewReviewForm({
  staff,
  subjects,
  templates,
}: {
  staff: { value: string; label: string }[];
  subjects: { value: string; label: string }[];
  /** 문항 세트 선택지(만든 순) — 비어 있으면 내장 기본 문항 사용(선택 UI 숨김). */
  templates: { value: string; label: string }[];
}) {
  const [mode, setMode] = useState<"assigned" | "open">("assigned");
  const [state, formAction] = useActionState<ReviewActionState, FormData>(createClassReview, undefined);
  const seenRef = useRef<ReviewActionState>(undefined);
  useEffect(() => {
    if (!state || state === seenRef.current) return;
    seenRef.current = state;
    if (state.error) toast.error(state.error);
  }, [state]);

  return (
    <form action={formAction} className="bg-card max-w-2xl space-y-4 rounded-2xl p-5 shadow-card">
      <input type="hidden" name="observerMode" value={mode} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="micro mb-1 block">평가 대상 강사 *</label>
          <SearchableSelect name="teacherId" options={staff} placeholder="강사 선택" ariaLabel="평가 대상 강사" />
        </div>
        <div>
          <label className="micro mb-1 block">과목 (선택)</label>
          <SearchableSelect name="subject" options={subjects} placeholder="과목 선택" ariaLabel="과목" />
        </div>
        {templates.length > 0 ? (
          <div className="sm:col-span-2">
            <label className="micro mb-1 block">문항 세트</label>
            <SearchableSelect
              name="templateId"
              options={templates}
              defaultValue={templates[0].value}
              placeholder="문항 세트 선택"
              ariaLabel="문항 세트"
            />
          </div>
        ) : null}
      </div>
      <p className="text-text-faint text-[11px]">날짜는 따로 입력하지 않습니다 — 생성한 날이 평가일로 기록됩니다.</p>

      <div className="border-line border-t pt-4">
        <p className="micro mb-2">평가자 방식</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          {(
            [
              { v: "assigned", t: "평가자 지정", d: "아래에서 최대 3명을 지정합니다" },
              { v: "open", t: "선착순 3명", d: "지정 없이 — 먼저 채점한 3명이 평가자가 됩니다" },
            ] as const
          ).map((o) => (
            <button
              key={o.v}
              type="button"
              onClick={() => setMode(o.v)}
              aria-pressed={mode === o.v}
              className={`flex-1 rounded-xl border px-4 py-3 text-left transition ${
                mode === o.v ? "border-primary bg-primary/5" : "border-line hover:border-primary/40"
              }`}
            >
              <span className={`block text-sm font-bold ${mode === o.v ? "text-primary" : "text-foreground"}`}>
                {o.t}
              </span>
              <span className="text-text-dim mt-0.5 block text-[11px]">{o.d}</span>
            </button>
          ))}
        </div>

        {mode === "assigned" ? (
          <div className="mt-3">
            <p className="micro mb-2">
              평가자 (최대 3명 — 평가 대상 본인은 자동으로 &lsquo;본인 평가&rsquo; 자리에 들어갑니다)
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <SearchableSelect name="observer1" options={staff} placeholder="평가자 A" ariaLabel="평가자 A" />
              <SearchableSelect name="observer2" options={staff} placeholder="평가자 B" ariaLabel="평가자 B" />
              <SearchableSelect name="observer3" options={staff} placeholder="평가자 C" ariaLabel="평가자 C" />
            </div>
          </div>
        ) : (
          <p className="text-text-faint mt-3 text-[11px]">
            이 화면에 접근 가능한 사람이라면 누구든 상세에서 바로 채점할 수 있고, 먼저 저장한 3명까지만
            평가자로 집계됩니다. (평가 대상 본인은 인원 제한과 무관하게 &lsquo;본인 평가&rsquo;로 저장)
          </p>
        )}
      </div>

      <div className="flex justify-end">
        <SubmitButton />
      </div>
    </form>
  );
}
