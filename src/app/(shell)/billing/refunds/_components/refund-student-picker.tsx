"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { AlertCircle, Loader2, Sparkles } from "@/components/icons/eywa-icon-compat";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { applyFormValues, readFormValues } from "@/lib/form-draft";
import {
  REFUND_PREFILL_LABELS,
  splitPrefill,
} from "@/features/billing/refund-prefill";
import {
  loadRefundPrefill,
  loadRefundStudentOptions,
} from "@/features/billing/server/refund-actions";
import type { RefundStudentOption } from "@/features/billing/server/refund-queries";

// 환불요청서 자동입력 — 학생을 고르면 DB가 아는 칸(학교/학년·주소·수강반·담당·수강기간·결제내역)을 채운다.
// 시트가 전부 언컨트롤드 input이라 **DOM에 직접 적용**한다(applyFormValues가 input/change를 발화해
// 초안 자동저장도 그대로 따라온다). 컨트롤드로 바꾸면 초안 캡처·React19 폼 리셋(#83)에 얽힌다.
//
// ⚠️ 기본은 **빈 칸만** 채운다 — 사람이 이미 쓴 값을 자동입력이 덮으면 그건 되돌릴 수 없는 손실이다.
//    덮어쓰려면 안내에 뜨는 '덮어쓰기'를 눌러 명시적으로.

const labelOf = (field: string) => REFUND_PREFILL_LABELS[field] ?? field;

export function RefundStudentPicker({ formRef }: { formRef: React.RefObject<HTMLFormElement | null> }) {
  const [options, setOptions] = useState<RefundStudentOption[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState("");
  const [note, setNote] = useState<{ text: string; overwrite?: Record<string, string> } | null>(null);
  const [pending, startTransition] = useTransition();
  const lastValues = useRef<Record<string, string>>({});

  // 폼이 열린 뒤 목록을 따로 가져온다(약 800명 — 페이지 첫 페인트를 이걸로 막지 않는다).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await loadRefundStudentOptions();
      if (cancelled) return;
      if (res.error) setLoadError(res.error);
      else setOptions(res.options ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function apply(values: Record<string, string>, force: boolean) {
    const form = formRef.current;
    if (!form) return;
    const current = readFormValues(form, []);
    const { fill, skipped } = force ? { fill: values, skipped: [] as string[] } : splitPrefill(values, current);
    applyFormValues(form, fill);
    const filled = Object.keys(fill).length;
    const head = filled > 0 ? `${filled}개 칸을 채웠습니다` : "채울 새 칸이 없습니다";
    setNote({
      text: skipped.length
        ? `${head} — 이미 입력된 ${skipped.map(labelOf).join("·")}은(는) 그대로 뒀습니다.`
        : `${head}. 환불사유·차감내역·환불금액은 직접 입력하세요.`,
      overwrite: skipped.length ? values : undefined,
    });
  }

  function pick(studentId: string) {
    setSelected(studentId);
    setNote(null);
    if (!studentId) return;
    startTransition(async () => {
      const res = await loadRefundPrefill(studentId);
      if (res.error || !res.values) {
        setNote({ text: res.error ?? "학생 정보를 불러오지 못했습니다" });
        return;
      }
      lastValues.current = res.values;
      apply(res.values, false);
    });
  }

  return (
    <div className="border-line bg-bg-soft/50 rounded-2xl border p-3 print:hidden">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-text-dim flex items-center gap-1.5 text-xs font-semibold whitespace-nowrap">
          <Sparkles className="size-4" />
          학생 자동입력
        </span>
        <div className="min-w-[220px] flex-1">
          <SearchableSelect
            value={selected}
            options={(options ?? []).map((s) => ({
              value: s.id,
              label: s.name,
              hint: [s.schoolGrade, s.statusLabel].filter(Boolean).join(" · "),
            }))}
            onValueChange={pick}
            ariaLabel="자동입력할 학생"
            placeholder={options === null ? "학생 목록 불러오는 중..." : "학생 이름으로 검색..."}
            searchPlaceholder="학생 이름 검색..."
          />
        </div>
        {pending ? <Loader2 className="text-text-faint size-4 animate-spin" /> : null}
      </div>
      {loadError ? (
        <p className="text-danger mt-2 flex items-center gap-1.5 text-xs">
          <AlertCircle className="size-3.5 shrink-0" />
          {loadError}
        </p>
      ) : null}
      <p className="text-text-faint mt-2 text-xs">
        {note ? (
          <>
            {note.text}
            {note.overwrite ? (
              <button
                type="button"
                onClick={() => apply(note.overwrite!, true)}
                className="text-primary ml-1.5 underline underline-offset-2"
              >
                덮어쓰기
              </button>
            ) : null}
          </>
        ) : (
          "이름을 고르면 학교/학년·주소·수강반·담당선생님·수강기간·결제내역이 채워집니다(빈 칸만)."
        )}
      </p>
    </div>
  );
}
