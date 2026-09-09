/**
 * 연차 조정 서버 액션의 반환 모양 — `useActionState`가 화면으로 나르는 값.
 *
 * 🔑 전자결재의 `ApprovalActionState`와 **모양은 같지만 따로 둔다**: 연차 조정은 결재 문서를 만들지
 *    않아 `docId`가 없고, 화면 자리도 직원관리라 결재 쪽 타입에 매여 있을 이유가 없다(그쪽이 필드를
 *    늘리면 여기까지 딸려 온다).
 * ⚠️ 이 파일엔 `"use server"`도 `import "server-only"`도 붙이지 말 것 — 클라이언트 컴포넌트가 타입으로
 *    읽는다([[#61]]·[[#119]]).
 */
export type LeaveActionState = { ok?: true; error?: string; notice?: string } | undefined;
