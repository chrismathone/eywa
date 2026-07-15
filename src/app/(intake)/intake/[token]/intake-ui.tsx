/**
 * 공개 접수 폼 공용 UI — 컬러 구획 Section + Field + 입력 클래스.
 * (public-intake-form.tsx 하단에 있던 것을 체크리스트 스텝과 공유하려고 분리 — 한 파일 200줄 규칙.)
 */
import type { ReactNode } from "react";

export const inputCls =
  "border-border bg-card text-foreground placeholder:text-text-faint h-11 w-full rounded-md border px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30";
export const labelCls = "mb-1.5 block text-sm font-bold text-foreground";
export const textareaCls =
  "border-border bg-card text-foreground placeholder:text-text-faint w-full rounded-md border px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/30";

const TONE: Record<string, { bar: string; barText: string; border: string }> = {
  gold: { bar: "bg-gold", barText: "text-foreground", border: "border-t-gold" },
  amber: { bar: "bg-amber", barText: "text-white", border: "border-t-amber" },
  danger: { bar: "bg-danger", barText: "text-white", border: "border-t-danger" },
  ink: { bar: "bg-foreground", barText: "text-background", border: "border-t-foreground" },
  primary: { bar: "bg-primary", barText: "text-white", border: "border-t-primary" },
};

export function Section({
  title,
  tone,
  hint,
  children,
}: {
  title: string;
  tone: keyof typeof TONE;
  /** 섹션 바 우측 보조 문구(예: "최대 2개") */
  hint?: string;
  children: ReactNode;
}) {
  const t = TONE[tone]!;
  return (
    <>
      <div className={`mx-3 mt-5 flex items-baseline justify-between gap-2 px-5 py-3 ${t.bar}`}>
        <span className={`text-sm font-bold ${t.barText}`}>{title}</span>
        {hint ? <span className={`text-xs opacity-80 ${t.barText}`}>{hint}</span> : null}
      </div>
      <div className={`bg-card mx-3 space-y-4 border-t-[3px] px-5 py-5 shadow-sm ${t.border}`}>{children}</div>
    </>
  );
}

export function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div>
      <span className={labelCls}>
        {label}
        {required ? <span className="text-danger ml-0.5">*</span> : null}
      </span>
      {children}
    </div>
  );
}
