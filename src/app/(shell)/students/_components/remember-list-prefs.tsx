"use client";

import { useEffect, useRef } from "react";
import { sameStudentListPrefs, type StudentListPrefs } from "@/features/students/list-prefs";
import { saveStudentListPrefs } from "@/features/students/server/list-prefs";

/**
 * 지금 화면에 걸린 보기 설정이 계정에 저장된 것과 다르면 **한 번** 저장한다(다음 방문용, 원장 2026-08-04 "뷰 세팅은 계정 귀속").
 *
 * 서버가 URL(명시값) → 저장값 → 기본값 순으로 필터를 정하고 그 결과를 `current`로 내려 준다. 사용자가 열 머리에서
 * 값을 고르면 URL이 바뀌어 다시 렌더되고, 그때 차이가 나면 여기서 저장한다 — 필터 컨트롤마다 저장 코드를 붙이지 않는다.
 * ⚠️ 저장 뒤 `saved`는 다음 서버 렌더까지 옛 값이라, 같은 값을 두 번 보내지 않게 마지막으로 보낸 값을 기억한다.
 * ⚠️ 실패해도 화면엔 아무 일도 없다(URL이 이미 진실) — 조용히 다음 기회에 다시 저장된다. 실패는 둘이다: 액션이 던지는 것(네트워크)과
 *    `{ ok: false }`로 돌아오는 것(비로그인·DB 오류) — 둘 다 표식을 지워야 다음 렌더가 다시 시도한다(재리뷰 2026-09-03).
 */
export function RememberListPrefs({ current, saved }: { current: StudentListPrefs; saved: StudentListPrefs }) {
  const sent = useRef<string | null>(null);
  const key = JSON.stringify(current);
  const same = sameStudentListPrefs(current, saved);
  useEffect(() => {
    if (same || sent.current === key) return;
    sent.current = key;
    void saveStudentListPrefs(JSON.parse(key) as StudentListPrefs)
      .then((result) => {
        if (!result.ok) sent.current = null;
      })
      .catch(() => {
        // 저장 실패 — 다음 렌더에서 다시 시도할 수 있게 표식을 지운다.
        sent.current = null;
      });
  }, [key, same]);
  return null;
}
