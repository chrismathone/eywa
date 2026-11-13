"use client";

/**
 * 관리자 직접 작성의 **보낼 반** — 원장 2026-09-30 *"관리자 화면은 반 선택해서 발송할 수 있게 반 선택 추가. (학생 고르고 난 후에
 * 반 고르기 나오는 식으로)"*. 재료는 서버 `getAdminSendClassOptions`(발송과 같은 판정) — 여긴 보여 주고 고르게만 한다.
 * - 반별 발송이 아니면(ClassNote 모듈 꺼짐·경로 '기존'·수학 아님) 아무것도 안 그린다(예전 그대로).
 * - 보고서 반(또는 강사가 보강 추가 때 고른 반 — 원장 2026-09-30)에 살아 있는 반 보드가 있으면 그 반을 알려만 준다.
 * - 🔴 보강 추가한 반에 이 학생의 반 보드가 없어 다른 반으로 가야 하면 경고 한 줄을 띄운다.
 * - 없으면 반 고르기(기본 = 메인 수업) · 고를 반이 없으면 발송 불가 사유.
 * 🔴 원장 2026-09-30 *"보고서 반 = 출석부 반"*: 반 없는 보강에서 고른 반은 **보강 반**이 된다 — 그 반으로 발송되고 출석부 보강 칸도
 *    그 반에 선다(서버 `prepareMakeupAnchor`). 정규 보고서의 반 보드가 없으면 고르지 않고 막는다(`blockedReason`).
 */
export type SendClassOption = {
  applies: boolean;
  needed: boolean;
  reportClassName: string | null;
  candidates: { id: string; name: string }[];
  defaultId: string | null;
  blockedReason: string | null;
  /** 막혔지만 발송을 누르면 서버가 그 반·학생의 반 보드 동기화를 요청한다(배정 중·새 반·학부모 가입 대기) — 버튼을 잠그지 않는다. */
  requestable?: boolean;
  /** 보강 추가한 반으로 간다(needed=false, reportClassName = 그 반). */
  viaMakeup?: boolean;
  deliveryOnly?: boolean;
  /** 보강 추가한 반인데 반 보드가 없어 다른 반으로 가야 한다 — 그 반 이름. */
  makeupClassName?: string | null;
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
        보낼 반: <b className="text-text-dim">{option.reportClassName ?? "보고서의 반"}</b>{" "}
        {option.viaMakeup ? "(보강 반 · ClassNote 반 보드 · 출석부 보강 칸도 이 반)" : "(ClassNote 반 보드)"}
      </p>
    );
  }
  // 보강 추가한 반과 다른 반으로 간다(그 반에 이 학생의 반 보드가 없다) — 원장 2026-09-30.
  const mismatch = option.makeupClassName ? (
    <p role="alert" className="bg-amber-soft text-foreground mb-1 rounded-md px-3 py-2 text-xs font-bold">
      보강 반({option.makeupClassName})으로는 이 학생의 보고서를 보낼 수 없습니다. 반 설정과 학생의 ClassNote 반 보드 연결을 확인해 주세요.{" "}
      {option.deliveryOnly ? "고른 반으로 보고서만 전달하며 보강 반과 출결·시수 기록은 유지됩니다." : "고른 반으로 출석부 보강 칸도 옮겨집니다."}
    </p>
  ) : null;
  if (!option.candidates.length) {
    return (
      <>
        {mismatch}
        {/* 발송을 누르면 배정을 요청하는 까닭은 '막힘'이 아니라 '안내'로 보인다(누를 수 있다). */}
        <p
          role="alert"
          className={
            option.requestable
              ? "bg-amber-soft text-foreground rounded-md px-3 py-2 text-xs"
              : "border-danger/30 bg-danger-soft/40 text-danger rounded-md border px-3 py-2 text-xs"
          }
        >
          {option.blockedReason}
        </p>
      </>
    );
  }
  return (
    <div className="max-w-sm">
      {mismatch}
      <div className={LABEL}>{option.deliveryOnly ? "보고서를 보낼 반" : "보강 반"}(ClassNote 반 보드)</div>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={INPUT} aria-label="보강 반">
        {value ? null : <option value="">반을 고르세요</option>}
        {option.candidates.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
            {c.id === option.defaultId ? " (메인 수업)" : ""}
          </option>
        ))}
      </select>
      <p className="text-text-faint mt-0.5 text-xs">{option.deliveryOnly ? "고른 반은 보고서를 전달할 경로입니다. 보강 반과 출결·시수는 바뀌지 않습니다." : "반 없는 보강입니다 — 고른 반으로 보고서가 발송되고 출석부 보강 칸도 그 반에 섭니다."}</p>
    </div>
  );
}
