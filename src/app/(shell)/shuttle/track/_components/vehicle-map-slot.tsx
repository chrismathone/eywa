"use client";

/**
 * 차량 위치가 들어올 **자리** — 지금은 지도가 아니라 "왜 아직 비어 있는지"를 말하는 칸이다.
 *
 * 원장(2026-09-03): *"지도키는 추후 개발예정이라 잡고 **영역만 만들어두려는것**"*.
 *
 * 🔴 **없는 것을 있는 척하지 않는다** — 가짜 지도·더미 마커·임의 좌표를 그리지 않는다. 빈 회색 상자도
 *    두지 않는다(빈 상자는 "느린 건지 고장인지"를 알 수 없어 정류장 위치 picker에서 이미 금지한 모양이다).
 *    대신 **무엇이 더 있어야 여기가 채워지는지**를 한글로 적는다.
 *
 * 🔑 자리를 **실제 높이로** 잡아 두는 이유: 나중에 지도가 들어올 때 레이아웃이 통째로 밀리지 않게 하고,
 *    지금도 "여기에 뭔가 올 자리"라는 게 보이게 하기 위해서다.
 */

/**
 * 빌드에 박히는 값 — 배포에 키를 넣으면 그때부터 안내 문구가 바뀐다(코드 변경 불필요).
 * ⚠️ 정류장 위치 picker(`_components/stop-map-picker.tsx`)에도 같은 판정이 있다. 지도가 실제로 이
 *    화면에 들어오는 날 그쪽 상수로 합칠 것 — 지금은 그 모듈이 `next/dynamic`으로 지도 구현 청크를
 *    물고 있어, 지도를 안 그리는 이 자리가 그걸 끌어올 이유가 없다.
 */
const MAP_KEY_READY = (process.env.NEXT_PUBLIC_KAKAO_MAP_KEY ?? "").length > 0;

export function VehicleMapSlot({
  stopsTotal,
  stopsWithCoords,
}: {
  /** 이 차 노선이 지나는 정류장 수(중복 제거). */
  stopsTotal: number;
  /** 그중 좌표가 찍힌 곳 — 위치 기능의 준비 상태를 보여주는 **유일한 진짜 숫자**다. */
  stopsWithCoords: number;
}) {
  return (
    <div className="border-line bg-muted/30 flex h-56 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed px-4 text-center">
      <p className="text-text-dim text-[13.5px] font-bold">
        {MAP_KEY_READY ? "차량 위치가 아직 들어오지 않습니다" : "지도가 들어올 자리입니다"}
      </p>

      {/* 🔴 키가 있어도 지도를 띄우지 않는다 — 띄울 좌표가 없다. 두 경우의 **남은 일이 다르다**. */}
      <p className="text-text-faint max-w-md text-[11.5px] leading-relaxed">
        {MAP_KEY_READY ? (
          <>
            기사·동승 선생님 폰이 운행 중에 위치를 보내기 시작하면 이 자리에 차량이 표시됩니다. 아직
            위치를 보내는 기능이 없어 표시할 것이 없습니다.
          </>
        ) : (
          <>
            지도 키(<span className="num">NEXT_PUBLIC_KAKAO_MAP_KEY</span>)가 설정되고 기사·동승 선생님
            폰이 위치를 보내기 시작하면 이 자리에 차량이 표시됩니다.
          </>
        )}
      </p>

      {/* 지금 실제로 말할 수 있는 사실 하나 — 이 차 노선의 정류장 중 몇 곳이 지도에 찍힐 수 있나. */}
      {stopsTotal > 0 && (
        <p className="text-text-faint text-[11.5px]">
          이 차 노선 정류장 <span className="num font-bold">{stopsTotal}</span>곳 중{" "}
          <span className="num font-bold">{stopsWithCoords}</span>곳에 좌표가 지정돼 있습니다
          {stopsWithCoords === 0 && " — '노선 편성 → 정류장 관리'에서 찍을 수 있습니다"}
        </p>
      )}
    </div>
  );
}
