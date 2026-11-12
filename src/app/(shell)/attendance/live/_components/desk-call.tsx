import { phoneLabel } from "@/lib/format/phone";

/** 전화 링크 — 번호는 하이픈 표기(`phoneLabel`)로 보인다(걸기 전 확인). 테두리 버튼이 아니라 글자만. */
export function DeskCall({ phone, label }: { phone: string | null; label: string }) {
  if (!phone) return <span className="text-text-faint text-xs">{label} 없음</span>;
  const shown = phoneLabel(phone);
  return (
    <a
      href={`tel:${phone.replace(/[^\d+]/g, "")}`}
      title={`${label} ${shown}`}
      className="text-primary num text-xs font-bold whitespace-nowrap"
    >
      {label} {shown}
    </a>
  );
}
