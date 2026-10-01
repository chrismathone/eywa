// scripts/_classnote/parent-reply-api.mjs — 답글(0317a)·공감(0319a)용 ClassNote 요청 헬퍼. 로그인된 봇 페이지에서 page.evaluate fetch + CSRF
// (게시·수정·회수 코어와 같은 방식 — classnote-admin-core `postClassnoteReport`·recall-core `deleteReport`).
//
// 경로(2026-09-30 조사): 작성 `POST kapi…/v1_1/reports/{글}/comments` · 수정 `PATCH …/v1/reports/{글}/comments/{댓글}` ·
// 삭제 `DELETE …/v1/reports/{글}/comments/{댓글}` · 목록 `GET /api/v1/reports/{글}/comments/`(피드 폴러가 쓰는 것).
// 공감(2026-10-01 조사·학원이 글 실측): 글 `POST /api/v1_2/reports/{글}/reactions/` · 댓글 `POST /api/v1/reports/{글}/comments/{댓글}/reactions/`
// 본문 `{reaction_type, author_name}` → 201 `{id, …}` · 풀기 `DELETE …/reactions/{공감 번호}/` → 204(없으면 404) · 종류 `GET /api/v1_2/reactions/types/`.
// 🔑 공감은 **(계정·명의·종류)당 하나**다 — 같은 명의·같은 종류를 다시 보내면 같은 번호가 돌아온다(수는 그대로). 명의가 다르면 같은 봇 계정이어도
//    새 공감이 생긴다. `my_reactions`는 읽을 때 `?author_name=`을 붙여야 그 명의 것이 나온다(안 붙이면 늘 빈 배열).
// 먼저 같은 출처(www `/api/…`)로 보내고 **404·405·리다이렉트면**(= 그 자리엔 엔드포인트가 없다 = 아무것도 안 만들어졌다)
// kapi 호스트로 한 번 더 보낸다. 🔴 다른 실패(400·5xx 등)는 다음 경로로 넘기지 않는다 — 이미 만들어졌을 수 있어서다.
// ⚠️ 리다이렉트는 따라가지 않는다(`redirect:"manual"`) — POST가 GET으로 바뀌어 목록 200을 "작성 성공"으로 읽는 사고 방지.
//
// 🔴 쓰기(`writeComment`·`deleteComment`·`writeReaction`·`deleteReaction`)는 **허가증**(parent-reply-guard `evaluateReplyTarget`이 발급한 객체)과
//    **쓰기 직전에 다시 읽은 모드**를 받아 요청을 보내기 직전에 `assertReplyWritePermit`으로 다시 본다 — 호출부가 가드를 빼먹어도 여기서 막힌다.
//    이 파일에 가드를 거치지 않는 쓰기 함수를 새로 내보내지 말 것(가드 테스트가 export 목록을 잠근다).
import { assertReplyWritePermit, replyWriteGuardError } from "./parent-reply-guard.mjs";

/** 한 요청의 상한 — 응답이 안 오면 데몬의 한 폴(발송 큐 포함)이 통째로 멈춘다. 끊긴 쓰기는 '결과 모름'으로 다시 읽어 판정한다. */
const REQUEST_TIMEOUT_MS = 30_000;

/** 쓰기 경로 후보 — [같은 출처, kapi]. 댓글 번호가 있으면 그 댓글. */
export function commentPaths(postId, commentId = null) {
  const p = Number(postId);
  if (commentId == null) return [`/api/v1_1/reports/${p}/comments/`, `https://kapi.classnote.com/v1_1/reports/${p}/comments`];
  const c = Number(commentId);
  return [`/api/v1/reports/${p}/comments/${c}/`, `https://kapi.classnote.com/v1/reports/${p}/comments/${c}`];
}

/** 공감 경로 후보 — 댓글 번호가 없으면 글의 공감. 공감 번호가 있으면 그 공감(풀기). */
export function reactionPaths(postId, commentId = null, reactionId = null) {
  const p = Number(postId);
  const tail = reactionId == null ? "" : `${Number(reactionId)}/`;
  const path = commentId == null ? `/v1_2/reports/${p}/reactions/${tail}` : `/v1/reports/${p}/comments/${Number(commentId)}/reactions/${tail}`;
  return [`/api${path}`, `https://kapi.classnote.com${path}`];
}

const nameQuery = (authorName) => (authorName ? `author_name=${encodeURIComponent(String(authorName))}` : "");

/**
 * 원글 단건 — recall-core `getReport`와 같은 계약 + 보드 이름(`className`) · 그 명의의 공감(`myReactions`, `authorName`을 줬을 때만).
 */
export async function getPost(page, id, { authorName = null } = {}) {
  return page.evaluate(
    async ([i, ms, q]) => {
      try {
        const csrf = (document.cookie.match(/csrftoken=([^;]+)/) || [])[1];
        const res = await fetch(`/api/v1_2/reports/${i}/${q ? `?${q}` : ""}`, {
          headers: { accept: "application/json", ...(csrf ? { "X-CSRFToken": csrf } : {}) },
          signal: AbortSignal.timeout(ms),
        });
        if (!res.ok) return { status: res.status, detail: (await res.text().catch(() => "")).slice(0, 200) };
        const j = await res.json().catch(() => null);
        return {
          status: res.status, cls: j?.cls ?? null, child: j?.child ?? null, className: typeof j?.class_name === "string" ? j.class_name : null,
          authorType: j?.author?.type ?? null, myReactions: Array.isArray(j?.my_reactions) ? j.my_reactions : null,
        };
      } catch (e) {
        return { status: 0, detail: String(e?.message ?? e).slice(0, 200) };
      }
    },
    [Number(id), REQUEST_TIMEOUT_MS, nameQuery(authorName)],
  );
}

/**
 * 그 글의 댓글 전건. 전건을 못 받았으면(count > 받은 수 · 다음 페이지가 있음) ok:false — 중복 확인을 추측으로 하지 않는다.
 * `authorName`을 주면 각 댓글의 `my_reactions`가 그 명의 기준으로 채워진다.
 */
export async function listComments(page, postId, { authorName = null } = {}) {
  return page.evaluate(
    async ([i, ms, q]) => {
      try {
        const res = await fetch(`/api/v1/reports/${i}/comments/?page_size=100${q ? `&${q}` : ""}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(ms) });
        if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
        const j = await res.json();
        const list = Array.isArray(j) ? j : j?.results;
        if (!Array.isArray(list)) return { ok: false, detail: "댓글 목록 모양이 예상과 다름" };
        const count = Array.isArray(j) ? list.length : Number(j?.count ?? list.length);
        if (count > list.length || (!Array.isArray(j) && j?.next)) return { ok: false, detail: `댓글 ${count}개 중 ${list.length}개만 받음` };
        return { ok: true, list };
      } catch (e) {
        return { ok: false, detail: String(e?.message ?? e) };
      }
    },
    [Number(postId), REQUEST_TIMEOUT_MS, nameQuery(authorName)],
  );
}

/** ClassNote가 지금 쓰는 공감 종류(`reaction_type` 목록). 못 읽으면 ok:false. */
export async function listReactionTypes(page) {
  return page.evaluate(
    async ([ms]) => {
      try {
        const res = await fetch("/api/v1_2/reactions/types/", { headers: { accept: "application/json" }, signal: AbortSignal.timeout(ms) });
        if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
        const j = await res.json();
        const list = Array.isArray(j) ? j : j?.results;
        if (!Array.isArray(list)) return { ok: false, detail: "공감 종류 목록 모양이 예상과 다름" };
        return { ok: true, types: list.filter((t) => t && t.is_active !== false && typeof t.reaction_type === "string").map((t) => t.reaction_type) };
      } catch (e) {
        return { ok: false, detail: String(e?.message ?? e) };
      }
    },
    [REQUEST_TIMEOUT_MS],
  );
}

async function send(page, method, paths, body) {
  return page.evaluate(
    async ([m, ps, b, ms]) => {
      const csrf = (document.cookie.match(/csrftoken=([^;]+)/) || [])[1];
      let last = { status: 0, detail: "요청하지 못함" };
      for (const p of ps) {
        try {
          const res = await fetch(p, {
            method: m,
            credentials: "include",
            redirect: "manual",
            headers: { accept: "application/json", ...(b ? { "content-type": "application/json" } : {}), ...(csrf ? { "X-CSRFToken": csrf } : {}) },
            ...(b ? { body: JSON.stringify(b) } : {}),
            signal: AbortSignal.timeout(ms),
          });
          const text = await res.text().catch(() => "");
          // 만든 댓글·공감 번호 — 2xx JSON 응답에 있으면 싣는다(다시 읽은 목록에서 글자가 안 맞을 때 호출부가 이 번호로 확인한다).
          let id = null;
          if (res.ok) {
            try {
              const n = Number(JSON.parse(text)?.id);
              if (Number.isFinite(n) && n > 0) id = n;
            } catch {
              /* JSON이 아니면 번호 없음 */
            }
          }
          last = { status: res.type === "opaqueredirect" ? 0 : res.status, detail: text.slice(0, 300), via: p, id };
          // 그 자리에 엔드포인트가 없다(404·405·리다이렉트) = 아무것도 안 만들어졌다 → 다음 후보로.
          if (res.type === "opaqueredirect" || res.status === 404 || res.status === 405) continue;
          return last;
        } catch (e) {
          // 네트워크 오류(CORS·시간 초과 포함)는 결과를 모른다 — 다음 후보로 넘기지 않는다(호출부가 다시 읽어 판정).
          return { status: 0, detail: String(e?.message ?? e).slice(0, 300), via: p, id: null };
        }
      }
      return last;
    },
    [method, paths, body ?? null, REQUEST_TIMEOUT_MS],
  );
}

/**
 * 작성(POST, 댓글 번호 없음)·수정(PATCH, 댓글 번호 있음).
 * @param {object} permit  `evaluateReplyTarget`이 발급한 허가증 — 아니면 요청을 보내지 않고 던진다
 * @param {{postId:number, commentId?:number|null, mode:string}} target  `mode` = 쓰기 직전에 다시 읽은 설정값
 */
export async function writeComment(page, permit, { postId, commentId = null, mode }, body) {
  assertReplyWritePermit(permit, postId, mode);
  return send(page, commentId == null ? "POST" : "PATCH", commentPaths(postId, commentId), body);
}

/** 삭제(DELETE). 허가증 없이는 보내지 않는다. */
export async function deleteComment(page, permit, { postId, commentId, mode }) {
  assertReplyWritePermit(permit, postId, mode);
  if (commentId == null || !Number.isFinite(Number(commentId))) throw replyWriteGuardError("지울 댓글 번호가 없습니다");
  return send(page, "DELETE", commentPaths(postId, commentId), null);
}

/** 공감 누르기(POST) — 글(댓글 번호 없음) 또는 그 댓글. 허가증 없이는 보내지 않는다. */
export async function writeReaction(page, permit, { postId, commentId = null, mode }, body) {
  assertReplyWritePermit(permit, postId, mode);
  if (commentId != null && !Number.isFinite(Number(commentId))) throw replyWriteGuardError("공감할 댓글 번호가 올바르지 않습니다");
  return send(page, "POST", reactionPaths(postId, commentId), body);
}

/** 공감 풀기(DELETE). 허가증 없이는 보내지 않는다. */
export async function deleteReaction(page, permit, { postId, commentId = null, reactionId, mode }) {
  assertReplyWritePermit(permit, postId, mode);
  if (reactionId == null || !Number.isFinite(Number(reactionId))) throw replyWriteGuardError("풀 공감 번호가 없습니다");
  if (commentId != null && !Number.isFinite(Number(commentId))) throw replyWriteGuardError("공감을 풀 댓글 번호가 올바르지 않습니다");
  return send(page, "DELETE", reactionPaths(postId, commentId, reactionId), null);
}
