"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SHUTTLE_ACTION, SHUTTLE_INPUT } from "@/features/shuttle/control-size";
import { hasCoords, type ShuttleStop } from "@/features/shuttle/types";
import { AddressFinder } from "./address-finder";
import { MAP_AVAILABLE, StopMapPicker } from "./stop-map-picker";

/**
 * 정류장 **위치**(위경도 · 도착 반경 · 주소) 입력 — 0244a.
 *
 * 🔑 **두 길을 다 연다**: ① 지도에서 클릭 ② 위도·경도 직접 입력. 지금 배포엔 카카오 앱키가 없어
 *    ①이 안 뜨는데(래퍼가 한글로 안내한다), 그렇다고 위치를 못 넣게 두면 기능이 통째로 잠긴다.
 *    키가 들어오면 ①이 저절로 살아난다.
 *
 * 🔴 **좌표는 둘 다이거나 둘 다 아니다**(0244a check). 한쪽만 저장되면 지도에 못 찍으면서 "좌표 있음"
 *    으로 세어져 빈 마커가 된다 — 서버가 거절하지만 화면에서도 같은 판정을 미리 해 준다.
 * 🔴 **비우면 지운다**: 잘못 찍은 좌표를 되돌릴 길이 필요하다('위치 지우기'가 두 칸을 비우고 저장).
 *
 * ⚠️ `<form action={...}>`을 쓰지 않는다 — React 19는 action 제출마다 폼을 **자동 리셋**해서, 저장 뒤에도
 *    열려 있는 이 패널의 컨트롤드 입력이 옛 값으로 굳는다([[#83]]). `onSubmit` + 직접 디스패치가 규약.
 */
export function StopLocationEditor({
  stop,
  busy,
  onSubmit,
  onClose,
}: {
  stop: ShuttleStop;
  busy: boolean;
  /** 부모(정류장 관리 다이얼로그)가 `saveStopLocation`으로 보낸다 — 에러 표시·목록 갱신도 그쪽 규약. */
  onSubmit: (fd: FormData) => void;
  onClose: () => void;
}) {
  const [lat, setLat] = useState(stop.lat != null ? String(stop.lat) : "");
  const [lng, setLng] = useState(stop.lng != null ? String(stop.lng) : "");
  const [address, setAddress] = useState(stop.address ?? "");
  const [radius, setRadius] = useState(String(stop.radiusM ?? 50));

  const latNum = Number(lat);
  const lngNum = Number(lng);
  const radiusNum = Number(radius);
  const mapLat = lat.trim() && Number.isFinite(latNum) ? latNum : null;
  const mapLng = lng.trim() && Number.isFinite(lngNum) ? lngNum : null;
  const mapRadius = Number.isFinite(radiusNum) && radiusNum >= 10 ? radiusNum : 50;

  /** 한쪽만 채운 상태 — 저장 버튼을 막고 이유를 적는다(서버도 같은 판정을 한다). */
  const halfFilled = Boolean(lat.trim()) !== Boolean(lng.trim());

  function send(next?: { lat: string; lng: string; address: string }) {
    const fd = new FormData();
    fd.set("id", stop.id);
    fd.set("lat", next?.lat ?? lat.trim());
    fd.set("lng", next?.lng ?? lng.trim());
    fd.set("address", next?.address ?? address.trim());
    fd.set("radiusM", radius.trim() || "50");
    onSubmit(fd);
  }

  return (
    <form
      className="border-line bg-muted/40 mx-2 mb-1.5 flex flex-col gap-2 rounded-lg border p-2"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <StopMapPicker
        lat={mapLat}
        lng={mapLng}
        radiusM={mapRadius}
        onPick={(p) => {
          setLat(String(p.lat));
          setLng(String(p.lng));
          // 주소는 역지오코딩이 알아낸 것만 덮는다 — 사람이 적어 둔 주소를 빈 값으로 지우지 않는다.
          if (p.address) setAddress(p.address);
        }}
      />

      {/* 📍 **주소 찾기가 기본 수단이다**(원장 2026-09-04 *"위도경도 찍지말고 … 주소찾기 기능 쓰면
          대자나"*). 🔑 이건 **앱키가 필요 없어** 지금 바로 된다 — 지도가 막혀 있는 것과 별개다.
          ⚠️ 다만 우편번호 서비스는 **주소만** 준다(좌표 없음). 좌표는 지도 키가 들어온 뒤에 채운다. */}
      <div className="flex flex-col gap-1.5">
        <AddressFinder onPick={setAddress} disabled={busy} />
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          maxLength={200}
          placeholder="주소 — 위 '주소 찾기'로 채우거나 직접 입력"
          aria-label={`${stop.name} 주소`}
          className={cn(SHUTTLE_INPUT, "w-full")}
        />
      </div>

      {/* 🔴 **좌표는 접어 둔다** — 손으로 위경도를 치는 건 사람이 할 일이 아니다. 지도가 뜨면 클릭으로,
          그전엔 주소로 충분하다. 그래도 아는 값을 넣고 싶은 사람을 막지는 않는다(펼치면 나온다).
          ⚠️ 좌표가 이미 있으면 처음부터 펼쳐 둔다 — 들어 있는 값을 숨기면 왜 못 고치는지 알 수 없다. */}
      <details className="text-text-dim text-[11.5px]" open={hasCoords(stop)}>
        <summary className="cursor-pointer select-none">좌표 직접 입력 (선택)</summary>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <label className="text-text-dim flex items-center gap-1 text-[11.5px]">
            위도
            <input
              value={lat}
              onChange={(e) => setLat(e.target.value)}
              inputMode="decimal"
              placeholder="35.8714"
              aria-label={`${stop.name} 위도`}
              className={cn(SHUTTLE_INPUT, "num w-32")}
            />
          </label>
          <label className="text-text-dim flex items-center gap-1 text-[11.5px]">
            경도
            <input
              value={lng}
              onChange={(e) => setLng(e.target.value)}
              inputMode="decimal"
              placeholder="128.6014"
              aria-label={`${stop.name} 경도`}
              className={cn(SHUTTLE_INPUT, "num w-32")}
            />
          </label>
          <label className="text-text-dim flex items-center gap-1 text-[11.5px]">
            반경
            <input
              value={radius}
              onChange={(e) => setRadius(e.target.value)}
              inputMode="numeric"
              aria-label={`${stop.name} 도착 반경(미터)`}
              className={cn(SHUTTLE_INPUT, "num w-20")}
            />
            m
          </label>
        </div>
      </details>

      {halfFilled && (
        <p className="text-danger text-[11.5px]">위도와 경도를 함께 입력하세요.</p>
      )}
      {!MAP_AVAILABLE && (
        <p className="text-text-faint text-[11.5px]">
          지도 키가 들어오면 여기에 지도가 떠서 클릭으로 좌표까지 찍힙니다. 그전에는 주소만 채워 두면
          됩니다.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" className={SHUTTLE_ACTION} disabled={busy || halfFilled}>
          위치 저장
        </Button>
        {hasCoords(stop) && (
          <Button
            type="button"
            variant="ghost"
            className={SHUTTLE_ACTION}
            disabled={busy}
            title="이 정류장의 좌표를 지웁니다(이름·메모는 그대로)"
            onClick={() => {
              setLat("");
              setLng("");
              // 화면 상태가 반영되기 전에 보내야 하므로 지운 값을 명시로 넘긴다.
              send({ lat: "", lng: "", address: address.trim() });
            }}
          >
            위치 지우기
          </Button>
        )}
        <Button type="button" variant="ghost" className={SHUTTLE_ACTION} onClick={onClose}>
          닫기
        </Button>
      </div>
    </form>
  );
}
