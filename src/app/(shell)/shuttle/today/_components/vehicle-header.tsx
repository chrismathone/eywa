"use client";

import { progressState, type Progress, type VehicleGroup } from "@/features/shuttle/today/today-board";
import { phoneLabel } from "@/lib/format/phone";

/**
 * 호차 머리 — 폰에서 **스크롤 중에도 붙어 있다**(sticky). 차가 여럿일 때 "지금 몇 호차를 보는지"를
 * 놓치면 남의 차 회차를 자기 차로 착각한다(원장 2026-08-19 "호차 구분").
 *
 * 🔑 숫자(N명 남음 · 찍은/예정)는 **그 차의 그날 전체**(`progress`, 사용자 2026-10-06).
 *    옛 등하원 필터(회차를 숨기던 것)는 2026-10-20 호차 토글로 바뀌어 이 머리가 밝힐 숨김이 없다 —
 *    호차 토글은 차를 통째로 고를 뿐 그 차의 회차를 빼지 않는다.
 * ⚠️ 기사 전화는 **누르면 걸리게**(tel:) — 차 안에서 번호를 옮겨 적을 수 없다.
 */
export function VehicleHeader({
  group,
  progress,
}: {
  group: VehicleGroup;
  /** 그 차의 그날 전체 진행. */
  progress: Progress;
}) {
  const state = progressState(progress);
  return (
    // ⚠️ 토큰 이름은 `--background`다 — `bg-bg`는 **정의가 없어 아무 색도 안 칠해지고**, 화이트 캔버스라
    //    "정상처럼" 보인 채 sticky 뒤로 본문이 비친다(죽은 색 클래스, 팔레트 v4 주의).
    <div className="bg-bg-canvas/95 border-line sticky top-0 z-10 flex flex-wrap items-center gap-x-2 gap-y-1 border-b py-1.5 backdrop-blur">
      <h2 className="text-foreground text-base font-bold">{group.vehicleName}</h2>
      {group.driverName && (
        <span className="text-text-dim text-xs">
          기사 {group.driverName}
          {group.driverPhone && (
            <a href={`tel:${group.driverPhone}`} className="text-primary ml-1 font-bold underline">
              {phoneLabel(group.driverPhone)}
            </a>
          )}
        </span>
      )}
      <span className="ml-auto text-xs font-bold">
        {/* 🔴 전원이 '오늘 안 탐'이면 "완료"가 아니라 "오늘 탑승 없음"이다 — 회차 머리와 같은 판정
            (`progressState`)을 쓴다. 두 머리가 다른 말을 하면 어느 쪽이 맞는지 알 수 없다. */}
        {state === "remaining" ? (
          <span className="text-amber">
            <span className="num">{progress.unmarked}</span>명 남음
          </span>
        ) : state === "done" ? (
          <span className="text-green">완료</span>
        ) : (
          <span className="text-text-faint">오늘 탑승 없음</span>
        )}
        <span className="text-text-faint ml-1.5 font-normal">
          <span className="num">{progress.boarded + progress.missed}</span>/
          <span className="num">{progress.planned}</span>
        </span>
      </span>
    </div>
  );
}
