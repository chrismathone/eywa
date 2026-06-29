import { redirect } from "next/navigation";

// 구 /admin/duplicates → 학원 설정 "데이터 정리" 면으로 이전(중복 학생은 2026-06-29 데이터 정리에 통합).
// 본문은 owner/_components/duplicates-face.tsx로 흡수. DuplicatesClient(_client.tsx)는 그 면이 재사용하므로 유지.
export default function DuplicatesRedirect() {
  redirect("/owner?tab=data");
}
