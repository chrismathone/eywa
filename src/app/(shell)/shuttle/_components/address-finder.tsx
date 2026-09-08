"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { SHUTTLE_ACTION } from "@/features/shuttle/control-size";

/**
 * 주소 찾기 — **다음(카카오) 우편번호 서비스**.
 *
 * 원장(2026-09-04): *"이거 위도경도 찍지말고 카카오 지도 그거 해서 주소찾기 기능 쓰면 대자나"*.
 * 맞는 지적이라 손으로 숫자를 치던 자리를 이걸로 바꿨다.
 *
 * 🔑 **이건 앱키가 필요 없다.** 지도(`stop-map-picker`)는 `NEXT_PUBLIC_KAKAO_MAP_KEY`가 있어야
 *    뜨지만, 우편번호 서비스는 키·도메인 등록·결제가 전부 없다. 그래서 **지금 당장 쓸 수 있다** —
 *    지도가 막혀 있는 것과 별개다.
 *
 * ⚠️ **좌표(위도·경도)는 주지 않는다.** 우편번호 서비스가 돌려주는 건 주소 문자열뿐이다
 *    (도로명·지번·우편번호·건물명). 주소를 좌표로 바꾸려면 그때는 카카오 키가 든다.
 *    → 지금은 **주소만 채우고**, 좌표는 키가 들어온 뒤에 지도에서 찍거나 일괄 변환한다.
 * ⚠️ **상호명은 대개 안 나온다** — 도로명주소 DB 기반이라 아파트·학교·큰 건물은 찾아지지만
 *    식당·상점 이름은 안 걸린다(정류장 이름 대부분이 아파트라 실사용엔 지장이 적다).
 *
 * 🔑 팝업(`.open()`) 대신 **인라인 임베드**(`.embed()`)를 쓴다 — 팝업은 브라우저가 막을 수 있고,
 *    플로팅 창 안에서 별도 창이 뜨면 원장님이 쓰시는 창 시스템과 겹친다.
 */

type PostcodeData = {
  /** 도로명 주소(있을 때). 없으면 지번 주소를 쓴다. */
  roadAddress?: string;
  jibunAddress?: string;
  /** 건물명 — "(달성초 입구)" 같은 우리 정류장 이름과 대조하기 좋아 함께 넘긴다. */
  buildingName?: string;
  zonecode?: string;
};

type PostcodeCtor = new (opts: {
  oncomplete: (data: PostcodeData) => void;
  onclose?: () => void;
  width?: string;
  height?: string;
}) => { embed: (el: HTMLElement) => void };

type DaumWindow = Window & { daum?: { Postcode?: PostcodeCtor } };

const SCRIPT_SRC = "https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js";

let scriptPromise: Promise<PostcodeCtor> | null = null;

/** 스크립트를 한 번만 주입한다. 실패하면 promise를 버려 다음 열기에서 다시 시도할 수 있게 둔다. */
function loadPostcode(): Promise<PostcodeCtor> {
  if (scriptPromise) return scriptPromise;
  const promise = new Promise<PostcodeCtor>((resolve, reject) => {
    const w = window as DaumWindow;
    if (w.daum?.Postcode) {
      resolve(w.daum.Postcode);
      return;
    }
    const el = document.createElement("script");
    el.src = SCRIPT_SRC;
    el.async = true;
    el.onload = () => {
      const ctor = (window as DaumWindow).daum?.Postcode;
      if (ctor) resolve(ctor);
      else reject(new Error("postcode-missing"));
    };
    el.onerror = () => reject(new Error("script-error"));
    document.head.appendChild(el);
  }).catch((e) => {
    scriptPromise = null; // 다음 시도에서 다시 붙일 수 있게
    throw e;
  });
  scriptPromise = promise;
  return promise;
}

export function AddressFinder({
  onPick,
  disabled,
}: {
  /** 고른 주소(도로명 우선, 없으면 지번). 건물명은 있으면 함께. */
  onPick: (address: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  // 🔴 최신 콜백을 효과가 잡게 — 열려 있는 동안 부모가 리렌더되어도 옛 onPick으로 채우지 않는다.
  // ⚠️ 렌더 중에 `.current`를 쓰면 안 된다(React 19 `react-hooks/refs`) — **효과 안에서** 갱신한다.
  const onPickRef = useRef(onPick);
  useEffect(() => {
    onPickRef.current = onPick;
  }, [onPick]);

  useEffect(() => {
    if (!open) return;
    let disposed = false;

    loadPostcode()
      .then((Postcode) => {
        const el = boxRef.current;
        if (disposed || !el) return;
        el.replaceChildren(); // 다시 열 때 이전 위젯이 겹치지 않게
        new Postcode({
          width: "100%",
          height: "100%",
          oncomplete: (data) => {
            const base = data.roadAddress?.trim() || data.jibunAddress?.trim() || "";
            // 건물명이 주소에 안 들어 있으면 괄호로 덧붙인다 — "○○아파트"가 붙어야 어느 자리인지 안다.
            const building = data.buildingName?.trim();
            const full = building && !base.includes(building) ? `${base} (${building})` : base;
            if (full) onPickRef.current(full);
            setOpen(false);
          },
          onclose: () => setOpen(false),
        }).embed(el);
      })
      .catch(() => {
        if (!disposed) setError("주소 찾기를 불러오지 못했습니다 — 잠시 뒤 다시 눌러 주세요.");
      });

    return () => {
      disposed = true;
    };
  }, [open]);

  return (
    <div className="flex flex-col gap-1.5">
      <Button
        type="button"
        variant="outline"
        className={SHUTTLE_ACTION}
        disabled={disabled}
        onClick={() => {
          setError(null);
          setOpen((v) => !v);
        }}
      >
        {open ? "주소 찾기 닫기" : "주소 찾기"}
      </Button>

      {error && <p className="text-danger text-xs">{error}</p>}

      {/* 위젯이 들어올 자리 — 높이를 실제로 잡아 둔다(0이면 목록이 보이지 않는다). */}
      {open && <div ref={boxRef} className="border-line h-72 w-full overflow-hidden rounded-lg border" />}
    </div>
  );
}
