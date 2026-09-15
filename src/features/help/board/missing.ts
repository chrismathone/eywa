/** 0265a 미적용 — 표가 아직 없다(42P01 / PGRST205). */
export function isMissingHelpBoard(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    (/help_posts|help_answers/.test(error.message ?? "") &&
      /not find|does not exist|schema cache/i.test(error.message ?? ""))
  );
}

export const HELP_BOARD_NOT_READY = "게시판 준비 중 — 아직 적용되지 않았습니다.";
