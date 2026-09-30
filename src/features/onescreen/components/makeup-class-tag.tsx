"use client";

/**
 * 보강 줄의 **보강 반** 표시 — 원장 2026-09-30 *"보강건 반 배정 적용되면 보강으로 되어있어도 출석부나 모든 곳에 반이 배정되어있겠지?"*.
 * 보강 묶음에 서 있어도 **어느 반으로 들어가는지**(보고서 발송 반 = 출석부 칸의 반, `makeup_class_id`)를 줄마다 보인다.
 *  · 반이 정해졌으면 반 이름(이름을 모르면 '반 지정됨' — 앵커는 있고 이름만 이 화면 반 목록 밖이다).
 *  · 반이 없으면 **'반 미정'** — 반별 발송 대상이면 저장·발송이 막힌다(서버 `prepareMakeupAnchor`). 누르면 반을 고른다.
 * ⚠️ 반 이름은 로스터가 이미 가진 값(반 목록·명단 세션)만 쓴다 — 핫패스라 새 조회를 하지 않는다([[#95]]).
 */
import { useSheetT } from "@/features/teacher-view/lang-context";
import type { Subject } from "../types";

export function isPureMakeupRow(subject: Pick<Subject, "makeup" | "classId">): boolean {
  return !!subject.makeup && !subject.classId;
}

export function MakeupClassTag({
  subject,
  onPick,
}: {
  subject: Pick<Subject, "makeup" | "classId" | "makeupClassId" | "makeupClassName">;
  /** 누르면 보강 반 고르기(없으면 표시만). */
  onPick?: () => void;
}) {
  const t = useSheetT();
  if (!isPureMakeupRow(subject)) return null;
  const undecided = !subject.makeupClassId;
  const label = undecided ? t("os.makeupClass.none") : (subject.makeupClassName ?? t("os.makeupClass.set"));
  const tone = undecided ? "bg-danger-soft text-danger" : "border-line text-text-dim border";
  const title = undecided ? t("os.makeupClass.noneTitle") : t("os.makeupClass.setTitle");
  const cls = `inline-flex max-w-[10rem] shrink-0 items-center truncate rounded-pill px-1 py-px text-xs font-bold whitespace-nowrap ${tone}`;
  return onPick ? (
    <button type="button" onClick={onPick} title={title} className={`${cls} cursor-pointer hover:opacity-80`}>
      {label}
    </button>
  ) : (
    <span title={title} className={cls}>
      {label}
    </span>
  );
}
