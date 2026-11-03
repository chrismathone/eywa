import { Sparkline } from "../_components/sparkline";
import { PanelEmpty } from "./tiles";
import type { WeeklyChangeBucket } from "@/features/dashboard/onescreen/weekly-change";
import { EXIT_BASIS_TAG } from "@/features/withdrawals/exit-basis";
import type { CompositionBar } from "@/features/dashboard/onescreen/composition";

/**
 * 한 화면 대시보드의 **차트 격자**.
 *
 * 🔴 2026-09-10 뒤집힘 — 옛 주석은 *"정확히 둘이고 더 늘리지 않는다"*였다. 원장이 참고 이미지
 *    (HR 대시보드)를 **두 번** 제시하고 *"디자인을 너무 무시한거 아냐"* + *"이 공간낭비 어쩔꺼야"*라고
 *    지적했다. 그 레퍼런스의 뼈대가 **위 KPI 줄 + 아래 차트 격자**라, 아래를 비워 두는 것이 곧 지시 위반이다.
 *
 * 🔴 **차트 라이브러리를 쓰지 않는다.** recharts는 ~367KB라 정적 import하면 첫 페인트를 막는데(§8-6),
 *    이 화면은 **바탕화면**이라 KPI·목록이 차트 청크를 기다리면 안 된다. 선은 이미 있는 `Sparkline`
 *    (순수 SVG)이고 막대는 div 몇 개다 — `next/dynamic` 래퍼조차 필요 없다.
 * 🔴 **도넛·파이를 쓰지 않는다**(길이 비교가 안 된다) · **애니메이션 없음**(실시간 갱신 화면이라
 *    떨림의 절반이 트랜지션이다, §6).
 */

/**
 * 최근 7일 출석률 — *"이번 주 출석이 무너지나, 어제만 나쁜가"*.
 * 🔴 오늘이 아직 마감 전이면 마지막 점은 **그리지 않는다**(`null`) — 진행 중 비율은 언제나 높아 보여
 *    선이 위로 튀고, 그 튐이 "오늘 좋아졌다"는 거짓 신호가 된다.
 */
export function AttendanceTrend({
  points,
}: {
  points: { day: string; attendance: number | null }[];
}) {
  const values = points.map((p) => p.attendance);
  const recorded = values.filter((v): v is number => v !== null);
  if (recorded.length === 0) return <PanelEmpty>최근 7일 출결 기록이 없습니다</PanelEmpty>;
  const last = recorded[recorded.length - 1];
  const lo = Math.min(...recorded);
  const hi = Math.max(...recorded);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-baseline gap-1.5">
        <span className="num text-foreground text-lg leading-none font-bold">{Math.round(last)}</span>
        <span className="text-text-dim text-xs">%</span>
        {/* 🔴 Y축을 0–100으로 고정하지 않는다(§3) — 실제 범위가 88~96%면 0부터 그린 선은 평평해서
            아무것도 안 보인다. 대신 범위를 **글자로** 적어 눈금 없는 선을 오해하지 않게 한다. */}
        <span className="text-text-faint ml-auto num text-xs">
          {Math.round(lo)}~{Math.round(hi)}%
        </span>
      </div>
      <div className="min-h-0 flex-1">
        <Sparkline data={values} colorVar="--color-primary" height={72} strokeWidth={2} />
      </div>
      <div className="text-text-faint flex justify-between text-xs">
        {points.map((p, i) => (
          <span key={`${p.day}-${i}`}>{p.day}</span>
        ))}
      </div>
    </div>
  );
}

/**
 * 최근 4주 등록 vs 퇴원 — *"학원이 늘고 있나 줄고 있나"*.
 * 🔴 등록=학원 색(primary) / 퇴원=앰버. 퇴원을 빨강으로 칠하지 않는다 — 퇴원은 **실패가 아니라 사실**이고,
 *    빨강으로 두면 정상 이탈률에도 화면이 늘 경보 상태가 된다.
 */
export function WeeklyChangeBars({ buckets }: { buckets: WeeklyChangeBucket[] }) {
  if (buckets.length === 0) return <PanelEmpty>표시할 기간이 없습니다</PanelEmpty>;
  // 눈금은 두 계열을 **함께** 본다 — 따로 잡으면 등록 2명과 퇴원 2명이 다른 높이로 그려진다.
  const peak = Math.max(1, ...buckets.flatMap((b) => [b.enrolled, b.withdrawn]));
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="text-text-faint flex items-center gap-2.5 text-xs">
        <span className="inline-flex items-center gap-1">
          <span aria-hidden className="bg-primary size-2 rounded-[2px]" /> 등록
        </span>
        <span className="inline-flex items-center gap-1">
          <span aria-hidden className="bg-amber size-2 rounded-[2px]" /> 퇴원
        </span>
        {/* 퇴원은 수업료를 낸 마지막 달의 말일 주에 선다(원장 2026-10-29 규칙 · 2026-11-03 기준을 적음). */}
        <span>· 퇴원은 {EXIT_BASIS_TAG}</span>
      </div>
      <div className="flex min-h-0 flex-1 items-end gap-2 pt-1">
        {buckets.map((b) => (
          <div key={b.monday} className="flex min-w-0 flex-1 flex-col items-center gap-0.5">
            <div className="flex h-full w-full items-end justify-center gap-1">
              <Bar n={b.enrolled} peak={peak} cls="bg-primary" label={`${b.label} 등록 ${b.enrolled}명`} />
              <Bar n={b.withdrawn} peak={peak} cls="bg-amber" label={`${b.label} 퇴원 ${b.withdrawn}명`} />
            </div>
            <span className="text-text-faint num text-xs">{b.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * 막대 하나. 🔴 **0도 자리를 남긴다**(2px 밑동) — 막대가 통째로 사라지면 "그 주엔 아무 일도 없었다"가
 * 아니라 "그 주가 없었다"로 읽힌다.
 */
function Bar({ n, peak, cls, label }: { n: number; peak: number; cls: string; label: string }) {
  const pct = Math.round((n / peak) * 100);
  return (
    <span
      title={label}
      aria-label={label}
      className={`w-2.5 rounded-t-[2px] ${n === 0 ? "bg-line" : cls}`}
      style={{ height: n === 0 ? 2 : `max(3px, ${pct}%)` }}
    />
  );
}

/**
 * **구성 가로 막대** — 레퍼런스의 `Headcount by Dept`에 대응한다(학년별 재원생 등).
 *
 * 🔴 폭은 **최댓값 대비**라 옆에 **실제 수를 반드시 적는다** — 폭만으로는 몇 명인지 알 수 없다.
 * 🔴 값이 0인 줄도 이름과 0을 남긴다(감추면 그 학년이 사라진 것처럼 보인다).
 * ⚠️ 상한에 걸려 잘린 줄이 있으면 **그 사실을 적는다** — 안 적으면 합계와 눈에 보이는 수가 어긋난다.
 */
export function CompositionBars({
  bars,
  hiddenCount,
  hiddenValue,
  emptyLabel,
}: {
  bars: CompositionBar[];
  hiddenCount: number;
  hiddenValue: number;
  emptyLabel: string;
}) {
  if (bars.length === 0) return <PanelEmpty>{emptyLabel}</PanelEmpty>;
  return (
    <div className="flex h-full min-h-0 flex-col gap-1 overflow-hidden">
      {bars.map((b) => (
        <div key={b.label} className="flex min-w-0 items-center gap-2">
          <span className="text-text-dim w-14 shrink-0 truncate text-right text-xs">{b.label}</span>
          <span className="bg-bg-soft relative h-3 min-w-0 flex-1 overflow-hidden rounded-sm">
            <span
              className="bg-primary absolute inset-y-0 left-0 rounded-sm"
              style={{ width: `${b.pct}%` }}
            />
          </span>
          <span className="num text-foreground w-8 shrink-0 text-right text-xs font-bold">{b.value}</span>
        </div>
      ))}
      {hiddenCount > 0 ? (
        <p className="text-text-faint mt-auto text-xs">
          외 {hiddenCount}개 · <span className="num">{hiddenValue}</span>명
        </p>
      ) : null}
    </div>
  );
}
