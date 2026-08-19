"use client";

import { DIRECTION_LABEL } from "@/features/shuttle/types";
import type { DirectionFilter, VehicleGroup } from "@/features/shuttle/today-board";

/**
 * 호차 머리 — 폰에서 **스크롤 중에도 붙어 있다**(sticky). 차가 여럿일 때 "지금 몇 호차를 보는지"를
 * 놓치면 남의 차 회차를 자기 차로 착각한다(원장 2026-08-19 "호차 구분").
 *
 * 🔴 **필터가 켜져 있으면 그 사실을 여기서 말한다** — 등하원 칩 줄은 스크롤하면 사라지는데 이 머리는
 *    붙어 있다. 안 밝히면 아침에 '등원'을 눌러 둔 채 저녁에 폰을 열었을 때 화면이 "완료"만 늘어놓고,
 *    하원 회차가 통째로 숨겨진 사실은 어디에도 안 보인다(그대로 미기록으로 끝난다).
 * ⚠️ 기사 전화는 **누르면 걸리게**(tel:) — 차 안에서 번호를 옮겨 적을 수 없다.
 */
export function VehicleHeader({
  group,
  dirFilter,
}: {
  group: VehicleGroup;
  dirFilter: DirectionFilter;
}) {
  const { progress } = group;
  const scope = dirFilter === "all" ? "" : `${DIRECTION_LABEL[dirFilter]} `;
  return (
    // ⚠️ 토큰 이름은 `--background`다 — `bg-bg`는 **정의가 없어 아무 색도 안 칠해지고**, 화이트 캔버스라
    //    "정상처럼" 보인 채 sticky 뒤로 본문이 비친다(죽은 색 클래스, 팔레트 v4 주의).
    <div className="bg-background/95 border-line sticky top-0 z-10 flex flex-wrap items-center gap-x-2 gap-y-1 border-b py-1.5 backdrop-blur">
      <h2 className="text-text text-[15px] font-bold">{group.vehicleName}</h2>
      {group.driverName && (
        <span className="text-text-dim text-[12px]">
          기사 {group.driverName}
          {group.driverPhone && (
            <a href={`tel:${group.driverPhone}`} className="text-primary ml-1 font-bold underline">
              {group.driverPhone}
            </a>
          )}
        </span>
      )}
      <span className="ml-auto text-[12px] font-bold">
        {progress.unmarked > 0 ? (
          <span className="text-amber">
            {scope}
            <span className="num">{progress.unmarked}</span>명 남음
          </span>
        ) : (
          <span className="text-green">{scope}완료</span>
        )}
        <span className="text-text-faint ml-1.5 font-normal">
          <span className="num">{progress.boarded + progress.missed}</span>/
          <span className="num">{progress.planned}</span>
        </span>
      </span>
    </div>
  );
}
