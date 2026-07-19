import type { ReactNode } from "react";

/**
 * BigStat — Editorial 문법 ②(빅 스탯: 큰 tabular 숫자 + 작은 라벨 + 보조 라인).
 * 화면마다 중복 정의되던 Stat 5곳(staff·meetings·consultations·withdrawals·attendance)과
 * 운영실 KpiCard의 공용 수렴 지점. 시맨틱 컬러는 값이 아니라 아이콘 칩 톤에 — 숫자는 잉크
 * (강조가 필요한 값만 valueClass, 예: 미수 text-danger).
 */
export type BigStatTone =
  | "neutral"
  | "primary"
  | "gold"
  | "blue"
  | "purple"
  | "rose"
  | "amber"
  | "danger";

const ICON_TONE: Record<BigStatTone, string> = {
  neutral: "bg-bg-soft text-text-dim",
  primary: "bg-primary-soft text-primary",
  gold: "bg-gold-soft text-gold",
  blue: "bg-blue-soft text-blue",
  purple: "bg-purple-soft text-purple",
  rose: "bg-rose-soft text-rose",
  amber: "bg-amber-soft text-amber",
  danger: "bg-danger-soft text-danger",
};

export function BigStat({
  label,
  value,
  unit,
  sub,
  icon,
  tone = "neutral",
  valueClass,
  size = "md",
}: {
  label: string;
  value: string | number;
  unit?: string;
  /** 보조 라인 — 델타·건수·기준일 등. ReactNode라 링크/모달 트리거도 허용. */
  sub?: ReactNode;
  /** 우측 상단 아이콘 칩 내용(예: <EyIcon name="users" size={16} />). */
  icon?: ReactNode;
  tone?: BigStatTone;
  /** 값 강조색(미수 danger 등). 기본은 잉크. */
  valueClass?: string;
  size?: "md" | "lg";
}) {
  return (
    <div className="bg-card shadow-card rounded-2xl p-4 xl:p-5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-text-dim text-[13px] font-medium">{label}</span>
        {icon ? (
          <span
            className={`${ICON_TONE[tone]} flex size-8 shrink-0 items-center justify-center rounded-xl`}
            aria-hidden="true"
          >
            {icon}
          </span>
        ) : null}
      </div>
      <div className={`${size === "lg" ? "mt-3" : "mt-2.5"} flex items-baseline gap-1`}>
        <span
          className={`num font-bold leading-none tracking-tight ${
            size === "lg" ? "text-[32px]" : "text-[27px]"
          } ${valueClass ?? "text-foreground"}`}
        >
          {value}
        </span>
        {unit ? <span className="text-text-dim text-[13px] font-medium">{unit}</span> : null}
      </div>
      <div className="text-text-faint mt-1.5 min-h-[17px] text-[12px]">{sub ?? null}</div>
    </div>
  );
}
