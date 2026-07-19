// 시간표 표시 선호(기기 기억) 쿠키 이름 — ⚠️ 반드시 이 **일반 모듈**에서 import할 것.
//
// 원래 "use client" 모듈(prefs-sync.tsx)이 export하던 상수를 서버 컴포넌트(page.tsx)가 import했는데,
// 클라이언트 모듈의 비컴포넌트 export는 서버 그래프에서 **클라이언트 참조 프록시**가 되어 문자열이
// 런타임 undefined로 평가됐다(2026-07-19 실측 — `cookieStore.get(undefined)`가 항상 미적중 → 쿠키
// 기본값이 조용히 죽고 URL 파라미터 경로만 동작). 타입체크는 통과하는 침묵 버그라, 클라·서버가 함께
// 쓰는 상수는 이렇게 지시어 없는 공용 모듈에 둔다. 쓰기(prefs-sync)와 읽기(page)가 둘 다 여기서 읽는다.

/** 강사뷰 '미사용 요일' 선호 — "hide" | "show". */
export const EMPTY_DAYS_COOKIE = "eywa-tt-emptydays";

/** 기본뷰 '빈 교시 접기' 선호 — "collapse" | "expand". */
export const EMPTY_PERIODS_COOKIE = "eywa-tt-emptyperiods";
