import { EDIT_CUTOFF_MINUTES, type VehicleRoute } from "../parent-rides";

/**
 * 학부모 '수정하기' 모달(`vehicle-route-dialog.tsx`)의 **그리는 조각** — 회차 머리 · 크게 보기 · 배지.
 * 상태는 모달이 들고, 여기는 받은 값대로 그리기만 한다(모달 파일이 400줄을 넘어 떼어 냈다).
 */

export function RunHeader({
  route,
  current,
  verb,
  closed,
  large = false,
}: {
  route: VehicleRoute;
  current: boolean;
  verb: string;
  /** 출발 10분 전이 지났다 — '수정 마감' 표시. */
  closed: boolean;
  large?: boolean;
}) {
  return (
    <p className={`flex flex-wrap items-baseline gap-x-1.5 font-bold ${large ? "text-lg" : "text-sm"}`}>
      {route.runName}
      {route.departTime ? <span className="num text-text-dim font-medium">· {route.departTime} 출발</span> : null}
      {current ? <span className={`text-primary ${large ? "text-sm" : "text-xs"}`}>· 지금 {verb} 회차</span> : null}
      {closed ? (
        <span className="bg-bg-soft text-text-dim self-center rounded-full px-2 py-0.5 text-xs font-bold">수정 마감</span>
      ) : null}
    </p>
  );
}

/**
 * 크게 보기 — 한 회차만. `selectable`이면 정류장 칸(학원 출발·도착 제외)을 누를 수 있다.
 * 고른 칸은 '타는 곳 변경'(테두리 배지), 지금 자리는 '지금 타는 곳'(채운 배지).
 */
export function FocusedRun({
  route,
  mine,
  pickStopId,
  verb,
  selectable,
  closed,
  blockOf,
  onPick,
}: {
  route: VehicleRoute;
  mine: { runId: string; stopId: string | null };
  pickStopId: string | null;
  verb: string;
  selectable: boolean;
  /** 이 회차가 출발 10분 전을 지났다 — 고를 수 없다는 안내. */
  closed: boolean;
  /** 이 시각의 정류장이 짝 규칙(같은 회차·등원<하원)에 걸리면 이유, 아니면 null. */
  blockOf: (time: string | null) => string | null;
  onPick: (stopId: string) => void;
}) {
  const current = route.runId === mine.runId;
  // 같은 회차 금지는 칸과 무관하게 회차 전체에 걸린다 — 시각은 아무 값이나 넣어 회차 판정만 본다.
  const runBlock = blockOf(null);
  const stopBlocks = route.stops.filter((s) => s.kind === "stop").map((s) => blockOf(s.time)).filter(Boolean);
  return (
    <section className={`rounded-xl border px-3 py-3 ${current ? "border-primary" : "border-line"}`}>
      <RunHeader route={route} current={current} verb={verb} closed={closed} large />
      {closed ? (
        <p className="text-danger mt-1 text-sm break-keep">
          이 회차는 출발 {EDIT_CUTOFF_MINUTES}분 전이 지나 고를 수 없어요.
        </p>
      ) : null}
      {!closed && (runBlock ?? stopBlocks[0]) ? (
        <p className="text-danger mt-1 text-sm break-keep">
          {runBlock ?? `${stopBlocks[0]} — 그런 정류장은 고를 수 없어요.`}
        </p>
      ) : null}
      {/* 마감된 회차의 정류장 — 보이되 회색으로 흐리게(안내 문구는 위에서 또렷하게). */}
      <ol className={`mt-2 flex flex-col gap-1 ${closed ? "opacity-50 grayscale" : ""}`}>
        {route.stops.map((s) => {
          const isMine = current && s.id === mine.stopId;
          const picked = s.id === pickStopId;
          const blocked = s.kind === "stop" && !!blockOf(s.time);
          const canPick = selectable && s.kind === "stop" && !blocked;
          const row = (
            <>
              <span
                className={`size-3 shrink-0 rounded-full ${isMine || picked ? "bg-primary" : "bg-line"}`}
                aria-hidden
              />
              <span className="num text-text-dim w-14 shrink-0 text-base">{s.time ?? "--:--"}</span>
              <span
                className={`min-w-0 flex-1 text-base break-keep ${isMine || picked ? "font-bold" : s.kind === "stop" ? "" : "text-text-dim"}`}
              >
                {s.name}
              </span>
              {isMine ? <Badge tone="primary">지금 {verb} 곳</Badge> : null}
              {picked ? <Badge tone="outline">{verb} 곳 변경</Badge> : null}
            </>
          );
          return (
            <li key={s.id}>
              {canPick ? (
                <button
                  type="button"
                  aria-pressed={picked}
                  onClick={() => onPick(s.id)}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-2.5 text-left ${
                    picked ? "bg-primary/10" : "hover:bg-bg-soft"
                  }`}
                >
                  {row}
                </button>
              ) : (
                <div className={`flex items-center gap-2.5 px-2 py-2.5 ${blocked && !isMine ? "opacity-45" : ""}`}>{row}</div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export function Badge({ tone, children }: { tone: "primary" | "outline"; children: React.ReactNode }) {
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${
        tone === "primary" ? "bg-primary text-primary-foreground" : "border-primary text-primary border bg-card"
      }`}
    >
      {children}
    </span>
  );
}
