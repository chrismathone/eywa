"use client";

import { useGradeLevels } from "@/features/owner/operations-context";
import { Field, SELECT } from "./form-bits";

/**
 * 수학 교재 학년·학기 — 진도 카드가 이 값으로 교재를 줄 세운다(원장 2026-10-22 *"교재 등록 시 수학은 학년도"*).
 * 고등 제목(`가우스 공통수학1 01. …`)엔 학년이 없어서 이 칸이 없으면 카드 순서에 못 선다.
 *
 * 🔑 선택지는 학원설정 학년(`operations.gradeLevels`)에서 만든다 — 코드에 학년 목록을 적지 않는다.
 *    `초3`·`중2`·`고1`처럼 학교급+숫자인 학년만 1·2학기로 편다(`6세`·`7세`는 교재 학년이 아니다).
 * ⚠️ 저장된 값이 학원설정에 없는 학년이면 그 값도 선택지에 남긴다(안 남기면 열기만 해도 값이 지워진다).
 */
export function GradeTermField({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  const levels = useGradeLevels();
  const terms = levels
    .filter((g) => /^[초중고][1-6]$/.test(g))
    .flatMap((g) => [`${g}-1`, `${g}-2`]);
  if (value && !terms.includes(value)) terms.unshift(value);

  return (
    <Field label="학년·학기" hint="진도 카드가 이 순서로 다음 교재를 잇습니다. 고등은 공통수학1=고1-1 · 공통수학2=고1-2 · 대수=고2-1 · 미적분I=고2-2.">
      <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className={SELECT}>
        <option value="">미지정</option>
        {terms.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
    </Field>
  );
}
