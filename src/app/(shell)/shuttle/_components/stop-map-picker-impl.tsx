"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { StopMapSearch, type StopSearchHit } from "./stop-map-search";

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

/** 검색 결과 표시 상한 — 한 화면에 들어오고 고르기 지치지 않는 수. */
const MAX_HITS = 7;

/**
 * 카카오 결과 한 줄 → 화면이 쓰는 모양. 좌표는 **문자열로 오므로** 숫자로 바꾸고,
 * 못 읽거나 이름이 통째로 빈 줄은 `null`로 버린다(누르면 아무 데도 안 가는 줄을 만들지 않는다).
 */
function toHit(
  id: string,
  name: string,
  address: string,
  y: string | undefined,
  x: string | undefined,
): StopSearchHit | null {
  const lat = Number(y);
  const lng = Number(x);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const title = name || address;
  if (!title) return null;
  return { id: id || title, name: title, address: address === title ? "" : address, lat, lng };
}

type LatLng = { getLat(): number; getLng(): number };
type KakaoMap = { setCenter(p: LatLng): void };
type KakaoMarker = { setPosition(p: LatLng): void; getPosition(): LatLng };
type KakaoCircle = { setPosition(p: LatLng): void; setRadius(r: number): void };
/** 카카오가 돌려주는 주소 한 덩이 — 도로명/지번 어느 쪽도 없을 수 있다(그래서 전부 optional). */
type KakaoAddressPart = { address_name?: string };

type Geocoder = {
  coord2Address(
    lng: number,
    lat: number,
    cb: (result: { road_address?: KakaoAddressPart; address?: KakaoAddressPart }[], status: string) => void,
  ): void;
  /** 주소 → 좌표. 정류장 이름이 상호명이 아니라 주소일 때의 두 번째 길. */
  addressSearch(
    query: string,
    cb: (
      result: {
        address_name?: string;
        x?: string;
        y?: string;
        road_address?: KakaoAddressPart | null;
        address?: KakaoAddressPart | null;
      }[],
      status: string,
    ) => void,
  ): void;
};

/** 장소(상호명) 검색 — `libraries=services`에 함께 들어 있다(추가 로드 없음). */
type Places = {
  keywordSearch(
    query: string,
    cb: (
      result: {
        id?: string;
        place_name?: string;
        address_name?: string;
        road_address_name?: string;
        x?: string;
        y?: string;
      }[],
      status: string,
    ) => void,
  ): void;
};

type KakaoMaps = {
  load(cb: () => void): void;
  LatLng: new (lat: number, lng: number) => LatLng;
  Map: new (el: HTMLElement, opts: { center: LatLng; level: number }) => KakaoMap;
  Marker: new (opts: { position: LatLng; map: KakaoMap; draggable?: boolean }) => KakaoMarker;
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
    /** 마커 이벤트(`dragend`)는 좌표를 **인자로 주지 않는다** — 핸들러가 마커에서 직접 읽는다. */
    addListener(target: KakaoMarker, type: "dragend", handler: () => void): void;
  };
  services?: {
    Geocoder: new () => Geocoder;
    Places: new () => Places;
    Status: { OK: string; ZERO_RESULT: string };
  };
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
    // autoload=false → 로드 뒤 maps.load(cb)로 초기화(카카오 권장).
    // services 하나에 셋이 다 들어 있다: 역지오코딩(주소 자동 채움) · 장소 검색 · 주소 검색.
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
  /**
   * `services` 라이브러리가 실제로 붙었나 — false면 **검색칸을 아예 안 그린다**.
   * (SDK는 떴는데 services만 빠지는 경우가 있어 지도 준비 여부와 따로 본다. 없는 기능을 약속하지 않는다.)
   */
  const [searchable, setSearchable] = useState(false);

  const mapsRef = useRef<KakaoMaps | null>(null);
  const mapRef = useRef<KakaoMap | null>(null);
  const markerRef = useRef<KakaoMarker | null>(null);
  const circleRef = useRef<KakaoCircle | null>(null);
  const geocoderRef = useRef<Geocoder | null>(null);
  const placesRef = useRef<Places | null>(null);

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
        // 📍 **핀을 끌어서 옮길 수 있다**(원장 2026-09-04 *"핀을 옮겨서 거기 위치로 찍을수있자나"*).
        // 지도를 눌러 찍는 것과 **같은 일**이라 처리도 같은 함수(`pick`)를 탄다 — 두 경로가 갈리면
        // 한쪽만 주소가 채워지는 식으로 어긋난다.
        const marker = new maps.Marker({ position: center, map, draggable: true });
        const circle = new maps.Circle({
          center,
          radius: radiusM,
          map,
          strokeWeight: 2,
          strokeColor: "#363c41",
          strokeOpacity: 0.8,
          fillColor: "#363c41",
          fillOpacity: 0.12,
        });

        mapsRef.current = maps;
        mapRef.current = map;
        markerRef.current = marker;
        circleRef.current = circle;
        if (maps.services) {
          geocoderRef.current = new maps.services.Geocoder();
          placesRef.current = new maps.services.Places();
          setSearchable(true);
        }

        /** 좌표 하나를 고르는 **단일 경로** — 지도 클릭도, 핀 끌기도 여기로 모인다. */
        const pick = (at: LatLng) => {
          const nextLat = at.getLat();
          const nextLng = at.getLng();
          marker.setPosition(at);
          circle.setPosition(at);
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
        };

        maps.event.addListener(map, "click", (e) => pick(e.latLng));
        // ⚠️ `dragend`는 좌표를 안 넘겨준다 — 놓인 자리는 **마커에서 읽는다**.
        maps.event.addListener(marker, "dragend", () => pick(marker.getPosition()));

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

  /**
   * 검색 — **키워드(상호명) 먼저, 0건일 때만 주소**로 넘어간다.
   * 정류장 이름 대부분이 `유진식당 앞`·`힐스테이트 … 동상 앞` 같은 상호·장소명이라 그쪽이 먼저 맞는다.
   * ⚠️ 어느 쪽으로 찾았는지는 화면에 말하지 않는다(사용자에겐 그냥 "검색"이다).
   */
  const runSearch = useCallback(async (query: string): Promise<StopSearchHit[]> => {
    const maps = mapsRef.current;
    if (!maps) throw new Error("map-not-ready");
    const ok = maps.services?.Status.OK ?? "OK";
    const zero = maps.services?.Status.ZERO_RESULT ?? "ZERO_RESULT";

    const places = placesRef.current;
    if (places) {
      const hits = await new Promise<StopSearchHit[]>((resolve, reject) => {
        places.keywordSearch(query, (result, s) => {
          if (s === zero) return resolve([]);
          if (s !== ok) return reject(new Error("keyword-search-failed"));
          resolve(
            result
              .map((r) =>
                toHit(r.id ?? r.place_name ?? "", r.place_name ?? "", r.road_address_name || r.address_name || "", r.y, r.x),
              )
              .filter((h): h is StopSearchHit => h !== null),
          );
        });
      });
      if (hits.length > 0) return hits.slice(0, MAX_HITS);
    }

    const geocoder = geocoderRef.current;
    if (!geocoder) return [];
    return new Promise<StopSearchHit[]>((resolve, reject) => {
      geocoder.addressSearch(query, (result, s) => {
        if (s === zero) return resolve([]);
        if (s !== ok) return reject(new Error("address-search-failed"));
        resolve(
          result
            .map((r, i) => {
              const road = r.road_address?.address_name ?? "";
              const jibun = r.address?.address_name ?? r.address_name ?? "";
              // 도로명이 있으면 그걸 제목으로, 지번은 보조로(같으면 보조를 비운다).
              const name = road || jibun;
              return toHit(`addr:${i}`, name, road && jibun !== road ? jibun : "", r.y, r.x);
            })
            .filter((h): h is StopSearchHit => h !== null)
            .slice(0, MAX_HITS),
        );
      });
    });
  }, []);

  /**
   * 결과를 고르면 **지도 클릭과 같은 경로**(`onPick`)로 올린다 — 좌표·주소가 부모 상태에 들어가고,
   * 그 상태가 위 효과를 통해 마커·원·지도 중심을 옮긴다. 여기서 지도를 직접 만지지 않는다.
   */
  const handleSelect = useCallback((hit: StopSearchHit) => {
    onPickRef.current({ lat: hit.lat, lng: hit.lng, address: hit.address || hit.name || null });
  }, []);

  return (
    <div className="flex flex-col gap-1">
      {/* 검색은 지도 **위**에 둔다 — 이름을 아는 정류장은 지도를 안 봐도 끝나야 한다.
          🔴 `services`가 없으면 안 그린다(위 `searchable` 주석). */}
      {status === "ready" && searchable && (
        <StopMapSearch onSearch={runSearch} onSelect={handleSelect} />
      )}
      <div
        ref={boxRef}
        className="border-line h-56 w-full overflow-hidden rounded-xl border"
        aria-label="정류장 위치 지도"
      />
      {status === "loading" && (
        <p className="text-text-faint text-xs">지도를 불러오는 중입니다…</p>
      )}
      {status === "failed" && (
        <p className="text-danger text-xs">
          지도를 불러오지 못했습니다 — 아래에서 위도·경도를 직접 입력하세요.
        </p>
      )}
      {/* 문구는 셔틀 세션의 새 흐름(핀 끌기), 글자 크기는 v5 규약(`text-[Npx]` 금지)을 따른다. */}
      {status === "ready" && (
        <p className="text-text-faint text-xs">
          {searchable ? "위에서 이름으로 찾거나, " : ""}지도를 누르거나 <b>핀을 끌어</b> 자리를
          잡으세요. 원은 도착 반경입니다.
        </p>
      )}
    </div>
  );
}
