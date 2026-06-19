import { redirect } from "next/navigation";

// 구 /admin/duplicates → 학원 설정 "중복 학생" 면으로 이전(2026-06-20 admin→owner 병합).
// 본문은 owner/_components/duplicates-face.tsx로 흡수. DuplicatesClient(_client.tsx)는 그 면이 재사용하므로 유지.
export default function DuplicatesRedirect() {
  redirect("/owner?tab=dup");
}
