import { redirect } from "next/navigation";

import { getParentViewer } from "@/features/shuttle/server/parent-viewer";
import { loadParentLiveData } from "@/features/shuttle/server/parent-live-data";
import { ParentLiveMap } from "@/features/shuttle/components/parent-live-map";
import { ACADEMY_LOCATION } from "@/features/shuttle/academy-location";

export const metadata = { title: "실시간 차량" };

/** 빌드에 박히는 값 — 키가 없으면 지도 대신 안내만 그린다(지도 청크도 안 받는다). */
const KAKAO_MAP_KEY = process.env.NEXT_PUBLIC_KAKAO_MAP_KEY ?? "";

/**
 * 학부모 탭 1 '실시간 차량' — 카카오맵에 **우리 아이의 오늘 정류장**을 띄운다(사용자 2026-10-08, 1단계).
 *
 * 🔴 지어내지 않는다: 차량 위치를 보내는 기기(기사 폰 GPS)가 아직 없다 — 지도엔 정류장만, 차는 "아직"이라고 말한다.
 *    다음 단계: 운행 중 기사 폰이 위치를 보내면 이 지도에 차 마커가 뜬다.
 * 🔑 지도의 기준은 **학원**(인재원 침산, `academy-location.ts`) — 마커로 찍는다. 정류장 좌표(0244a)가 있으면 학원과 함께
 *    한 화면에 맞추고, 없으면 학원 중심으로 뜨고 아래 목록이 정류장을 말한다.
 */
export default async function ParentLivePage() {
  const viewer = await getParentViewer();
  if (!viewer) redirect("/home");
  const { stops, withCoords } = await loadParentLiveData(viewer);

  return (
    <>
      <h1 className="text-lg font-bold">실시간 차량</h1>

      {KAKAO_MAP_KEY ? (
        <ParentLiveMap appKey={KAKAO_MAP_KEY} academy={ACADEMY_LOCATION} stops={stops} />
      ) : (
        <section className="bg-card rounded-2xl p-6 text-center shadow-[var(--shadow-card)]">
          <p className="font-bold">준비 중인 기능이에요</p>
          <p className="text-text-dim mt-1 text-sm break-keep">아이가 탄 셔틀이 지금 어디쯤인지 지도로 볼 수 있게 준비하고 있어요.</p>
        </section>
      )}

      <p className="bg-bg-soft text-text-dim rounded-xl px-3 py-2 text-xs break-keep">
        🚌 차량 위치는 아직 표시되지 않아요. 셔틀이 운행 중일 때 차 위치가 이 지도에 뜨도록 준비하고 있어요.
      </p>

      <section className="bg-card rounded-2xl p-4 shadow-[var(--shadow-card)]">
        <h2 className="text-sm font-bold">오늘 타고 내리는 곳</h2>
        {stops.length === 0 ? (
          <p className="text-text-dim mt-2 text-sm">오늘은 셔틀 일정이 없어요.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {stops.map((s) => (
              <li key={s.stopId} className="border-line rounded-xl border px-3 py-2">
                <p className="text-sm font-bold">{s.name}</p>
                <p className="text-text-dim text-xs">{s.lines.join(" · ")}</p>
              </li>
            ))}
          </ul>
        )}
        {stops.length > 0 && withCoords < stops.length ? (
          <p className="text-text-faint mt-2 text-xs break-keep">
            {withCoords === 0 ? "정류장 위치가 아직 지도에 등록되지 않았어요." : `정류장 ${stops.length}곳 중 ${withCoords}곳이 지도에 표시돼요.`}
          </p>
        ) : null}
      </section>
    </>
  );
}
