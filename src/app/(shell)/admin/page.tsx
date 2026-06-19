import { redirect } from "next/navigation";

// 관리자 도구 → 학원 설정(/owner) "관리" 면들로 병합(2026-06-20). 허브는 데이터 정리 면으로 보낸다.
// 북마크·딥링크 보존용 redirect stub. 권한 체크는 도착지(owner = master 전용)가 수행.
export default function AdminRedirect() {
  redirect("/owner?tab=data");
}
