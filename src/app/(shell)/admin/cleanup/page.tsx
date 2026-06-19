import { redirect } from "next/navigation";

// 구 /admin/cleanup → 학원 설정 "데이터 정리" 면으로 이전(2026-06-20 admin→owner 병합).
// 본문은 owner/_components/data-face.tsx로 흡수. CleanupClient(_client.tsx)는 그 면이 재사용하므로 유지.
export default function CleanupRedirect() {
  redirect("/owner?tab=data");
}
