"use client";

import { MenuGlyph } from "@/components/icons/menu-glyph";
import { useOpenMenu } from "@/components/workspace/menu-hub-grid";
import type { HubSearchEntry } from "@/lib/menu-hub";
import { SEARCH_ZONE_ATTR, openCommandPalette, useMenuMap, useSidebarSearch } from "./sidebar-menu-search";

/**
 * **메뉴 지도** — 사이드바 '메뉴 검색' 칸을 누르면 사이드바 오른쪽에 펼쳐지는 판(원장 2026-10-19 *"수업) 수업목록·시간표 /
 * 원생) 원생목록 등등 지도처럼 촤라락 펼쳐지게 해서 한눈에 + 검색기능"*).
 *
 * 🔑 업무군 하나 = 한 덩어리(머리 = 업무군 아이콘·이름, 아래 = 그 안의 메뉴)를 **여러 열로** 흘려 담는다 — 사이드바 폭(216px)에
 *    세로로 늘어놓으면 스크롤만 길어져 "한눈에"가 안 된다. 치는 대로 걸러지고(업무군째 사라짐), 맞는 글자는 진하게.
 * 📌 위치는 사이드바(z-45) **안의** 절대 배치라 창(z-40)·메뉴 판 위에 뜬다. 바깥을 누르거나 Esc·메뉴를 열면 닫힌다.
 * ⚠️ 키보드 순서(↑↓)와 그린 순서는 `groupHubSearch`의 `flat` 하나 — 따로 정하면 화살표가 엉뚱한 줄로 간다.
 */
export function SidebarMenuMap({ entries }: { entries: readonly HubSearchEntry[] }) {
  const { q, active, open, setActive, close } = useSidebarSearch();
  const { groups, flat } = useMenuMap(entries);
  const openMenu = useOpenMenu();
  if (!open) return null;

  const query = q.trim();
  let index = 0;
  return (
    <div
      id="sidebar-menu-map"
      role="dialog"
      aria-label="메뉴 지도"
      {...{ [SEARCH_ZONE_ATTR]: "" }}
      className="border-line bg-card shadow-modal absolute top-[54px] left-full z-10 ml-2 flex max-h-[calc(100vh-72px)] w-[min(880px,calc(100vw-260px))] flex-col overflow-hidden rounded-xl border"
    >
      <div className="border-line flex shrink-0 items-baseline gap-3 border-b px-5 py-3">
        <h2 className="text-foreground text-base font-bold">
          {query ? (
            <>
              &lsquo;{query}&rsquo; 메뉴 <span className="num">{flat.length}</span>개
            </>
          ) : (
            "전체 메뉴"
          )}
        </h2>
        <span className="text-text-faint ml-auto text-xs">↑↓ 이동 · Enter 열기 · Shift+Enter 새 창 · Esc 닫기</span>
      </div>

      {flat.length === 0 ? (
        <div className="text-text-dim px-5 py-6 text-sm">
          <p>&lsquo;{query}&rsquo; 메뉴가 없습니다.</p>
          <button type="button" onClick={openCommandPalette} className="text-primary mt-1.5 text-sm font-bold hover:underline">
            학생·수업까지 찾기 (Shift+F)
          </button>
        </div>
      ) : (
        <div className="min-h-0 overflow-y-auto px-5 py-4">
          {/* 덩어리를 열로 흘린다(높이가 제각각이라 격자보다 빈칸이 적다) — 한 덩어리는 열 사이에서 안 쪼갠다. */}
          <div className="columns-[180px] gap-x-8">
            {groups.map((g) => (
              <section key={g.id} className="mb-5 break-inside-avoid">
                <h3 className="text-foreground flex items-center gap-2 text-sm font-bold">
                  <MenuGlyph name={g.icon} size={18} className="shrink-0" />
                  <span className="truncate">{g.label}</span>
                </h3>
                {/* 왼쪽 가는 선 = 이 업무군 아래라는 표시(나무 모양). 색은 구조선 토큰. */}
                <ul className="border-line mt-1.5 ml-[8px] flex flex-col gap-0.5 border-l pl-2.5">
                  {g.items.map((e) => {
                    const i = index++;
                    const on = i === active;
                    return (
                      <li key={e.dest.href}>
                        <button
                          type="button"
                          onClick={(ev) => {
                            openMenu(e.dest, ev.shiftKey);
                            close();
                          }}
                          onMouseEnter={() => setActive(i)}
                          className={`flex h-8 w-full items-center rounded-md px-2 text-left text-sm ${
                            on ? "bg-primary-soft text-primary font-bold" : "text-foreground"
                          }`}
                        >
                          <span className="truncate">
                            <Highlight text={e.dest.label} query={query} />
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** 라벨 안의 검색어(대소문자 무시, 붙어 있는 그대로)만 진하게 — 띄어쓰기로만 걸린 경우는 그냥 둔다. */
function Highlight({ text, query }: { text: string; query: string }) {
  const at = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <b className="text-primary font-bold">{text.slice(at, at + query.length)}</b>
      {text.slice(at + query.length)}
    </>
  );
}
