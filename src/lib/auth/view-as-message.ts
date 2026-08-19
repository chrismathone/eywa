/**
 * '다른 강사 뷰'(열람 전용) 거절 문구 — **서버 가드(view-as.ts)와 클라 토스트가 같은 문자열**을 쓴다.
 * view-as.ts는 server-only라 클라가 직접 import할 수 없어 순수 모듈로 뺐다(#61 — 문구가 두 벌이면
 * 서버 쪽만 고쳐질 때 클라 토스트가 옛 문구로 남는다).
 */
export const READONLY_TEACHER_VIEW_ERROR =
  "다른 강사 뷰는 열람 전용입니다 — 저장·발송은 관리자뷰 또는 본인 강사뷰에서 해 주세요";
