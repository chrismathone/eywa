"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { GUARDIAN2_NAME_MAX, GUARDIAN_RELATIONS } from "@/features/students/guardian";
import { Field, inputClass } from "./student-form-field";
import { useModuleOn } from "@/features/owner/operations-context";

/** 보호자2 칸 이름(s2_0022) — 서버 `readForm`이 같은 이름을 읽는다. */
export const GUARDIAN2_FIELD_NAMES = ["parent2Name", "parent2Phone", "parent2Relation"] as const;

export type Guardian2Value = { name: string | null; phone: string | null; relation: string | null };
/** 서버 검증 오류(`readForm` 칸 이름 parent2Name·parent2Phone·parent2Relation) — 칸 아래에 보인다. */
export type Guardian2Errors = { name?: string; phone?: string; relation?: string };

/**
 * 원생 폼 '보호자 연락처'의 둘째 보호자 줄(원장 2026-11-04 — 보호자를 한 명 더). 값이 있으면 처음부터 열려 있고, 없으면
 * '+ 보호자 추가'를 눌러 연다. '삭제'는 세 칸을 비우고 닫는다(저장하면 보호자2가 지워진다).
 *
 * 🔑 칸은 닫혀 있어도 폼 안에 그대로 둔다(숨김만) — 닫힌 줄은 빈 값으로 실려 저장과 화면이 늘 같고, 초안 되살리기도 값을 넣을
 *    자리가 있다. 숨은 칸에 값이 들어오면(초안 되살리기) 줄을 연다 — 보이지 않는 값이 저장되지 않게.
 */
export function Guardian2Field({ initial, errors = {} }: { initial: Guardian2Value; errors?: Guardian2Errors }) {
  const classnoteOn = useModuleOn("classnote");
  const filled = !!(initial.name || initial.phone || initial.relation);
  const [open, setOpen] = useState(filled);
  // 칸 오류는 줄이 닫혀 있어도 보이게 연다 — 단 '삭제'를 누른 뒤엔 닫는다(다음 제출의 폼 리셋에서 풀린다).
  const [dismissed, setDismissed] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const focusOnOpen = useRef(false);
  const hasError = !!(errors.name || errors.phone || errors.relation);
  const shown = open || (hasError && !dismissed);

  // 폼 리셋(React 19는 제출 뒤 폼을 연 때 값으로 되돌린다)이면 칸 값이 연 때 값으로 돌아가니 열림도 연 때로 맞춘다 —
  // '삭제'로 닫은 줄이 숨은 채 옛 값을 다시 싣지 않게.
  useEffect(() => {
    const form = rowRef.current?.closest("form");
    if (!form) return;
    const onReset = () => {
      setOpen(filled);
      setDismissed(false);
    };
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  }, [filled]);

  useEffect(() => {
    if (shown && focusOnOpen.current) {
      focusOnOpen.current = false;
      nameRef.current?.focus();
    }
  }, [shown]);

  const controls = () =>
    GUARDIAN2_FIELD_NAMES.map((n) => rowRef.current?.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${n}"]`) ?? null);

  const remove = () => {
    const els = controls();
    for (const el of els) if (el) el.value = "";
    setOpen(false);
    setDismissed(true);
    // 미저장 가드·초안 자동저장은 폼의 input 이벤트로 바뀐 것을 안다 — 코드로 비운 값은 이벤트가 없으니 대신 낸다.
    els[0]?.dispatchEvent(new Event("input", { bubbles: true }));
  };

  return (
    <div
      ref={rowRef}
      className="space-y-2 sm:col-span-2 lg:col-span-3"
      onInput={() => {
        if (!shown && controls().some((el) => el?.value)) setOpen(true);
      }}
    >
      <div hidden={!shown} className="space-y-2">
        <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="보호자2 이름" htmlFor="parent2Name" error={errors.name}>
            <input
              ref={nameRef}
              id="parent2Name"
              name="parent2Name"
              maxLength={GUARDIAN2_NAME_MAX}
              defaultValue={initial.name ?? ""}
              className={inputClass}
              placeholder="예: 김어머니"
            />
          </Field>
          <Field label="보호자2 연락처" htmlFor="parent2Phone" error={errors.phone}>
            <input
              id="parent2Phone"
              name="parent2Phone"
              type="tel"
              inputMode="tel"
              defaultValue={initial.phone ?? ""}
              className={inputClass}
              placeholder="010-1234-5678"
            />
          </Field>
          <Field label="보호자2 관계" htmlFor="parent2Relation" error={errors.relation}>
            <select id="parent2Relation" name="parent2Relation" defaultValue={initial.relation ?? ""} className={inputClass}>
              <option value="">선택</option>
              {GUARDIAN_RELATIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {/* 안내(원장 2026-11-05 — 지금 해당 0명이지만 혹시 모를 경우): 형제 판정·중복 후보는 보호자2 번호도 본다(siblings.ts
            `guardianPhoneKeys`), 보호자2를 원아 대조에 쓰는 연동 PC 판도 준비 중이다. */}
        <p className="text-text-dim text-xs leading-relaxed">
          보호자2에는 이 아이 집의 보호자 번호를 적어 주세요. 다른 집 아이와 함께 쓰는 번호(예: 사촌을 함께 돌보는 할머니 번호)를 적으면{" "}
          {classnoteOn ? "그 아이와 형제로 묶이고, ClassNote 원아 연결도 헷갈릴 수 있습니다." : "그 아이와 형제로 묶일 수 있습니다."}
        </p>
        <div className="flex justify-end">
          <Button type="button" variant="ghost" size="sm" onClick={remove} aria-label="보호자2 삭제">
            삭제
          </Button>
        </div>
      </div>
      {shown ? null : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            focusOnOpen.current = true;
            setOpen(true);
          }}
        >
          + 보호자 추가
        </Button>
      )}
    </div>
  );
}
