/** 전화 링크 — 번호는 그대로(걸기 전 확인). 테두리 버튼이 아니라 글자만. */
export function DeskCall({ phone, label }: { phone: string | null; label: string }) {
  if (!phone) return <span className="text-text-faint text-xs">{label} 없음</span>;
  return (
    <a
      href={`tel:${phone.replace(/[^\d+]/g, "")}`}
      title={`${label} ${phone}`}
      className="text-primary num text-xs font-bold whitespace-nowrap"
    >
      {label} {phone}
    </a>
  );
}
