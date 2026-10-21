"use client";

import { Button } from "@/components/ui/button";
import { isSiteName, SITE_MAX_VIDEOS_PER_HOMEWORK, SITE_NAME_MAX, type SiteBranch, type SiteChoice } from "@/features/video-submit/site";

/**
 * 숙제 영상 올리기 사이트(`/v`)의 화면 조각 — 상태 없이 받은 값만 그린다(판단·요청은 `video-site-form.tsx`).
 * 학생 폰이 기본이라 한 열·큰 버튼이다. 문구는 전부 한글이고, 학생·반 번호는 여기까지 오지 않는다.
 */
const INPUT = "border-line bg-background focus:border-primary h-14 w-full rounded-lg border px-4 text-center font-bold outline-none";

/** 지점 고르기 — 지금 사이트를 쓸 수 있는 지점만 선다. */
export function SiteBranchChooser({ branches, onPick }: { branches: SiteBranch[]; onPick: (id: string) => void }) {
  return (
    <div className="space-y-3">
      <p className="text-foreground text-base font-bold break-keep">다니는 지점을 골라 주세요</p>
      <ul className="space-y-2" aria-label="지점 선택">
        {branches.map((b) => (
          <li key={b.id}>
            <Button type="button" variant="outline" size="lg" className="h-auto w-full justify-start py-3 text-left text-base font-bold break-keep" onClick={() => onPick(b.id)}>
              {b.name}
            </Button>
          </li>
        ))}
      </ul>
      {/* 잠시 못 받는 지점은 목록에 없다 — 그 지점 학생이 다른 지점을 누르지 않게 알려 준다. */}
      <p className="text-text-dim text-sm break-keep">다니는 지점이 보이지 않으면 잠시 후 다시 열거나 담당 선생님께 알려 주세요.</p>
    </div>
  );
}

/**
 * 번호·이름 입력 칸과 안내 — `<form>` 안에 놓는다(제출은 부모가 받는다).
 * `branchName` = 고른 지점(지점을 고르는 화면일 때만) — '지점 바꾸기'가 함께 선다.
 */
export function SiteAskFields(props: {
  digits: string; name: string; looking: boolean; maxLabel: string; branchName: string | null;
  onDigits: (value: string) => void; onName: (value: string) => void; onChangeBranch: () => void;
}) {
  const { digits, name, looking, maxLabel, branchName, onDigits, onName, onChangeBranch } = props;
  return (
    <>
      {branchName ? (
        <p className="border-line flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
          <span className="text-foreground min-w-0 text-base font-bold break-keep">{branchName}</span>
          <button type="button" className="text-primary shrink-0 text-sm underline underline-offset-4" disabled={looking} onClick={onChangeBranch}>
            지점 바꾸기
          </button>
        </p>
      ) : null}
      <label className="block space-y-2">
        <span className="text-foreground block text-base font-bold break-keep">휴대폰 번호 뒷 4자리</span>
        {/* 16px 이상 — iOS가 입력 때 화면을 확대하지 않게. 숫자 키패드 · 자동완성은 끈다(남의 번호가 남지 않게). */}
        <input
          type="text" inputMode="numeric" pattern="[0-9]*" autoComplete="off" maxLength={4} value={digits}
          onChange={(event) => onDigits(event.target.value.replace(/\D/g, "").slice(0, 4))}
          placeholder="뒷 4자리" aria-label="휴대폰 번호 뒷 4자리"
          className={`${INPUT} text-2xl tracking-[0.4em]`}
        />
      </label>
      <label className="block space-y-2">
        <span className="text-foreground block text-base font-bold break-keep">내 이름</span>
        <input
          type="text" autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} maxLength={SITE_NAME_MAX} value={name}
          onChange={(event) => onName(event.target.value)}
          placeholder="이름" aria-label="내 이름"
          className={`${INPUT} text-xl`}
        />
      </label>
      <Button type="submit" size="lg" className="w-full" disabled={looking || digits.length !== 4 || !isSiteName(name)}>
        {looking ? "찾는 중…" : "다음"}
      </Button>
      <ul className="text-text-dim space-y-1 text-sm break-keep">
        <li>내 번호가 없으면 학원에 알려 준 부모님 번호 뒷 4자리를 넣어 주세요.</li>
        <li>선생님이 낸 영상 숙제가 있으면 그 숙제를 골라 올리고, 없으면 반을 골라 메모와 함께 올립니다.</li>
        <li>영상 한 개에 {maxLabel}까지 올릴 수 있습니다.</li>
        <li>올린 영상은 담당 선생님만 봅니다.</li>
      </ul>
    </>
  );
}

/**
 * 올릴 숙제 고르기 — `openingId` = 지금 여는 중인 줄(있으면 전부 잠근다).
 * 숙제 줄이 먼저, 그 아래 **숙제 없이 올리기**(반마다 한 줄 — 메모와 함께, 2026-10-13).
 */
export function SiteHomeworkChoices({ choices, openingId, onOpen, onReset }: {
  choices: SiteChoice[]; openingId: string | null; onOpen: (id: string) => void; onReset: () => void;
}) {
  // 이름을 가린 표기가 여럿이면(구분 글자만 다른 동명이인) 줄마다 이름도 보여 준다 — 하나뿐이면 반·숙제만으로 충분하다.
  const manyStudents = new Set(choices.map((c) => c.studentLabel)).size > 1;
  const opening = openingId !== null;
  const homework = choices.filter((c) => !c.free);
  const free = choices.filter((c) => c.free);
  return (
    <div className="space-y-3">
      {homework.length ? <p className="text-foreground text-base font-bold break-keep">올릴 숙제를 골라 주세요</p> : null}
      {homework.length ? <ul className="space-y-2">
        {homework.map((choice) => (
          <li key={choice.id}>
            <Button type="button" variant="outline" size="lg" className="h-auto w-full justify-start py-3 text-left" disabled={opening} onClick={() => onOpen(choice.id)}>
              <span className="min-w-0 break-keep">
                <span className="text-foreground block text-base font-bold">{choice.homeworkLabel} 수업 숙제</span>
                {/* 언제까지 내나 — 학생이 숙제일을 내는 날로 헷갈렸다(원장 2026-10-15). 숙제일보다 눈에 띄게 둔다. */}
                {choice.dueLabel ? <span className="text-primary block text-sm font-bold">{choice.dueLabel} 제출</span> : null}
                {/* 이미 낸 숙제도 마감까지 더 올린다(여러 단원 — 원장 2026-10-21). */}
                {choice.sent ? <span className="text-foreground block text-sm">영상 {choice.sent}개 냄 · 더 올릴 수 있어요</span> : null}
                {/* 반을 옮기기 전 반에서 받은 숙제 — 지금 반 이름과 달라 학생이 망설이지 않게 '지난 반'을 붙인다(원장 2026-10-21). */}
                <span className="text-text-dim block text-sm">{manyStudents ? `${choice.studentLabel} · ${choice.className}` : choice.className}{choice.pastClass ? " · 지난 반" : ""}</span>
              </span>
              {openingId === choice.id ? <span className="text-text-dim ml-auto shrink-0 text-sm">여는 중…</span> : null}
            </Button>
          </li>
        ))}
      </ul> : null}
      {homework.length ? <p className="text-text-dim text-sm break-keep">제출 마감이 지난 숙제는 나오지 않습니다. 여러 단원이면 같은 숙제에 영상을 {SITE_MAX_VIDEOS_PER_HOMEWORK}개까지 올릴 수 있습니다.</p> : null}
      {free.length ? <>
        <p className="text-foreground pt-1 text-base font-bold break-keep">{homework.length ? "숙제 목록에 없는 영상이면 반을 골라 주세요" : "올릴 반을 골라 주세요"}</p>
        <ul className="space-y-2">
          {free.map((choice) => (
            <li key={choice.id}>
              <Button type="button" variant="outline" size="lg" className="h-auto w-full justify-start py-3 text-left" disabled={opening} onClick={() => onOpen(choice.id)}>
                <span className="min-w-0 break-keep">
                  <span className="text-foreground block text-base font-bold">{manyStudents ? `${choice.studentLabel} · ${choice.className}` : choice.className}</span>
                  <span className="text-text-dim block text-sm">숙제 없이 올리기 · 메모를 함께 남깁니다</span>
                </span>
                {openingId === choice.id ? <span className="text-text-dim ml-auto shrink-0 text-sm">여는 중…</span> : null}
              </Button>
            </li>
          ))}
        </ul>
      </> : null}
      <Button type="button" variant="ghost" className="w-full" disabled={opening} onClick={onReset}>
        처음으로
      </Button>
    </div>
  );
}
