"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { cn } from "@/lib/utils";
import { SHUTTLE_CHIP, SHUTTLE_CHIP_OFF, SHUTTLE_CHIP_ON } from "@/features/shuttle/control-size";
import { reportVehiclePosition } from "@/features/shuttle/map/server/vehicle-position-actions";
import { ageLabel, FIX_MAX_AGE_S, ROUGH_ACCURACY_M, SEND_EVERY_MS } from "@/features/shuttle/map/vehicle-position";

/** 이 폰이 그 회차 위치를 보내기로 했나 — 이 기기에만 남는다(다른 직원 폰이 같은 회차를 열어도 보내지 않게). */
const flagKey = (date: string, runId: string) => `shuttle-gps:${date}:${runId}`;

/** 표식이 바뀌었음을 같은 탭의 구독자에게 알린다(storage 이벤트는 다른 탭에만 온다). */
const FLAG_EVENT = "shuttle-gps-flag";

function subscribeFlag(cb: () => void) {
  window.addEventListener(FLAG_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(FLAG_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

/** [출발]을 이 폰에서 눌렀을 때 켠다 — 출발한 사람이 곧 차에 탄 사람이다. */
export function markGpsOn(date: string, runId: string) {
  writeFlag(date, runId, true);
}

function readFlag(date: string, runId: string): boolean {
  try {
    return localStorage.getItem(flagKey(date, runId)) === "on";
  } catch {
    return false;
  }
}

function writeFlag(date: string, runId: string, on: boolean) {
  try {
    if (on) localStorage.setItem(flagKey(date, runId), "on");
    else localStorage.removeItem(flagKey(date, runId));
  } catch {}
  window.dispatchEvent(new Event(FLAG_EVENT));
}

type WakeLockSentinelLike = { release(): Promise<void> };
type NavigatorWithWakeLock = Navigator & { wakeLock?: { request(type: "screen"): Promise<WakeLockSentinelLike> } };

type Fix = { lat: number; lng: number; accuracy: number; heading: number | null; speed: number | null; at: number };

/**
 * 운행 중 회차의 **차량 위치 보내기**(0381a, 사용자 2026-10-15 "휴대폰으로 GPS") — 회차 머리 아래 한 줄.
 *
 * 🔑 브라우저 `navigator.geolocation.watchPosition`으로 좌표를 받고 `SEND_EVERY_MS`(10초)마다 최신 좌표를 서버로 보낸다.
 * 🔑 **이 폰에서 [출발]을 누르면 자동으로 켜진다**(`markGpsOn`). 다른 폰에선 [📡 위치 보내기]를 눌러야 보낸다 —
 *    사무실에서 같은 화면을 연 관리자의 위치가 차 위치로 찍히지 않게.
 * 🔑 화면 꺼짐 방지(Wake Lock)를 건다 — 웹은 화면이 꺼지거나 다른 앱으로 가면 위치를 못 받는다(특히 아이폰).
 * 🔴 https에서만 된다(PC의 localhost는 예외로 된다). 권한 거부·GPS 꺼짐은 한글로 알린다.
 * 🔴 운행 종료(회차 상태가 바뀌면 이 부품이 사라진다) 또는 서버가 "종료"라고 하면 멈춘다.
 */
export function TripGpsSender({ runId, date }: { runId: string; date: string }) {
  // 🔑 켜짐 = 이 폰의 표식(localStorage). 서버 렌더·첫 화면은 꺼짐으로 그리고 브라우저 값으로 맞춘다.
  const on = useSyncExternalStore(subscribeFlag, () => readFlag(date, runId), () => false);
  const setOn = (next: boolean) => writeFlag(date, runId, next);
  /** 이 브라우저에서 위치를 못 쓰는 이유(https 아님 · 미지원) — 켜졌을 때만 말한다. */
  const unsupported =
    on && typeof window !== "undefined"
      ? !window.isSecureContext
        ? "https 주소에서만 위치를 보낼 수 있어요"
        : !("geolocation" in navigator)
          ? "이 브라우저는 위치를 지원하지 않아요"
          : null
      : null;
  const [fix, setFix] = useState<Fix | null>(null);
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const fixRef = useRef<Fix | null>(null);

  useEffect(() => {
    if (!on || !window.isSecureContext || !("geolocation" in navigator)) return;
    let stopped = false;

    const watchId = navigator.geolocation.watchPosition(
      (p) => {
        const f: Fix = {
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          accuracy: p.coords.accuracy,
          heading: p.coords.heading,
          speed: p.coords.speed,
          at: p.timestamp,
        };
        // 🔑 방금 받은 정확한 좌표(GPS)를 곧이어 온 대략적 좌표(와이파이·기지국)로 덮지 않는다 — 오차가 2배 넘게 나빠지면
        //    앞 좌표가 아직 신선한 동안(전송 간격 안)은 앞 것을 쓴다.
        const prev = fixRef.current;
        if (prev && f.accuracy > prev.accuracy * 2 && f.at - prev.at < SEND_EVERY_MS) return;
        fixRef.current = f;
        setFix(f);
        setProblem(null);
      },
      (e) => {
        setProblem(
          e.code === e.PERMISSION_DENIED
            ? "위치 권한이 꺼져 있어요 — 폰 설정에서 이 브라우저의 위치 접근을 허용해 주세요"
            : e.code === e.POSITION_UNAVAILABLE
              ? "GPS 신호를 못 잡고 있어요 — 위치(GPS)가 켜져 있는지 확인해 주세요"
              : "위치를 받는 데 시간이 걸리고 있어요",
        );
      },
      // 🔑 maximumAge 0 — 브라우저가 들고 있던 옛 좌표 말고 매번 새로 잰 좌표를 받는다.
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
    );

    async function send() {
      const f = fixRef.current;
      if (!f || stopped) return;
      // 🔴 묵은 좌표는 보내지 않는다 — 서버는 받은 시각으로 "방금"을 그리므로, GPS가 멈춘 채 보내면 차가 몇 분 전 자리에 "방금"으로 찍힌다.
      //    f.at과 Date.now()는 같은 기기 시계라 시계 오차가 없다.
      if (Date.now() - f.at > FIX_MAX_AGE_S * 1000) {
        setProblem("GPS가 새 위치를 못 받고 있어요 — 화면을 켜 두고, 창가나 밖에서 잠시 기다려 주세요");
        return;
      }
      const res = await reportVehiclePosition({
        runId,
        lat: f.lat,
        lng: f.lng,
        accuracyM: f.accuracy,
        heading: f.heading,
        speedMps: f.speed,
        measuredAt: new Date(f.at).toISOString(),
      }).catch(() => ({ error: "위치를 보내지 못했어요 — 인터넷 연결을 확인해 주세요" }));
      if (stopped) return;
      if ("error" in res) {
        setProblem(res.error);
        // 운행이 끝났으면 더 보내지 않는다.
        if (res.error.includes("종료")) {
          writeFlag(date, runId, false);
        }
      } else {
        setSentAt(Date.now());
      }
    }
    const first = window.setTimeout(send, 1500);
    const timer = window.setInterval(send, SEND_EVERY_MS);
    const tick = window.setInterval(() => setNow(Date.now()), 1000);

    // 화면 꺼짐 방지 — 탭이 다시 앞으로 오면 다시 건다(가려지면 브라우저가 풀어 버린다).
    let lock: WakeLockSentinelLike | null = null;
    const acquire = () => {
      const wl = (navigator as NavigatorWithWakeLock).wakeLock;
      if (!wl || document.visibilityState !== "visible") return;
      wl.request("screen")
        .then((l) => {
          if (stopped) void l.release();
          else lock = l;
        })
        .catch(() => {});
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        acquire();
        void send();
      }
    };
    acquire();
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      stopped = true;
      navigator.geolocation.clearWatch(watchId);
      window.clearTimeout(first);
      window.clearInterval(timer);
      window.clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisible);
      if (lock) void lock.release().catch(() => {});
    };
  }, [on, runId, date]);

  function toggle() {
    const next = !on;
    setOn(next);
    setProblem(null);
    if (!next) {
      setFix(null);
      setSentAt(null);
      setProblem(null);
    }
  }

  const shown = unsupported ?? (on ? problem : null);
  return (
    <div
      className={cn(
        "mx-3 mb-2 flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs",
        shown ? "bg-danger-soft text-danger" : on ? "bg-green-soft text-green" : "bg-muted text-text-dim",
      )}
      role="status"
    >
      <span className="min-w-0 flex-1 font-bold break-keep">
        {shown
          ? `📡 ${shown}`
          : on
            ? fix
              ? `📡 위치 보내는 중 · ±${Math.round(fix.accuracy)}m · ${sentAt ? `${ageLabel(Math.round((now - sentAt) / 1000))} 보냄` : "보내는 중…"}`
              : "📡 위치를 잡는 중… (처음엔 위치 권한을 물어요)"
            : "📡 이 폰은 차 위치를 보내지 않고 있어요"}
        {on && !shown ? (
          fix && fix.accuracy > ROUGH_ACCURACY_M ? (
            // GPS가 아니라 와이파이·기지국 위치 — 대개 폰의 '정확한 위치'가 꺼졌거나 실내다.
            <span className="text-danger block font-medium">
              위치가 대략적이에요 — 폰 설정에서 이 브라우저의 &lsquo;정확한 위치&rsquo;를 켜 주세요
            </span>
          ) : (
            <span className="text-text-dim block font-medium">운행 중엔 이 화면을 켜 두세요</span>
          )
        ) : null}
      </span>
      <button type="button" onClick={toggle} className={cn(SHUTTLE_CHIP, "shrink-0", on ? SHUTTLE_CHIP_OFF : SHUTTLE_CHIP_ON)}>
        {on ? "멈춤" : "위치 보내기"}
      </button>
    </div>
  );
}
