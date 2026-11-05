"use client";

/**
 * 영어 템플릿 칸의 **인재원 한 줄**(2026-09-11) — 요약(또는 미연결·실패 이유) + '새로 고침'·'다시 불러오기'.
 *
 * 🔑 미연결이면 **어디서 잇는지**를 그 자리에서 알려 준다(사용자 *"이거 연결 어디서 함"*): 짝을 이을 수 있는 사람
 *    (학생 기록 관리 = ijw/server/viewer.ts `canLink`, 원스크린 페이지가 같은 함수로 내려 준다)에겐 짝 잇기 자리로 가는 링크,
 *    아니면 관리자에게 요청하라는 한 줄 — 누를 수 없는 사람에게 링크를 주면 빈 화면(구역이 관리자 전용)으로 간다.
 * 🔑 링크는 **새 탭** — 원스크린(강사 미니셸)엔 창 시스템이 없어 같은 탭으로 가면 쓰던 보고서 화면을 떠난다.
 */
import { useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";

/**
 * 그 행의 인재원 하루치 — 패널 한 줄 요약. 받는 중 · 미연결 · 실패(다시) · 오늘 시험 N건 · 30일 학습 N문제.
 * 🔑 그림 칸 템플릿이 아니어도 보여 준다 — 템플릿을 고르기 전에 "넣을 게 있나"를 알 수 있게.
 */
export type EnglishJjStatus =
  | { kind: "loading" }
  | { kind: "unlinked" }
  | { kind: "error"; detail: string }
  | { kind: "ok"; exams: number; answers: number };

/** 짝 잇기 자리 — 성적관리 › 영어 › JJ실 맨 아래(exams/input/page.tsx의 `#jj-link`, 관리자 전용 구역).
 *  옛 `/exams?…type=jj`는 리다이렉트를 한 번 더 거쳐 스켈레톤이 두 번 떴다(2026-11-05) — 입력 화면으로 바로 간다. */
export const JJ_LINK_HREF = "/exams/input?subject=english&type=jj#jj-link";

export function JjStatusLine({
  jj,
  canLink,
  onRetry,
}: {
  jj: EnglishJjStatus;
  canLink: boolean;
  onRetry: () => void;
}) {
  const t = useSheetT();
  const tf = useSheetTf();
  if (jj.kind === "loading") return <p className="text-text-faint text-xs">{t("os.tpl.jjLoading")}</p>;
  const reload = (
    <button type="button" onClick={onRetry} className="text-primary underline underline-offset-2">
      {t("os.tpl.jjReload")}
    </button>
  );
  if (jj.kind === "unlinked") {
    return (
      <p className="text-text-faint flex flex-wrap items-center gap-1.5 text-xs" title={t("os.tpl.jjUnlinkedTitle")}>
        {t("os.tpl.jjUnlinked")}
        {canLink ? (
          <a
            href={JJ_LINK_HREF}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary font-bold underline underline-offset-2"
          >
            {t("os.tpl.jjLinkGo")}
          </a>
        ) : (
          <span className="text-text-dim font-bold">{t("os.tpl.jjAskAdmin")}</span>
        )}
        {reload}
      </p>
    );
  }
  if (jj.kind === "ok") {
    return (
      <p className="text-text-dim flex flex-wrap items-center gap-1.5 text-xs">
        {tf("os.tpl.jjSummary", { exams: jj.exams, answers: jj.answers })}
        {reload}
      </p>
    );
  }
  return (
    <p className="text-amber flex flex-wrap items-center gap-1.5 text-xs font-bold" title={jj.detail}>
      {t("os.tpl.jjFailed")}
      <button type="button" onClick={onRetry} className="text-primary underline underline-offset-2">
        {t("os.tpl.jjRetry")}
      </button>
    </p>
  );
}
