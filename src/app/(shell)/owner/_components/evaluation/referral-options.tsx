"use client";

import { REFERRAL_ATTRIBUTION_LABEL, referralOptionsSchema, type ReferralOptions } from "@/features/teacher-portfolio/evaluation/options";

/**
 * 원생 소개의 세는 법(원장 결정 7) — 소개한 원생의 상담일 담임 **누구에게** 1건을 주나. 직원이 직접 소개했으면 늘 그 직원이다.
 * ⚠️ 학생을 **세는** 법이라 미리보기(저장된 수치에 점수 규칙만 얹는다)엔 안 보이고, 저장 뒤 다시 매긴 점수에 반영된다.
 */
export function ReferralOptionsEditor({ value, onChange, label }: { value: ReferralOptions; onChange: (next: ReferralOptions) => void; label: string }) {
  const options = referralOptionsSchema.shape.attribution.options;
  return (
    <fieldset className="space-y-2 rounded-lg border border-line-faint px-3 py-2.5">
      <legend className="px-1 text-sm font-medium">세는 법</legend>
      <p className="text-xs">소개한 원생의 상담일 담임 중 누구에게 1건을 줄지(직원이 직접 소개했으면 그 직원):</p>
      <div className="flex flex-col gap-1.5 text-sm">
        {options.map((o) => (
          <label key={o} className="flex items-center gap-1.5">
            <input type="radio" className="size-4" name={`${label}-referral-attribution`} aria-label={`${label} — ${REFERRAL_ATTRIBUTION_LABEL[o]}`}
              checked={value.attribution === o} onChange={() => onChange({ ...value, attribution: o })} />
            {REFERRAL_ATTRIBUTION_LABEL[o]}
          </label>
        ))}
      </div>
      <p className="text-xs">신규 콜&상담에서 소개한 사람을 원생·직원으로 이은 상담만 셉니다. 이 칸을 바꾸면 미리보기엔 보이지 않고, 저장한 뒤 다시 매긴 점수에 반영됩니다.</p>
    </fieldset>
  );
}
