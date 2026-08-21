"use server";
/**
 * 허브 학생 검색의 **클라 진입점** — 조회 본체·권한 게이트는 [`hub-search-queries.ts`](./hub-search-queries.ts).
 *
 * 🔴 게이트를 여기 복사하지 말 것 — 서버 컴포넌트(허브 첫 렌더의 씨앗 검색)와 이 액션이 **같은 함수**를
 *    통과해야 "화면에선 못 보는데 액션으론 보이는" 구멍이 안 생긴다([[#77]]).
 * ⚠️ 조회 헬퍼는 규약상 throw한다(B3) — 본체가 한글 사유로 접어 돌려주므로 여기선 그대로 흘린다.
 */
import { loadHubStudentSearch } from "./hub-search-queries";
import type { HubSearchResult } from "../hub-search";

export async function searchAttendanceHubStudents(input: {
  query: string;
  month: string;
}): Promise<HubSearchResult> {
  return loadHubStudentSearch(input);
}
