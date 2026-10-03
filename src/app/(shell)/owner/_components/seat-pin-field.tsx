"use client";

import { useId } from "react";
import { PasswordInput } from "@/components/ui/password-input";

/**
 * 자리 출석부 공개 PIN 한 칸 — **기본 마스킹**(눈 버튼으로 잠깐 보기). 운영 설정 편집자에게만 선다.
 *
 * 🔴 `autoComplete="new-password"` + 비밀번호 관리자 무시 속성 — 비밀번호 칸이 되면 브라우저가 **저장해 둔 로그인
 *    비밀번호**를 여기에 채울 수 있다. 채워진 채로 운영 설정을 저장하면(다른 칸을 고치려던 저장이어도 운영 섹션 전체가
 *    실려 간다) 자리 PIN이 조용히 바뀐다. `name`도 달지 않는다(로그인 칸으로 읽힐 단서를 주지 않는다).
 * 🔴 라벨은 `<label htmlFor>`로 **입력에만** 잇는다 — 공용 `Field`처럼 `<label>`로 통째 감싸면 눈 버튼의
 *    "비밀번호 표시"가 칸의 접근성 이름에 섞인다. 안내 문구는 `aria-describedby`.
 * ⚠️ 화면 마스킹은 어깨 너머·화면 공유 수준의 방어다 — 편집자의 폼 payload에는 값이 실려 있다(저장하려면 필요하다).
 *    읽기 전용 열람자에게는 이 칸 자체가 없고 값도 내려가지 않는다(`seat-pin-view.ts`).
 */
export function SeatPinField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className="block">
      <label htmlFor={id} className="text-foreground text-xs font-bold">
        {label}
      </label>
      {hint ? (
        <span id={hintId} className="text-text-dim ml-2 text-xs">
          {hint}
        </span>
      ) : null}
      <div className="mt-1">
        <PasswordInput
          id={id}
          aria-describedby={hint ? hintId : undefined}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="비우면 꺼짐"
          // 스키마 상한(settings-types `seatPins` max 12)과 같은 길이 — 긴 값이 통째로 붙여 넣어지지 않게.
          maxLength={12}
          autoComplete="new-password"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          data-1p-ignore=""
          data-lpignore="true"
          data-bwignore="true"
          data-form-type="other"
          // 옆 칸(fields.tsx inputCls)과 같은 높이·테두리로 맞춘다 — 공용 Input 기본(h-8·rounded-lg)과 다르다.
          // ⚠️ 가로 여백은 왼쪽만(`pl-3`) 준다 — `px-3`을 주면 PasswordInput의 `pr-9`(눈 버튼 자리)를 덮어 글자가 버튼 밑으로 들어간다.
          className="border-line text-foreground focus-visible:border-primary h-auto rounded-md py-2 pl-3 text-sm focus-visible:ring-0"
        />
      </div>
    </div>
  );
}

/** 읽기 전용 열람자에게 보이는 자리 한 줄 — 값 없이 '설정됨 / 꺼짐'만. */
export function SeatPinStatusRow({ label, on }: { label: string; on: boolean }) {
  return (
    <div className="border-line flex items-center justify-between gap-3 rounded-md border px-3 py-2">
      <span className="text-foreground text-xs font-bold">{label}</span>
      <span className={`text-xs font-bold ${on ? "text-primary" : "text-text-faint"}`}>{on ? "설정됨" : "꺼짐"}</span>
    </div>
  );
}
