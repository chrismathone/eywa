import { TONE_SOFT, TONE_TEXT } from "@/lib/design/semantic-color";
import { legRode, parentLegView, runEditClosed, runStartTime, type RegularChange, type RideChange, type RideLeg, type VehicleFleet } from "../parent-rides";
import { BOARDING_STATUS_LABEL, DIRECTION_LABEL, dayLabel } from "../../types";
import { TRIP_STATE_LABEL } from "../../today/trip-state";
import { AckHistoryButton } from "../../ride-change/components/ack-history-button";
import { CollapsibleList } from "../../ride-change/components/collapsible-list";
import { SkipRideButton } from "./skip-ride-button";
import { VehicleRouteDialog } from "./vehicle-route-dialog";

/**
 * 아이 한 명의 오늘 셔틀 카드 — **학부모 뷰와 관리자 뷰가 같은 카드**를 그린다.
 *
 * 차이는 `staff` 하나다: 관리자 뷰(`staff`)는 문장 아래에 직원용 사실(차량·회차·기록 상태·직원 메모)을
 * 덧붙인다. 학부모 뷰는 문장만 — 직원 메모·다른 아이 정보는 애초에 이 카드에 오지 않는다.
 */
export function ParentRideCard({
  name,
  schoolGrade,
  legs,
  staff = false,
  showRoute = false,
  aside,
  editing = false,
  fleet = [],
  dayLabel = "",
  onDate = "",
  today = "",
  editable = false,
  changes = [],
  regularChanges = [],
  skipButtons = false,
  nowMinutes,
  canAck = false,
}: {
  name: string;
  schoolGrade: string;
  legs: readonly RideLeg[];
  staff?: boolean;
  /** 그 회차의 노선 전체를 구간 아래에 펼친다(학부모 뷰). */
  showRoute?: boolean;
  /**
   * 학부모 '등하원 수정' 모드 — 구간마다 '등원 수정하기'/'하원 수정하기' 버튼을 세운다.
   * 누르면 호차 전체 노선 모달(`VehicleRouteDialog`) — 거기서 고르고 저장하면 바로 DB에 반영된다.
   */
  editing?: boolean;
  /** 학원의 호차 전부와 각 전체 노선 — `editing`일 때 모달 재료. */
  fleet?: readonly VehicleFleet[];
  /** 모달 설명 줄("오늘 · …" / "2026년 10월 1일 (수) 일정"). */
  dayLabel?: string;
  /** 이 카드의 날짜(YYYY-MM-DD) — 모달 저장 대상. */
  onDate?: string;
  /** 서버가 본 오늘(KST) — 모달의 '출발 10분 전 마감' 판정용. */
  today?: string;
  /** 오늘 이후면 true — 지난 날짜는 모달이 보기만. */
  editable?: boolean;
  /**
   * 이 아이의 그날 변경 내역(0321a 장부, 최신 먼저) — 🔴 **직원 뷰(`staff`)에서만** 그린다
   * (사용자 2026-09-29 "관리자나 셔틀 선생님만"). 학부모 화면은 애초에 넘기지 않는다.
   */
  changes?: readonly RideChange[];
  /** 이 아이의 최근 고정(매주) 시간 변경(0322a 장부) — 🔴 직원 뷰에서만 그린다. */
  regularChanges?: readonly RegularChange[];
  /**
   * 학부모 뷰 — 구간 문장 옆에 '등원만 타지 않기'/'하원만 타지 않기' 버튼(**수정 모드에서만**).
   * 누르면 짧은 사유를 받아 저장한다(`SkipRideButton`, 사용자 2026-09-29).
   */
  skipButtons?: boolean;
  /**
   * 지금 KST 분 — 주면 학부모 뷰에서 **지금 타는 회차가 출발 10분 전을 지난** 구간을 잠근다(사용자 2026-10-15).
   * 없으면(월별 상세 등) [출발]이 찍힌 구간만 잠근다. 판정은 서버가 다시 한다.
   */
  nowMinutes?: number;
  /** 카드 머리 오른쪽(관리자 뷰의 '학부모 계정 연결' 표시 등). */
  aside?: React.ReactNode;
  /**
   * 직원 뷰 변경 내역 줄의 [확인](학원 공용 확인 기록에 쓴다)을 세울까 — 호출부(page.tsx)가 서버 게이트(`ackShuttleHistory`)와
   * **같은 함수** `canRecordBoarding()`으로 계산해 넘긴다. 없으면 [확인]을 그리지 않고 내역만 보인다(원장 2026-11-05).
   */
  canAck?: boolean;
}) {
  return (
    <article className="bg-card rounded-2xl p-4 shadow-[var(--shadow-card)]">
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="text-lg font-bold">
          {name} <span className="text-text-dim text-sm font-medium">{schoolGrade}</span>
        </h2>
        {aside}
      </header>
      {legs.length === 0 ? (
        <p className="text-text-dim mt-3 text-sm">오늘은 셔틀 일정이 없어요.</p>
      ) : (
        <ol className="mt-3 flex flex-col gap-2">
          {legs.map((leg, i) => {
            const view = parentLegView(leg, { past: !!onDate && !!today && onDate < today });
            // 🔑 수정 모드 key = 방향 + **그 방향 안에서의** 순번. 저장하면 구간 key(예외 id 포함)도, 시각 정렬 순서도
            //    바뀔 수 있는데(등원을 저녁 회차로 옮기면 하원보다 뒤로 간다) 그걸 key에 넣으면 모달이 다시 만들어져
            //    저장 직후 닫힌다(결과 문구를 못 본다).
            const nth = legs.slice(0, i).filter((l) => l.direction === leg.direction).length;
            // 🔑 이미 탄 구간은 수정 모드에서 잠근다(사용자 2026-09-30) — 노선은 흐리게, 수정·타지 않기 버튼 없음.
            //    '타지 않기'의 흐림과 달리 되살릴 길도 없다(탄 사실은 바뀌지 않는다). 서버도 같은 기록으로 막는다.
            //    흐림은 수정 모드에서만 — 평소 보기·관리자 뷰에선 탄 구간이 가장 또렷해야 한다.
            const rode = legRode(leg);
            // 🔒 지금 타는 회차가 출발했거나 출발 10분 전을 지났으면 그 방향은 잠근다(학부모만 — 직원은 마감이 없다).
            //    안 타는 구간(타지 않기)은 잠그지 않는다 — 다른 열린 회차로 다시 탈 수 있다(서버도 같은 규칙).
            const closed =
              !staff &&
              !leg.skipped &&
              (leg.trip === "running" ||
                leg.trip === "done" ||
                (typeof nowMinutes === "number" && runEditClosed(runStartTime(leg.route), onDate, today, nowMinutes)));
            // 짝 규칙 재료 — 그날 반대 방향이 실제로 타는 자리(안 타는 구간은 빼고, 탄 구간이 있으면 그것).
            const otherLeg = legs.find((l) => l.direction !== leg.direction && !l.skipped) ?? null;
            const other = otherLeg
              ? { runId: otherLeg.runId, time: otherLeg.route.find((s) => s.mine)?.time ?? otherLeg.plannedTime }
              : null;
            // 🔑 수정 모드가 아닐 때는 **그 회차 운행이 끝났다고 셔틀 선생님이 종료를 찍은**(학원 도착까지 마친) 구간을
            //    흐리게(사용자 2026-09-30) — 끝난 일이 앞으로 탈 구간보다 눈에 덜 띄게. 판정 = `trip === "done"`(오늘만 온다).
            //    관리자 뷰(`staff`)는 흐리지 않는다(그 화면은 사실을 또렷하게 확인하는 곳이다).
            const tripDone = !staff && !editing && leg.trip === "done";
            const dim = leg.skipped || (editing && rode) || tripDone;
            return (
              // 흰 바탕 + 헤어라인 — 회색 바탕이면 '예정'(회색) 배지가 묻혀 안 보였다.
              <li key={editing ? `${leg.direction}|${nth}` : leg.key} className="border-line rounded-xl border px-3 py-2.5">
                <div className="flex items-start gap-2">
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${TONE_SOFT[view.tone]}`}>
                    {DIRECTION_LABEL[leg.direction]}
                  </span>
                  {/* 버튼이 옆에 서는 학부모 뷰는 문장을 한 단계 줄여 폰 폭에서 한 줄에 들어가게 한다. */}
                  <div className="min-w-0 flex-1">
                    {/* 안 타는 구간은 문장만 또렷하게("등원차를 타지 않습니다") — 노선은 아래에서 흐리게. */}
                    <p
                      className={`font-bold break-keep ${skipButtons ? "text-sm" : ""} ${leg.skipped ? "text-foreground" : TONE_TEXT[view.tone]}`}
                    >
                      {view.headline}
                    </p>
                    {view.detail ? (
                      <p className={`text-text-dim break-keep ${skipButtons ? "text-xs" : "text-sm"}`}>{view.detail}</p>
                    ) : null}
                    {/* 그날만 바뀐 사유 — 학부모에게도 보인다(사용자 2026-10-20). 직원 뷰는 아래 `StaffFacts`의 메모가 같은 글을 싣는다. */}
                    {!staff && leg.changeNote ? (
                      <p className={`text-foreground break-keep ${skipButtons ? "text-xs" : "text-sm"}`}>사유: {leg.changeNote}</p>
                    ) : null}
                  </div>
                  {/* '타지 않기'는 수정 모드에서만(사용자 2026-09-29) · 이미 안 타는 구간 · 지난 날짜엔 없다. */}
                  {skipButtons && editing && editable && !leg.skipped && !rode && !closed ? (
                    <SkipRideButton studentId={leg.studentId} onDate={onDate} direction={leg.direction} />
                  ) : null}
                </div>
                {showRoute && leg.route.length > 0 ? (
                  // 안 타는 구간·이미 탄 구간의 노선 — 시간·정류장은 보이되 회색으로 흐리게.
                  // 안 타는 구간은 수정하기 버튼이 살아 있고(다시 탈 수 있다), 탄 구간은 아래에서 잠근다.
                  <div className="relative">
                    <div className={dim ? "pointer-events-none opacity-45 grayscale select-none" : undefined} aria-hidden={dim || undefined}>
                      <RouteList leg={leg} />
                    </div>
                    {/* 🔑 운행 종료로 흐린 노선엔 결말을 그 자리에 적는다(사용자 2026-09-30) — 흐림만으로는 "왜 회색인지"를 모른다.
                        흐림 레이어 밖에 둬서 글자는 또렷하다. */}
                    {/* 🔴 '완료'는 **이 아이가 실제로 탔을 때만** — 운행이 끝났어도 미탑승·안 타는 날·기록 없음이면
                        "완료했습니다"는 거짓이다(윗줄 문장은 "타지 않았어요"라고 말하고 있다). */}
                    {tripDone && rode ? (
                      <div className="absolute inset-0 flex items-center justify-center">
                        {/* 크게 + 살짝 흐리게(사용자 2026-09-30) — 끝난 일이라 눈에는 띄되 앞으로 탈 구간보다 앞서지 않게. */}
                        <span className="bg-card text-foreground rounded-full px-5 py-2 text-lg font-bold opacity-70 shadow-[var(--shadow-card)]">
                          {leg.direction === "in" ? "등원 완료했습니다" : "하원 완료했습니다"}
                        </span>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {staff ? <StaffFacts leg={leg} /> : null}
                {editing && rode ? (
                  <p className="bg-bg-soft text-text-dim mt-2 flex h-10 w-full items-center justify-center rounded-lg text-sm font-bold">
                    이미 {leg.direction === "in" ? "탔어요" : "내렸어요"} · 수정할 수 없어요
                  </p>
                ) : editing && closed && editable ? (
                  <p className="bg-bg-soft text-text-dim mt-2 flex min-h-10 w-full items-center justify-center rounded-lg px-2 text-center text-sm font-bold break-keep">
                    {leg.trip === "running" || leg.trip === "done" ? "차량이 이미 출발했어요" : "출발 10분 전이 지났어요"} · 수정할 수 없어요
                  </p>
                ) : editing ? (
                  <VehicleRouteDialog
                    leg={leg}
                    other={other}
                    fleet={fleet}
                    dayLabel={dayLabel}
                    onDate={onDate}
                    today={today}
                    editable={editable}
                  />
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
      {staff && changes.length > 0 ? <StaffChangeList changes={changes} canAck={canAck} /> : null}
      {staff && regularChanges.length > 0 ? <StaffRegularChangeList changes={regularChanges} canAck={canAck} /> : null}
    </article>
  );
}

/**
 * 변경 내역(직원 전용) — 누가 · 언제 · 어디서 어디로. 학부모·직원이 바꾼 것, 취소한 것 모두(0321a 장부).
 * 🔑 전/후는 저장 당시 글자 스냅샷이다(노선이 나중에 바뀌어도 그때의 자리가 남는다). null = 평소대로.
 */
function StaffChangeList({ changes, canAck }: { changes: readonly RideChange[]; canAck: boolean }) {
  return (
    <section className="border-line mt-3 border-t pt-2">
      <p className="text-text-dim text-xs font-bold">변경 내역 {changes.length}건 · 직원에게만 보입니다</p>
      {/* 최신 2건만 먼저 — 나머지는 펼쳐보기(사용자 2026-09-30 "한번에 다 보이니 너무 정신이 없다"). */}
      <CollapsibleList className="mt-1 flex flex-col gap-1.5">
        {changes.map((c) => (
          <li key={c.id} className="text-sm break-keep">
            <div className="flex items-center gap-1">
              <span>
                <span className="bg-bg-soft rounded-full px-1.5 py-0.5 text-xs font-bold">{DIRECTION_LABEL[c.direction]}</span>{" "}
                <span className="num text-text-dim">{c.at}</span> <span className="font-bold">{c.actorName}</span>
              </span>
              {/* 확인하면 이 줄은 화면에서 내려간다(장부는 그대로, 0323a · 사용자 2026-09-30). 기록 권한이 없으면 단추 없음. */}
              {canAck ? <AckHistoryButton kind="ride" historyId={c.id} /> : null}
            </div>
            <span className="text-text-dim block pl-1">
              {c.beforeLabel ?? "평소"} → {c.op === "cancel" ? "평소대로" : c.afterLabel ?? "평소"}
            </span>
            {/* 사유 — '타지 않기'에서 학부모가 적은 것(취소 줄은 취소된 변경의 사유라 옅게). */}
            {c.memo ? (
              <span className={`block pl-1 ${c.op === "cancel" ? "text-text-dim" : "text-foreground"}`}>사유: {c.memo}</span>
            ) : null}
          </li>
        ))}
      </CollapsibleList>
    </section>
  );
}

/** 고정(매주) 시간 변경 내역(직원 전용, 0322a 장부) — 최근 60일. 요일·전/후·사유·누가. */
function StaffRegularChangeList({ changes, canAck }: { changes: readonly RegularChange[]; canAck: boolean }) {
  return (
    <section className="border-line mt-3 border-t pt-2">
      <p className="text-text-dim text-xs font-bold">고정 시간 변경 {changes.length}건 · 최근 60일 · 직원에게만 보입니다</p>
      <CollapsibleList className="mt-1 flex flex-col gap-1.5">
        {changes.map((c) => (
          <li key={c.id} className="text-sm break-keep">
            <div className="flex items-center gap-1">
              <span>
                <span className="bg-bg-soft rounded-full px-1.5 py-0.5 text-xs font-bold">
                  매주 {dayLabel(c.weekday)} {DIRECTION_LABEL[c.direction]}
                </span>{" "}
                <span className="num text-text-dim">{c.at}</span> <span className="font-bold">{c.actorName}</span>
              </span>
              {canAck ? <AckHistoryButton kind="regular" historyId={c.id} /> : null}
            </div>
            <span className="text-text-dim block pl-1">
              {c.beforeLabel ?? "없음"} → {c.afterLabel ?? "없음"}
            </span>
            {c.reason ? <span className="block pl-1">사유: {c.reason}</span> : null}
          </li>
        ))}
      </CollapsibleList>
    </section>
  );
}

/**
 * 노선 전체 — 정류장 순서대로 시각·이름, 우리 아이가 타고 내리는 칸은 굵게 + '우리 아이' 표시.
 * 🔑 정류장 이름·시각뿐이다(다른 아이 정보는 재료에 없다). 학원 출발·도착 칸은 글자를 옅게 둔다.
 */
function RouteList({ leg }: { leg: RideLeg }) {
  return (
    <div className="border-line mt-2 border-t pt-2">
      <p className="text-text-dim text-sm">
        {leg.vehicleName} {leg.runName} 노선
      </p>
      <ol className="mt-1 flex flex-col">
        {leg.route.map((s) => (
          <li key={s.id} className="flex items-center gap-2 py-0.5 text-sm">
            <span className={`size-2 shrink-0 rounded-full ${s.mine ? "bg-primary" : "bg-line"}`} aria-hidden />
            <span className="num text-text-dim w-11 shrink-0">{s.time ?? "--:--"}</span>
            <span className={`min-w-0 break-keep ${s.mine ? "font-bold" : s.kind === "stop" ? "" : "text-text-dim"}`}>
              {s.name}
            </span>
            {s.mine ? (
              <span className="bg-primary text-primary-foreground shrink-0 rounded-full px-2 py-0.5 text-xs font-bold">
                {leg.direction === "in" ? "여기서 타요" : "여기서 내려요"}
              </span>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

function StaffFacts({ leg }: { leg: RideLeg }) {
  const facts = [
    `${leg.vehicleName} ${leg.runName}`.trim(),
    `${leg.stopName}${leg.plannedTime ? ` ${leg.plannedTime}` : ""}`,
    leg.skipped ? "오늘 안 탐" : leg.added ? "오늘만 승하차" : null,
    leg.status ? BOARDING_STATUS_LABEL[leg.status] : "아직 안 찍음",
    leg.trip ? TRIP_STATE_LABEL[leg.trip] : null,
  ].filter(Boolean);
  return (
    <div className="text-text-dim border-line mt-1.5 border-t pt-1.5 text-sm">
      <p className="break-keep">{facts.join(" · ")}</p>
      {leg.staffMemo ? <p className="break-keep">메모: {leg.staffMemo}</p> : null}
    </div>
  );
}
