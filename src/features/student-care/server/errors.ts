/**
 * 약속을 못 보여 주는 까닭 — 화면이 서로 다른 문장을 낸다(실패를 '약속 없음'으로 꾸미지 않는다).
 * denied = 권한·담당 범위 밖 · unavailable = 표·함수가 아직 없음(SQL s2_0028·s2_0029 미적용 — #95) · error = 그 밖의 조회 실패.
 * 순수 모듈(접근 판정 `access.ts`를 모킹하는 시험에서도 진짜 분류를 쓰게 따로 둔다).
 */
export type CareFailure = "denied" | "unavailable" | "error";
export class CareAccessError extends Error {
  constructor(message: string, readonly reason: CareFailure) {
    super(message);
    this.name = "CareAccessError";
  }
}
export const careFailureOf = (error: unknown): CareFailure => error instanceof CareAccessError ? error.reason : "error";

/** 표·칸·함수가 없을 때 PostgREST·Postgres가 내는 코드 — SQL을 아직 적용하지 않은 DB. */
const STORAGE_MISSING = ["42P01", "42703", "PGRST204", "PGRST205", "PGRST202"];
export const isCareStorageMissing = (error: { code?: string } | null | undefined) => STORAGE_MISSING.includes(error?.code ?? "");
