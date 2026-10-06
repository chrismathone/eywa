import { extractReadToken } from "./classnote-read-core.mjs";

/**
 * **보고서 글에 댓글로 올린 영상 → 그 보고서의 숙제**(원장 2026-10-06).
 *
 * 원장: *"몇일자 숙제라는 정보가 있지 … 해당 수업보고서에 숙제 보고서 고유의 링크 주소가 있는데"* ·
 *       *"해당 숙제 보고서 고유의 링크 주소가 있는 보고서에 영상을 업로드하면 무조건 체킹가능하지."*
 *
 * 수업 보고서 글의 본문에는 그 보고서의 공유 주소(`/r/{share_token}`)가 들어 있다(읽음 연동이 쓰는 그 열쇠 —
 * `classnote-read-core.mjs`). 학부모가 그 글에 **댓글로** 영상을 올리면, 댓글이 달린 글이 어느 보고서인지 = 어느 반 · 며칠 수업의
 * 숙제인지가 정해진다. 그 값을 영상 줄의 `route`(`classId` · `homeworkDate`)에 실으면 영상 제출 현황이 올리기 사이트에서
 * 숙제를 골라 올린 영상과 **같은 길**로 그 숙제 칸에 붙인다(`src/features/video-homework/rounds.ts` ③ — 새 판정 없음).
 *
 * 🔴 묶는 조건은 전부 DB로 확인한다(글 본문의 주소만 믿지 않는다):
 *    같은 지점의 보고서 · **그 영상의 학생**의 보고서 · 반이 있는 보고서 · **'영상 과제 있음'**(`video_homework = true`).
 *    하나라도 아니면 묶지 않는다 — 그 영상은 예전처럼 "가장 오래된 미확인 숙제부터" 규칙을 탄다.
 *    (영상 과제가 없는 보고서 글에 올린 영상을 그 반으로 끌어오지 않는다 — JJ 반 보고서 글에 올린 정규반 숙제 영상이 길을 잃는다.)
 * ⚠️ 학부모가 **새 글**로 올리거나 다른 글에 올린 영상은 대상이 아니다(종전 규칙). 글에 적은 날짜 문구는 읽지 않는다.
 * ⚠️ 지난 숙제 영상을 **더 최근 보고서 글**에 올리면 그 최근 보고서의 숙제로 묶인다(그 글에도 영상 과제가 있을 때) — 원장이 정한 규칙이다.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** 댓글이 달린 글 → 그 글이 aywa 수업 보고서면 공유 토큰(소문자). 아니면 null. */
export function commentedReportToken(post) {
  const parsed = extractReadToken(post?.content);
  return parsed?.kind === "aywa" && UUID.test(parsed.token) ? parsed.token : null;
}

/**
 * 댓글이 달린 글을 읽어(GET) 보고서 토큰을 돌려준다 — `{ token, unread }`.
 *  · 글이 없거나(404) 보고서 글이 아니면 `{ token: null, unread: false }` — 묶을 것이 없다(예전 판정).
 *  · 읽지 못하면(그 밖의 응답 · 30초 무응답) 한 번 더 해 보고, 그래도 안 되면 던지지 않고 `{ token: null, unread: true }` —
 *    다시 할지 연결 없이 보관할지는 부르는 쪽(`video-worker.mjs`)이 정한다.
 * 🔴 시간 제한을 빼지 말 것 — 응답이 안 오면 그 작업이 임대만 갱신하며 매달려 영상 워커 전체가 멈춘다(조회마다 30초 · 최대 두 번).
 * 🔴 **페이지가 닫혀서** 난 오류는 '글을 못 읽음'이 아니다(피드 페이지는 폴러와 함께 쓰고, 폴이 실패하면 폴러가 닫는다) — 던진다.
 *    삼키면 집은 횟수가 한도를 넘은 작업이 연결 없이 보관돼 숙제 연결을 영영 잃는다. 던지면 작업 전체가 다음 주기에 다시 돈다.
 */
export async function readCommentedReportToken(page, postId) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const post = await page.evaluate(async (id) => {
        const response = await fetch(`/api/v1/reports/${id}/`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
        if (response.status === 404) return null;
        if (!response.ok) throw new Error(`글 조회 실패 HTTP ${response.status}`);
        return response.json();
      }, String(postId));
      return { token: commentedReportToken(post), unread: false };
    } catch (error) {
      if (page.isClosed?.()) throw error;
      // 그 밖의 실패는 한 번 더 해 본다
    }
  }
  return { token: null, unread: true };
}

/**
 * 토큰으로 찾은 보고서 줄 → 묶을 숙제(`{ classId, homeworkDate }`) 또는 null(순수).
 * 🔴 줄이 정확히 하나일 때만 — 토큰은 유니크라 둘일 수 없지만, 둘이면 고르지 않는다.
 */
export function pickCommentedReport(rows, studentId) {
  if (!studentId || !Array.isArray(rows) || rows.length !== 1) return null;
  const row = rows[0];
  if (String(row?.student_id ?? "") !== String(studentId)) return null;
  if (row?.video_homework !== true || !row?.class_id) return null;
  const date = typeof row.report_date === "string" ? row.report_date : "";
  return DATE.test(date) ? { classId: String(row.class_id), homeworkDate: date } : null;
}

/**
 * 그 영상이 댓글로 달린 글의 보고서(있으면) — DB는 SELECT만, 지점으로 좁힌다.
 * 댓글 영상이 아니거나 토큰이 없으면 조회하지 않는다. DB 오류는 삼키지 않는다(작업이 실패로 남아 다음 주기에 다시 한다).
 */
export async function loadCommentedReport(sql, tenantId, video, studentId) {
  const token = String(video?.reportToken ?? "").toLowerCase();
  if (!video?.commentId || !studentId || !UUID.test(token)) return null;
  const rows = await sql`select student_id, class_id, video_homework, to_char(report_date, 'YYYY-MM-DD') as report_date
    from lesson_reports where tenant_id = ${tenantId} and share_token = ${token} limit 2`;
  return pickCommentedReport(rows, studentId);
}
