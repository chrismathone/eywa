"use client";

import { useEffect, useRef } from "react";
// ⚠️ 쿠키 이름 상수는 pref-cookies(일반 모듈)가 단일 소스 — 이 "use client" 파일에서 다시 export하지
// 말 것. 서버(page.tsx)가 클라 모듈 경유로 상수를 import하면 참조 프록시가 되어 런타임 undefined다
// (2026-07-19 실측: 쿠키 기본값이 조용히 죽었다).
import {
  COMPACT1H_COOKIE,
  EMPTY_DAYS_COOKIE,
  EMPTY_PERIODS_COOKIE,
  writeCompact1hFor,
} from "@/features/timetable/lib/pref-cookies";
import { saveTimetableViewPrefs } from "@/features/timetable/server/view-prefs-actions";
import type { EnglishTrackFilter } from "@/features/classes/english-track";

const ONE_YEAR = 60 * 60 * 24 * 365;

function setCookie(name: string, value: string) {
  document.cookie = `${name}=${value}; path=/; max-age=${ONE_YEAR}; samesite=lax`;
}

/**
 * 시간표 표시 선호를 **계정에 기억**한다(0146a users.ui_prefs). 원장 지시 2026-07-23:
 * "뷰 설정은 각자 계정에 개별 귀속되어 다음에도 계속 같은 뷰로 볼 수 있게."
 *
 * 대상 3종 — 강사뷰 '미사용 요일' · 기본뷰 '빈 교시 접기' · 통합뷰 '1시간 단위'(과목별).
 * 이 토글들은 URL 파라미터로만 살아 있었는데, eywa는 메뉴를 창(iframe)으로 열고 창은 항상 깨끗한
 * URL로 열리므로 **열 때마다 초기화**됐다(주 2일 강사가 매번 넓은 표를 다시 접어야 했음).
 *
 * ⚠️ **쿠키도 계속 쓴다** — 계정 조회가 실패하거나 아직 값이 없을 때의 폴백이다(page.tsx 우선순위:
 * URL 파라미터 → 계정 → 쿠키 → 기본값). 계정이 진실이고 쿠키는 이관용 그림자다.
 *
 * ⚠️ **셋을 한 컴포넌트로 합친 이유**: 토글마다 따로 저장하면 같은 `ui_prefs` 행에 동시 쓰기가 겹쳐
 * 서로를 덮는다. 바뀐 것만 모아 **한 번** 저장한다(액션도 부분 병합이라 이중 방어).
 *
 * ⚠️ **값이 실제로 바뀌었을 때만 저장** — 렌더마다 쓰면 서버 왕복이 쌓인다. 서버가 내려준 '계정에
 * 저장된 값'과 다를 때만 쓴다(첫 방문엔 안 쓰고, 사용자가 토글해야 쓴다).
 *
 * ⚠️ 알려진 트레이드오프: 파라미터가 붙은 **공유 링크로 들어와도** 그 값이 내 계정에 저장된다.
 * 지금까지 쿠키(기기)에서 벌어지던 일이 계정으로 올라온 것 — 대상이 표시 취향(요일/교시 접기)이라
 * 그대로 뒀다. 학생을 숨기는 학년 필터는 이 경로가 아니라 '뷰 설정' 패널에서만 저장된다.
 */
export function TimetableViewPrefsSync({
  hideEmptyDays,
  collapseEmptyPeriods,
  subject,
  sections,
  englishTrack,
  savedHideEmptyDays,
  savedCollapseEmptyPeriods,
  savedSections,
  savedEnglishTrack,
}: {
  hideEmptyDays: boolean;
  collapseEmptyPeriods: boolean;
  subject: string;
  sections: number[];
  /**
   * 영어 프로그램 필터(전체/EiE/인재원 영어). **영어 과목일 때만** 넘긴다(undefined = 저장 대상 아님).
   * ⚠️ 다른 과목을 보는 중에 'all'을 넘기면 영어에서 좁혀 둔 값이 조용히 풀린다 — 그래서 값이 아니라
   *    **undefined**로 "지금은 이 축이 없다"를 표현한다.
   */
  englishTrack?: EnglishTrackFilter;
  /** 계정에 저장돼 있던 값(null = 미설정). 이것과 다를 때만 저장한다. */
  savedHideEmptyDays: boolean | null;
  savedCollapseEmptyPeriods: boolean | null;
  /** 계정에 저장돼 있던 **이 과목의** 압축 섹션(null = 그 과목 미설정). */
  savedSections: number[] | null;
  savedEnglishTrack: EnglishTrackFilter | null;
}) {
  // 배열은 렌더마다 새 참조라 effect 의존성으로 못 쓴다 → 원시 문자열로 고정.
  const key = sections.join(".");
  const savedKey = savedSections === null ? null : savedSections.join(".");
  // 느린 응답 중 재렌더로 같은 저장이 두 번 나가지 않게 마지막 조합을 기억한다.
  const sentRef = useRef<string | null>(null);

  useEffect(() => {
    // 쿠키는 항상 최신으로(폴백 경로가 옛 값을 들고 있지 않게).
    setCookie(EMPTY_DAYS_COOKIE, hideEmptyDays ? "hide" : "show");
    setCookie(EMPTY_PERIODS_COOKIE, collapseEmptyPeriods ? "collapse" : "expand");
    if (subject) {
      const raw = document.cookie
        .split("; ")
        .find((c) => c.startsWith(`${COMPACT1H_COOKIE}=`))
        ?.slice(COMPACT1H_COOKIE.length + 1);
      setCookie(
        COMPACT1H_COOKIE,
        writeCompact1hFor(raw, subject, key ? key.split(".").map(Number) : []),
      );
    }

    // 계정 저장 — 바뀐 키만.
    const patch: Parameters<typeof saveTimetableViewPrefs>[0] = {};
    if (savedHideEmptyDays !== hideEmptyDays) patch.hideEmptyDays = hideEmptyDays;
    if (savedCollapseEmptyPeriods !== collapseEmptyPeriods) {
      patch.collapseEmptyPeriods = collapseEmptyPeriods;
    }
    // 과목별 — 그 과목 키만 보낸다(액션이 과목 단위로 병합). 빈 배열도 보낸다(= 명시적 해제).
    if (subject && savedKey !== key) {
      patch.compact1h = { [subject]: key ? key.split(".").map(Number) : [] };
    }
    // 프로그램 필터 — 이 축이 있는 과목(영어)일 때만. `savedEnglishTrack`이 null(미설정)이면 'all'과 같은
    // 뜻이라 그때 'all'을 또 저장하지 않는다(첫 방문에 빈 쓰기가 나가지 않게).
    if (englishTrack !== undefined && englishTrack !== (savedEnglishTrack ?? "all")) {
      patch.englishTrack = englishTrack;
    }
    if (Object.keys(patch).length === 0) return;

    const stamp = `${hideEmptyDays}|${collapseEmptyPeriods}|${subject}|${key}|${englishTrack ?? "-"}`;
    if (sentRef.current === stamp) return;
    sentRef.current = stamp;
    // 표시 취향이라 실패해도 화면을 막지 않는다(쿠키 폴백이 남아 이번 기기에선 유지된다).
    void saveTimetableViewPrefs(patch);
  }, [
    hideEmptyDays,
    collapseEmptyPeriods,
    subject,
    key,
    englishTrack,
    savedHideEmptyDays,
    savedCollapseEmptyPeriods,
    savedKey,
    savedEnglishTrack,
  ]);

  return null;
}
