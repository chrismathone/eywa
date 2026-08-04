"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, LayoutPanelTop } from "@/components/icons/eywa-icon-compat";
import { NAV_GROUPS } from "@/lib/navigation";
import { EyIcon, type EywaIconName } from "@/components/icons/eywa-icons";
import { useWindowStore, instanceLabel } from "./window-store";
import { usePrefs } from "./use-prefs";

// 라우트 창 칩 아이콘 — 레일과 동일한 Eywa 아이콘. 학생 요약창은 user.
const ICON_BY_MENU: Record<string, EywaIconName> = {};
for (const g of NAV_GROUPS) for (const it of g.items) ICON_BY_MENU[it.menuKey] = it.icon;

/**
 * 하단 **왼쪽** 독/스위처 — **자동 숨김(맥 독식)**. 평소엔 하단 가장자리에 작은 핸들로 숨어 본문
 * (페이지네이션·버튼)을 안 가리고, 마우스를 핸들/하단으로 가져가면 독이 떠오른다.
 * 칩 클릭=focus/복원, 가운데클릭=닫기.
 * ⚠️ 창이 **1개만 열려 있으면**(최소화 아님) 전환할 대상이 없어 독 자체를 숨긴다(중복·겹침 제거).
 * ⚠️ 반대로 **최소화한 창이 있으면 자동 숨김을 끄고 고정 노출**한다 — 독이 그 창을 되살릴 유일한
 *    경로라서, 숨으면 창이 갇힌다(2026-07-31).
 * ⚠️ 그 '고정 노출'조차 겹치면 곤란한 화면이 있어 **직접 접기(prefs.dockCollapsed)** 를 뒀다 —
 *    접으면 자동 노출·호버 노출이 모두 멈추고 작은 펼치기 버튼만 남는다(아래 주석 참조).
 */
export function WindowSwitcher() {
  const windows = useWindowStore((s) => s.windows);
  const order = useWindowStore((s) => s.order);
  const focusedId = useWindowStore((s) => s.focusedId);
  const restore = useWindowStore((s) => s.restore);
  const close = useWindowStore((s) => s.close);
  const enterSpotlight = useWindowStore((s) => s.enterSpotlight);
  const collapsed = usePrefs((s) => s.dockCollapsed);
  const setCollapsed = usePrefs((s) => s.setDockCollapsed);

  const [revealed, setRevealed] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (hideTimer.current) clearTimeout(hideTimer.current); }, []);
  const clearHide = () => { if (hideTimer.current) clearTimeout(hideTimer.current); };
  const reveal = () => { clearHide(); setRevealed(true); }; // 독 진입 — 숨김 취소
  const scheduleHide = () => { clearHide(); hideTimer.current = setTimeout(() => setRevealed(false), 280); };

  const list = order.map((id) => windows[id]).filter(Boolean);
  if (list.length === 0) return null;
  const openCount = list.filter((w) => !w.minimized).length;
  // 창 1개만 열려 있으면(=지금 보는 그 창) 전환 대상이 없음 → 독 숨김. (최소화 1개면 복원 위해 유지.)
  if (list.length === 1 && openCount === 1) return null;
  // ⚠️ **최소화한 창이 하나라도 있으면 독을 고정 노출**(자동 숨김 해제, 원장 제보 2026-07-31:
  // "최소화하면 하단에서 확인이 안 된다"). 최소화는 창을 화면에서 통째로 지우는데, 되살릴 유일한
  // 경로인 독까지 1.5px 핸들로 숨어 있으면 **화면 어디에도 그 창의 흔적이 없다**(사이드바 점은
  // 비최소화 창만 표시 — app-sidebar `openIds`). 자동 숨김은 "전부 떠 있어 본문을 가리면 안 될 때"의
  // 편의이지, 되살릴 게 있을 때의 기본값이 아니다. (window-switcher.test.tsx가 이 계약을 잠근다.)
  const minimizedCount = list.length - openCount;
  // 접기(사용자 선택)가 최우선 — 접었으면 최소화 창이 있어도, 호버해도 칩을 펼치지 않는다.
  // 대신 아래 '펼치기' 버튼이 **항상 보이고 최소화 개수를 표시**하므로 창이 갇히지 않는다(1클릭 복귀).
  const showDock = !collapsed && (revealed || minimizedCount > 0);

  return (
    // 하단 왼쪽 hot-zone — 핸들(숨김 표시)과 독을 **한 컨테이너**로 묶는다(호버 핸들러는 이 컨테이너에만).
    // reveal 시 컨테이너의 자식만 핸들→독+브리지로 바뀌고 컨테이너 엘리먼트 자체는 그대로라(언마운트·
    // 재마운트 없음) 마우스가 안에 그대로 남는다. 컨테이너는 **내용 크기**라 독을 항상 정확히 감싸므로
    // 창 수와 무관하게 폭 데드존이 없다. 컨테이너를 벗어날 때만(onMouseLeave) 숨김 예약 → "호버 후
    // 클릭하면 사라짐" 버그 해소. 숨김일 땐 작은 핸들만 차지해 본문(페이지네이션 등) 클릭을 거의 안 가린다.
    <div
      onMouseEnter={collapsed ? undefined : reveal}
      onMouseLeave={collapsed ? undefined : scheduleHide}
      // ⚠️ **하단 왼쪽**에 붙인다(원장 제보 2026-08-04: "저장 버튼하고 겹쳐서 누르기 힘들다").
      // 자리 이동 이력: 하단 중앙(→페이지네이션과 충돌, 07-30) → 하단 오른쪽(→폼 저장 바와 충돌, 08-04)
      // → **하단 왼쪽**. 저장 액션 바([FormActionBar](src/components/forms/form-action-bar.tsx))는 규약상
      // 창 하단 **우측 정렬**이라 오른쪽 끝은 사실 가장 붐비는 자리였다(최대화·스냅 창의 저장/취소 버튼이
      // 정확히 거기). 하단 중앙=페이지네이션, 하단 우측=저장 바를 빼면 **하단 왼쪽만이 어느 화면에서도
      // 조작 대상이 없는 자리**다(폼 버튼은 우측 정렬, 목록 페이저는 중앙).
      // 그래도 겹치는 화면이 나오면 사용자가 직접 접을 수 있다(dockCollapsed).
      className="pointer-events-auto absolute bottom-0 left-2 z-50 flex flex-col items-start"
    >
      {showDock ? (
        <>
          <div
            data-slot="window-switcher"
            className="border-line bg-card/95 shadow-modal animate-in fade-in slide-in-from-bottom-1 flex items-center gap-1.5 rounded-full border px-2 py-1.5 backdrop-blur duration-150"
          >
            {openCount >= 2 ? (
              <button
                type="button"
                onClick={() => enterSpotlight()}
                title="스포트라이트 (포커스 크게 + 나머지 커버)"
                aria-label="스포트라이트"
                className="text-text-dim hover:bg-bg-soft hover:text-foreground mr-0.5 flex size-7 items-center justify-center rounded-full transition"
              >
                <LayoutPanelTop size={15} strokeWidth={1.8} />
              </button>
            ) : null}
            {list.map((w) => {
              const active = w.id === focusedId && !w.minimized;
              const iconName =
                w.kind === "route"
                  ? (ICON_BY_MENU[w.params.id] ?? ICON_BY_MENU[w.params.id.split("/")[0]])
                  : null;
              const label = instanceLabel(w.id, w.params.title);
              return (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => restore(w.id)}
                  onAuxClick={(e) => {
                    e.preventDefault();
                    close(w.id);
                  }}
                  title={`${label}${w.minimized ? " (최소화됨 — 눌러서 다시 열기)" : ""}`}
                  // 최소화 칩은 **점선 테두리**로 구분한다(opacity만으론 "꺼진 글씨"로 보여 누를 수 있는
                  // 줄 모른다). 테두리 두께 차로 칩 높이가 들쭉날쭉해지지 않게 기본은 투명 테두리.
                  className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] transition ${
                    active ? "bg-primary text-primary-foreground" : "text-text-dim hover:bg-bg-soft"
                  } ${w.minimized ? "border-dashed border-line-strong/60 opacity-75" : "border-transparent"}`}
                >
                  {iconName ? (
                    <EyIcon name={iconName} size={13} strokeWidth={1.8} />
                  ) : (
                    <EyIcon name="user" size={12} />
                  )}
                  <span className="max-w-[120px] truncate">{label}</span>
                </button>
              );
            })}
            {/* 접기 — 이 독을 아예 내려둔다(영속). 자동 노출(최소화 창)·호버 노출 모두 멈춘다.
                버튼 하나 넓이가 아까워 보이지만, "지금 이 화면에서 방해된다"를 사용자가 즉시 해결할
                유일한 손잡이다(자리 이동만으론 모든 화면을 만족시킬 수 없어 07-30·08-04 두 번 옮겼다). */}
            <button
              type="button"
              onClick={() => setCollapsed(true)}
              title="독 접기 (하단 왼쪽 작은 버튼으로 줄임)"
              aria-label="독 접기"
              className="text-text-faint hover:bg-bg-soft hover:text-foreground ml-0.5 flex size-7 items-center justify-center rounded-full transition"
            >
              <ChevronDown size={15} strokeWidth={1.8} />
            </button>
          </div>
          {/* 브리지 — 독 아래~바닥(독 폭만큼). 핸들(바닥 왼쪽)에서 독까지 마우스 경로를 한 컨테이너로 잇는다. */}
          <div className="h-4 w-full" aria-hidden />
        </>
      ) : collapsed ? (
        // 접힘(사용자가 직접 접음): 작은 **펼치기 버튼**. 호버로는 안 열린다(그게 접은 이유) — 클릭만.
        // ⚠️ 최소화 창이 있으면 개수를 함께 보여준다. 접힌 상태에서 창을 최소화하면 화면 어디에도
        //    흔적이 없어(사이드바 점은 비최소화 창만) 창이 갇히기 때문 — 여기가 그 유일한 표지다.
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          title={`창 ${list.length}개 — 독 펼치기${minimizedCount > 0 ? ` (최소화 ${minimizedCount}개)` : ""}`}
          className={`border-line bg-card/95 shadow-card mb-2 flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] backdrop-blur transition ${
            minimizedCount > 0 ? "text-primary border-primary/40" : "text-text-dim hover:text-foreground"
          }`}
        >
          <ChevronUp size={13} strokeWidth={1.8} />
          <span className="num">{minimizedCount > 0 ? `최소화 ${minimizedCount}` : list.length}</span>
        </button>
      ) : (
        // 숨김(자동): 작은 핸들만. 컨테이너 hover(onMouseEnter)가 reveal → 자식이 독으로 바뀐다.
        <div className="cursor-pointer px-5 pt-3 pb-1.5" aria-hidden>
          <span className="bg-line-strong/45 hover:bg-line-strong block h-1.5 w-10 rounded-full transition" />
        </div>
      )}
    </div>
  );
}
