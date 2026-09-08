"use client";

import dynamic from "next/dynamic";
import type { StopMapPickerImplProps } from "./stop-map-picker-impl";

/**
 * 정류장 위치 지도 — **지연 로드 래퍼**(CLAUDE.md B5).
 *
 * 카카오 SDK는 외부 스크립트라 정적으로 물면 셔틀 편성 화면 첫 페인트를 막는다. 지도는 '위치'를
 * 펼쳤을 때만 필요하므로 `next/dynamic(ssr:false)`로 그때 가져온다.
 *
 * 🔴 **키가 없으면 impl 청크를 아예 안 받는다** — 지금 이 프로젝트엔 `NEXT_PUBLIC_KAKAO_MAP_KEY`가
 *    없다. 그 상태에서 지도를 띄우려 하면 빈 회색 상자만 남아 "느린 건지 고장인지"를 알 수 없으므로,
 *    **한글로 사유를 적고 직접 입력으로 보낸다**(에디터가 위경도 입력을 항상 함께 그린다).
 * ⚠️ `process.env.NEXT_PUBLIC_*`는 빌드 시 인라인이라 클라이언트에서 그대로 읽힌다. 서버가 이 모듈을
 *    import하지 않는다(클라 전용) — [[#81]] 상수 누출과 무관.
 */

/** 빌드에 박히는 값 — 배포에 키를 넣으면 그때부터 지도가 뜬다(코드 변경 불필요). */
const KAKAO_MAP_KEY = process.env.NEXT_PUBLIC_KAKAO_MAP_KEY ?? "";

/** 지도를 띄울 수 있는 배포인가 — 에디터가 '지도에서 고르기' 버튼을 그릴지 판단할 때 쓴다. */
export const MAP_AVAILABLE = KAKAO_MAP_KEY.length > 0;

const Impl = dynamic(() => import("./stop-map-picker-impl").then((m) => m.StopMapPickerImpl), {
  ssr: false,
  loading: () => <div className="bg-bg-soft/40 h-56 w-full animate-pulse rounded-xl" />,
});

export function StopMapPicker(props: Omit<StopMapPickerImplProps, "appKey">) {
  if (!MAP_AVAILABLE) {
    return (
      <p className="border-line text-text-dim rounded-xl border border-dashed px-3 py-2 text-xs">
        지도 키가 설정되지 않아 좌표를 직접 입력합니다 — 카카오 지도에서 위치를 찾아 위도·경도를 아래
        칸에 넣으세요. (배포에 <span className="num">NEXT_PUBLIC_KAKAO_MAP_KEY</span>를 넣으면 지도가
        바로 뜹니다.)
      </p>
    );
  }
  return <Impl appKey={KAKAO_MAP_KEY} {...props} />;
}
