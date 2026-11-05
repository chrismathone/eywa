"use client";

import { useState } from "react";
import { AUTO_STAFF_EMAIL_DOMAIN, DEFAULT_EMAIL_DOMAIN, splitEmailForEdit } from "@/features/staff/email";

/**
 * 로그인 이메일 입력 — **아이디만 고치고 도메인은 고정**(원장 지시 2026-07-30).
 * 전체 주소를 매번 타이핑하면 오타 한 글자로 로그인이 막히는데, 실제로 바뀌는 건 앞부분뿐이다.
 *
 * 도메인을 gmail로 못 박지 않는다 — 네이버 등을 쓰는 직원이 있어서, 그 사람 폼을 열었을 때
 * 도메인이 gmail로 보이면 **저장하는 순간 로그인 주소가 조용히 바뀐다**([`splitEmailForEdit`] 참조).
 * 지금 쓰는 도메인을 그대로 고정으로 들고 오고, 정말 바꿔야 할 때만 '도메인 변경'으로 연다.
 *
 * 제출은 hidden input 한 개(`name`)로 합쳐진 전체 주소 — 서버 액션은 종전 그대로 `email` 하나만 읽는다.
 */
export function EmailIdField({
  name = "email",
  id,
  defaultEmail,
  inputClassName,
  autoComplete = "email",
}: {
  name?: string;
  id?: string;
  /** 현재 이메일(없거나 임시 주소면 아이디는 비고 도메인은 기본값). */
  defaultEmail?: string | null;
  inputClassName?: string;
  autoComplete?: string;
}) {
  const initial = splitEmailForEdit(defaultEmail);
  const [local, setLocal] = useState(initial.local);
  const [domain, setDomain] = useState(initial.domain);
  // gmail이면 도메인을 고정 칩으로(대다수 — 아이디만 고치면 된다).
  // **gmail이 아니면 처음부터 열어 둔다**(원장 지시 2026-07-30) — 네이버 등을 쓰는 사람은
  // 도메인까지 손볼 일이 실제로 있는데, 고정해 두면 한 번 더 눌러야 해서 번거롭다.
  // 자동 생성 로그인 도메인(AUTO_STAFF_EMAIL_DOMAIN)도 사람이 고를 일이 없는 값이라 칩으로 닫아 둔다.
  const [editDomain, setEditDomain] = useState(
    initial.domain !== DEFAULT_EMAIL_DOMAIN && initial.domain !== AUTO_STAFF_EMAIL_DOMAIN,
  );

  const value = local.trim() && domain.trim() ? `${local.trim()}@${domain.trim()}` : "";

  return (
    <div>
      {/* 서버로 나가는 값은 합쳐진 전체 주소 하나 — 액션 계약 불변. */}
      <input type="hidden" name={name} value={value} />
      <div className="flex items-stretch gap-1.5">
        <input
          id={id}
          value={local}
          onChange={(e) => setLocal(e.target.value.trim())}
          placeholder="아이디"
          autoComplete={autoComplete}
          aria-label="이메일 아이디"
          className={`num min-w-0 flex-1 ${inputClassName ?? ""}`}
        />
        <span className="text-text-dim flex shrink-0 items-center text-sm">@</span>
        {editDomain ? (
          <input
            value={domain}
            onChange={(e) => setDomain(e.target.value.trim().toLowerCase())}
            placeholder="gmail.com"
            aria-label="이메일 도메인"
            // 폭은 flex-basis로 잡는다 — 부르는 쪽 inputClassName에 `w-full`이 섞여 오면(내 정보·직원 계정 대화상자)
            // `w-36`이 지고 도메인 칸이 열 너비를 다 먹은 채 줄지 않아(shrink-0) 아이디 칸이 0으로 눌리고 옆 열을 덮었다
            // (원장 제보 2026-11-05). basis는 width보다 우선이고, 좁은 화면에선 아이디 칸과 함께 줄어든다.
            className={`num min-w-0 basis-36 ${inputClassName ?? ""}`}
          />
        ) : (
          <span className="border-line bg-bg-soft/60 text-text-dim num flex shrink-0 items-center rounded-lg border px-2.5 text-sm">
            {domain}
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={() => setEditDomain((v) => !v)}
        className="text-text-faint hover:text-primary mt-1 text-xs underline-offset-2 hover:underline"
      >
        {/* 닫아도 도메인 값은 그대로 — 버튼은 '입력칸을 여닫는' 것일 뿐 도메인을 바꾸지 않는다. */}
        {editDomain ? "도메인 입력칸 닫기" : "도메인 변경"}
      </button>
    </div>
  );
}
