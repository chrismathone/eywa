"use client";

import { EyIcon } from "@/components/icons/aywa-icons";

type Mode = "off" | "test" | "on";

const OPTIONS: { value: Mode; label: string; hint: string }[] = [
  { value: "off", label: "끔", hint: "답글·공감 버튼과 '학부모 글·답글' 면이 보이지 않고, 연동 PC도 아무것도 올리지 않습니다" },
  { value: "test", label: "시험", hint: "테스트 원아 '학원이'의 글에만 쓸 수 있습니다(테스트반 보드) — 실제 학부모에게는 나가지 않습니다" },
  { value: "on", label: "전체", hint: "담당 선생님과 원장·관리자·매니저가 학부모 글·댓글에 답글과 공감을 남길 수 있습니다" },
];

/**
 * 보고서 설정 > 발송 > 학부모 글 답글·공감(원장 2026-10-01) — 학부모가 ClassNote에 쓴 글·댓글에 aywa에서 답글·공감을 남기는 기능의 단계.
 * 소비처 = 앱 `classnoteReplyMode`(벨 버튼·'학부모 글·답글' 면·서버 액션) + 연동 PC 워커(`loadReplyMode` — 폴마다 다시 읽는다).
 * 🔴 '전체'는 학부모 폰에 바로 알림이 가는 쓰기다 — 워커는 학생·원아·보드 연결이 확정된 글에만 올리고, 하나라도 모르면 올리지 않는다.
 */
export function ClassnoteReplyModeField({ mode, onChange }: { mode: Mode; onChange: (patch: { classnoteParentReplyMode: Mode }) => void }) {
  return (
    <div className="border-line mt-3 border-t pt-3">
      <p className="text-foreground text-sm font-bold">학부모 글 답글·공감</p>
      <p className="text-text-dim mt-0.5 text-xs break-keep">
        학부모가 ClassNote에 쓴 글·댓글에 aywa에서 답글과 공감을 남기면 연동 PC가 그 글에 올립니다. 위 &lsquo;ClassNote 실제 발송 사용&rsquo;이
        꺼져 있으면 올라가지 않습니다.
      </p>
      <div className="mt-2 flex flex-col gap-1.5" role="radiogroup" aria-label="학부모 글 답글·공감">
        {OPTIONS.map((o) => (
          <label key={o.value} className="flex cursor-pointer items-start gap-2 text-sm">
            <input
              type="radio"
              name="classnoteParentReplyMode"
              className="accent-primary mt-1"
              checked={mode === o.value}
              onChange={() => onChange({ classnoteParentReplyMode: o.value })}
            />
            <span>
              <span className="text-foreground font-bold">{o.label}</span>
              <span className="text-text-dim ml-1.5 text-xs break-keep">{o.hint}</span>
            </span>
          </label>
        ))}
      </div>
      {mode === "on" ? (
        <p className="text-danger mt-2 flex items-start gap-1.5 text-xs break-keep">
          <EyIcon name="alert" size={14} className="mt-0.5 shrink-0" />
          <span>답글은 학부모에게 바로 알림이 갑니다. 저장하면 연동 PC가 다음 확인(약 15초)부터 실제 글에 올립니다.</span>
        </p>
      ) : null}
    </div>
  );
}
