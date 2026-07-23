"use client";

import { useEffect } from "react";
// ⚠️ 쿠키 이름 상수는 pref-cookies(일반 모듈)가 단일 소스 — 이 "use client" 파일에서 다시 export하지
// 말 것. 서버(page.tsx)가 클라 모듈 경유로 상수를 import하면 참조 프록시가 되어 런타임 undefined다
// (2026-07-19 실측: 쿠키 기본값이 조용히 죽었다).
import {
  COMPACT1H_COOKIE,
  EMPTY_DAYS_COOKIE,
  EMPTY_PERIODS_COOKIE,
  writeCompact1hFor,
} from "@/features/timetable/lib/pref-cookies";

const ONE_YEAR = 60 * 60 * 24 * 365;

/**
 * 강사뷰 '미사용 요일' 토글을 **기기에 기억**한다.
 *
 * 이 토글은 URL 파라미터(`emptydays=hide`)로만 살아 있었는데, eywa는 메뉴를 창(iframe)으로 열고 창은
 * 항상 깨끗한 URL로 열리므로 **열 때마다 기본값(전 요일 표시)으로 초기화**됐다. 강사뷰 기본이 월~토
 * 전 컬럼이라, 주 2일만 가르치는 강사도 매번 가로로 넓은 표를 다시 접어야 했다(적대 감사 UX).
 *
 * localStorage가 아니라 **쿠키**인 이유: 서버 컴포넌트가 첫 렌더에서 읽어야 깜빡임(잘못된 상태로
 * 그렸다가 클라에서 교정)이 없다. localStorage를 lazy state 초기값으로 읽는 패턴은 hydration 크래시
 * 전례(#75)도 있다. URL 파라미터가 있으면 그쪽이 우선(공유 링크 존중), 없을 때만 이 값이 기본이 된다.
 */
export function EmptyDaysPrefSync({ hide }: { hide: boolean }) {
  useEffect(() => {
    document.cookie = `${EMPTY_DAYS_COOKIE}=${hide ? "hide" : "show"}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
  }, [hide]);
  return null;
}

/**
 * 기본뷰 '빈 교시 접기' 선호를 기기에 기억 — 이유·구조는 위 EmptyDaysPrefSync와 동일(창은 깨끗한
 * URL로 열려 파라미터만으론 매번 초기화). URL 파라미터(`emptyperiods=collapse|expand`)가 있으면
 * 그쪽 우선, 없을 때만 쿠키가 기본. 링크 직렬화는 **양방향 명시**(page.tsx buildHref 참조 — hide만
 * 직렬화하다 토글이 한쪽으로 죽은 emptydays 전례 재발 방지).
 */
export function EmptyPeriodsPrefSync({ collapse }: { collapse: boolean }) {
  useEffect(() => {
    document.cookie = `${EMPTY_PERIODS_COOKIE}=${collapse ? "collapse" : "expand"}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
  }, [collapse]);
  return null;
}

/**
 * 통합뷰 '1시간 단위'(섹션별 압축)를 **과목별로** 기기에 기억 — 위 둘과 같은 이유·같은 구조.
 *
 * 이 토글만 쿠키가 없어서, 창을 다시 열거나 새로고침할 때마다(창은 항상 깨끗한 URL로 열린다)
 * 체크가 풀렸다. 원장 제보 2026-07-23 "영어 시간표 1시간 단위를 계속 해놨는데 왜 자꾸 풀리지".
 *
 * ⚠️ 쓰기 전에 기존 쿠키를 **읽어서 머지**한다(다른 과목 설정 보존). 그리고 서버는 URL 파라미터가
 * 있으면 그쪽을 우선하되, **해제를 표현하는 `compact1h=none` 센티널**을 반드시 함께 쓴다 — 없으면
 * '마지막 하나를 해제 → 파라미터 소멸 → 쿠키(옛 값)로 복원'이 되어 토글이 켜진 채로 죽는다
 * (emptydays가 한쪽으로만 직렬화돼 죽었던 전례와 같은 함정).
 */
export function Compact1hPrefSync({ subject, sections }: { subject: string; sections: number[] }) {
  // 배열은 렌더마다 새 참조라 effect 의존성으로 못 쓴다 → 원시 문자열로 고정.
  const key = sections.join(".");
  useEffect(() => {
    if (!subject) return;
    const raw = document.cookie
      .split("; ")
      .find((c) => c.startsWith(`${COMPACT1H_COOKIE}=`))
      ?.slice(COMPACT1H_COOKIE.length + 1);
    const next = writeCompact1hFor(raw, subject, key ? key.split(".").map(Number) : []);
    document.cookie = `${COMPACT1H_COOKIE}=${next}; path=/; max-age=${ONE_YEAR}; samesite=lax`;
  }, [subject, key]);
  return null;
}
