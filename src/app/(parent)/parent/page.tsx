import { redirect } from "next/navigation";

/**
 * `/parent` — 학부모 첫 화면. 지금 내용이 있는 섹션은 탭 2 '변경·확인'(셔틀 등하원)뿐이라 그리로 보낸다.
 * 로그인 착지(`/home`)가 이 주소로 보내므로, 기본 섹션을 바꿀 땐 여기 한 줄만 고친다.
 */
export default function ParentHome() {
  redirect("/parent/rides");
}
