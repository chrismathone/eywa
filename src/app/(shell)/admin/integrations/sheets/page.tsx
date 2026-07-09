import { redirect } from "next/navigation";

// 구 /admin/integrations/sheets → 학원 설정 "연동" 면으로 이전(2026-06-20 admin→owner 병합).
// 본문은 owner/_components/sheets-face.tsx로 흡수(과목별 시트 카드). 이 경로는 리다이렉트만 유지.
export default function SheetsRedirect() {
  redirect("/owner?tab=sheets");
}
