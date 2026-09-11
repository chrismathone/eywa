"use client";

import { useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { useInFrame } from "./use-in-frame";
import { windowIdForHref } from "./window-link";
import { WINDOW_CHROME, windowMinSize } from "./window-geometry";

/**
 * 창 **최소 폭 미달** 안내 — 창(iframe) 본문이 그 메뉴의 최소 폭(`ROUTE_WINDOW_SIZE.w`)보다 좁을 때 맨 위에 띄운다.
 *
 * 원장 2026-09-03: *"창이 줄어들어도 기존 4열 스타일을 유지하는 게 오히려 가독성이 뛰어남 · 차라리 '최소 크기 위반'
 * 경고 안내 페이지를 띄우거나 창 크기를 최소 크기보다 줄이려고 할 때 경고를 띄우고 줄어들지 않도록"*.
 *
 * 두 겹이다: ① 리사이즈 드래그는 [`resizeRect`](./window-geometry.ts)가 그 창의 최소 크기에서 **멈춘다**(손잡이 옆 힌트).
 * ② 그래도 작아질 수 있는 길(스냅·타일·작은 모니터·복원)에서는 화면을 접지 않고 **이 안내**가 선다 — 레이아웃은
 * 최소 폭 그대로라 가로로 밀어 볼 수 있고, [창 최대화]가 부모 캔버스에 postMessage한다.
 *
 * 🔴 **세로는 보지 않는다**(원장 2026-09-10: *"대시보드 충분히 잘보이는데 창을 키워라고 하네."* → *"세로는
 *    스크롤 생겨도 그래도 볼만하니까"*). 1482×637 창에서 폭은 1180을 넘는데 높이가 820에 못 미쳐 안내가 떴었다.
 *    세로는 **스크롤로 해결되는** 축이라 짧다고 못 읽는 화면이 아니다. 이 안내를 만든 계기도 세로가 아니라
 *    **가로 접힘**이었고(열이 접히는 것을 막으려던 것), 2026-09-09의 재발 사례도 358px **폭**이었다.
 *    ⚠️ `ROUTE_WINDOW_SIZE`의 높이는 그대로 둔다 — 그건 **처음 열리는 크기**이자 리사이즈가 멈추는 지점이라
 *    여전히 쓸모가 있다. 여기서 없앤 것은 **잔소리**뿐이다.
 *
 * 🔴 **무엇이 얼마나 모자란지, 그래서 무슨 일이 일어나는지를 적는다**(원장 2026-09-10 *"무엇이 부족한지도 좀
 *    알려줘. 스크롤이 생긴다고도 알려주고"*) — "창을 키워 주세요"만으로는 얼마나 키워야 하는지 알 수 없고,
 *    가로 스크롤이 생긴다는 사실을 모르면 잘린 열을 **없는 것으로** 읽는다(기준이 아니라 실제 값을 적을 것).
 *
 * 🔴 **숨길 수 있다**(원장 2026-09-10 *"저 메시지 숨길 수 있게도 해주고"*). 숨김은 **이 창을 보는 동안만**이다 —
 *    계정에 저장하면 다음에 진짜로 좁게 열었을 때 경고가 영영 안 뜨고, localStorage는 계정 설정이 아니다.
 *    폭을 더 줄이면 다시 뜬다(모자란 양이 달라졌으면 새 사실이다).
 *
 * 🔴 판정은 물리 프레임(`useInFrame`)이다 — 최상위 프레임(폰·직접 방문)엔 키울 창이 없어 안 띄운다.
 * ⚠️ 크기는 `useSyncExternalStore`로 읽는다(effect 안 setState 금지) — SSR 스냅샷은 빈 문자열이라 서버에선 안 그린다.
 */
function subscribe(cb: () => void) {
  window.addEventListener("resize", cb);
  return () => window.removeEventListener("resize", cb);
}
const getSize = () => `${window.innerWidth}x${window.innerHeight}`;
const getServerSize = () => "";

export function WindowMinSizeNotice() {
  const inFrame = useInFrame();
  const pathname = usePathname();
  const size = useSyncExternalStore(subscribe, getSize, getServerSize);
  // 숨긴 시점의 폭 — 그보다 더 좁아지면 다시 띄운다(모자란 양이 달라졌으니 새 사실이다).
  const [hiddenAt, setHiddenAt] = useState<number | null>(null);
  if (!inFrame || !size) return null;
  const win = windowIdForHref(pathname);
  if (!win) return null;
  // 🔴 이 화면(주소) 기준 — 경로형 면은 부모 창 id를 쓰므로 id로만 재면 출결 모드가 출석부(1280) 기준이 됐다
  //    (전수검사 2026-09-11). 같은 메뉴 안에서는 리사이즈 바닥(routeMinSize)과 같은 답이다.
  // ⚠️ 다른 메뉴로 드릴인한 화면(원생 창 안의 콜&상담 상세)에선 **다르다** — 여기 id는 같은 주소에서 뽑아 늘 그 화면의
  //    메뉴라 안내는 그 화면 크기로 재고, 바닥은 창의 원래 id(원생) 크기로 잰다(창 안에서는 창의 원래 id를 모른다).
  const min = windowMinSize(win.id, pathname);
  const [w] = size.split("x").map(Number);
  if (!Number.isFinite(w)) return null;
  // 창 rect의 최소 폭에서 크롬(테두리)을 뺀 것이 본문 iframe의 최소 폭이다. 1px은 반올림 오차라 위반이 아니다.
  const needed = min.w - WINDOW_CHROME.w;
  if (w >= needed - 1) return null;
  if (hiddenAt !== null && w >= hiddenAt) return null;
  const short = Math.max(1, Math.round(needed - w));
  const maximize = () => {
    try {
      window.parent.postMessage({ type: "eywa-window-maximize" }, window.location.origin);
    } catch {
      /* 부모가 없거나 막혀 있으면 조용히 — 안내는 그대로 남는다. */
    }
  };
  return (
    <div
      role="status"
      className="border-amber/40 bg-amber-soft text-amber mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg border px-3 py-1.5 text-sm font-bold"
    >
      <span>
        가로 <span className="num">{short}</span>px이 모자랍니다 — 이 화면은 폭{" "}
        <span className="num">{needed}</span>px이 필요한데 지금 <span className="num">{w}</span>px입니다. 잘린
        부분은 가로 스크롤로 밀어 보실 수 있습니다. 세로는 스크롤로 보시면 됩니다.
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={maximize}
          className="text-amber hover:bg-background/40 rounded-md border border-current px-2 py-0.5 font-bold"
        >
          창 최대화
        </button>
        {/* 숨기기 — 이 창을 보는 동안만 감춘다(더 좁아지면 다시 뜬다). */}
        <button
          type="button"
          onClick={() => setHiddenAt(w)}
          aria-label="이 안내 숨기기"
          className="text-amber hover:bg-background/40 rounded-md border border-current px-2 py-0.5 font-bold"
        >
          숨기기
        </button>
      </span>
    </div>
  );
}
