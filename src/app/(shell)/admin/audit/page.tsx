import { redirect } from "next/navigation";

// 구 /admin/audit → 학원 설정 "감사로그" 면으로 이전(2026-06-20 admin→owner 병합).
// 본문은 owner/_components/audit-face.tsx로 흡수.
export default function AuditRedirect() {
  redirect("/owner?tab=audit");
}
