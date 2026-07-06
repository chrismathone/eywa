"use client";

import { toast } from "sonner";

/**
 * 스케줄·시간 충돌처럼 **저장을 막거나 주의가 필요한 경고**를 화면 상단 가운데(top-center) 토스트로 띄운다.
 *
 * 배경: 강의실/강사 시간 충돌·수강 기간 겹침 같은 경고는 지금까지 폼 하단의 작은 인라인 텍스트로만 떠서,
 * 긴 폼(스케줄 그리드 등)에서 스크롤 밖으로 밀리면 놓치기 쉬웠다(저장이 조용히 안 된 것처럼 보임).
 * 이 헬퍼는 같은 문구를 **눈에 띄는 가운데 알림**으로 병행 노출한다(인라인 표시는 맥락용으로 유지).
 *
 * 전역 Toaster는 top-right지만, 이 토스트만 `position: "top-center"`로 개별 지정한다.
 * ⚠️ 새 스케줄/시간 충돌 경고를 추가할 땐 인라인 표시와 함께 이 헬퍼로 가운데 알림도 띄울 것.
 */
export function conflictToast(message: string) {
  toast.warning(message, { position: "top-center", duration: 6000 });
}
