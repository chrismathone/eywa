"use client";

import { useEffect, useRef, useState } from "react";

import type { AcademyLocation } from "../academy-location";
import type { ParentLiveStop } from "../server/parent-live-data";

/**
 * 학부모 '실시간 차량' 지도(사용자 2026-10-08) — 카카오맵에 **우리 아이의 오늘 정류장**을 찍는다.
 *
 * 🔴 차량 마커는 없다 — 기사 폰이 위치를 보내는 기능이 아직 없다. 가짜 차를 그리지 않는다.
 * 🔑 SDK는 `<script>`를 직접 주입한다(정류장 picker와 같은 결 — react-kakao-maps-sdk 미설치). 학부모 화면엔 picker가
 *    없으니 주입은 여기 한 번이고, 이미 `window.kakao.maps`가 있으면 그걸 쓴다.
 * 🔴 실패를 회색 상자로 두지 않는다 — 키·도메인 문제면 한글로 사유를 적는다(도메인 미등록이 가장 흔하다).
 */

type LatLng = object;
type KakaoMap = { setBounds(b: LatLngBounds): void; setCenter(c: LatLng): void; relayout(): void };
type LatLngBounds = { extend(p: LatLng): void };
type KakaoMaps = {
  load(cb: () => void): void;
  LatLng: new (lat: number, lng: number) => LatLng;
  LatLngBounds: new () => LatLngBounds;
  Map: new (el: HTMLElement, opts: { center: LatLng; level: number }) => KakaoMap;
  Marker: new (opts: { position: LatLng; map: KakaoMap; title?: string }) => object;
  CustomOverlay: new (opts: { position: LatLng; content: HTMLElement; yAnchor: number; map: KakaoMap }) => object;
};
type KakaoWindow = Window & { kakao?: { maps?: KakaoMaps } };

let sdkPromise: Promise<KakaoMaps> | null = null;

function loadKakaoMaps(appKey: string): Promise<KakaoMaps> {
  if (sdkPromise) return sdkPromise;
  const promise = new Promise<KakaoMaps>((resolve, reject) => {
    const w = window as KakaoWindow;
    if (w.kakao?.maps) {
      w.kakao.maps.load(() => resolve((window as KakaoWindow).kakao!.maps!));
      return;
    }
    const el = document.createElement("script");
    el.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(appKey)}&autoload=false`;
    el.async = true;
    el.onload = () => {
      const maps = (window as KakaoWindow).kakao?.maps;
      if (!maps) return reject(new Error("maps-missing"));
      maps.load(() => resolve(maps));
    };
    el.onerror = () => reject(new Error("script-error"));
    document.head.appendChild(el);
  });
  sdkPromise = promise.catch((e) => {
    sdkPromise = null; // 다음 시도를 막지 않는다
    throw e;
  });
  return sdkPromise;
}

/** 학원 기준 확대 단계 — 3 ≈ 동네 골목이 보이는 정도(1이 가장 가깝다). */
const ACADEMY_LEVEL = 3;

export function ParentLiveMap({ appKey, academy, stops }: { appKey: string; academy: AcademyLocation; stops: ParentLiveStop[] }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  /**
   * 🔴 정류장 **내용**이 바뀔 때만 다시 그린다 — 학부모 화면은 알림 때문에 15초마다 다시 읽어(router.refresh)
   *    `stops`가 매번 새 배열로 온다. 배열 그대로 의존하면 15초마다 지도를 새로 만들어 화면이 깜빡이고 확대가 풀린다.
   */
  const stopsKey = JSON.stringify(stops);

  useEffect(() => {
    let cancelled = false;
    loadKakaoMaps(appKey)
      .then((maps) => {
        if (cancelled || !boxRef.current) return;
        const placedStops = JSON.parse(stopsKey) as ParentLiveStop[];
        boxRef.current.innerHTML = ""; // 다시 그릴 때 옛 지도를 남기지 않는다
        // 🔑 기준점 = 학원(셔틀이 출발하고 돌아오는 곳). 정류장 좌표가 없어도 학원은 늘 보인다.
        const academyPos = new maps.LatLng(academy.lat, academy.lng);
        const map = new maps.Map(boxRef.current, { center: academyPos, level: ACADEMY_LEVEL });
        new maps.Marker({ position: academyPos, map, title: academy.name });
        const academyLabel = document.createElement("div");
        academyLabel.textContent = `🏫 ${academy.name}`;
        academyLabel.className = "bg-primary text-primary-foreground rounded-md px-2 py-0.5 text-xs font-bold shadow";
        new maps.CustomOverlay({ position: academyPos, content: academyLabel, yAnchor: 2.6, map });
        const placed = placedStops.filter((s) => s.lat !== null && s.lng !== null);
        if (placed.length > 0) {
          // 학원과 우리 아이 정류장이 한 화면에 다 들어오게 맞춘다.
          const bounds = new maps.LatLngBounds();
          bounds.extend(academyPos);
          for (const s of placed) {
            const pos = new maps.LatLng(s.lat!, s.lng!);
            new maps.Marker({ position: pos, map, title: s.name });
            // 정류장 이름 꼬리표 — 마커만 있으면 어느 정류장인지 눌러 봐야 안다.
            const label = document.createElement("div");
            label.textContent = s.name;
            label.className = "rounded-md bg-white px-2 py-0.5 text-xs font-bold text-neutral-900 shadow";
            new maps.CustomOverlay({ position: pos, content: label, yAnchor: 2.6, map });
            bounds.extend(pos);
          }
          map.setBounds(bounds);
        }
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("failed");
      });
    return () => {
      cancelled = true;
    };
  }, [appKey, academy.lat, academy.lng, academy.name, stopsKey]);

  return (
    <div className="relative">
      {/* 자리는 실제 높이로 먼저 잡는다 — 지도가 늦게 떠도 아래 내용이 밀리지 않게. */}
      <div ref={boxRef} className="border-line h-[55dvh] min-h-72 w-full overflow-hidden rounded-2xl border" />
      {status !== "ready" && (
        <div className="bg-card/90 absolute inset-0 flex flex-col items-center justify-center gap-1 rounded-2xl px-6 text-center">
          {status === "loading" ? (
            <p className="text-text-dim text-sm font-bold">지도를 불러오는 중이에요…</p>
          ) : (
            <>
              <p className="text-sm font-bold">지도를 불러오지 못했어요</p>
              <p className="text-text-dim text-xs break-keep">잠시 후 다시 열어 주세요. 계속 안 되면 학원에 알려 주세요.</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
