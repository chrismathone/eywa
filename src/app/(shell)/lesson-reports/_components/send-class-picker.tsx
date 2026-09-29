"use client";

/**
 * 관리자 직접 작성의 **보낼 반** — 원장 2026-09-30 *"관리자 화면은 반 선택해서 발송할 수 있게 반 선택 추가. (학생 고르고 난 후에
 * 반 고르기 나오는 식으로)"*. 재료는 서버 `getAdminSendClassOptions`(발송과 같은 판정) — 여긴 보여 주고 고르게만 한다.
 * - 반별 발송이 아니면(ClassNote 모듈 꺼짐·경로 '기존'·수학 아님) 아무것도 안 그린다(예전 그대로).
 * - 보고서 반에 살아 있는 반 보드가 있으면 그 반을 알려만 준다.
 * - 없으면 반 고르기(기본 = 메인 수업) · 고를 반이 없으면 발송 불가 사유.
 */
export type SendClassOption = {
  applies: boolean;
  needed: boolean;
  reportClassName: string | null;
  candidates: { id: string; name: string }[];
  defaultId: string | null;
  blockedReason: string | null;
};

const LABEL = "text-text-dim text-xs font-medium";
const INPUT = "border-border bg-card text-foreground rounded-lg border px-2.5 py-1.5 text-sm w-full";

export function SendClassPicker({
  option,
  pending,
  value,
  onChange,
}: {
  option: SendClassOption | null;
  pending: boolean;
  value: string;
  onChange: (id: string) => void;
}) {
  if (pending && !option) return <p className="text-text-faint text-xs">보낼 반을 확인하는 중…</p>;
  if (!option?.applies) return null;
  if (!option.needed) {
    return (
      <p className="text-text-faint text-xs">
        보낼 반: <b className="text-text-dim">{option.reportClassName ?? "보고서의 반"}</b> (ClassNote 반 보드)
      </p>
    );
  }
  if (!option.candidates.length) {
    return (
      <p role="alert" className="border-danger/30 bg-danger-soft/40 text-danger rounded-md border px-3 py-2 text-xs">
        {option.blockedReason}
      </p>
    );
  }
  return (
    <div className="max-w-sm">
      <div className={LABEL}>보낼 반(ClassNote 반 보드)</div>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={INPUT} aria-label="보낼 반">
        {value ? null : <option value="">반을 고르세요</option>}
        {option.candidates.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
            {c.id === option.defaultId ? " (메인 수업)" : ""}
          </option>
        ))}
      </select>
      <p className="text-text-faint mt-0.5 text-xs">이 보고서의 반에 ClassNote 반 보드가 없어 보낼 반을 정합니다(보강 등).</p>
    </div>
  );
}
