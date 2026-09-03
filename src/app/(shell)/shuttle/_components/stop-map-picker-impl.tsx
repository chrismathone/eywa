"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 카카오맵 정류장 위치 선택 — **실제 구현부**.
 *
 * ⚠️ 이 파일은 **직접 import하지 말 것** — `stop-map-picker.tsx`(next/dynamic 래퍼)를 쓴다.
 *    카카오 SDK는 외부 스크립트라 첫 페인트를 막으면 안 된다(CLAUDE.md B5).
 *
 * 🔑 **패키지를 쓰지 않는다**(`react-kakao-maps-sdk` 미설치) — 지도는 정류장 좌표를 찍는 자리
 *    하나뿐이라, 의존성을 늘리는 대신 SDK `<script>`를 직접 주입한다. 주입은 모듈 단위로 한 번만
 *    (`sdkPromise`) — 정류장을 여럿 열어도 스크립트는 하나다.
 *
 * 🔴 **실패를 회색 상자로 두지 않는다** — 키가 잘못됐거나(도메인 미등록) 네트워크가 막히면 지도가
 *    영영 안 뜨는데, 빈 상자만 있으면 "느린 건지 고장인지"를 알 수 없다. 한글로 사유를 적고
 *    직접 입력으로 돌아갈 길을 남긴다(래퍼가 그 입력을 항상 함께 그린다).
 */

/** 좌표를 못 찍은 정류장을 열 때의 시작점 — 대구 시청(이 학원 권역). 여기서 끌어 옮기면 된다. */
const FALLBACK_CENTER = { lat: 35.8714, lng: 128.6014 };

type LatLng = { getLat(): number; getLng(): number };
type KakaoMap = { setCenter(p: LatLng): void };
type KakaoMarker = { setPosition(p: LatLng): void };
type KakaoCircle = { setPosition(p: LatLng): void; setRadius(r: number): void };
type Geocoder = {
  coord2Address(
    lng: number,
    lat: number,
    cb: (
      result: { road_address?: { address_name?: string }; address?: { address_name?: string } }[],
      status: string,
    ) => void,
  ): void;
};

type KakaoMaps = {
  load(cb: () => void): void;
  LatLng: new (lat: number, lng: number) => LatLng;
  Map: new (el: HTMLElement, opts: { center: LatLng; level: number }) => KakaoMap;
  Marker: new (opts: { position: LatLng; map: KakaoMap }) => KakaoMarker;
  Circle: new (opts: {
    center: LatLng;
    radius: number;
    map: KakaoMap;
    strokeWeight: number;
    strokeColor: string;
    strokeOpacity: number;
    fillColor: string;
    fillOpacity: number;
  }) => KakaoCircle;
  event: {
    addListener(target: KakaoMap, type: string, handler: (e: { latLng: LatLng }) => void): void;
  };
  services?: { Geocoder: new () => Geocoder; Status: { OK: string } };
};

type KakaoWindow = Window & { kakao?: { maps?: KakaoMaps } };

let sdkPromise: Promise<KakaoMaps> | null = null;

/** SDK를 한 번만 주입한다. 실패하면 promise를 버려 다음 열기에서 다시 시도할 수 있게 둔다. */
function loadKakaoMaps(appKey: string): Promise<KakaoMaps> {
  if (sdkPromise) return sdkPromise;
  const promise = new Promise<KakaoMaps>((resolve, reject) => {
    const w = window as KakaoWindow;
    if (w.kakao?.maps) {
      w.kakao.maps.load(() => resolve((window as KakaoWindow).kakao!.maps!));
      return;
    }
    const el = document.createElement("script");
    // autoload=false → 로드 뒤 maps.load(cb)로 초기화(카카오 권장). services = 역지오코딩(주소 자동 채움).
    el.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(appKey)}&autoload=false&libraries=services`;
    el.async = true;
    el.onload = () => {
      const maps = (window as KakaoWindow).kakao?.maps;
      if (!maps) {
        reject(new Error("maps-missing"));
        return;
      }
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

export type StopMapPickerImplProps = {
  appKey: string;
  lat: number | null;
  lng: number | null;
  radiusM: number;
  /** 지도를 누르면 좌표(+주소를 알아냈으면 주소까지) 를 위로 올린다. */
  onPick: (next: { lat: number; lng: number; address: string | null }) => void;
};

export function StopMapPickerImpl({ appKey, lat, lng, radiusM, onPick }: StopMapPickerImplProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");

  const mapsRef = useRef<KakaoMaps | null>(null);
  const mapRef = useRef<KakaoMap | null>(null);
  const markerRef = useRef<KakaoMarker | null>(null);
  const circleRef = useRef<KakaoCircle | null>(null);
  const geocoderRef = useRef<Geocoder | null>(null);

  // 클릭 핸들러는 지도 생성 시 한 번만 등록하므로, 최신 onPick을 ref로 들고 본다.
  const onPickRef = useRef(onPick);
  useEffect(() => {
    onPickRef.current = onPick;
  }, [onPick]);

  // 지도 생성은 **한 번만**. 좌표 갱신은 아래 효과가 마커·원만 옮긴다(지도를 다시 만들면 확대율이 튄다).
  useEffect(() => {
    let disposed = false;
    loadKakaoMaps(appKey)
      .then((maps) => {
        if (disposed || !boxRef.current) return;
        const center = new maps.LatLng(lat ?? FALLBACK_CENTER.lat, lng ?? FALLBACK_CENTER.lng);
        const map = new maps.Map(boxRef.current, { center, level: 4 });
        const marker = new maps.Marker({ position: center, map });
        const circle = new maps.Circle({
          center,
          radius: radiusM,
          map,
          strokeWeight: 2,
          strokeColor: "#153e75",
          strokeOpacity: 0.8,
          fillColor: "#153e75",
          fillOpacity: 0.12,
        });

        mapsRef.current = maps;
        mapRef.current = map;
        markerRef.current = marker;
        circleRef.current = circle;
        if (maps.services) geocoderRef.current = new maps.services.Geocoder();

        maps.event.addListener(map, "click", (e) => {
          const nextLat = e.latLng.getLat();
          const nextLng = e.latLng.getLng();
          marker.setPosition(e.latLng);
          circle.setPosition(e.latLng);
          const geocoder = geocoderRef.current;
          if (!geocoder) {
            onPickRef.current({ lat: nextLat, lng: nextLng, address: null });
            return;
          }
          // 주소는 **부가 정보**다 — 못 받아도 좌표는 그대로 올린다(주소 실패로 위치 지정이 막히면 안 된다).
          geocoder.coord2Address(nextLng, nextLat, (result, s) => {
            const found =
              s === (maps.services?.Status.OK ?? "OK")
                ? (result[0]?.road_address?.address_name ??
                  result[0]?.address?.address_name ??
                  null)
                : null;
            onPickRef.current({ lat: nextLat, lng: nextLng, address: found });
          });
        });

        setStatus("ready");
      })
      .catch(() => {
        if (!disposed) setStatus("failed");
      });
    return () => {
      disposed = true;
    };
    // 좌표·반경은 아래 효과가 따로 반영한다 — 여기 넣으면 클릭할 때마다 지도가 새로 만들어진다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appKey]);

  // 좌표·반경이 바뀌면(직접 입력 포함) 마커·원을 옮긴다.
  useEffect(() => {
    const maps = mapsRef.current;
    if (!maps || lat === null || lng === null) return;
    const p = new maps.LatLng(lat, lng);
    markerRef.current?.setPosition(p);
    circleRef.current?.setPosition(p);
    mapRef.current?.setCenter(p);
  }, [lat, lng]);

  useEffect(() => {
    circleRef.current?.setRadius(radiusM);
  }, [radiusM]);

  return (
    <div className="flex flex-col gap-1">
      <div
        ref={boxRef}
        className="border-line h-56 w-full overflow-hidden rounded-xl border"
        aria-label="정류장 위치 지도"
      />
      {status === "loading" && (
        <p className="text-text-faint text-[11.5px]">지도를 불러오는 중입니다…</p>
      )}
      {status === "failed" && (
        <p className="text-danger text-[11.5px]">
          지도를 불러오지 못했습니다 — 아래에서 위도·경도를 직접 입력하세요.
        </p>
      )}
      {status === "ready" && (
        <p className="text-text-faint text-[11.5px]">
          지도를 누르면 그 자리가 정류장 위치가 됩니다. 원은 도착 반경입니다.
        </p>
      )}
    </div>
  );
}
