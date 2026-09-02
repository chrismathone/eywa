import { TONE_SOFT, TONE_TEXT, type SemanticTone } from "@/lib/design/semantic-color";
import { railX, RAIL_STATUS_LABEL, type GoalRail, type GoalRailStatus } from "../lib/goal-rail";

/**
 * **레일 한 줄** — `Start ─ Plan ─ Now ─ End`. 목표 레일 카드·현황 표·진도표 고정열이 **같은 부품**을 쓴다
 * (세 곳이 각자 그리면 같은 학생이 화면마다 다른 자리에 찍힌다).
 *
 * 초안(able)의 그림을 우리 어법으로: 회색 선이 이 달 목표 구간(Start→End), 색 채움이 실제(Start→Now),
 * 파란 눈금이 오늘 계획상 자리(Plan). 채움 색은 **의미색 캐논**(느림=caution · 계획대로=positive ·
 * 빠름=info)이라 다른 화면의 같은 뜻과 같은 색이다 — 새 색을 고르지 않는다.
 *
 * 🔴 목표가 없으면 **점선 레일**에 채움만 그린다(눈금 20차시) — 경고색을 쓰지 않는다(목표 부재는 잘못이 아니다).
 * 🔴 위치를 모르면 레일 대신 글자("위치 미상")다 — 0%짜리 막대는 없는 사실을 만든다.
 */
export const RAIL_TONE: Record<GoalRailStatus, SemanticTone> = {
  "no-data": "inert",
  "no-goal": "inert",
  "goal-behind": "inert",
  "not-started": "inert",
  done: "positive",
  ahead: "info",
  on: "positive",
  behind: "caution",
};

/** tone → 채움 색(막대). 의미색 캐논의 팔레트 그대로 — 여기서 새 색을 정하지 않는다. */
const FILL: Record<SemanticTone, string> = {
  positive: "bg-green",
  caution: "bg-amber",
  critical: "bg-danger",
  info: "bg-blue",
  special: "bg-purple",
  inert: "bg-line-strong",
  brand: "bg-primary",
};

/** 상태 배지 — 라벨은 `RAIL_STATUS_LABEL` 단일 소스. */
export function RailStatusPill({ status, className = "" }: { status: GoalRailStatus; className?: string }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${TONE_SOFT[RAIL_TONE[status]]} ${className}`}>
      {RAIL_STATUS_LABEL[status]}
    </span>
  );
}

export function GoalRailBar({
  rail,
  size = "md",
  title,
}: {
  rail: GoalRail;
  /** `md` = 카드(라벨 있음) · `sm` = 표·고정열(선만). */
  size?: "sm" | "md";
  title?: string;
}) {
  if (rail.start == null || rail.now == null) {
    return <span className="text-text-faint text-[11px]">{RAIL_STATUS_LABEL["no-data"]}</span>;
  }
  const tone = RAIL_TONE[rail.status];
  const hasGoal = rail.end != null && rail.end > rail.start;
  const nowX = railX(rail, rail.now) ?? 0;
  const planX = hasGoal ? railX(rail, rail.plan) : null;
  const sm = size === "sm";
  // 선의 세로 위치 — md는 위·아래 라벨 자리를 남긴다.
  const lineTop = sm ? "top-[6px]" : "top-[16px]";
  const h = sm ? "h-[14px]" : "h-[34px]";

  return (
    <div className={`relative w-full ${h}`} title={title}>
      {/* 목표 구간(회색) — 목표가 없으면 점선. */}
      <div
        className={`absolute left-0 right-0 ${lineTop} ${
          hasGoal ? "bg-line h-[3px] rounded-full" : "border-line-strong h-0 border-t-2 border-dashed"
        }`}
      />
      {/* 실제(채움) — Start→Now. */}
      <div
        className={`absolute left-0 ${lineTop} h-[3px] rounded-full ${FILL[tone]}`}
        style={{ width: `${nowX}%` }}
      />
      {/* 오늘 계획 자리 — 파란 눈금(정보색). 목표가 없으면 없다. */}
      {planX != null ? (
        <div
          className={`bg-blue absolute w-[2px] ${sm ? "top-[2px] h-[11px]" : "top-[10px] h-[15px]"}`}
          style={{ left: `calc(${planX}% - 1px)` }}
        />
      ) : null}
      {/* Now 점 — 양 끝에서 레일 밖으로 삐져나오지 않게 점 지름만큼 안쪽으로 당긴다(0%=왼쪽 끝, 100%=오른쪽 끝). */}
      <div
        className={`absolute rounded-full border-2 border-white ${FILL[tone]} ${
          sm ? "top-[2px] h-[11px] w-[11px]" : "top-[11px] h-[13px] w-[13px]"
        }`}
        style={{ left: `calc(${nowX}% - ${((sm ? 11 : 13) * nowX) / 100}px)` }}
      />
      {!sm ? (
        <>
          <span className="text-text-faint absolute left-0 top-[21px] text-[10px] font-bold whitespace-nowrap">
            시작
          </span>
          {hasGoal ? (
            <span className="text-text-faint absolute right-0 top-[21px] text-[10px] font-bold whitespace-nowrap">
              목표
            </span>
          ) : null}
          {planX != null ? (
            <span
              className="text-blue absolute top-0 text-[10px] font-bold whitespace-nowrap"
              style={{ left: `${planX}%`, transform: `translateX(${planX < 8 ? "0" : planX > 92 ? "-100%" : "-50%"})` }}
            >
              계획
            </span>
          ) : null}
          {/* '시작'·'목표' 글자와 겹치지 않게 양 끝 12% 안쪽에선 안쪽으로 붙인다. */}
          <span
            className={`absolute top-[21px] text-[10px] font-extrabold whitespace-nowrap ${TONE_TEXT[tone]}`}
            style={{
              left: nowX < 12 ? "26px" : nowX > 88 && hasGoal ? "auto" : `${nowX}%`,
              right: nowX > 88 && hasGoal ? "26px" : "auto",
              transform: nowX < 12 || (nowX > 88 && hasGoal) ? "none" : nowX > 88 ? "translateX(-100%)" : "translateX(-50%)",
            }}
          >
            지금
          </span>
        </>
      ) : null}
    </div>
  );
}
