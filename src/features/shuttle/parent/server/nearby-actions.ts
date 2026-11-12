"use server";

import { reportError } from "@/lib/observability/report-error";
import { PARENT_PORTAL_UNAVAILABLE_MESSAGE, parentPortalAvailable } from "./parent-availability";
import { getParentViewer } from "./parent-viewer";
import { isShuttleAdmin } from "../../server/access";
import { findWalkRoute, type WalkRoute } from "./walk-route";

/**
 * 🔒 쓸 수 있는 사람 = 학부모(탭 4) **또는** 셔틀 관리자(원장·관리자·총괄 — 셔틀 '가까운 노선 찾기' 면, 2026-10-26).
 * 정류장 이름·좌표만 다루고 학생 정보는 없다. 화면 게이트와 같은 판정(#77).
 */
async function nearbyDenial(): Promise<string | null> {
  const viewer = await getParentViewer();
  if (viewer) return (await parentPortalAvailable(viewer)) ? null : PARENT_PORTAL_UNAVAILABLE_MESSAGE;
  // 직원 쪽은 종전 문구 그대로(같은 '가까운 노선 찾기' 화면을 쓰는 직원에게 학부모용 안내를 보이지 않는다 — 검토 2026-11-12).
  return (await isShuttleAdmin()) ? null : "로그인이 필요합니다";
}

export type PlaceHit = { name: string; address: string; lat: number; lng: number };

/**
 * 학부모 '가까운 노선 찾기'의 **장소 검색**(사용자 2026-10-22) — 카카오 로컬 키워드 검색(REST, 서버 전용 키).
 *
 * 🔒 학부모 로그인만(`getParentViewer`). 🔑 검색어·결과는 **저장하지 않는다**(집 주소일 수 있다 — 화면에서 쓰고 버린다).
 * 🔑 학원 근처를 먼저 — 학원 좌표 기준 반경 20km 안에서 정확도순.
 * ⚠️ 키가 없거나 실패하면 한글 사유만 돌려준다(원문 노출 금지).
 */
export async function searchNearbyPlace(
  query: string,
  near: { lat: number; lng: number },
): Promise<{ hits: PlaceHit[] } | { error: string }> {
  const denied = await nearbyDenial();
  if (denied) return { error: denied };
  const q = query.trim().slice(0, 60);
  if (!q) return { hits: [] };
  const key = process.env.KAKAO_REST_API_KEY;
  if (!key) return { error: "장소 검색이 아직 준비되지 않았어요" };
  try {
    const url = new URL("https://dapi.kakao.com/v2/local/search/keyword.json");
    url.searchParams.set("query", q);
    url.searchParams.set("size", "8");
    url.searchParams.set("x", String(near.lng));
    url.searchParams.set("y", String(near.lat));
    url.searchParams.set("radius", "20000");
    const res = await fetch(url, { headers: { Authorization: `KakaoAK ${key}` }, cache: "no-store" });
    if (!res.ok) throw new Error(`kakao local ${res.status}`);
    const json = (await res.json()) as { documents?: { place_name: string; road_address_name?: string; address_name?: string; x: string; y: string }[] };
    const hits = (json.documents ?? []).map((d) => ({
      name: d.place_name,
      address: d.road_address_name || d.address_name || "",
      lat: Number(d.y),
      lng: Number(d.x),
    }));
    return { hits: hits.filter((h) => Number.isFinite(h.lat) && Number.isFinite(h.lng)) };
  } catch (e) {
    reportError(e, { scope: "shuttle.parentNearbySearch" });
    return { error: "장소를 찾지 못했어요 — 잠시 후 다시 검색해 주세요" };
  }
}

/** 한 번에 도보로 잴 수 있는 곳 — 화면의 후보 상한(CANDIDATE_MAX)과 같다. 넘치면 잘라서 T맵 호출 폭주를 막는다. */
const MAX_TARGETS = 8;

/**
 * 학부모 '가까운 노선 찾기' — 검색한 곳에서 **후보 정류장마다 실제로 걸어가는 길**을 잰다(사용자 2026-10-26 "도보로 움직이는 기준").
 * 길찾기는 findWalkRoute(T맵 보행자 우선 → 실패 시 카카오 도로 · 24시간 캐시) — 곳마다 병렬. 못 잰 곳은 결과에서 빠진다.
 * 🔒 학부모 로그인만. 좌표는 저장하지 않는다.
 */
export async function walkRoutesFrom(
  from: { lat: number; lng: number },
  targets: { id: string; lat: number; lng: number }[],
): Promise<{ routes: Record<string, WalkRoute> } | { error: string }> {
  const denied = await nearbyDenial();
  if (denied) return { error: denied };
  if (!process.env.TMAP_APP_KEY && !process.env.KAKAO_REST_API_KEY) return { error: "길찾기가 아직 준비되지 않았어요" };
  const ok = (p: { lat: number; lng: number }) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
  if (!ok(from)) return { error: "위치를 확인하지 못했어요" };
  const list = targets.filter(ok).slice(0, MAX_TARGETS);
  const settled = await Promise.allSettled(list.map((t) => findWalkRoute(from, t)));
  const routes: Record<string, WalkRoute> = {};
  settled.forEach((r, i) => {
    if (r.status === "fulfilled" && r.value) routes[list[i]!.id] = r.value;
    else if (r.status === "rejected") reportError(r.reason, { scope: "shuttle.parentNearbyWalk" });
  });
  if (list.length && !Object.keys(routes).length) return { error: "걸어가는 길을 불러오지 못했어요 — 잠시 후 다시 검색해 주세요" };
  return { routes };
}

/**
 * 관리자 '가까운 노선 찾기'에서 **학생(주소)·학교를 눌렀을 때** 그 자리를 찾는다(사용자 2026-10-26).
 * 주소는 카카오 주소 검색 → 안 되면 키워드 검색(학교 이름 등)으로. 🔒 **셔틀 관리자만**(학생 주소를 다룬다 — 학부모 경로는 막는다).
 * 좌표·주소는 저장하지 않는다.
 */
export async function locateForStaff(query: string, near?: { lat: number; lng: number }): Promise<{ lat: number; lng: number } | { error: string }> {
  if (!(await isShuttleAdmin())) return { error: "관리자만 쓸 수 있어요" };
  const q = query.trim().slice(0, 120);
  if (!q) return { error: "찾을 주소가 없어요" };
  const key = process.env.KAKAO_REST_API_KEY;
  if (!key) return { error: "위치 찾기가 아직 준비되지 않았어요" };
  const headers = { Authorization: `KakaoAK ${key}` };
  try {
    const addr = new URL("https://dapi.kakao.com/v2/local/search/address.json");
    addr.searchParams.set("query", q);
    addr.searchParams.set("size", "1");
    const a = await fetch(addr, { headers, cache: "no-store" });
    if (a.ok) {
      const d = ((await a.json()) as { documents?: { x: string; y: string }[] }).documents?.[0];
      if (d) return { lat: Number(d.y), lng: Number(d.x) };
    }
    const kw = new URL("https://dapi.kakao.com/v2/local/search/keyword.json");
    kw.searchParams.set("query", q);
    kw.searchParams.set("size", "1");
    // 학교 이름처럼 전국에 같은 이름이 있는 건 학원 근처(20km)부터.
    if (near) {
      kw.searchParams.set("x", String(near.lng));
      kw.searchParams.set("y", String(near.lat));
      kw.searchParams.set("radius", "20000");
    }
    const k = await fetch(kw, { headers, cache: "no-store" });
    if (!k.ok) throw new Error(`kakao local ${k.status}`);
    const d = ((await k.json()) as { documents?: { x: string; y: string }[] }).documents?.[0];
    return d ? { lat: Number(d.y), lng: Number(d.x) } : { error: "이 주소의 위치를 찾지 못했어요" };
  } catch (e) {
    reportError(e, { scope: "shuttle.staffNearbyLocate" });
    return { error: "위치를 찾지 못했어요 — 잠시 후 다시 눌러 주세요" };
  }
}
