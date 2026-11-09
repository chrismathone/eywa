"use client";

import { useEffect, useRef, useState } from "react";

import type { AcademyLocation } from "../academy-location";
import type { ParentLiveStop } from "../server/parent-live-data";
import { ROLE_LABEL } from "./route-line-diagram";

/**
 * 셔틀 지도(사용자 2026-10-08) — 카카오맵에 **학원 + 정류장**을 찍는다. 학부모 '실시간 차량'(우리 아이 정류장)과
 * 직원 '실시간 위치'(오늘 도는 노선 정류장)가 함께 쓴다.
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
  Marker: new (opts: { position: LatLng; map: KakaoMap; title?: string; draggable?: boolean }) => {
    getPosition(): { getLat(): number; getLng(): number };
    setMap(map: KakaoMap | null): void;
  };
  CustomOverlay: new (opts: { position: LatLng; content: HTMLElement; xAnchor?: number; yAnchor: number; map: KakaoMap; zIndex?: number }) => {
    setMap(map: KakaoMap | null): void;
  };
  Polyline: new (opts: { path: LatLng[]; map: KakaoMap; strokeWeight: number; strokeColor: string; strokeOpacity: number; strokeStyle?: string }) => { setMap(map: KakaoMap | null): void };
  event: { addListener(target: object, type: string, handler: (e?: { latLng?: { getLat(): number; getLng(): number } }) => void): void };
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

/** 지도에 찍을 정류장 — 학부모 화면(우리 아이 정류장)과 직원 '실시간 위치'(오늘 도는 노선 정류장)가 같이 쓴다. */
export type MapStop = Pick<ParentLiveStop, "stopId" | "name" | "lat" | "lng"> & {
  /** 우리 아이가 **타는 곳 / 내리는 곳**(학부모 화면, 사용자 2026-10-15) — 초록 / 주황 배지로 갈라 보인다. */
  role?: "board" | "alight" | "here";
};

/**
 * 경로 선 색(사용자 2026-10-14 "좀 더 세련된 줄 색") — 나가는 길 인디고 · 돌아오는 길 앰버, 둘 다 **흰 테두리**를 깐다.
 * 카카오 지도는 CSS 변수를 못 읽어 값을 직접 넘긴다(범례도 같은 값을 쓴다).
 */
const ROUTE_COLOR = "#3b5bdb";
const BACK_COLOR = "#f08c00";
/** 운행 중 "지금 위치 → 다음 정류장" 선(사용자 2026-10-21) — 운행 중 = 녹색(오늘 등하원 판과 같은 뜻). */
const LIVE_COLOR = "#0e7c46";
/** 학부모 '가까운 노선 찾기' 안내선(검색한 곳 → 후보 정류장, 직선 점선) — 학원색(사용자 2026-10-23). */
const GUIDE_COLOR = "#363c41";
/** 돌아오는 길을 진행 방향 오른쪽으로 비켜 그리는 거리(m) — 같은 도로를 오가도 두 선이 나란히 보이게. */
const BACK_OFFSET_M = 9;
/** 선 단순화 허용 오차(m) — 도로 꼭짓점의 자잘한 꺾임(삐뚤빼뚤)을 펴되 길 모양은 그대로. */
const SIMPLIFY_M = 4;
/** 진행 방향 화살표 간격(m) — 동네 골목이 보이는 확대에서 선을 덮지 않을 만큼. */
const ARROW_EVERY_M = 250;

const toRad = (d: number) => (d * Math.PI) / 180;
/** 두 점 사이 거리(m, 하버사인). */
function meters(a: [number, number], b: [number, number]): number {
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}
/** a → b 방위각(북=0°, 시계 방향). */
function bearing(a: [number, number], b: [number, number]): number {
  const y = Math.sin(toRad(b[1] - a[1])) * Math.cos(toRad(b[0]));
  const x = Math.cos(toRad(a[0])) * Math.sin(toRad(b[0])) - Math.sin(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.cos(toRad(b[1] - a[1]));
  return (Math.atan2(y, x) * 180) / Math.PI;
}
/** 위경도 → 그 근처 평면 좌표(m). 수 km 범위라 정사각형 투영으로 충분하다. */
function project(p: [number, number], lat0: number): [number, number] {
  return [p[1] * 111_320 * Math.cos(toRad(lat0)), p[0] * 110_540];
}
function unproject(x: number, y: number, lat0: number): [number, number] {
  return [y / 110_540, x / (111_320 * Math.cos(toRad(lat0)))];
}
/** 더글러스-포커 단순화 — 허용 오차(m) 안의 꺾임을 지운다(끝점은 남긴다). */
function simplify(path: [number, number][], tol: number): [number, number][] {
  if (path.length < 3) return path;
  const lat0 = path[0]![0];
  const pts = path.map((pt) => project(pt, lat0));
  const keep = new Array<boolean>(path.length).fill(false);
  keep[0] = keep[path.length - 1] = true;
  const stack: [number, number][] = [[0, path.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = pts[a]!;
    const [bx, by] = pts[b]!;
    const len = Math.hypot(bx - ax, by - ay) || 1;
    let far = -1;
    let dmax = 0;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i]!;
      const d = Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len;
      if (d > dmax) {
        dmax = d;
        far = i;
      }
    }
    if (far >= 0 && dmax > tol) {
      keep[far] = true;
      stack.push([a, far], [far, b]);
    }
  }
  return path.filter((_, i) => keep[i]);
}
/** 진행 방향 **오른쪽**으로 `d` m 평행 이동한 선(꼭짓점마다 앞뒤 구간 법선의 평균). */
function offsetRight(path: [number, number][], d: number): [number, number][] {
  if (path.length < 2) return path;
  const lat0 = path[0]![0];
  const pts = path.map((pt) => project(pt, lat0));
  const normal = (i: number, j: number): [number, number] => {
    const dx = pts[j]![0] - pts[i]![0];
    const dy = pts[j]![1] - pts[i]![1];
    const l = Math.hypot(dx, dy) || 1;
    return [dy / l, -dx / l]; // (dx, dy)를 시계 방향으로 90° — 진행 방향 오른쪽
  };
  return pts.map(([x, y], i) => {
    const n1 = normal(Math.max(0, i - 1), Math.max(1, i));
    const n2 = normal(Math.min(i, pts.length - 2), Math.min(i + 1, pts.length - 1));
    const nx = (n1[0] + n2[0]) / 2;
    const ny = (n1[1] + n2[1]) / 2;
    const nl = Math.hypot(nx, ny) || 1;
    return unproject(x + (nx / nl) * d, y + (ny / nl) * d, lat0);
  });
}

/** 경로를 따라 `every` m마다 화살표 자리(위치 + 그 구간의 진행 방향) — 점 개수가 아니라 **거리**로 고르게 둔다. */
function arrowsAlong(path: [number, number][], every: number): { lat: number; lng: number; bearing: number; index: number }[] {
  const out: { lat: number; lng: number; bearing: number; index: number }[] = [];
  let next = every / 2; // 출발점 바로 위는 학원 마커와 겹치니 반 칸 띄운다
  let acc = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    const seg = meters(a, b);
    while (seg > 0 && acc + seg >= next) {
      const t = (next - acc) / seg;
      out.push({ lat: a[0] + (b[0] - a[0]) * t, lng: a[1] + (b[1] - a[1]) * t, bearing: bearing(a, b), index: out.length });
      next += every;
    }
    acc += seg;
  }
  return out;
}

/**
 * 지도 배지 하나 = 동그라미(좌표 자리) + 이름표. 🔑 이름표는 **동그라미 밖에 절대 위치**로 붙인다 — 겹치면 아래 → 오른쪽 →
 * 왼쪽 → 위로 옮기고, 어디에도 자리가 없으면 이름표만 숨긴다(동그라미는 늘 보인다). 사용자 2026-10-15 "글자·UI가 커서 겹친다,
 * 겹치면 옆에 표시하더라도 안 겹치게, 글자도 줄여도 된다".
 * `priority`가 높은 이름표가 먼저 자리를 잡는다(차 > 탈 곳·내릴 곳 > 학원 > 정류장).
 */
type Badge = { el: HTMLElement; dot: HTMLElement; label: HTMLElement; priority: number };

function makeBadge(dotText: string, dotClass: string, labelText: string, labelClass: string, priority: number, dotColor?: string): Badge {
  const el = document.createElement("div");
  el.className = "relative";
  const dot = document.createElement("div");
  dot.textContent = dotText;
  dot.className = dotClass;
  if (dotColor) {
    dot.style.borderColor = dotColor;
    dot.style.color = dotColor;
  }
  const label = document.createElement("div");
  label.textContent = labelText;
  label.className = `absolute max-w-28 truncate rounded-full px-1.5 text-xs leading-4 font-bold whitespace-nowrap shadow ${labelClass}`;
  el.append(dot, label);
  placeLabel(label, "below");
  return { el, dot, label, priority };
}

type Place = "below" | "right" | "left" | "above";
const PLACES: Place[] = ["below", "right", "left", "above"];

function placeLabel(label: HTMLElement, place: Place) {
  const st = label.style;
  st.top = st.bottom = st.left = st.right = "auto";
  st.visibility = "visible";
  if (place === "below") {
    st.top = "calc(100% + 2px)";
    st.left = "50%";
    st.transform = "translateX(-50%)";
  } else if (place === "above") {
    st.bottom = "calc(100% + 2px)";
    st.left = "50%";
    st.transform = "translateX(-50%)";
  } else if (place === "right") {
    st.left = "calc(100% + 3px)";
    st.top = "50%";
    st.transform = "translateY(-50%)";
  } else {
    st.right = "calc(100% + 3px)";
    st.top = "50%";
    st.transform = "translateY(-50%)";
  }
}

const overlaps = (a: DOMRect, b: DOMRect, pad = 2) =>
  a.left < b.right + pad && a.right + pad > b.left && a.top < b.bottom + pad && a.bottom + pad > b.top;

/** 이름표 자리 잡기 — 동그라미들은 먼저 장애물로 깔고, 우선순위 순으로 빈 쪽을 찾는다. */
function spreadLabels(badges: Iterable<Badge>, box: HTMLElement | null) {
  const list = [...badges].filter((b) => b.el.isConnected).sort((a, b) => b.priority - a.priority);
  const taken = list.map((b) => b.dot.getBoundingClientRect());
  const area = box?.getBoundingClientRect();
  for (const b of list) {
    let ok = false;
    for (const place of PLACES) {
      placeLabel(b.label, place);
      const rect = b.label.getBoundingClientRect();
      const inside = !area || (rect.left >= area.left && rect.right <= area.right && rect.top >= area.top && rect.bottom <= area.bottom);
      if (inside && !taken.some((t) => overlaps(rect, t))) {
        taken.push(rect);
        ok = true;
        break;
      }
    }
    if (!ok) b.label.style.visibility = "hidden";
  }
}

/** 학원 배지 — 남색 동그라미 🏫 + 이름표. */
function academyBadge(name: string): Badge {
  return makeBadge(
    "🏫",
    "bg-primary flex size-7 items-center justify-center rounded-full border-2 border-white text-sm shadow-md",
    name,
    "bg-primary text-primary-foreground",
    2,
  );
}

/**
 * 정류장 배지 — "3. 이름"이면 번호 동그라미, 아니면 작은 점. 이름표는 흰 바탕.
 * 🔑 `role`이 있으면(우리 아이 탈 곳 / 내릴 곳) 초록 / 주황으로 채운 동그라미 + "탈 곳 · 이름"(사용자 2026-10-15).
 */
function stopBadge(text: string, role?: "board" | "alight" | "here"): Badge {
  const m = /^(\d+)\.\s*(.*)$/.exec(text);
  const name = m ? m[2]! : text;
  // 📍 학부모가 검색한 곳(가까운 노선 찾기, 2026-10-22) — 학원색 큰 핀, 이름표는 장소 이름만(탈 곳/내릴 곳이 아니다).
  if (role === "here") {
    return makeBadge("●", "bg-primary flex size-8 items-center justify-center rounded-full border-[3px] border-white text-xs text-white shadow-lg", name, "bg-primary text-primary-foreground", 4);
  }
  if (role) {
    const tone = role === "board" ? "bg-green" : "bg-amber";
    return makeBadge(
      m ? m[1]! : "●",
      `num ${tone} flex size-7 items-center justify-center rounded-full border-2 border-white text-xs font-bold text-white shadow-md`,
      `${ROLE_LABEL[role]} · ${name}`,
      `${tone} text-white`,
      3,
    );
  }
  return makeBadge(
    m ? m[1]! : "",
    m
      ? "num flex size-6 items-center justify-center rounded-full border-2 bg-white text-xs font-bold shadow"
      : "size-3 rounded-full border-2 bg-white shadow",
    name,
    "bg-white/95 text-neutral-800",
    1,
    ROUTE_COLOR,
  );
}

/** 지도 위 차 한 대(0383a 기사 폰 GPS) — 🚌 배지 + "2호차 · 방금". `stale`이면 회색 '위치 끊김'. */
export type MapVehicle = { key: string; label: string; lat: number; lng: number; age: string; stale: boolean };

function busBadge(v: MapVehicle): Badge {
  return makeBadge(
    "🚌",
    `${v.stale ? "bg-muted opacity-70" : "bg-primary"} flex size-7 items-center justify-center rounded-full border-2 border-white text-sm shadow-md`,
    v.stale ? `${v.label} · 위치 끊김(${v.age})` : `${v.label} · ${v.age}`,
    v.stale ? "bg-muted text-text-dim" : "bg-primary text-primary-foreground",
    4,
  );
}

export function ParentLiveMap({
  appKey,
  academy,
  stops,
  paths,
  livePaths,
  guideLines,
  vehicles,
  editStops = false,
  onStopMove,
  onStopClick,
  onMapClick,
}: {
  appKey: string;
  academy: AcademyLocation;
  stops: MapStop[];
  /**
   * 도로를 따라가는 이동 경로들([위도, 경도] 선) — 직원 '실시간 위치'에서 호차·회차를 고르면(카카오 길찾기, route-path.ts).
   * `kind`: 'out' 나가는 길(남색 실선) · 'back' 돌아오는 길(주황 점선) — 같은 도로를 오가도 갈라 보이게(사용자 2026-10-14).
   */
  paths?: { path: [number, number][]; kind: "out" | "back" }[];
  /**
   * 운행 중 **지금 위치 → 다음 정류장** 선들(live-leg.ts) — 차가 움직일 때마다 바뀌므로 지도를 새로 만들지 않고 선만 바꿔 끼운다.
   * 운행 중인 회차는 부르는 쪽이 `paths`에서 빼고 이걸 넘긴다(전체 노선 줄 대신 다음 정류장까지만).
   */
  livePaths?: [number, number][][];
  /**
   * 안내 **직선**(점선) — 학부모 '가까운 노선 찾기'에서 검색한 곳 → 후보 정류장(사용자 2026-10-23 "직선 코스도 보여줄 수 있어?").
   * 도로가 아니라 눈대중용 직선이다. 지도를 새로 만들지 않고 선만 바꿔 끼운다.
   */
  guideLines?: [number, number][][];
  /** 운행 중 차 위치(기사 폰 GPS, 0383a) — 몇 초마다 바뀌므로 지도를 새로 만들지 않고 🚌만 옮긴다. */
  vehicles?: MapVehicle[];
  /**
   * **위치 수정 모드**(사용자 2026-10-21 "지정된 마커들을 수정 · 이름은 그대로 · 위치만") — 정류장마다 끌 수 있는 핀을 세운다.
   * 놓으면 `onStopMove(stopId, lat, lng)` — 저장은 부르는 쪽(기존 saveStopLocation). 이름은 이 지도가 건드리지 않는다.
   */
  editStops?: boolean;
  onStopMove?: (stopId: string, lat: number, lng: number) => void;
  /** 정류장 배지를 누르면(수정 모드가 아닐 때) — 부르는 쪽이 그 정류장에서 나가는 구간만 그린다(사용자 2026-10-21). */
  onStopClick?: (stopId: string) => void;
  /** 지도 빈 곳을 누르면(수정 모드) — **위치 없는 정류장 찍기**에 쓴다(사용자 2026-10-22). */
  onMapClick?: (lat: number, lng: number) => void;
}) {
  // 콜백은 ref로 — 지도를 새로 만드는 effect의 의존성에 넣으면 부모가 다시 그릴 때마다 지도가 새로 생긴다.
  const onStopMoveRef = useRef(onStopMove);
  const onStopClickRef = useRef(onStopClick);
  const onMapClickRef = useRef(onMapClick);
  useEffect(() => {
    onStopMoveRef.current = onStopMove;
    onStopClickRef.current = onStopClick;
    onMapClickRef.current = onMapClick;
  });
  const boxRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<{ maps: KakaoMaps; map: KakaoMap } | null>(null);
  /** 지도를 새로 만들 때마다 +1 — 차 마커를 새 지도에 다시 얹는 신호. */
  const [mapVersion, setMapVersion] = useState(0);
  /** 지금 지도에 올라간 배지들 — 확대·축소가 끝날 때마다 이름표 자리를 다시 잡는다. */
  const badgesRef = useRef(new Set<Badge>());
  const vehiclesKey = JSON.stringify(vehicles ?? []);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  /**
   * 🔴 정류장 **내용**이 바뀔 때만 다시 그린다 — 학부모 화면은 알림 때문에 15초마다 다시 읽어(router.refresh)
   *    `stops`가 매번 새 배열로 온다. 배열 그대로 의존하면 15초마다 지도를 새로 만들어 화면이 깜빡이고 확대가 풀린다.
   */
  const stopsKey = JSON.stringify(stops);
  const pathKey = JSON.stringify(paths ?? []);

  useEffect(() => {
    let cancelled = false;
    loadKakaoMaps(appKey)
      .then((maps) => {
        if (cancelled || !boxRef.current) return;
        const placedStops = JSON.parse(stopsKey) as MapStop[];
        boxRef.current.innerHTML = ""; // 다시 그릴 때 옛 지도를 남기지 않는다
        // 🔑 기준점 = 학원(셔틀이 출발하고 돌아오는 곳). 정류장 좌표가 없어도 학원은 늘 보인다.
        const academyPos = new maps.LatLng(academy.lat, academy.lng);
        const map = new maps.Map(boxRef.current, { center: academyPos, level: ACADEMY_LEVEL });
        mapRef.current = { maps, map };
        const badges = badgesRef.current;
        badges.clear();
        const relayout = () => spreadLabels(badgesRef.current, boxRef.current);
        // 확대·축소·이동이 끝나면(idle) 이름표 자리를 다시 잡는다 — 확대하면 겹침이 풀려 숨겼던 이름표가 다시 나온다.
        maps.event.addListener(map, "idle", relayout);
        // 📍 수정 모드에서 지도를 누르면 그 좌표를 넘긴다 — 위치 없는 정류장을 여기에 찍는다(부르는 쪽이 고른 정류장이 있을 때만 저장).
        if (editStops) {
          maps.event.addListener(map, "click", (e) => {
            if (e?.latLng) onMapClickRef.current?.(e.latLng.getLat(), e.latLng.getLng());
          });
        }
        // 🏫 학원 배지 — 기본 핀 대신 둥근 배지(사용자 2026-10-14 "마커도 좀 더 예쁜 걸로").
        const placed = placedStops.filter((s) => s.lat !== null && s.lng !== null);
        // 학원이 곧 탈 곳/내릴 곳이면(하원 출발 · 등원 도착) 그 배지가 학원 자리를 맡는다 — 배지 두 개가 겹치지 않게.
        const academyIsRole = placed.some((s) => s.role && meters([s.lat!, s.lng!], [academy.lat, academy.lng]) < 5);
        if (!academyIsRole) {
          const b = academyBadge(academy.name);
          badges.add(b);
          new maps.CustomOverlay({ position: academyPos, content: b.el, xAnchor: 0.5, yAnchor: 0.5, map, zIndex: 6 });
        }
        // 이동 경로 — 마커보다 먼저 그려 선이 마커 아래로 깔리게 한다. 🔑 선 위에 **진행 방향 화살표**를 일정 간격으로
        //    얹는다(사용자 2026-10-14 "어떻게 차가 이동할지") — 선만으로는 어느 쪽으로 도는지 안 보인다.
        const lines = JSON.parse(pathKey) as { path: [number, number][]; kind: "out" | "back" }[];
        const linePoints: LatLng[] = [];
        // 돌아오는 길을 먼저(아래) — 나가는 길이 위로 온다. 돌아오는 길은 오른쪽으로 비켜 그려 겹치지 않는다(사용자 2026-10-14).
        for (const leg of [...lines].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "back" ? -1 : 1))) {
          if (leg.path.length < 2) continue;
          const back = leg.kind === "back";
          // 🔑 삐뚤빼뚤 정리 — 도로 꼭짓점의 자잘한 꺾임을 편다(사용자 2026-10-14).
          const smooth = simplify(leg.path, SIMPLIFY_M);
          const raw = back ? offsetRight(smooth, BACK_OFFSET_M) : smooth;
          const line = raw.map(([lat, lng]) => new maps.LatLng(lat, lng));
          linePoints.push(...line);
          // 흰 테두리(아래) + 색 선(위) — 지도 바탕 위에서 선이 또렷하고 매끈해 보인다.
          new maps.Polyline({ path: line, map, strokeWeight: 9, strokeColor: "#ffffff", strokeOpacity: 0.95, strokeStyle: "solid" });
          new maps.Polyline({ path: line, map, strokeWeight: 5, strokeColor: back ? BACK_COLOR : ROUTE_COLOR, strokeOpacity: 1, strokeStyle: "solid" });
          for (const a of arrowsAlong(raw, ARROW_EVERY_M)) {
            const el = document.createElement("div");
            el.textContent = "➤";
            el.setAttribute("aria-hidden", "true");
            el.className = "route-arrow text-xs leading-none text-white";
            // ➤는 오른쪽(동쪽)을 가리킨다 — 방위각(북=0°, 시계 방향)에서 90°를 빼 돌린다.
            el.style.transform = `rotate(${a.bearing - 90}deg) scale(0.8)`;
            // 🔑 차례로 밝아지게 — 화살표마다 조금씩 늦게 시작해 **진행 방향으로 빛이 흐르는** 것처럼 보인다.
            el.style.animationDelay = `${(a.index * 0.12) % 3}s`;
            new maps.CustomOverlay({ position: new maps.LatLng(a.lat, a.lng), content: el, xAnchor: 0.5, yAnchor: 0.5, map, zIndex: 3 });
          }
        }
        if (placed.length > 0 || linePoints.length > 1) {
          // 학원 · 정류장 · 경로가 한 화면에 다 들어오게 맞춘다.
          const bounds = new maps.LatLngBounds();
          bounds.extend(academyPos);
          for (const pt of linePoints) bounds.extend(pt);
          for (const s of placed) {
            const pos = new maps.LatLng(s.lat!, s.lng!);
            // 정류장 배지 — "2. 칠성초 정문"처럼 순서가 붙어 오면 번호 동그라미, 아니면 작은 점 + 이름.
            bounds.extend(pos);
            if (editStops) {
              // ✏️ 수정 모드 — 끌 수 있는 핀(이름은 핀 제목). 놓으면 부르는 쪽이 저장한다.
              const marker = new maps.Marker({ position: pos, map, title: s.name, draggable: true });
              maps.event.addListener(marker, "dragend", () => {
                const p = marker.getPosition();
                onStopMoveRef.current?.(s.stopId, p.getLat(), p.getLng());
              });
              continue;
            }
            const b = stopBadge(s.name, s.role);
            badges.add(b);
            if (onStopClickRef.current) {
              b.el.style.cursor = "pointer";
              b.el.addEventListener("click", () => onStopClickRef.current?.(s.stopId));
            }
            new maps.CustomOverlay({ position: pos, content: b.el, xAnchor: 0.5, yAnchor: 0.5, map, zIndex: s.role ? 7 : 5 });
          }
          map.setBounds(bounds);
        }
        setStatus("ready");
        setMapVersion((v) => v + 1);
        window.setTimeout(relayout, 300);
      })
      .catch(() => {
        if (!cancelled) setStatus("failed");
      });
    return () => {
      cancelled = true;
    };
  }, [appKey, academy.lat, academy.lng, academy.name, stopsKey, pathKey, editStops]);

  // 🟢 지금 위치 → 다음 정류장 선 — 차 마커처럼 지도는 그대로 두고 선만 바꿔 끼운다.
  const livePathKey = JSON.stringify(livePaths ?? []);
  useEffect(() => {
    const ctx = mapRef.current;
    if (!ctx || mapVersion === 0) return;
    const lines = JSON.parse(livePathKey) as [number, number][][];
    const made: { setMap: (m: null) => void }[] = [];
    for (const raw of lines) {
      if (raw.length < 2) continue;
      const line = raw.map(([lat, lng]) => new ctx.maps.LatLng(lat, lng));
      made.push(new ctx.maps.Polyline({ path: line, map: ctx.map, strokeWeight: 10, strokeColor: "#ffffff", strokeOpacity: 0.95, strokeStyle: "solid" }) as { setMap: (m: null) => void });
      made.push(new ctx.maps.Polyline({ path: line, map: ctx.map, strokeWeight: 6, strokeColor: LIVE_COLOR, strokeOpacity: 1, strokeStyle: "solid" }) as { setMap: (m: null) => void });
    }
    return () => {
      for (const p of made) p.setMap(null);
    };
  }, [livePathKey, mapVersion]);

  // ┄ 안내 직선 — 지도는 그대로 두고 선만 바꿔 끼운다(검색한 곳이 바뀌면 다시 그린다).
  const guideKey = JSON.stringify(guideLines ?? []);
  useEffect(() => {
    const ctx = mapRef.current;
    if (!ctx || mapVersion === 0) return;
    const lines = JSON.parse(guideKey) as [number, number][][];
    // 🔑 **첫 줄 = 가장 가까운 정류장**(부르는 쪽이 거리순으로 넘긴다) — 굵은 실선으로 "여기가 제일 가깝다"를 보인다
    //    (사용자 2026-10-23 "사람이 이동하는 거라 최단거리로 갈 수 있는 위치로 직선"). 나머지는 옅은 점선.
    const made = lines
      .filter((l) => l.length >= 2)
      .map((raw, i) =>
        new ctx.maps.Polyline({
          path: raw.map(([lat, lng]) => new ctx.maps.LatLng(lat, lng)),
          map: ctx.map,
          strokeWeight: i === 0 ? 5 : 3,
          strokeColor: GUIDE_COLOR,
          strokeOpacity: i === 0 ? 0.95 : 0.55,
          strokeStyle: i === 0 ? "solid" : "shortdash",
        }),
      );
    return () => {
      for (const p of made) p.setMap(null);
    };
  }, [guideKey, mapVersion]);

  // 🚌 차 마커 — 지도는 그대로 두고 마커만 바꿔 끼운다(10초마다 지도를 새로 만들면 깜빡이고 확대가 풀린다).
  useEffect(() => {
    const ctx = mapRef.current;
    if (!ctx || mapVersion === 0) return;
    const list = JSON.parse(vehiclesKey) as MapVehicle[];
    const badges = badgesRef.current;
    const made = list.map((v) => {
      const b = busBadge(v);
      badges.add(b);
      const o = new ctx.maps.CustomOverlay({ position: new ctx.maps.LatLng(v.lat, v.lng), content: b.el, xAnchor: 0.5, yAnchor: 0.5, map: ctx.map, zIndex: 9 });
      return { b, o };
    });
    // 차 배지가 붙은 뒤 이름표 자리를 다시 잡는다(오버레이는 다음 그리기에 붙는다).
    const t = window.setTimeout(() => spreadLabels(badges, boxRef.current), 120);
    return () => {
      window.clearTimeout(t);
      for (const { b, o } of made) {
        badges.delete(b);
        o.setMap(null);
      }
    };
  }, [vehiclesKey, mapVersion]);

  const hasBack = (paths ?? []).some((p) => p.kind === "back");
  const roles = new Set(stops.flatMap((s) => (s.role && s.lat !== null ? [s.role] : [])));
  return (
    <div className="relative">
      {/* 지도 위 진행 방향 화살표 반짝임 — 이 부품 안에서만 쓰는 keyframes. '동작 줄이기'면 멈춘다. */}
      <style>{`@keyframes route-arrow-glow { 0%, 70%, 100% { opacity: .45 } 85% { opacity: 1; text-shadow: 0 0 6px #fff } }
.route-arrow { animation: route-arrow-glow 3s linear infinite }
@media (prefers-reduced-motion: reduce) { .route-arrow { animation: none; opacity: 1 } }`}</style>
      {/* 자리는 실제 높이로 먼저 잡는다 — 지도가 늦게 떠도 아래 내용이 밀리지 않게. */}
      <div ref={boxRef} className="border-line h-[55dvh] min-h-72 w-full overflow-hidden rounded-2xl border" />
      {/* 범례 — 한 줄로 작게(사용자 2026-10-15 "너무 커서 방해가 된다"). 지도를 가리지 않게 왼쪽 아래 구석에 반투명으로. */}
      {((paths ?? []).length > 0 || roles.size > 0) && status === "ready" ? (
        <div className="bg-card/80 text-text-dim pointer-events-none absolute bottom-1.5 left-1.5 z-10 flex items-center gap-2 rounded-md px-1.5 py-0.5 text-xs leading-none font-bold">
          {roles.has("board") ? (
            <span className="flex items-center gap-0.5">
              <span aria-hidden className="bg-green inline-block size-2 rounded-full" />
              {ROLE_LABEL.board}
            </span>
          ) : null}
          {roles.has("alight") ? (
            <span className="flex items-center gap-0.5">
              <span aria-hidden className="bg-amber inline-block size-2 rounded-full" />
              {ROLE_LABEL.alight}
            </span>
          ) : null}
          {(paths ?? []).length > 0 ? (
            <span className="flex items-center gap-0.5">
              <span aria-hidden className="inline-block h-1 w-3 rounded-full" style={{ backgroundColor: ROUTE_COLOR }} />
              가는 길
            </span>
          ) : null}
          {hasBack ? (
            <span className="flex items-center gap-0.5">
              <span aria-hidden className="inline-block h-1 w-3 rounded-full" style={{ backgroundColor: BACK_COLOR }} />
              오는 길
            </span>
          ) : null}
        </div>
      ) : null}
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
