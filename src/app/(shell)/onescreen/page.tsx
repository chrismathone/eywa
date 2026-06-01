import { requireAccess } from "@/lib/auth/require-access";
import { DEMO_ONESCREEN } from "@/features/onescreen/data";
import { OneScreenClient } from "@/features/onescreen/components/onescreen-client";

export const metadata = { title: "선생님 원스크린 — eywa" };

/**
 * 선생님 원스크린 — 강사 전용 수업 마감 화면.
 * 데모 충실 이식: 서버 컴포넌트는 권한 게이트 + 정적 데모 데이터 주입만 담당.
 * (진도·테스트·보고서 입력은 클라이언트 state, DB 영속화 없음.)
 */
export default async function OneScreenPage() {
  await requireAccess("teacher_onescreen");
  return <OneScreenClient initial={DEMO_ONESCREEN} />;
}
