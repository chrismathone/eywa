// 급여 기능 전체 on/off — 단일 소스(사용자 결정 2026-07-07: 급여 비활성화).
// false = "월별 급여"·개인별 "급여 정산" 버튼 숨김 + 라우트 가드(진입 시 /staff로 리다이렉트).
// 코드·DB(payroll 테이블)는 보존 → 복구는 이 값을 true로 되돌리면 끝(버튼·라우트 즉시 부활).
// ⚠️ 휴가(leaves)는 이 플래그와 무관 — 아래 STAFF_LEAVES_ENABLED가 따로 잡는다.
export const PAYROLL_ENABLED = false;

// 옛 '휴가 관리'(staff_leaves) 진입점 on/off — 단일 소스(원장 지시 2026-08-25: 휴가는 전자결재에서 관리).
// false = 직원목록·직원 상세·근무 설정의 '휴가' 버튼 숨김. 복구는 이 값을 true로 되돌리면 끝.
// ⚠️ 라우트(/staff/leaves·/staff/[id]/leaves)는 **일부러 안 막았다** — 이 표에 남은 옛 기록이 있으면
//    URL로는 계속 읽혀야 한다(숨김은 잠금이 아니다, gotcha #77). 신규 신청은 전자결재(/approvals)로.
// ⚠️ 운영실 '오늘 할 일'의 휴가 승인·오늘 휴가 신호는 staff_leaves 행이 있을 때만 뜬다(데이터 기반) —
//    이 플래그와 무관하니, 그 신호를 끄려면 별도 결정이 필요하다.
export const STAFF_LEAVES_ENABLED = false;
