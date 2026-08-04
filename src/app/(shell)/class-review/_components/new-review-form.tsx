"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { Loader2 } from "@/components/icons/eywa-icon-compat";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { createClassReview, type ReviewActionState } from "@/features/class-review/server/actions";

const inputClass =
  "border-line bg-card text-foreground placeholder:text-text-faint focus:border-primary w-full rounded-lg border px-3 py-2 text-sm outline-none transition";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : null}
      참관 만들기
    </Button>
  );
}

/** 새 참관 폼 — 시트 상단 헤더(참관일·강사·과목·반명·회차·수업시간·학생수) + 참관자 3명(선택). */
export function NewReviewForm({
  staff,
  subjects,
}: {
  staff: { value: string; label: string }[];
  subjects: { value: string; label: string }[];
}) {
  const [state, formAction] = useActionState<ReviewActionState, FormData>(createClassReview, undefined);
  const seenRef = useRef<ReviewActionState>(undefined);
  useEffect(() => {
    if (!state || state === seenRef.current) return;
    seenRef.current = state;
    if (state.error) toast.error(state.error);
  }, [state]);

  return (
    <form action={formAction} className="border-line bg-card max-w-2xl space-y-4 rounded-2xl border p-5 shadow-card">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="cr-date" className="micro mb-1 block">
            참관일 *
          </label>
          <input id="cr-date" name="date" type="date" required className={inputClass} />
        </div>
        <div>
          <label className="micro mb-1 block">평가 대상 강사 *</label>
          <SearchableSelect name="teacherId" options={staff} placeholder="강사 선택" ariaLabel="평가 대상 강사" />
        </div>
        <div>
          <label className="micro mb-1 block">과목</label>
          <SearchableSelect name="subject" options={subjects} placeholder="과목 선택" ariaLabel="과목" />
        </div>
        <div>
          <label htmlFor="cr-class" className="micro mb-1 block">
            반명
          </label>
          <input id="cr-class" name="className" placeholder="예: 중등M 중2 BS3B" className={inputClass} />
        </div>
        <div>
          <label htmlFor="cr-session" className="micro mb-1 block">
            회차
          </label>
          <input id="cr-session" name="session" placeholder="예: 3" className={inputClass} />
        </div>
        <div>
          <label htmlFor="cr-time" className="micro mb-1 block">
            수업시간
          </label>
          <input id="cr-time" name="classTime" placeholder="예: 16:20~17:50" className={inputClass} />
        </div>
        <div>
          <label htmlFor="cr-students" className="micro mb-1 block">
            학생수
          </label>
          <input id="cr-students" name="studentCount" placeholder="예: 8" className={inputClass} />
        </div>
      </div>

      <div className="border-line border-t pt-4">
        <p className="micro mb-2">참관자 (최대 3명 — 평가 대상 본인은 자동으로 &lsquo;본인 평가&rsquo; 자리에 들어갑니다)</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <SearchableSelect name="observer1" options={staff} placeholder="참관자 A" ariaLabel="참관자 A" />
          <SearchableSelect name="observer2" options={staff} placeholder="참관자 B" ariaLabel="참관자 B" />
          <SearchableSelect name="observer3" options={staff} placeholder="참관자 C" ariaLabel="참관자 C" />
        </div>
      </div>

      <div className="flex justify-end">
        <SubmitButton />
      </div>
    </form>
  );
}
