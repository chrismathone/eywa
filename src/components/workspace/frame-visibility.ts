/**
 * 창(iframe) 문서에 "지금 이 창은 안 보인다"를 **Page Visibility 그대로** 알려 준다.
 *
 * 왜: iframe 안의 `document.visibilityState`는 **최상위 탭** 기준이다. 최소화(`display:none`)·보관(BL3)·
 *     최대화 창 뒤에 가려진 창도 `visible`이라, 창 안의 폴링(출결 라이브·신규 상담 감시·ClassNote 큐·알림 등
 *     20여 곳)이 아무도 못 보는 화면을 위해 계속 돌았다(창 최대 6 + 보관 4 = 10배).
 * 어떻게: 그 폴링들은 이미 `visibilityState`/`visibilitychange`로 멈추고 되살아나게 짜여 있다. 그래서 소비처를
 *     하나도 안 고치고 **부모가 창 문서의 `visibilityState`·`hidden`을 덮어** "창이 숨음 ∨ 탭이 숨음"으로 답하게
 *     하고, 값이 바뀔 때 `visibilitychange`를 쏜다. 같은 origin이라 부모가 창 문서를 직접 만질 수 있다.
 *     덤으로 초안 자동저장(use-form-draft)의 "숨을 때 즉시 기록"과 툴팁 닫기도 창 단위로 맞게 돈다.
 * ⚠️ 덮는 건 **그 문서 객체**의 속성이다 — 창 안에서 새 문서가 뜨면(⟳·하드 이동) 다시 걸어야 한다(RouteWindow가
 *    load·첫 페인트 때 다시 부른다). 걸기 전 잠깐은 탭 기준 값이 보인다(무해 — 종전과 같다).
 */

type Vis = "visible" | "hidden";
type FrameWin = Window & { __eywaWindowHidden?: boolean };
type FrameDoc = Document & { __eywaVisibilityPatched?: boolean };

/** 창 문서가 답할 값 — 창이 숨었거나 탭이 숨었으면 hidden. 순수 함수(Vitest). */
export function effectiveVisibility(windowHidden: boolean, tab: Vis): Vis {
  return windowHidden || tab === "hidden" ? "hidden" : "visible";
}

/** 탭 기준(원래) 값 — 덮기 전 프로토타입의 getter를 그 문서에 대고 부른다. */
function tabVisibility(cw: FrameWin, doc: Document): Vis {
  try {
    const desc = Object.getOwnPropertyDescriptor(
      (cw as unknown as { Document: typeof Document }).Document.prototype,
      "visibilityState",
    );
    const v = desc?.get?.call(doc) as Vis | undefined;
    if (v === "hidden" || v === "visible") return v;
  } catch {
    /* 아래 폴백 */
  }
  return "visible";
}

/**
 * 창 문서에 숨김 여부를 싣는다. 값이 실제로 바뀌면 `visibilitychange`를 쏜다(같은 값이면 조용히).
 * 아직 라우트를 싣기 전(about:blank)·접근 불가면 아무것도 안 한다.
 */
export function applyFrameVisibility(frame: HTMLIFrameElement | null, hidden: boolean): void {
  let cw: FrameWin | null = null;
  let doc: FrameDoc | null = null;
  try {
    cw = frame?.contentWindow as FrameWin | null;
    doc = frame?.contentDocument as FrameDoc | null;
    if (!cw || !doc || cw.location.href === "about:blank") return;
  } catch {
    return;
  }
  const w = cw;
  const d = doc;
  const before = d.__eywaVisibilityPatched
    ? effectiveVisibility(!!w.__eywaWindowHidden, tabVisibility(w, d))
    : tabVisibility(w, d);
  w.__eywaWindowHidden = hidden;
  if (!d.__eywaVisibilityPatched) {
    try {
      Object.defineProperty(d, "visibilityState", {
        configurable: true,
        get: () => effectiveVisibility(!!w.__eywaWindowHidden, tabVisibility(w, d)),
      });
      Object.defineProperty(d, "hidden", {
        configurable: true,
        get: () => effectiveVisibility(!!w.__eywaWindowHidden, tabVisibility(w, d)) === "hidden",
      });
      d.__eywaVisibilityPatched = true;
    } catch {
      return;
    }
  }
  const after = effectiveVisibility(hidden, tabVisibility(w, d));
  if (after !== before) {
    try {
      const Ev = (w as unknown as { Event: typeof Event }).Event;
      // 진짜 이벤트처럼 bubbles — `window`에서 듣는 쪽(Supabase auth-js 등)도 받게.
      d.dispatchEvent(new Ev("visibilitychange", { bubbles: true }));
    } catch {
      /* 무시 */
    }
  }
}
