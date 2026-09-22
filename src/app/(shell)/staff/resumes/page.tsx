import { redirect } from "next/navigation";

// 이력서 목록은 따로 없다 — 이력서는 직원목록(각 직원 행)과 내 정보에서 연다. 이 주소는 옛 입구라
// 404(영문 기본 화면)를 보이는 대신 직원목록으로 넘긴다(2026-09-22 빈 지점 점검). 권한은 /staff가 다시 본다.
export default function StaffResumesIndexPage() {
  redirect("/staff");
}
