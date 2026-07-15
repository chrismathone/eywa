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

/**
 * 문항 섹션 바(체크리스트 전용) — 채도 높은 중간 톤 위에 글씨를 얹으면 대비가 무너진다(실측: amber+흰글씨
 * 2.69로 WCAG AA 4.5 미달, gold+검정글씨 5.31이지만 탁함 — 원장 지적 2026-07-15). 학부모가 폰에서 읽는
 * 긴 설문이라 가독성이 우선 → **음영(-soft) 배경 + 진한 본문색 제목 + 좌측 색 액센트**로 통일한다
 * (eywa 규약: 헤더 달린 카드 = 음영 헤더바 + 진한 제목). 색 구분은 액센트 막대가 그대로 유지.
 */
const QUESTION_TONE: Record<string, { bar: string; accent: string; border: string }> = {
  gold: { bar: "bg-gold-soft", accent: "bg-gold", border: "border-t-gold" },
  amber: { bar: "bg-amber-soft", accent: "bg-amber", border: "border-t-amber" },
  primary: { bar: "bg-primary-soft", accent: "bg-primary", border: "border-t-primary" },
  ink: { bar: "bg-bg-soft", accent: "bg-foreground", border: "border-t-foreground" },
};

/** 번호 붙은 문항 섹션 — 학부모용 설문(2단계) 전용. 접수 정보(1단계)는 기존 컬러 바 Section 유지. */
export function QuestionSection({
  title,
  tone,
  hint,
  children,
}: {
  title: string;
  tone: keyof typeof QUESTION_TONE;
  hint?: string;
  children: ReactNode;
}) {
  const t = QUESTION_TONE[tone]!;
  return (
    <>
      <div className={`mx-3 mt-5 flex items-baseline gap-2.5 px-4 py-3 ${t.bar}`}>
        <span className={`mt-[3px] h-3.5 w-1 shrink-0 self-start rounded-full ${t.accent}`} aria-hidden />
        <span className="text-foreground flex-1 text-[15px] leading-snug font-bold break-keep">{title}</span>
        {hint ? <span className="text-text-dim shrink-0 text-[11px]">{hint}</span> : null}
      </div>
      <div className={`bg-card mx-3 space-y-4 border-t-[3px] px-5 py-5 shadow-sm ${t.border}`}>{children}</div>
    </>
  );
}

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
