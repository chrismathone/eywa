"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { RememberPrefs } from "@/components/remember-prefs";
import { clampTableScale, type StaffFilterPrefs, type StaffViewPrefs } from "@/features/staff/list/list-prefs";
import { queueStaffPrefsSave, rememberPickedView, seedStaffView } from "./staff-prefs-queue";

/**
 * 직원 표 보기 설정(볼 열·순서·글자 크기)의 **런타임 값** — 진실은 계정(`ui_prefs.staff`, 원장 2026-08-04 "뷰 세팅은 계정 귀속").
 *
 * 서버가 계정값을 `initial`로 내려 주고 이 Provider가 그 값으로 **첫 렌더부터** 그린다(SSR = 첫 클라 렌더 — 하이드레이션 무변,
 * 기본값 → 계정값 플래시 없음). 클릭은 여기 state를 바꿔 즉시 반영하고 같은 자리에서 계정에 저장한다(부분 객체·단일 큐).
 * 저장이 돌아오면 **병합된 계정값**으로 화면을 맞춘다 — 다른 창·PC가 그 사이 바꾼 값이 있으면 그때 따라온다(그 전엔 이 창 값).
 *
 * 🔴 zustand persist(`eywa-prefs`, localStorage)에 두지 않는다(적대적 리뷰 2026-09-04): persist는 모듈 로드 시점에 동기로
 *    되살아나 SSR HTML(기본값)과 첫 클라 렌더(기기값)가 갈렸다(React #418/#425, [[#75]] 계열) — 계정이 진실이면 기기 사본은
 *    필요 없다. 시간표 글씨 크기(`TimetableFontPrefSync`, 스토어 주입형)와 **구조가 다르다** — 여기는 목록→상세→뒤로가 주 동선이라
 *    "렌더마다 주입"이 캐시된 옛 페이로드로 클릭을 되돌렸다(뒤로 가기 보정은 `seedStaffView`, 세대 비교 `rev`).
 */
type StaffViewCtx = {
  view: StaffViewPrefs;
  setColumns: (order: string[], hidden: string[]) => void;
  setScale: (scale: number) => void;
};
const Ctx = createContext<StaffViewCtx | null>(null);

export function StaffViewPrefsProvider({ initial, children }: { initial: StaffViewPrefs; children: ReactNode }) {
  const [view, setViewState] = useState<StaffViewPrefs>(() => seedStaffView(initial));
  // 핸들러가 읽는 "지금 값"(state는 클로저에 갇힌다) — 저장의 base가 된다: 서버는 base와 next의 차이만 저장값 위에 얹는다.
  const viewRef = useRef(view);
  // 연속 클릭에선 마지막 클릭의 저장 결과만 화면에 되먹인다(앞 결과를 그대로 얹으면 뒤 클릭이 잠깐 되돌아가 보인다).
  const seq = useRef(0);
  const commit = useCallback((patch: Partial<StaffViewPrefs>) => {
    const base = viewRef.current;
    const optimistic = { ...base, ...patch };
    viewRef.current = optimistic; // ① 화면은 즉시
    setViewState(optimistic);
    rememberPickedView(optimistic);
    const my = ++seq.current;
    queueStaffPrefsSave(patch, base) // ② 계정에 영속(바뀐 키만 + base — 실패해도 화면은 안 막는다)
      .then((r) => {
        if (my !== seq.current || !r.ok || !r.view) return;
        viewRef.current = r.view; // ③ 병합된 계정값으로 수렴(다른 창·PC의 변경 포함)
        setViewState(r.view);
        rememberPickedView(r.view);
      })
      .catch(() => {});
  }, []);
  const setColumns = useCallback((columnOrder: string[], columnHidden: string[]) => commit({ columnOrder, columnHidden }), [commit]);
  const setScale = useCallback((next: number) => commit({ tableScale: clampTableScale(next) }), [commit]);
  const value = useMemo(() => ({ view, setColumns, setScale }), [view, setColumns, setScale]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStaffViewPrefs(): StaffViewCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useStaffViewPrefs: StaffViewPrefsProvider 밖에서 불렸다");
  return ctx;
}

/**
 * 필터 5축 저장 — 공용 RememberPrefs를 **이 문서의 단일 큐**에 태운 것. 서버 컴포넌트는 서버 액션 참조만 넘길 수 있어
 * 큐 함수를 직접 못 넘기므로 이 얇은 껍데기가 필요하다. `current`·`saved`는 `pickStaffFilterPrefs`를 거친 5키뿐이다.
 */
export function StaffRememberPrefs({ current, saved }: { current: StaffFilterPrefs; saved: StaffFilterPrefs }) {
  return <RememberPrefs current={current} saved={saved} save={queueStaffPrefsSave} />;
}
