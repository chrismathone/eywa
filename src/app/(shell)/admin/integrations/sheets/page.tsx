import { redirect } from "next/navigation";

// 구 /admin/integrations/sheets → 학원 설정 "연동" 면으로 이전(2026-06-20 admin→owner 병합).
// 본문은 owner/_components/sheets-face.tsx로 흡수. SheetsClient(_client.tsx)는 그 면이 재사용하므로 유지.
export default function SheetsRedirect() {
  redirect("/owner?tab=sheets");
}
