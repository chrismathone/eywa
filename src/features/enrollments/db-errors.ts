// 수강 관련 **DB 오류 → 화면용 한글** 매핑 — 판정은 순수, 미매핑 오류는 공용 explainDbError가 로그까지 남긴다.
//
// 🔴 왜 별도 파일인가(2026-08-29 배포 실패로 확인): 원래 `server/actions.ts` 안에 있었는데, 그 파일은
//    맨 위가 `"use server"`다. **`"use server"` 파일은 async 함수만 export할 수 있어서**, 재사용하려고
//    이 동기 함수에 `export`를 붙인 순간 **프로덕션 빌드가 깨졌다**(typecheck·lint·vitest는 전부 통과
//    하고 Vercel 빌드에서만 터진다 — [[#61]]과 같은 계열의 조용한 함정).
//    그래서 공유 헬퍼는 서버 액션 파일 밖, 이런 평범한 모듈에 둔다.
// ⚠️ `import "server-only"`도 붙이지 않는다 — 순수 문자열 매핑이라 클라가 import해도 안전해야 한다([[#61]]).

import { explainDbError } from "@/lib/supabase/db-error";

export type DbError = { message?: string; code?: string } | null | undefined;

/** GiST `enrollments_no_overlap`(같은 학생·같은 반 기간 겹침) 위반인가 — Postgres 23P01. */
export function isOverlapConflict(error: DbError): boolean {
  if (!error) return false;
  return (
    error.code === "23P01" ||
    /enrollments_no_overlap|exclusion constraint/i.test(error.message ?? "")
  );
}

/**
 * DB 원문(영문) 에러 → 화면용 한글. **UI에 raw 노출 금지**(작업 선호) —
 * 매핑 못 한 원문은 서버 로그로만 남기고 화면엔 일반 문구를 준다.
 * (`conflicting key value violates exclusion constraint "enrollments_no_overlap"`가 배정
 * 다이얼로그에 그대로 떴던 2026-07-28 제보의 재발 방지.)
 */
export function toKoreanDbError(error: DbError, fallback: string, scope = "enrollments"): string {
  const msg = error?.message ?? "";
  if (isOverlapConflict(error)) return "이미 이 반에 기간이 겹치는 수강이 있습니다.";
  if (msg.includes("conflicting_period")) {
    return "이 학생이 같은 시간대 다른 반에 이미 배정되어 있습니다.";
  }
  if (msg.includes("range lower bound")) {
    return "종료일이 시작일보다 빠릅니다. 날짜를 확인해 주세요.";
  }
  // 그 밖은 공용 판정(오류 코드·제약 이름) + 로그([[#138]]) — 예전엔 console.error 한 줄에 scope가 없어
  // Vercel 로그에서 어느 화면 실패인지 못 찾았고, 반·학생이 지워진 경우(23503)도 일반 문구로 뭉개졌다.
  return explainDbError(error, { scope, fallback }).message;
}
