import { EyIcon } from "@/components/icons/aywa-icons";

/** 예시 화면 속 체크 표시 — 글자(✓) 대신 앱 아이콘을 쓴다(아이콘 가드). 크기는 CSS가 주변 글자 크기(1.1em)에 맞춘다. */
export function Ck() {
  return <EyIcon name="check" className="ck" size={16} strokeWidth={3} />;
}
