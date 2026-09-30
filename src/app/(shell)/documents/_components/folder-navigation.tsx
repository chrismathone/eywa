"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useContext, useOptimistic, useRef, useTransition, type ComponentProps, type ReactNode } from "react";
import { useEmbed, withEmbed } from "@/components/workspace/embed-context";

// 데이터베이스 탐색기의 폴더 이동 — "한 번 누르고 기다려야 들어가진다"(원장 2026-09-30)의 수리.
// ① 누른 폴더를 **그 자리에서** 선택된 모양으로(낙관적 activeKey) ② 목록은 새 폴더가 올 때까지 흐리게(aria-busy)
// ③ 이동은 그대로 서버 렌더(`router.push`) — 권한·필터·정렬·페이지는 지금과 같은 한 경로를 지난다(#77).
// 주소도 그대로 `?cat=`이라 뒤로 가기·주소 공유가 산다. 클라 캐시를 두지 않아 지운 문서가 남아 보일 일이 없다.

type FolderNavigation = {
  /** 화면에 선택돼 보이는 폴더 — 누르는 즉시 바뀐다(이동이 끝나면 서버 값과 같다). */
  activeKey: string | null;
  /** 다른 폴더로 옮겨 가는 중(목록을 흐리게). */
  navigating: boolean;
  go: (href: string, key: string | null) => void;
  /** 이 폴더로 가던 이동을 멈춘다 — 더블클릭 이름 변경이 첫 클릭의 이동에 휩쓸리지 않게. */
  cancel: (key: string | null) => void;
};

const Ctx = createContext<FolderNavigation | null>(null);

/** 첫 클릭으로 이동을 시작한 뒤 같은 더블클릭의 두 번째 클릭이 **새 화면**에 떨어지는 창(OS 더블클릭 한도 여유분). */
const SECOND_CLICK_GUARD_MS = 1000;

export function FolderNavigationProvider({ activeKey, className, children }: {
  activeKey: string | null; className?: string; children: ReactNode;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [shownKey, setShownKey] = useOptimistic(activeKey);
  const lastPress = useRef<Element | null>(null);
  const started = useRef<{ at: number; origin: Element | null; key: string | null } | null>(null);

  function go(href: string, key: string | null) {
    started.current = { at: performance.now(), origin: lastPress.current, key };
    startTransition(() => {
      setShownKey(key);
      router.push(href);
    });
  }

  function cancel(key: string | null) {
    const s = started.current;
    if (!s || s.key !== key) return;
    // 편집이 열렸으니 두 번째-클릭 보호는 끝 — 남겨 두면 입력칸 안 더블클릭(단어 선택)까지 삼킨다.
    started.current = null;
    if (!pending) return; // 이미 들어갔다(서버가 더블클릭보다 빨랐다) — 트리 줄은 그대로라 편집은 이어진다.
    // 진행 중인 이동은 새 이동이 오면 버려진다(Next 액션 큐) — 지금 주소로 되돌려 보내 화면을 그대로 둔다.
    startTransition(() => {
      setShownKey(activeKey);
      router.replace(`${window.location.pathname}${window.location.search}`, { scroll: false });
    });
  }

  /** 첫 클릭이 연 이동 뒤, 같은 더블클릭의 나머지가 **다른 요소**(새로 그려진 폴더·삭제 버튼 등)에 떨어지면 삼킨다. */
  function strayFollowUp(target: Element): boolean {
    const s = started.current;
    if (!s || performance.now() - s.at > SECOND_CLICK_GUARD_MS) return false;
    return !(s.origin?.isConnected && s.origin.contains(target));
  }

  return <Ctx.Provider value={{ activeKey: shownKey, navigating: pending && shownKey !== activeKey, go, cancel }}>
    <div className={className}
      onClickCapture={(e) => {
        const target = e.target as Element;
        if (e.detail >= 2 && strayFollowUp(target)) { e.preventDefault(); e.stopPropagation(); return; }
        if (e.detail <= 1) {
          // 새 클릭 = 새 더블클릭 묶음 — 앞 이동의 보호를 끝낸다(안 그러면 곧이어 다른 곳을 더블클릭할 때 그 두 번째 클릭을
          // 삼켜, 파일 이름 칸의 500ms 보류가 안 풀리고 미리보기 창이 열린다). 이 클릭이 이동을 걸면 go()가 다시 세운다.
          started.current = null;
          lastPress.current = target.closest("a") ?? target;
        }
      }}
      onDoubleClickCapture={(e) => {
        if (strayFollowUp(e.target as Element)) { e.preventDefault(); e.stopPropagation(); }
      }}>
      {children}
    </div>
  </Ctx.Provider>;
}

export function useFolderNavigation(): FolderNavigation | null {
  return useContext(Ctx);
}

/** 화면에 선택돼 보일 폴더 — 탐색기 밖(테스트·단독 렌더)에선 서버가 준 값 그대로. */
export function useShownFolderKey(committed: string | null): string | null {
  const nav = useContext(Ctx);
  return nav ? nav.activeKey : committed;
}

/**
 * 폴더로 가는 링크 — 평범한 클릭은 탐색기 이동(즉시 강조 + 목록 흐림)으로, Ctrl·가운데 클릭(새 탭)은 브라우저 그대로.
 * 창(iframe) 안이면 embed=1을 잃지 않는다(#133 — `EmbedLink`와 같은 규칙).
 * 같은 더블클릭의 두 번째 클릭은 이동하지 않는다(같은 폴더를 두 번 받지 않게 · 이름 변경은 dblclick이 맡는다).
 */
export function FolderNavLink({ folderKey, href, onClick, onNavigate, ...rest }:
  Omit<ComponentProps<typeof Link>, "href"> & { href: string; folderKey: string | null }) {
  const nav = useContext(Ctx);
  const embed = useEmbed();
  const target = embed ? withEmbed(href) : href;
  return <Link {...rest} href={target}
    onClick={(e) => { onClick?.(e); if (e.detail > 1) e.preventDefault(); }}
    onNavigate={(e) => {
      onNavigate?.(e);
      if (!nav) return;
      e.preventDefault();
      nav.go(target, folderKey);
    }} />;
}

/** 폴더 목록 칸 — 새 폴더를 받는 동안 흐리게 두어 "눌렸다"를 알린다(빠른 이동엔 안 깜빡이게 살짝 늦게). */
export function FolderListSection({ className, children }: { className?: string; children: ReactNode }) {
  const busy = !!useContext(Ctx)?.navigating;
  return <section aria-busy={busy || undefined}
    className={`${className ?? ""} relative transition-opacity ${busy ? "cursor-progress opacity-60 delay-100" : ""}`}>
    {/* sr-only는 absolute라 positioned 부모 안에 둔다(#79 — 밖이면 창 안 스크롤바가 둘). */}
    {busy ? <p role="status" className="sr-only">폴더를 여는 중입니다</p> : null}
    {children}
  </section>;
}
