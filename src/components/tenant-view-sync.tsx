"use client";

import { useEffect } from "react";
import {
  expectedTenantFromMark,
  parseTenantViewMark,
  TENANT_VIEW_CLIENT_EXTRA_CUTOFF_MS,
  TENANT_VIEW_MARK_COOKIE,
  tenantViewResyncHref,
} from "@/lib/auth/tenant-view-shared";

/**
 * 운영 콘솔의 '지점 보기'(읽기 전용) — **이 탭에 그려진 화면**과 **이 브라우저의 실제 상태**가 어긋났는지 지켜본다.
 *
 * 왜 필요한가: 보기는 탭이 아니라 브라우저(쿠키) 단위다. 다른 탭에서 보기를 끝내거나 새로 열면, 또는 시간이 다 되면,
 * 이 탭의 셸(위쪽 띠 · 왼쪽 메뉴)은 옛 상태로 남는데 서버는 이미 새 상태로 답한다. 그러면
 *   · '읽기 전용 보기' 띠가 떠 있는데 실제로는 **본인 지점에 저장이 되는** 화면, 또는
 *   · 본인 지점 화면인 줄 아는데 실제로는 다른 지점을 읽고 있는 화면
 * 이 생긴다. 서버는 탭을 구분할 수 없으므로 탭이 스스로 알아채야 한다.
 *
 * 어떻게: 서버가 보기를 열고 닫을 때 함께 쓰는 **표식 쿠키**(비밀 아님)를 읽어, "이 사람이 지금 보고 있어야 할 지점"과
 * 이 탭이 그려진 지점을 견준다. **누르거나 치는 순간**(capture 단계)마다 견주므로, 어긋난 화면에서는 어떤 동작도
 * 서버에 닿기 전에 멈춘다. 5초마다 · 탭이 다시 보일 때도 견준다.
 * 어긋나면 화면 전체를 다시 맞춘다 — 보기가 끝난 것이면 '보기 끝내기' 주소로(운영 콘솔로 돌아간다), 그 밖에는 맞춤 주소로.
 *
 * 🔴 **어긋나 있는 동안에는 동작을 하나도 흘려보내지 않는다** — 이동이 막혀 있어도(미저장 경고에서 '머무르기'를 눌렀다 ·
 *    되풀이 방지에 걸렸다) 먹는다. 흘려보내면 '읽기 전용 보기' 띠가 달린 화면의 저장이 본인 지점에 들어갈 수 있다.
 *    대신 사람이 다시 누르면 이동을 다시 시도한다(죽은 화면으로 남지 않는다).
 * 🔴 쿠키는 남아 있는데 서버 쪽에서만 보기가 끝난 경우(표식으로는 알 수 없다)는 서버가 맡는다 — 그 요청의 쓰기를 막고,
 *    화면 요청이면 '보기 끝내기'로 보낸다(tenant-view.ts `ended`).
 *
 * 보는 중이거나 보기를 열 수 있는 사람(운영 계정)의 화면에만 놓인다(셸 레이아웃).
 */

/** 저절로(타이머 · 화면 복귀 · 처음 뜰 때) 다시 맞추러 가는 것은 같은 어긋남에 한 번만 — 화면이 끝없이 새로 고쳐지는 것 방지. */
const RESYNC_KEY = "aywa-tenant-view-resync";
const RESYNC_QUIET_MS = 20_000;
/** 사람이 누를 때의 다시 시도 간격 — 앞선 이동이 취소됐을 수 있다(미저장 경고에서 '머무르기'). */
const USER_RETRY_MS = 2_000;
/**
 * 사용자의 동작이 시작되는 모든 길 — 전부 capture 단계에서 먼저 받는다. 누르는 순간(pointerdown)만 막으면 손을 뗄 때의
 * click은 그대로 나가 서버 액션이 불릴 수 있어, 이어지는 이벤트까지 같은 함수로 받는다.
 */
const GUARDED_EVENTS = [
  "pointerdown", "mousedown", "touchstart", "pointerup", "mouseup", "touchend",
  "click", "dblclick", "auxclick", "contextmenu", "submit",
  "keydown", "keypress", "keyup", "paste", "drop", "dragstart", "change", "input",
] as const;

function readCookie(name: string): string | null {
  try {
    for (const part of document.cookie.split("; ")) {
      const i = part.indexOf("=");
      if (i > 0 && part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1));
    }
  } catch {
    /* 쿠키를 읽지 못하면 표식이 없는 것으로 본다 */
  }
  return null;
}

function allowAutoResync(signature: string): boolean {
  try {
    const raw = window.sessionStorage.getItem(RESYNC_KEY);
    const last = raw ? (JSON.parse(raw) as { signature?: string; at?: number }) : null;
    if (last && last.signature === signature && typeof last.at === "number" && Date.now() - last.at < RESYNC_QUIET_MS) return false;
    window.sessionStorage.setItem(RESYNC_KEY, JSON.stringify({ signature, at: Date.now() }));
  } catch {
    /* 저장소를 못 쓰면 되풀이 방지 없이 한 번은 맞춘다 */
  }
  return true;
}

export function TenantViewSync({
  userId,
  viewingTenantId,
  serverNow,
}: {
  /** 로그인한 사람. */
  userId: string;
  /** 이 탭이 그려진 지점(보는 중이 아니면 null). */
  viewingTenantId: string | null;
  /** 이 화면을 그린 서버의 시각(ms) — 이 기기의 시계가 틀려도 끝나는 때를 서버 기준으로 맞춘다. */
  serverNow: number;
}) {
  useEffect(() => {
    // 서버 시각 − 이 기기 시각. 화면이 그려진 뒤 여기까지의 지연만큼 서버 시각을 늦게 보므로 여유(TENANT_VIEW_CLIENT_EXTRA_CUTOFF_MS)를 둔다.
    const clockOffset = serverNow - Date.now();
    /** 이 문서에서 마지막으로 이동을 시도한 때(0 = 아직 없다). */
    let triedAt = 0;

    const expectedNow = () =>
      expectedTenantFromMark(parseTenantViewMark(readCookie(TENANT_VIEW_MARK_COOKIE)), userId, Date.now() + clockOffset + TENANT_VIEW_CLIENT_EXTRA_CUTOFF_MS);

    const resync = (expected: string | null, byUser: boolean) => {
      const now = Date.now();
      if (byUser) {
        // 사람이 누른 것 — 방금 시도한 이동이 아직 진행 중일 수 있으니 잠깐만 기다렸다가 다시 간다.
        if (triedAt && now - triedAt < USER_RETRY_MS) return;
      } else if (triedAt || !allowAutoResync(`${viewingTenantId ?? "-"}>${expected ?? "-"}`)) {
        // 저절로 가는 것은 이 문서에서 한 번, 같은 어긋남으로는 잠시 동안 한 번뿐이다.
        return;
      }
      triedAt = now;
      // 창(iframe) 안에서 알아챘어도 바깥 문서를 옮긴다 — 어긋난 것은 셸 전체다.
      let target: Window = window;
      try {
        if (window.top && window.top.location.origin === window.location.origin) target = window.top;
      } catch {
        /* 다른 출처의 틀 안이면 이 문서만 옮긴다 */
      }
      // 보기가 끝났으면 '보기 끝내기'로(남은 쿠키를 지우고 운영 콘솔로), 새로 열렸거나 바뀌었으면 '화면 맞추기'로.
      const href = tenantViewResyncHref(viewingTenantId, expected, `${target.location.pathname}${target.location.search}`);
      if (href) target.location.assign(href);
    };

    const check = (event?: Event) => {
      const expected = expectedNow();
      if (expected === viewingTenantId) return;
      // 어긋난 화면이다 — 이 동작은 서버에 닿지 않게 먹고(이동이 막혀 있어도), 화면을 다시 맞추러 간다.
      if (event) {
        if (event.cancelable) event.preventDefault();
        event.stopImmediatePropagation();
      }
      resync(expected, Boolean(event));
    };

    const onGuarded = (event: Event) => check(event);
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    const onPageShow = (event: PageTransitionEvent) => {
      // 뒤로 가기로 되살아난 화면(bfcache)이면 앞서의 이동 시도 기록을 지우고 다시 본다.
      if (event.persisted) triedAt = 0;
      onVisible();
    };
    const onTick = () => check();
    for (const type of GUARDED_EVENTS) window.addEventListener(type, onGuarded, true);
    window.addEventListener("focus", onVisible);
    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(onTick, 5_000);
    check();
    return () => {
      for (const type of GUARDED_EVENTS) window.removeEventListener(type, onGuarded, true);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    };
  }, [userId, viewingTenantId, serverNow]);

  return null;
}
