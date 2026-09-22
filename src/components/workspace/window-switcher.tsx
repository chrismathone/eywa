"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, ChevronUp, LayoutPanelTop, X } from "@/components/icons/aywa-icon-compat";
import { NAV_GROUPS } from "@/lib/navigation";
import type { AywaIconName } from "@/components/icons/aywa-icons";
// 🔴 창 칩·배경 카드의 메뉴 아이콘은 **사이드바와 같은 스티커 글리프**다(원장 2026-09-09
//    *"좌하단 떠있는 창들 아이콘 안바꾼듯"*) — 같은 메뉴가 자리마다 다른 그림이면 눈이 못 잇는다.
//    `MenuGlyph`는 스티커가 없는 이름이면 알아서 선 아이콘으로 떨어진다.
import { MenuGlyph } from "@/components/icons/menu-glyph";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { useWindowStore, instanceLabel } from "./window-store";
import { useCloseWindow } from "./use-close-window";
import { usePrefs } from "./use-prefs";

// 라우트 창 칩 아이콘 — 레일과 동일한 Aywa 아이콘. 학생 요약창은 user.
const ICON_BY_MENU: Record<string, AywaIconName> = {};
for (const g of NAV_GROUPS) for (const it of g.items) ICON_BY_MENU[it.menuKey] = it.icon;

/**
 * 하단 **왼쪽** 독/스위처 — **자동 숨김(맥 독식)**. 평소엔 하단 가장자리에 작은 핸들로 숨어 본문
 * (페이지네이션·버튼)을 안 가리고, 마우스를 핸들/하단으로 가져가면 독이 떠오른다.
 * 칩 클릭=focus/복원, 칩 안 ✕(및 가운데클릭)=닫기.
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
  // 닫기는 창 자체 X와 **같은 경로**(useCloseWindow: 스토어 close + 라우트 창이면 배경 refresh).
  const closeWindow = useCloseWindow();
  // 닫기 가드 두 축 — 창 안에서 벌어지는 일이라 독은 스토어에 적재된 값으로만 안다.
  const dirty = useWindowStore((s) => s.dirty); // 미저장 폼(useUnsavedGuard → postMessage)
  const busy = useWindowStore((s) => s.busy); // 녹음 등 끊기면 유실(use-recording-lock → 부모 postMessage → RouteWindow)
  const enterSpotlight = useWindowStore((s) => s.enterSpotlight);
  const collapsed = usePrefs((s) => s.dockCollapsed);
  const setCollapsed = usePrefs((s) => s.setDockCollapsed);

  /**
   * 독에서의 닫기 요청(칩 ✕ · 가운데클릭) — **창 자체 ✕와 같은 가드를 지난다.**
   * 예전엔 스토어 `close`를 직접 불러 ① 미저장 확인 ② 녹음 잠금 ③ 배경 새로고침을 통째로 건너뛰었다
   * (가운데클릭이라 아무도 몰라 안 터졌을 뿐이다). ✕를 눈에 보이게 다는 순간 이게 정식 경로가 된다.
   *
   * 미저장·잠금 창은 **닫지 않고 복원+포커스**한다 — 확인 UI(저장 안 함/계속 작성)는 그 창 위에 있고,
   * 독엔 그 문맥이 없다. 여기서 확인을 흉내 내면 같은 판단이 두 벌이 된다.
   */
  function requestCloseFromDock(id: string, label: string) {
    if (busy[id]) {
      restore(id);
      toast.warning(`${label} — 녹음 중이라 닫을 수 없습니다. 창에서 녹음을 정지한 뒤 닫아 주세요`);
      return;
    }
    if (dirty[id]) {
      restore(id);
      toast.info(`${label} — 저장하지 않은 내용이 있어 창을 열었습니다. 창 오른쪽 위 닫기 버튼으로 닫아 주세요`);
      return;
    }
    closeWindow(id);
  }

  const [revealed, setRevealed] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeChipRef = useRef<HTMLDivElement>(null);
  useEffect(() => () => { if (hideTimer.current) clearTimeout(hideTimer.current); }, []);
  const clearHide = () => { if (hideTimer.current) clearTimeout(hideTimer.current); };
  const reveal = () => { clearHide(); setRevealed(true); }; // 독 진입 — 숨김 취소
  const scheduleHide = () => { clearHide(); hideTimer.current = setTimeout(() => setRevealed(false), 280); };

  // 표시 순서 = **최근 본 순**(맨 앞 = 지금 보는 창). 원장 지시 2026-08-25 *"항상 보고 있는 창을 가장
  // 앞으로. 최근 본 순서대로 정렬되면 좋을듯"* — 폭 상한이 생기면서 포커스 칩이 끝에 있으면 잘려
  // 안 보였다. `order`는 z-스택(back→front)이라 **표시만 뒤집는다**(filter가 만든 새 배열이라 스토어
  // 불변). ⚠️ 순서를 새 상태로 따로 들지 말 것 — 선택이 순서를 흔든다([[#49]]).
  const list = order.map((id) => windows[id]).filter(Boolean).reverse();
  const openCount = list.filter((w) => !w.minimized).length;
  // ⚠️ **최소화한 창이 하나라도 있으면 독을 고정 노출**(자동 숨김 해제, 원장 제보 2026-07-31:
  // "최소화하면 하단에서 확인이 안 된다"). 최소화는 창을 화면에서 통째로 지우는데, 되살릴 유일한
  // 경로인 독까지 1.5px 핸들로 숨어 있으면 **화면 어디에도 그 창의 흔적이 없다**(사이드바 점은
  // 비최소화 창만 표시 — app-sidebar `openIds`). 자동 숨김은 "전부 떠 있어 본문을 가리면 안 될 때"의
  // 편의이지, 되살릴 게 있을 때의 기본값이 아니다. (window-switcher.test.tsx가 이 계약을 잠근다.)
  const minimizedCount = list.length - openCount;
  // 접기(사용자 선택)가 최우선 — 접었으면 최소화 창이 있어도, 호버해도 칩을 펼치지 않는다.
  // 대신 아래 '펼치기' 버튼이 **항상 보이고 최소화 개수를 표시**하므로 창이 갇히지 않는다(1클릭 복귀).
  const showDock = !collapsed && (revealed || minimizedCount > 0);

  // 폭 상한 때문에 **포커스 칩이 잘려 안 보이는** 경우만 그만큼 가로 스크롤한다. 포커스 칩은 맨 앞이라
  // 보통은 이미 보이지만, 오른쪽으로 끌어 둔 상태에서 다른 창을 고르면 그 칩이 앞으로 옮겨가 시야 밖이 된다.
  // ⚠️ `scrollIntoView`는 조상(페이지)까지 움직여 쓰지 않는다. 스크롤 컨테이너는 DragScrollArea 안쪽
  //    div(칩 행의 부모) — 구조가 바뀌면 넘침 검사에 걸려 조용히 아무 것도 안 한다(안전 실패).
  // ⚠️ 훅이라 **early return보다 먼저** 와야 한다(그래서 목록 파생값도 위로 끌어올렸다).
  useEffect(() => {
    const chip = activeChipRef.current;
    const scroller = chip?.parentElement?.parentElement;
    if (!chip || !scroller || scroller.scrollWidth <= scroller.clientWidth + 1) return;
    const c = chip.getBoundingClientRect();
    const s = scroller.getBoundingClientRect();
    if (c.left < s.left) scroller.scrollLeft -= s.left - c.left + 8;
    else if (c.right > s.right) scroller.scrollLeft += c.right - s.right + 8;
  }, [focusedId, showDock, list.length]);

  if (list.length === 0) return null;
  // 창 1개만 열려 있으면(=지금 보는 그 창) 전환 대상이 없음 → 독 숨김. (최소화 1개면 복원 위해 유지.)
  if (list.length === 1 && openCount === 1) return null;

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
            {/* 칩 목록 = **폭 상한 + 잡고 끌기 가로 스크롤**(원장 지시 2026-08-25 "목록이 많아지면 너무
                가로가 길어보이니까 적당한 목록 보여주고 드래그 스크롤"). 창은 최대 6개까지 열려 한 줄이
                600px를 넘던 것을 ~3.5칩으로 자른다 — 넘치면 DragScrollArea가 가장자리 페이드로 "더 있음"을
                표시하고 마우스로 끌어 넘긴다(전역 규약, 5px 임계값이라 탭=전환/끌기=스크롤이 안 섞인다).
                ⚠️ 스포트라이트·접기 버튼은 **밖에** 둔다(스크롤되어 사라지면 손잡이를 잃는다).
                ⚠️ 막대 스크롤바는 **감춘다**(원장 지시 "스크롤은 안보여도 된다. 대신 페이드인아웃으로
                   스크롤 가능하다를 표현") — 칩 높이가 28px라 막대가 내용만큼 자리를 먹었다. */}
            <DragScrollArea className="max-w-[360px] rounded-full" hideBar fadeTone="surface">
              <div className="flex items-center gap-1.5">
                {list.map((w) => {
                  const active = w.id === focusedId && !w.minimized;
                  const iconName =
                    w.kind === "route"
                      ? (ICON_BY_MENU[w.params.id] ?? ICON_BY_MENU[w.params.id.split("/")[0]])
                      : null;
                  const label = instanceLabel(w.id, w.params.title);
                  return (
                    // ⚠️ 칩은 **버튼이 아니라 감싸개**다 — 안에 ✕ 버튼이 들어가므로(버튼 안 버튼 금지).
                    // 배경·테두리(활성/최소화 표시)는 감싸개가 지고, 안의 두 버튼은 투명하게 겹쳐 둔다.
                    // 최소화 칩은 **점선 테두리**로 구분한다(opacity만으론 "꺼진 글씨"로 보여 누를 수 있는
                    // 줄 모른다). 테두리 두께 차로 칩 높이가 들쭉날쭉해지지 않게 기본은 투명 테두리.
                    <div
                      key={w.id}
                      ref={active ? activeChipRef : undefined}
                      // 가운데클릭 닫기는 **칩 전체**에 둔다(종전 동작 유지) — 라벨 버튼에만 두면 ✕ 위 20px에선
                      // 안 먹어 브라우저 자동스크롤만 뜬다. 경로는 ✕와 같은 requestCloseFromDock.
                      onAuxClick={(e) => {
                        if (e.button !== 1) return;
                        e.preventDefault();
                        requestCloseFromDock(w.id, label);
                      }}
                      className={`flex shrink-0 items-center rounded-full border text-xs transition ${
                        active ? "bg-primary text-primary-foreground" : "text-text-dim hover:bg-bg-soft"
                      } ${w.minimized ? "border-dashed border-line-strong/60 opacity-75" : "border-transparent"}`}
                    >
                      <button
                        type="button"
                        onClick={() => restore(w.id)}
                        aria-label={`${label} 열기`}
                        title={`${label}${w.minimized ? " (최소화됨 — 눌러서 다시 열기)" : ""}`}
                        className="flex min-w-0 items-center gap-1.5 rounded-full py-1 pr-1 pl-3 transition"
                      >
                        {iconName ? (
                          <MenuGlyph name={iconName} size={14} />
                        ) : (
                          <MenuGlyph name="user" size={13} />
                        )}
                        <span className="max-w-[120px] truncate">{label}</span>
                      </button>
                      {/* 닫기 — 칩 **오른쪽 끝**의 작은 형제 버튼(라벨을 밀지 않게 폭 최소, 독은 가로로 좁다).
                          칩 전체를 먹으면 전환(칩 클릭)이 안 되므로 일부러 20px만 차지한다. */}
                      <button
                        type="button"
                        onClick={() => requestCloseFromDock(w.id, label)}
                        aria-label={`${label} 닫기`}
                        title="닫기"
                        className={`mr-1 flex size-5 shrink-0 items-center justify-center rounded-full transition ${
                          active
                            ? "text-primary-foreground/75 hover:text-primary-foreground hover:bg-white/20"
                            : "text-text-faint hover:bg-danger-soft hover:text-danger"
                        }`}
                      >
                        <X size={12} strokeWidth={2} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </DragScrollArea>
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
          className={`border-line bg-card/95 shadow-card mb-2 flex items-center gap-1 rounded-full border px-2 py-1 text-xs backdrop-blur transition ${
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
