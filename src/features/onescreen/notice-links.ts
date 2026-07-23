/**
 * 공지 이력의 **게시글 링크 라벨** — 순수 규칙(서버 액션이 import, `server-only`/`use client` 금지).
 *
 * 워커가 남기는 `results[]`는 **보드명 기준**(`{board, reports:[{id,url}]}` / 회수는 `{board, revoked:[…]}`)이라
 * 그대로 그리면 "#1 #2 #3"밖에 못 쓴다 — 어느 학생 글인지 알 수 없어 회수·확인에 쓸모가 없다(원장 지적).
 * 큐 행의 `targets[]`가 `board → studentName`을 들고 있으므로 여기서 되붙인다.
 *
 * ⚠️ 이름을 못 찾으면 **보드명에서 과목 접두어만 벗겨** 폴백한다(`(수학)김경민` → `김경민`).
 *    보드명은 학생 이름으로 만들어지므로 폴백도 사람이 읽을 수 있고, 최후에도 raw 코드는 노출하지 않는다.
 */

export type NoticeReportLink = {
  url: string; // 빈 문자열이면 id는 있으나 주소 조립 실패(링크 없이 이름만 표시)
  revoked: boolean;
  name: string; // 학생 이름(같은 보드에 2건이면 "김경민 (2)")
};

type TargetLike = { board?: unknown; studentName?: unknown };

/** `(수학)김경민` → `김경민`. 접두어가 없으면 원문 그대로. */
export function boardStudentName(board: string): string {
  return board.replace(/^\s*\([^)]*\)\s*/, "").trim() || board.trim();
}

/**
 * `results`(워커 산출) × `targets`(발송 시 저장) → 학생 이름이 붙은 게시글 링크 목록.
 * 게시 결과는 `reports[]`, 회수 결과는 `revoked[]`에 들어 있어 둘 다 읽는다.
 */
export function flattenNoticeReportLinks(results: unknown, targets: unknown): NoticeReportLink[] {
  const nameByBoard = new Map<string, string>();
  if (Array.isArray(targets)) {
    for (const t of targets as TargetLike[]) {
      const board = typeof t?.board === "string" ? t.board : "";
      const name = typeof t?.studentName === "string" ? t.studentName.trim() : "";
      if (board && name) nameByBoard.set(board, name);
    }
  }

  if (!Array.isArray(results)) return [];
  const out: NoticeReportLink[] = [];
  for (const r of results as Array<Record<string, unknown>>) {
    const board = typeof r.board === "string" ? r.board : "";
    const base = nameByBoard.get(board) ?? (board ? boardStudentName(board) : "") ?? "";
    const reps = (Array.isArray(r.reports) ? r.reports : Array.isArray(r.revoked) ? r.revoked : []) as Array<
      Record<string, unknown>
    >;
    // 학부모 계정이 둘이면 같은 보드에 2건이 올라간다 — 이름만 두 번 찍히면 중복처럼 보여 순번을 붙인다.
    const multi = reps.length > 1;
    reps.forEach((rep, i) => {
      const url = typeof rep.url === "string" ? rep.url : "";
      if (!url && rep.id == null) return; // 게시 자체가 없던 타깃(실패)은 링크 목록에 넣지 않는다
      out.push({
        url,
        revoked: rep.revoked === true,
        name: `${base || "대상"}${multi ? ` (${i + 1})` : ""}`,
      });
    });
  }
  return out;
}
