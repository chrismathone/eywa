// 급여 기능 전체 on/off — 단일 소스(사용자 결정 2026-07-07: 급여 비활성화).
// false = "월별 급여"·개인별 "급여 정산" 버튼 숨김 + 라우트 가드(진입 시 /staff로 리다이렉트).
// 코드·DB(payroll 테이블)는 보존 → 복구는 이 값을 true로 되돌리면 끝(버튼·라우트 즉시 부활).
// ⚠️ 휴가(leaves)는 이 플래그와 무관(계속 활성).
export const PAYROLL_ENABLED = false;
