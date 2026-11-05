import { readDisplayOptions, type DisplayOptions } from "./display-options";
import { readOnescreenFontSize, type OnescreenFontSize } from "./font-size";
import { readTemplatePrefs, type TemplatePrefs } from "./last-template";
import { readTrendOptOut } from "./trend-optout";
import { readVideoDueDefault } from "@/features/video-homework/due-pref";
import type { VideoHomeworkDueMode } from "@/features/video-homework/due";

/**
 * 원스크린 개인 설정을 **누구의 행에서** 읽나 — 순수 판정(Vitest). 로스터(`getTeacherRoster`)가 이 함수 하나로 나눈다.
 *
 * 🔑 표시 취향(글씨 크기 · 표시 옵션 · 영상 마감 내 기본값) = **보는 사람**(실제 로그인 계정). 저장이 실제 계정에 간다
 *    (`setMyOnescreenFontSize` · `saveDisplayOptions` · `setMyVideoDueDefault`). '다른 강사 뷰'에서 대상 강사의 행을 읽으면 저장한 값이
 *    화면에 돌아오지 않는다(2026-11-05 강사뷰 신원 적대 리뷰 — ECS `viewer-prefs.ts`와 같은 결정).
 * 🔑 반·보고서에 묶인 값(반별 마지막 템플릿 · 학습 추세 미발송) = **화면 주인**(대상 강사). 키가 그 강사의 반·학생 id이고,
 *    학습 추세 미발송은 학부모에게 나가는 글을 바꾼다 — 보는 사람의 값에는 대상 강사의 반이 없어 기본값으로 무너진다(ECS 반 순서와 같은 이유).
 * ⚠️ 강사뷰가 아니면 두 행은 같은 사람이다 — `viewerPrefs`를 보지 않는다(로스터가 따로 읽지 않는다, 왕복 0).
 */
export type OnescreenPrefSplit = {
  fontSize: OnescreenFontSize;
  displayOptions: DisplayOptions;
  videoDueDefault: VideoHomeworkDueMode;
  trendOptOut: string[];
  templatePrefs: TemplatePrefs;
};

export function splitOnescreenPrefs(input: {
  /** 지금 요청이 '다른 강사 뷰'인가(전체·읽기 모두). */
  viewingOtherTeacher: boolean;
  /** 화면 주인(강사뷰면 대상 강사)의 `users.ui_prefs`. */
  ownerPrefs: unknown;
  /** 보는 사람(실제 계정)의 `users.ui_prefs` — 강사뷰일 때만 의미가 있다. */
  viewerPrefs: unknown;
}): OnescreenPrefSplit {
  const display = input.viewingOtherTeacher ? input.viewerPrefs : input.ownerPrefs;
  return {
    fontSize: readOnescreenFontSize(display),
    displayOptions: readDisplayOptions(display),
    videoDueDefault: readVideoDueDefault(display),
    trendOptOut: readTrendOptOut(input.ownerPrefs),
    templatePrefs: readTemplatePrefs(input.ownerPrefs),
  };
}
