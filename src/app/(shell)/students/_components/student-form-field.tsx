/** 원생 등록·수정 폼의 칸 틀 — 폼 본문(`student-form.tsx`)과 보호자2 줄(`guardian2-field.tsx`)이 같은 모양을 쓴다. */

export const inputClass =
  "border-input bg-background w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring";

/** 보호자 관계 선택지 — 보호자1·보호자2가 같은 목록(원장 2026-11-04). 값이 곧 저장값이다. */
export const GUARDIAN_RELATIONS = ["부", "모", "조부", "조모", "기타"] as const;

export function Field({
  label,
  htmlFor,
  error,
  hint,
  inlineHint,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  inlineHint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <label
          htmlFor={htmlFor}
          className="text-foreground block text-sm font-medium"
        >
          {label}
        </label>
        {inlineHint ? (
          <p id={`${htmlFor}-inline-hint`} className="text-foreground/60 text-xs leading-relaxed">
            {inlineHint}
          </p>
        ) : null}
      </div>
      {children}
      {hint ? <p className="text-text-faint text-xs">{hint}</p> : null}
      {error ? <p className="text-chart-4 text-xs">{error}</p> : null}
    </div>
  );
}
