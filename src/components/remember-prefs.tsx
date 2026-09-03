"use client";

import { useEffect, useRef } from "react";

/**
 * 지금 화면에 걸린 보기 설정이 계정에 저장된 것과 다르면 **한 번** 저장한다(다음 방문용, 원장 2026-08-04 "뷰 세팅은 계정 귀속").
 *
 * 서버가 URL(명시값) → 저장값 → 기본값 순으로 필터를 정하고 그 결과를 `current`로 내려 준다. 사용자가 열 머리에서 값을 고르면
 * URL이 바뀌어 다시 렌더되고, 그때 차이가 나면 여기서 저장한다 — 필터 컨트롤마다 저장 코드를 붙이지 않는다.
 * 학생목록(`ui_prefs.students`)·수업목록(`ui_prefs.classes`)이 같이 쓴다 — `save`는 그 화면의 서버 액션(`saveXxxPrefs`).
 *
 * 🔑 같음 판정은 **JSON 문자열 비교**다 — `current`·`saved` 둘 다 같은 파서(`parseXxxPrefs`)를 거친 완전한 객체라 키 순서가
 *    같다. 파서를 거치지 않은 객체를 넘기면 순서만 달라도 매 렌더 저장한다(호출부 규약).
 * ⚠️ 저장 뒤 `saved`는 다음 서버 렌더까지 옛 값이라, 같은 값을 두 번 보내지 않게 마지막으로 보낸 값을 기억한다.
 * ⚠️ 실패해도 화면엔 아무 일도 없다(URL이 이미 진실) — 조용히 다음 기회에 다시 저장된다. 실패는 둘이다: 액션이 던지는 것
 *    (네트워크)과 `{ ok: false }`로 돌아오는 것(비로그인·DB 오류) — 둘 다 표식을 지워야 다음 렌더가 다시 시도한다.
 */
export function RememberPrefs<T extends object>({
  current,
  saved,
  save,
}: {
  current: T;
  saved: T;
  /** 그 화면의 `"use server"` 저장 액션 — 서버 컴포넌트가 참조를 그대로 넘긴다. */
  save: (next: T) => Promise<{ ok: boolean }>;
}) {
  const sent = useRef<string | null>(null);
  // 저장은 **한 줄로 세운다** — 서버 액션이 ui_prefs 전체를 읽고-쓰기라, 연달아 두 번 고치면(요일 월 → 수 연타) 먼저 보낸 저장이
  // 나중에 써져 계정엔 옛 집합이 남는다(적대적 리뷰 2026-09-04). 같은 창 안에서는 앞 저장이 끝난 뒤 다음을 보낸다.
  // ⚠️ 창이 다르면(학생목록 창과 수업목록 창이 동시에) 여전히 겹칠 수 있다(앱 전역 ui_prefs 쓰기 14곳이 같은 읽고-쓰기) — 형제 키를 잃으면
  //    그 화면에서 필터를 한 번 더 바꿀 때 다시 써진다(맨몸으로 다시 열기만 해선 current===saved라 안 써진다).
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const key = JSON.stringify(current);
  const same = key === JSON.stringify(saved);
  useEffect(() => {
    if (same || sent.current === key) return;
    sent.current = key;
    chain.current = chain.current.then(() =>
      save(JSON.parse(key) as T)
        .then((result) => {
          if (!result.ok) sent.current = null;
        })
        .catch(() => {
          // 저장 실패 — 다음 렌더에서 다시 시도할 수 있게 표식을 지운다.
          sent.current = null;
        }),
    );
  }, [key, same, save]);
  return null;
}
