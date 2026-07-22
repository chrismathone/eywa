"use client";

// 발송 다이얼로그의 상단 조각 — 학원설정 경고 배너 + 멘트 입력칸.
// 배너는 "지금 누르면 무슨 일이 벌어지는지"를 누르기 **전에** 알리는 자리다(사후 토스트로 미루지 않는다).

import { TEXTAREA_AUTOSIZE } from "@/lib/ui/textarea";

export function NoticeBanners({
  attachOff,
  sendOff,
  workerError,
}: {
  attachOff: boolean;
  sendOff: boolean;
  /** 연동 PC 워커가 이미지 첨부 미지원(구버전)일 때의 한글 사유 — 있으면 발송을 막는다. */
  workerError?: string;
}) {
  return (
    <>
      {attachOff ? (
        <p className="border-danger/30 bg-danger-soft text-danger rounded-2xl border px-3 py-2 text-[12px]">
          학원설정 → 보고서 → 표시 항목의 &lsquo;사진/파일 첨부&rsquo;가 꺼져 있습니다 — 이 발송은 요청서·표지
          이미지가 함께 나가므로 설정을 켠 뒤에 보내주세요.
        </p>
      ) : null}
      {workerError ? (
        <p className="border-danger/30 bg-danger-soft text-danger rounded-2xl border px-3 py-2 text-[12px]">
          {workerError}
        </p>
      ) : null}
      {sendOff ? (
        <p className="border-amber/30 bg-amber-soft text-amber rounded-2xl border px-3 py-2 text-[12px]">
          학원설정에서 &lsquo;ClassNote 실제 발송&rsquo;이 꺼져 있습니다 — 지금 누르면 실제로 보내지 않습니다.
        </p>
      ) : null}
    </>
  );
}

export function MentField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1">
      <span className="text-text-dim block text-[12px] font-medium">학부모께 드릴 말씀</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        aria-label="학부모께 드릴 말씀"
        className={`border-line bg-card focus:border-primary min-h-[88px] w-full rounded-lg border p-3 text-[13px] outline-none ${TEXTAREA_AUTOSIZE}`}
      />
      <p className="text-text-faint text-[11px]">
        {"{학생}·{교재명}·{금액}"}은 학생마다 자동으로 채워집니다 · 입력을 멈추면 자동 저장됩니다.
      </p>
    </div>
  );
}
