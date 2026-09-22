"use client";

/**
 * 공개 접수 폼 공용 UI — 컬러 구획 Section + Field + 입력 클래스 + 자동 증감 textarea.
 * (public-intake-form.tsx 하단에 있던 것을 체크리스트 스텝과 공유하려고 분리 — 한 파일 200줄 규칙.)
 */
import { useEffect, useRef, type ComponentProps, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export const inputCls =
  "border-border bg-card text-foreground placeholder:text-text-faint h-11 w-full rounded-xl border px-3.5 text-sm outline-none focus:ring-2 focus:ring-primary/30";
export const labelCls = "mb-1.5 block text-sm font-bold text-foreground";
export const textareaCls =
  "border-border bg-card text-foreground placeholder:text-text-faint w-full rounded-xl border px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/30";

/** 접수 정보(1단계) 섹션 톤 — Editorial 전환(2026-07-19): 채도 높은 원색 바(gold/amber/danger 솔리드)는
 *  QUESTION_TONE과 같은 이유(대비·탁함, 원장 지적 2026-07-15)로 폐기 — 음영(-soft) 바 + 좌측 색 액센트로 통일. */
const TONE: Record<string, { bar: string; accent: string }> = {
  gold: { bar: "bg-gold-soft", accent: "bg-gold" },
  amber: { bar: "bg-amber-soft", accent: "bg-amber" },
  danger: { bar: "bg-danger-soft", accent: "bg-danger" },
  ink: { bar: "bg-bg-soft", accent: "bg-foreground" },
  primary: { bar: "bg-primary-soft", accent: "bg-primary" },
};

/**
 * 문항 섹션 바(체크리스트 전용) — 채도 높은 중간 톤 위에 글씨를 얹으면 대비가 무너진다(실측: amber+흰글씨
 * 2.69로 WCAG AA 4.5 미달, gold+검정글씨 5.31이지만 탁함 — 원장 지적 2026-07-15). 학부모가 폰에서 읽는
 * 긴 설문이라 가독성이 우선 → **음영(-soft) 배경 + 진한 본문색 제목 + 좌측 색 액센트**로 통일한다
 * (aywa 규약: 헤더 달린 카드 = 음영 헤더바 + 진한 제목). 색 구분은 액센트 막대가 그대로 유지.
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
      <div className={`mx-3 mt-5 flex items-baseline gap-2.5 rounded-t-2xl px-4 py-3 ${t.bar}`}>
        <span className={`mt-[3px] h-3.5 w-1 shrink-0 self-start rounded-full ${t.accent}`} aria-hidden />
        <span className="text-foreground flex-1 text-base leading-snug font-bold break-keep">{title}</span>
        {hint ? <span className="text-text-dim shrink-0 text-xs">{hint}</span> : null}
      </div>
      <div className="bg-card mx-3 space-y-4 rounded-b-2xl px-5 py-5 shadow-sm">{children}</div>
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
      <div className={`mx-3 mt-5 flex items-baseline gap-2.5 rounded-t-2xl px-4 py-3 ${t.bar}`}>
        <span className={`mt-[3px] h-3.5 w-1 shrink-0 self-start rounded-full ${t.accent}`} aria-hidden />
        <span className="text-foreground flex-1 text-sm font-bold break-keep">{title}</span>
        {hint ? <span className="text-text-dim shrink-0 text-xs">{hint}</span> : null}
      </div>
      <div className="bg-card mx-3 space-y-4 rounded-b-2xl px-5 py-5 shadow-sm">{children}</div>
    </>
  );
}

/**
 * 자유입력 textarea — **입력 길이에 따라 스스로 늘고 줄어든다**(원장 지시 2026-07-15).
 * 학부모가 폰에서 우측 하단 손잡이를 끌어 창을 키우는 건 사실상 불가능하고, 고정 높이면 긴 답이 좁은
 * 스크롤 상자에 갇혀 다시 읽지 못한다 → 손잡이(resize)는 없애고 내용 높이에 맞춘다.
 * · 최소 높이 = `minRows`(그 아래로는 안 줄어듦), 최대 = 없음(길게 쓰면 그만큼 커짐)
 * · 상태 없이 ref+DOM만 만짐(렌더 유발 없음). `auto`로 리셋 후 scrollHeight를 재야 **줄어들 때도** 맞는다.
 */
export function AutoTextarea({
  minRows = 2,
  className,
  onInput,
  ...props
}: ComponentProps<"textarea"> & { minRows?: number }) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const fit = (el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };

  // 최초 마운트(초안 복원·자동완성으로 값이 이미 있을 수 있음) 1회 보정.
  useEffect(() => {
    if (ref.current) fit(ref.current);
  }, []);

  return (
    <textarea
      ref={ref}
      rows={minRows}
      onInput={(e) => {
        fit(e.currentTarget);
        onInput?.(e);
      }}
      className={cn(textareaCls, "resize-none overflow-hidden", className)}
      {...props}
    />
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
