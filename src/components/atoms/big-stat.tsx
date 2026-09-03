import type { ReactNode } from "react";

/**
 * BigStat — Editorial 문법 ②(빅 스탯: 큰 tabular 숫자 + 작은 라벨 + 보조 라인).
 * 화면마다 중복 정의되던 Stat 5곳(staff·meetings·consultations·withdrawals·attendance)과
 * 운영실 KpiCard의 공용 수렴 지점. 시맨틱 컬러는 값이 아니라 아이콘 칩 톤에 — 숫자는 잉크
 * (강조가 필요한 값만 valueClass, 예: 미수 text-danger).
 */
/**
 * ⚠️ v4에서 `green`을 추가했다 — 종전 톤엔 "정상·완료"를 나타낼 색이 아예 없어서, 수납 완료·출석률
 * 같은 긍정 지표가 전부 primary(네이비)나 gold로 칠해졌다(의미색 캐논의 positive가 표현 불가였다).
 */
export type BigStatTone =
  | "neutral"
  | "primary"
  | "green"
  | "gold"
  | "blue"
  | "purple"
  | "rose"
  | "amber"
  | "danger";

const ICON_TONE: Record<BigStatTone, string> = {
  neutral: "bg-bg-soft text-text-dim",
  primary: "bg-primary-soft text-primary",
  green: "bg-green-soft text-green",
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
  // compact-chrome(창·모바일·강사 미니셸) — 크롬이 이미 밖에 있는 화면에선 카드가 세로 110px을 먹을 이유가
  // 없다. 값·라벨·보조라인은 **그대로 두고 밀도만** 올린다(정보를 지우지 않는다). 아이콘 칩만 한 단계 축소.
  return (
    <div className="bg-card shadow-card rounded-2xl p-4 compact-chrome:p-3 xl:p-5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-text-dim text-sm font-medium compact-chrome:text-xs">{label}</span>
        {icon ? (
          <span
            className={`${ICON_TONE[tone]} flex size-8 shrink-0 items-center justify-center rounded-xl compact-chrome:size-6 compact-chrome:rounded-lg`}
            aria-hidden="true"
          >
            {icon}
          </span>
        ) : null}
      </div>
      <div className={`${size === "lg" ? "mt-3" : "mt-2.5"} flex items-baseline gap-1 compact-chrome:mt-1`}>
        <span
          className={`num font-bold leading-none tracking-tight compact-chrome:text-2xl ${
            size === "lg" ? "text-4xl" : "text-3xl"
          } ${valueClass ?? "text-foreground"}`}
        >
          {value}
        </span>
        {unit ? <span className="text-text-dim text-sm font-medium compact-chrome:text-xs">{unit}</span> : null}
      </div>
      {/* 보조라인 자리는 값이 없을 때 **비워두되 높이를 잡아** 카드 4장의 밑선을 맞춘다 — 컴팩트에선 그
          예약 높이를 없애고(min-h-0) 실제 내용이 있을 때만 차지하게 한다. */}
      <div className="text-text-faint mt-1.5 min-h-[17px] text-xs compact-chrome:mt-0.5 compact-chrome:min-h-0">
        {sub ?? null}
      </div>
    </div>
  );
}
