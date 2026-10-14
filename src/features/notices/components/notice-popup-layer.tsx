"use client";

import { useEffect, useState } from "react";
import type { ActivePopup } from "../server/queries";
import { NoticePopupCard } from "./notice-popup-card";

/** 열린 화면이 새 공지를 다시 묻는 주기 — 알림 벨과 같은 60초. */
const POLL_MS = 60_000;
/** 창 포커스는 자주 일어난다(플로팅 창 ↔ 바탕) — 그때마다 묻지 않게 최소 간격. */
const FOCUS_MIN_GAP_MS = 15_000;

/** 카드 정체 — 같은 공지는 같은 카드, 고친 공지는 새 카드(`updatedAt`). */
const cardKey = (p: ActivePopup) => `${p.id}:${p.updatedAt}`;

/**
 * 화면에 선 카드 묶음이 같은가(같으면 다시 그리지 않는다). 글자까지 본다 — 영문 번역은 저장 뒤 몇 초 늦게 붙고
 * `updatedAt`을 안 바꾼다(번역 전 목록이 계속 남지 않게). 이미지 주소는 서명이 매번 바뀌어 **있고 없음**만 본다
 * (서명이 잠깐 실패해 이미지 없이 받은 카드가, 복구된 뒤에도 그 탭에서 계속 이미지 없이 남지 않게).
 */
const sameList = (a: readonly ActivePopup[], b: readonly ActivePopup[]) =>
  a.length === b.length &&
  a.every((p, i) => {
    const q = b[i]!;
    return (
      cardKey(p) === cardKey(q) &&
      p.title === q.title &&
      p.body === q.body &&
      p.linkLabel === q.linkLabel &&
      p.linkUrl === q.linkUrl &&
      p.width === q.width &&
      p.position === q.position &&
      !!p.imageSrc === !!q.imageSrc
    );
  });

// position → 화면 앵커(그리드 블록 위치 + 내부 정렬). cascade는 중앙 그리드로 흡수.
const ANCHOR: Record<string, { outer: string; inner: string }> = {
  center: { outer: "items-center justify-center", inner: "justify-center" },
  cascade: { outer: "items-center justify-center", inner: "justify-center" },
  "left-top": { outer: "items-start justify-start", inner: "justify-start" },
  "right-top": { outer: "items-start justify-end", inner: "justify-end" },
  "left-bottom": { outer: "items-end justify-start", inner: "justify-start" },
  "right-bottom": { outer: "items-end justify-end", inner: "justify-end" },
};
const anchorOf = (p: string) => ANCHOR[p] ?? ANCHOR.center;

/**
 * 공지 팝업 레이어 — 셸 진입 시 활성 팝업을 그리드로 타일링(겹치지 않음). position 앵커별로 그룹을 만들고,
 * 같은 앵커의 팝업은 flex-wrap으로 나란히 배치(여러 개여도 안 겹침). fixed 레이어는 pointer-events-none,
 * 카드만 auto → 카드 사이 빈 공간은 아래 페이지로 클릭 통과. 임베드 iframe엔 마운트 안 함(부모 셸만).
 * "안 보기" 필터는 **서버**(getActivePopups, 계정 단위 0162a)에서 이미 끝났다 — 옛 localStorage 시절의
 * 하이드레이션 게이트가 필요 없어졌고(클라 전용 상태 없음 = SSR 미스매치 없음), 첫 페인트부터 바로 보인다.
 *
 * **열린 화면에도 뜬다**(2026-10-14, 원장 *"시간대가 맞으면 그 즉시 강사 창에 팝업되나"*): 첫 목록은 셸이 그릴 때 받고,
 * 그 뒤엔 60초마다·화면으로 돌아올 때 `/api/notice-popups`(셸과 같은 판정 함수)에 다시 묻는다 — 새로 쓴 공지와 노출
 * 시작 시각이 된 예약 공지가 새로고침 없이 선다. 숨은 탭에서는 묻지 않는다. 실패하면 보던 목록 그대로.
 * 🔴 카드 key = `id:updatedAt` — 같은 공지는 다시 물어도 같은 카드라 X로 닫은 카드가 1분마다 되살아나지 않고,
 *    공지를 **고치면** 새 카드로 다시 선다(계정 '다시 보지 않기'의 버전 규칙 `isDismissed`와 같은 뜻). 닫은 카드 key는
 *    레이어도 기억한다(`closedKeys`) — 셸이 다시 그려져 목록을 새로 내려줘도 이 화면에선 다시 안 뜬다. 공지를 껐다 켜면
 *    `updated_at`이 바뀌어 새 카드다(다시 뜬다 — '다시 보지 않기'의 버전 규칙과 같다).
 * ⚠️ 창(iframe) 안에서는 묻지 않는다 — 레이어는 최상위 프레임 몫이고, 숨은 창의 visibilityState는 탭 기준이라([[#134]])
 *    숨어 있어도 계속 묻게 된다.
 */
export function NoticePopupLayer({ popups: initial }: { popups: ActivePopup[] }) {
  // 셸이 다시 그려져 새 목록을 내려주면 그쪽이 최신이다(렌더 중 상태 맞추기 — effect로 하면 한 박자 늦는다).
  const [seed, setSeed] = useState(initial);
  const [popups, setPopups] = useState(initial);
  const [closedKeys, setClosedKeys] = useState<ReadonlySet<string>>(() => new Set());
  if (seed !== initial) {
    setSeed(initial);
    setPopups(initial);
  }

  useEffect(() => {
    if (window.top !== window.self) return;
    let alive = true;
    let seq = 0;
    let lastAt = Date.now();
    const refresh = async () => {
      if (document.visibilityState !== "visible") return;
      const mine = ++seq;
      lastAt = Date.now();
      try {
        const res = await fetch("/api/notice-popups", { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as { popups?: ActivePopup[] };
        if (!alive || mine !== seq || !Array.isArray(body.popups)) return;
        const next = body.popups;
        setPopups((prev) => (sameList(prev, next) ? prev : next));
      } catch {
        /* best-effort — 못 물었으면 보던 목록 그대로 */
      }
    };
    const timer = setInterval(refresh, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const onFocus = () => {
      if (Date.now() - lastAt >= FOCUS_MIN_GAP_MS) void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  const shown = popups.filter((p) => !closedKeys.has(cardKey(p)));
  if (shown.length === 0) return null;

  // 앵커별 그룹화(같은 앵커 = 한 그리드 클러스터).
  const groups = new Map<string, ActivePopup[]>();
  for (const p of shown) {
    const a = p.position in ANCHOR ? p.position : "center";
    (groups.get(a) ?? groups.set(a, []).get(a)!).push(p);
  }

  return (
    <>
      {[...groups.entries()].map(([pos, items]) => {
        const a = anchorOf(pos);
        return (
          // print:hidden — 팝업 뜬 채 문서 인쇄 시 카드가 인쇄물 위에 찍히는 것 방지.
          <div key={pos} className={`pointer-events-none fixed inset-0 z-[55] flex p-4 print:hidden ${a.outer}`}>
            <div className={`flex max-w-full flex-wrap content-start gap-4 ${a.inner}`}>
              {items.map((p) => (
                <NoticePopupCard
                  key={cardKey(p)}
                  popup={p}
                  onClose={() => setClosedKeys((prev) => new Set(prev).add(cardKey(p)))}
                />
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}
