/**
 * "그 컬럼이 아직 없어서 난 오류인가" 판정 — **expand/contract 배포의 핵심 도구**(#95).
 *
 * eywa는 마이그레이션 SQL을 원장이 **손으로** 실행하므로 push와 적용 사이에 **항상 간격**이 있다.
 * 그래서 새 컬럼을 쓰는 코드는 옛 스키마에서도 죽지 않아야 한다 — 이 판정으로 컬럼 부재를 구분해
 * 그 컬럼만 뺀 채 재시도하면, SQL을 늦게 적용해도 본 기능이 함께 무너지지 않는다.
 *
 * PostgREST는 스키마 캐시에 없는 컬럼을 `PGRST204`로, Postgres는 `42703`으로 알린다.
 * (0202a `score`에서 처음 쓰였고 0204a `consent_snapshot`이 같은 패턴을 쓴다.)
 */
export function isMissingColumn(err: { code?: string; message?: string } | null, column: string): boolean {
  if (!err) return false;
  if (err.code === "PGRST204" || err.code === "42703") return true;
  return (err.message ?? "").includes(column) && /column|컬럼/i.test(err.message ?? "");
}
