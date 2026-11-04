/** 원생 등록·수정 폼의 칸 틀 — 폼 본문(`student-form.tsx`)과 보호자2 줄(`guardian2-field.tsx`)이 같은 모양을 쓴다. */
// 보호자 관계 목록·보호자2 이름 상한은 저장 검증과 한 벌이라 기능 모듈에 둔다(`@/features/students/guardian`).

export const inputClass =
  "border-input bg-background w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring";

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
