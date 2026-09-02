import { TONE_SOFT, type SemanticTone } from "@/lib/design/semantic-color";
import { railX, RAIL_STATUS_LABEL, type GoalRail, type GoalRailStatus } from "../lib/goal-rail";

/**
 * **목표 레일 두 줄** — 1행 현재진도(Start→Now) · 2행 목표진도(Start→Plan, 끝이 목표). 진도표 고정열이 쓴다.
 *
 * 원장 2026-09-02: *"목표와 지금을 같은 레일에 놓지말고, 이중으로 지금을 1행, 목표를 2행. 지금 → 현재진도,
 * 목표 → 목표진도"* — 한 줄에 점·눈금·끝을 겹쳐 놓으니 무엇이 무엇인지 읽히지 않았다. 두 줄을 **같은 눈금**
 * (왼쪽 끝 = 이 달 시작 위치, 오른쪽 끝 = 목표 차시)에 놓으면 두 막대의 길이 차가 곧 "계획 대비 얼마나"다.
 *
 * 채움 색은 **의미색 캐논** — 현재진도는 판정 색(느림=caution · 계획대로=positive · 빠름=info), 목표진도는
 * 계획을 뜻하는 정보색(파랑)을 옅게. 새 색을 고르지 않는다.
 * 🔴 목표가 없으면 2행은 **점선 빈 줄**이고 1행은 20차시 눈금으로 채움만 그린다 — 경고색을 쓰지 않는다
 *    (목표 부재는 잘못이 아니다). 🔴 위치를 모르면 레일 대신 글자("위치 미상")다 — 0%짜리 막대는 없는 사실을 만든다.
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

/** 두 줄의 이름 — 화면·툴팁·표 머리가 같은 말을 쓴다(원장 지정 어휘). */
export const RAIL_ROW_LABEL = { now: "현재진도", goal: "목표진도" } as const;

/** 상태 배지 — 라벨은 `RAIL_STATUS_LABEL` 단일 소스. */
export function RailStatusPill({ status, className = "" }: { status: GoalRailStatus; className?: string }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${TONE_SOFT[RAIL_TONE[status]]} ${className}`}>
      {RAIL_STATUS_LABEL[status]}
    </span>
  );
}

function RailLine({
  label,
  x,
  fill,
  dashed,
  dot,
  text,
}: {
  label: string;
  /** 채움 끝(0~100). null이면 채움 없음. */
  x: number | null;
  fill: string;
  /** 목표가 없어 눈금이 임시(20차시)일 때 — 점선 트랙. */
  dashed: boolean;
  /** 끝에 점을 찍는가(현재진도만). */
  dot: boolean;
  /** 막대 아래 한 줄(차시 이름 등). 좁은 고정열이라 넘치면 자른다. */
  text: string | null;
}) {
  // 굵기는 원장 2026-09-02 *"레일 텍스트 굵은 글씨 해주고, 레일바도 굵기 현재 2배로"* — 선 3px→6px, 글자는 전부 굵게.
  return (
    <div>
      <div className="flex items-center gap-1.5">
        <span className="text-text-dim w-[52px] shrink-0 text-[11.5px] font-extrabold">{label}</span>
        <div className="relative h-[14px] min-w-0 flex-1">
          <div
            className={`absolute top-[4px] right-0 left-0 ${
              dashed ? "border-line-strong h-0 border-t-[3px] border-dashed" : "bg-line h-[6px] rounded-full"
            }`}
          />
          {x != null ? (
            <div className={`absolute top-[4px] left-0 h-[6px] rounded-full ${fill}`} style={{ width: `${x}%` }} />
          ) : null}
          {/* 점 — 양 끝에서 레일 밖으로 삐져나오지 않게 점 지름만큼 안쪽으로 당긴다. */}
          {dot && x != null ? (
            <div
              className={`absolute top-0 h-[14px] w-[14px] rounded-full border-2 border-white ${fill}`}
              style={{ left: `calc(${x}% - ${(14 * x) / 100}px)` }}
            />
          ) : null}
        </div>
      </div>
      {text ? <div className="text-foreground truncate pl-[58px] text-[11.5px] leading-tight font-bold">{text}</div> : null}
    </div>
  );
}

export function GoalRailRows({
  rail,
  nowText,
  goalText,
  title,
}: {
  rail: GoalRail;
  /** 1행 아래 글 — 현재 차시 이름(+날짜). */
  nowText: string | null;
  /** 2행 아래 글 — 목표 차시 이름(목표가 없으면 그 사실). */
  goalText: string | null;
  title?: string;
}) {
  if (rail.start == null || rail.now == null) {
    return <span className="text-text-faint text-[11px]">{RAIL_STATUS_LABEL["no-data"]}</span>;
  }
  const hasGoal = rail.end != null && rail.end > rail.start;
  const nowX = railX(rail, rail.now) ?? 0;
  const planX = hasGoal ? railX(rail, rail.plan) : null;
  return (
    <div className="space-y-1" title={title}>
      <RailLine label={RAIL_ROW_LABEL.now} x={nowX} fill={FILL[RAIL_TONE[rail.status]]} dashed={!hasGoal} dot text={nowText} />
      <RailLine label={RAIL_ROW_LABEL.goal} x={planX} fill="bg-blue/45" dashed={!hasGoal} dot={false} text={goalText} />
    </div>
  );
}
