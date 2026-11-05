"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { Loader2 } from "@/components/icons/aywa-icon-compat";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { createClassReview, type ReviewActionState } from "@/features/class-review/server/actions";
import { writeLockedNote, writeLockedPlaceholder } from "@/lib/write-lock";
import {
  DEFAULT_OBSERVER_LIMIT,
  OBSERVER_LIMIT_OPTIONS,
  observerSlotLabel,
} from "@/features/class-review/observer-count";

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
 * ① 평가자 지정 ② 선착순(지정 없이, 권한자 중 먼저 채점한 N명이 평가자).
 * **평가자 인원(N)은 생성 시 고른다**(원장 지시 2026-08-18 — 종전 3명 고정). 두 방식 모두에 적용되고
 * 그 값이 문서에 동결되므로, 나중에 기본값을 바꿔도 이미 만든 평가의 정원은 안 흔들린다.
 * 반명·회차·수업시간·학생수는 입력받지 않고, **날짜도 안 받는다**(2026-08-05 — 생성 당일 자동).
 * 호칭은 "평가자"(원장 지시 2026-08-05 — "참관자 아니고 평가자") — 데이터 키(observer*)는 불변.
 * `canWrite=false`(읽기 권한) — 칸·선택 단추는 전부 잠그고 안내를 띄우며 '평가 만들기'는 그리지 않는다(원장 2026-11-05).
 */
export function NewReviewForm({
  staff,
  subjects,
  templates,
  canWrite,
}: {
  staff: { value: string; label: string }[];
  subjects: { value: string; label: string }[];
  /** 문항 세트 선택지(만든 순) — 비어 있으면 내장 기본 문항 사용(선택 UI 숨김). */
  templates: { value: string; label: string }[];
  /** 서버(page)가 canWriteTenant("class_review")로 정한 값 — 저장 액션과 같은 판정. */
  canWrite: boolean;
}) {
  const locked = !canWrite;
  const lockedPlaceholder = writeLockedPlaceholder("class_review");
  const [mode, setMode] = useState<"assigned" | "open">("assigned");
  const [count, setCount] = useState<number>(DEFAULT_OBSERVER_LIMIT);
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
      <input type="hidden" name="observerCount" value={count} />
      {/* 문항 세트·인원·방식은 값이 이미 골라져 있어 placeholder로는 알릴 수 없다 — 양식 위에 한 줄. */}
      {locked ? <p className="text-text-dim text-sm" role="status">{writeLockedNote("class_review")}</p> : null}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="micro mb-1 block">평가 대상 강사 *</label>
          <SearchableSelect name="teacherId" options={staff} placeholder={locked ? lockedPlaceholder : "강사 선택"}
            ariaLabel="평가 대상 강사" disabled={locked} />
        </div>
        <div>
          <label className="micro mb-1 block">과목 (선택)</label>
          <SearchableSelect name="subject" options={subjects} placeholder={locked ? lockedPlaceholder : "과목 선택"}
            ariaLabel="과목" disabled={locked} />
        </div>
        {templates.length > 0 ? (
          <div className="sm:col-span-2">
            <label className="micro mb-1 block">문항 세트</label>
            <SearchableSelect
              name="templateId"
              options={templates}
              defaultValue={templates[0].value}
              placeholder={locked ? lockedPlaceholder : "문항 세트 선택"}
              ariaLabel="문항 세트"
              disabled={locked}
            />
          </div>
        ) : null}
      </div>
      <p className="text-text-faint text-xs">날짜는 따로 입력하지 않습니다 — 생성한 날이 평가일로 기록됩니다.</p>

      <div className="border-line border-t pt-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="micro">평가자 방식</p>
          <div className="flex items-center gap-1.5">
            <span className="text-text-dim text-xs">평가자 인원</span>
            {/* 방식과 무관하게 같은 값을 쓴다 — 지정이면 칸 수, 선착순이면 마감 인원. */}
            <div className="border-line flex overflow-hidden rounded-lg border" role="group" aria-label="평가자 인원">
              {OBSERVER_LIMIT_OPTIONS.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setCount(n)}
                  disabled={locked}
                  aria-pressed={count === n}
                  className={`num border-line px-2.5 py-1 text-xs transition not-first:border-l disabled:cursor-not-allowed disabled:opacity-60 ${
                    count === n
                      ? "bg-primary text-primary-foreground font-bold"
                      : "text-text-dim hover:text-foreground"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          {(
            [
              { v: "assigned", t: "평가자 지정", d: `아래에서 최대 ${count}명을 지정합니다` },
              { v: "open", t: `선착순 ${count}명`, d: `지정 없이 — 먼저 채점한 ${count}명이 평가자가 됩니다` },
            ] as const
          ).map((o) => (
            <button
              key={o.v}
              type="button"
              onClick={() => setMode(o.v)}
              disabled={locked}
              aria-pressed={mode === o.v}
              className={`flex-1 rounded-xl border px-4 py-3 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${
                mode === o.v ? "border-primary bg-primary/5" : "border-line hover:border-primary/40"
              }`}
            >
              <span className={`block text-sm font-bold ${mode === o.v ? "text-primary" : "text-foreground"}`}>
                {o.t}
              </span>
              <span className="text-text-dim mt-0.5 block text-xs">{o.d}</span>
            </button>
          ))}
        </div>

        {mode === "assigned" ? (
          <div className="mt-3">
            <p className="micro mb-2">
              평가자 (최대 <span className="num">{count}</span>명 — 평가 대상 본인은 자동으로
              &lsquo;본인 평가&rsquo; 자리에 들어갑니다)
            </p>
            {/* 칸 수 = 정원. 서버 루프도 정원까지 읽으므로 둘이 어긋나면 뒤쪽 선택이 조용히 버려진다. */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: count }, (_, i) => {
                const label = observerSlotLabel(i);
                return (
                  <SearchableSelect
                    key={i}
                    name={`observer${i + 1}`}
                    options={staff}
                    placeholder={locked ? lockedPlaceholder : label}
                    ariaLabel={label}
                    disabled={locked}
                  />
                );
              })}
            </div>
          </div>
        ) : (
          <p className="text-text-faint mt-3 text-xs">
            이 화면에 접근 가능한 사람이라면 누구든 상세에서 바로 채점할 수 있고, 먼저 저장한{" "}
            <span className="num">{count}</span>명까지만 평가자로 집계됩니다. (평가 대상 본인은 인원 제한과 무관하게 &lsquo;본인 평가&rsquo;로 저장)
          </p>
        )}
      </div>

      {/* 읽기 권한이면 저장 단추를 그리지 않는다 — 비활성으로 두면 "누르면 될 것 같은" 오해가 남는다. */}
      {canWrite ? (
        <div className="flex justify-end">
          <SubmitButton />
        </div>
      ) : null}
    </form>
  );
}
