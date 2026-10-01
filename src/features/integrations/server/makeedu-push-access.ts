import "server-only";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import type { SystemRole } from "@/lib/permissions";

/**
 * makeedu 역동기화(QR 접수 상담 → makeedu 예비상담) **수동 전송** 게이트 — 단일 소스(#77).
 *
 * 쓰는 곳 셋이 같은 함수를 지난다: 전송 서버 액션(`enqueueConsultationPush`) · 콜&상담 머리글
 * 'makeedu 보내기' 버튼(페이지가 그릴지 · 후보 조회 섹션이 다시 한 번). 화면만 감추면 액션 id로 우회된다.
 *
 * = `integrations` 액션 권한 키 쓰기(기본 master·admin·manager, 역할·권한 면에서 조정).
 * 🔑 **모듈이 꺼진 지점도 여기서 막힌다** — makeedu 모듈의 메뉴키가 `integrations`라 권한 매트릭스 맨 끝
 *    (`capDisabledModules`)에서 전 역할 `none`이 된다(원장 override·개인 예외·super_admin 병합으로도 못 연다).
 *    '다른 강사 뷰'(열람 전용)도 canWriteTenant가 막는다.
 */
export async function canPushToMakeedu(role: SystemRole): Promise<boolean> {
  return canWriteTenant(role, "integrations");
}
