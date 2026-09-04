"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SHUTTLE_ACTION, SHUTTLE_INPUT } from "@/features/shuttle/control-size";
import { hasCoords, type ShuttleStop } from "@/features/shuttle/types";
import { AddressFinder } from "./address-finder";
import { MAP_AVAILABLE, StopMapPicker } from "./stop-map-picker";

/**
 * 정류장 **위치** 잡기 — 한 번에 한 곳만, 목록을 가리고 여기에 집중한다.
 *
 * 📐 **2026-09-04 재설계**(원장 *"정류장 관리 → 위치 쪽 실제 사용자가 사용하기에 매우 불편함"*).
 *    종전 흐름은 23곳을 채우기엔 손이 너무 많이 갔다 —
 *      [위치] → [주소 찾기] → 고르기 → [위치 저장] → [닫기] → 목록에서 다음 줄 찾기 …  (곳당 5동작)
 *    게다가 목록 **안에서** 패널이 펼쳐져 줄이 밀리는 바람에, 저장하고 나면 어디까지 했는지 잃었다.
 *
 *    바뀐 흐름:
 *      · **[위치]를 누르면 목록이 사라지고 이 화면만** 남는다(줄이 밀리지 않는다).
 *      · **주소 검색창이 처음부터 열려 있다** — 한 동작이 줄고, 열자마자 타이핑하면 된다.
 *      · **주소를 고르면 곧바로 저장하고 다음 미지정 정류장으로 넘어간다** — 23곳을 연달아 훑는다.
 *      · 진행이 "5 / 23"으로 보인다(끝이 보여야 앉아서 끝낸다).
 *    → 곳당 **2동작**(검색어 입력 → 고르기). 나머지는 화면이 알아서 한다.
 *
 * 🔴 **자동 저장이 좌표를 건드리지 않는다** — 폼이 들고 있는 현재 값을 그대로 다시 보낸다.
 *    빈 값으로 보내면 서버가 **좌표를 지운다**(0244a 규약). 주소만 고쳤는데 좌표가 날아가면 안 된다.
 * ⚠️ `<form action={...}>`을 쓰지 않는다 — React 19는 action 제출마다 폼을 **자동 리셋**해서, 저장 뒤에도
 *    열려 있는 이 화면의 컨트롤드 입력이 옛 값으로 굳는다([[#83]]).
 */
export function StopLocationEditor({
  stop,
  busy,
  position,
  total,
  nextName,
  onSubmit,
  onSkip,
  onClose,
}: {
  stop: ShuttleStop;
  busy: boolean;
  /** 지금 몇 번째 미지정인가(1부터). 끝이 보이면 앉아서 끝낸다. */
  position: number;
  /** 아직 위치가 없는 정류장 수. */
  total: number;
  /** 저장 뒤 이어서 갈 곳 이름 — 없으면(마지막) 버튼 문구가 바뀐다. */
  nextName: string | null;
  /**
   * 부모(정류장 관리)가 `saveStopLocation`으로 보낸다. `advance`가 true면 저장 뒤 다음 곳으로 넘어간다.
   * 에러 표시·목록 갱신도 부모 규약.
   */
  onSubmit: (fd: FormData, advance: boolean) => void;
  /** 이 곳은 건너뛰고 다음으로. */
  onSkip: () => void;
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

  /** 한쪽만 채운 상태 — 저장을 막고 이유를 적는다(서버도 같은 판정을 한다). */
  const halfFilled = Boolean(lat.trim()) !== Boolean(lng.trim());

  /**
   * 저장 — 화면 상태가 아직 반영되기 전에 보내야 하는 경우가 있어(주소를 고른 그 순간) 값을 명시로 받는다.
   * 🔴 넘기지 않은 칸은 **지금 폼 값을 그대로** 싣는다 — 빈 값을 보내면 서버가 그 칸을 지운다.
   */
  function send(
    next: Partial<{ lat: string; lng: string; address: string }> = {},
    advance = false,
  ) {
    const fd = new FormData();
    fd.set("id", stop.id);
    fd.set("lat", (next.lat ?? lat).trim());
    fd.set("lng", (next.lng ?? lng).trim());
    fd.set("address", (next.address ?? address).trim());
    fd.set("radiusM", radius.trim() || "50");
    onSubmit(fd, advance);
  }

  return (
    <div className="flex min-h-0 flex-col gap-2">
      {/* 어디까지 왔나 — 끝이 보여야 한 번에 끝낸다. */}
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-foreground text-base font-bold">{stop.name}</span>
        {stop.memo && <span className="text-text-faint text-xs">{stop.memo}</span>}
        <span className="text-text-dim ml-auto text-xs">
          위치 미지정 <span className="num font-bold">{position}</span> /{" "}
          <span className="num">{total}</span>
        </span>
      </div>

      {/* 📍 주소 검색창이 **처음부터 열려 있다** — 열자마자 타이핑하면 된다.
          🔑 이건 앱키가 필요 없다(다음 우편번호 서비스) — 지도가 막혀 있어도 여기까진 된다.
          🔴 고르는 순간 **저장하고 다음으로 넘어간다** — 23곳을 훑는 게 이 화면의 목적이다. */}
      <AddressFinder
        defaultOpen
        disabled={busy}
        onPick={(picked) => {
          setAddress(picked);
          send({ address: picked }, true);
        }}
      />

      <label className="text-text-dim flex flex-col gap-1 text-xs">
        주소
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          maxLength={200}
          placeholder="위에서 찾거나 직접 입력"
          aria-label={`${stop.name} 주소`}
          className={cn(SHUTTLE_INPUT, "w-full")}
        />
      </label>

      {/* 지도는 키가 있을 때만 뜬다 — 없으면 래퍼가 한 줄로 사유를 말한다(빈 회색 상자 금지). */}
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

      {/* 🔴 **좌표는 접어 둔다** — 손으로 위경도를 치는 건 사람이 할 일이 아니다. 지도가 뜨면 클릭·핀 끌기로,
          그전엔 주소로 충분하다. 그래도 아는 값을 넣고 싶은 사람을 막지는 않는다(펼치면 나온다).
          ⚠️ 좌표가 이미 있으면 처음부터 펼쳐 둔다 — 들어 있는 값을 숨기면 왜 못 고치는지 알 수 없다. */}
      <details className="text-text-dim text-xs" open={hasCoords(stop)}>
        <summary className="cursor-pointer select-none">좌표·반경 직접 입력 (선택)</summary>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <label className="text-text-dim flex items-center gap-1 text-xs">
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
          <label className="text-text-dim flex items-center gap-1 text-xs">
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
          <label className="text-text-dim flex items-center gap-1 text-xs">
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
        <p className="text-danger text-xs">위도와 경도를 함께 입력하세요.</p>
      )}
      {!MAP_AVAILABLE && (
        <p className="text-text-faint text-xs">
          지도 키가 들어오면 여기에 지도가 떠서 클릭·핀 끌기로 좌표까지 찍힙니다. 그전에는 주소만 채워 두면
          됩니다.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          className={SHUTTLE_ACTION}
          disabled={busy || halfFilled}
          onClick={() => send({}, true)}
        >
          {nextName ? "저장하고 다음" : "저장하고 끝내기"}
        </Button>
        <Button
          type="button"
          variant="outline"
          className={SHUTTLE_ACTION}
          disabled={busy}
          onClick={onSkip}
          title={nextName ? `이 곳은 건너뛰고 '${nextName}'로 갑니다` : "목록으로 돌아갑니다"}
        >
          건너뛰기
        </Button>
        {hasCoords(stop) && (
          <Button
            type="button"
            variant="ghost"
            className={SHUTTLE_ACTION}
            disabled={busy}
            title="이 정류장의 좌표를 지웁니다(주소·이름은 그대로)"
            onClick={() => {
              setLat("");
              setLng("");
              send({ lat: "", lng: "" });
            }}
          >
            좌표 지우기
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          className={cn(SHUTTLE_ACTION, "ml-auto")}
          onClick={onClose}
        >
          목록으로
        </Button>
      </div>
    </div>
  );
}
