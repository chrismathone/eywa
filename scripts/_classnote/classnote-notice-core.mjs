/**
 * scripts/_classnote/classnote-notice-core.mjs — 반/학부모 공지 큐(classnote_notices) 처리 코어.
 *
 * aywa 서버 액션(sendClassNotice / sendOnescreenNotice)이 큐에 넣은 공지를 잡아, 각 타깃 학생의 ClassNote
 * 개별 보드에 **내부 API로 직접 게시**한다(`POST /api/v1_2/reports/`). watch-classnote-queue.mjs(연동 PC 데몬)가 매 폴 호출.
 *
 * 게시 후 **리포트 id를 조회해 results[].reports 에 저장**(회수용) — 게시 응답은 빈 201이라 id가 없어
 * `GET /api/v1_2/centers/{center}/reports/?child=…` 목록에서 방금 글(cls+child+content)을 찾는다(2026-07-14 실측 확정).
 * **개인화 본문(target.body)** 지원(태그 치환은 aywa에서 per-target 렌더) — 단 **공유 보드(2가족+)엔 개인화 게시 금지**
 * (fan-out이 다른 가족에게 남 이름을 노출하는 것 차단). **게시취소(회수)**: aywa가 status='revoke_requested'로 표시하면
 * 저장된 리포트 id를 GET로 (cls/child) 대조 후 `DELETE /api/v1_2/reports/{id}/`(204) — 엉뚱한 id로 남 글 삭제 방지.
 *
 * **첨부(2단계, 0130a)**: 공지에 첨부가 있으면(공통 `attachments` + 학생별 `targets[].attachments`) 글자 대신
 * **이미지 동반 게시**를 탄다 — 내부 라우트에서 signed URL을 받아 kage에 올리고 `postClassnoteReport`로 게시.
 * 첨부 0건이면 기존 글자 전용 `postReport` 경로 그대로(회귀 격리). 준비 헬퍼는 notice-attachments.mjs.
 *
 * 안전장치: 실게시·회수는 --post + classnoteSendEnabled(킬스위치) 확인. 타깃별 실패는 그 타깃만 기록(results).
 *
 * **반 보드 경로(수학, 원장 2026-10-02)**: 타깃에 `classId`가 있으면 1인 보드 `(수학)이름`이 아니라 **그 반 보드의 그 학생 원아**에게
 * 1:1로 올린다(수업보고서 반 보드 경로와 같은 대상 확정 — notice-class-route.mjs). 원아는 이름으로 찾지 않는다(0302a 원아 번호).
 * **영어 반 방 경로(원장 2026-11-04 · 1.0.15)**: `classId` + `subject: "english"`이면 그 영어 반에 이어진 ClassNote 반 방(s2_0006)의
 * 그 학생 원아에게 1:1로(원아 연결 0185a ∩ 지금 그 방 — 영어 보고서와 같은 함수). 대상 확정만 다르고 게시 이후는 수학 반 보드와 같은 코드다.
 * `classId`가 없는 타깃(반 방이 없는 영어 반·옛 큐 행)은 지금까지와 똑같이 1인 보드로 간다. 게시·중복 확인·409 재시도·회수·수정은 세 경로가 같은 코드다.
 */
import { isClassnoteSendEnabled, getClassnoteBoardAllowlist, DEFAULT_BASE, DEFAULT_AUTHOR_NAME } from "./classnote-core.mjs";
import {
  CLASSNOTE_BASE,
  dismissHonorificDialog,
  loginClassnote,
  fetchCenterId,
  fetchBoards,
  fetchBoardChildren,
  fetchChildren,
  resolveBoardChildEnrollments,
  postClassnoteReport,
  uploadToKage,
  norm,
} from "./classnote-admin-core.mjs";
import { boardNameAmbiguity, emptyBoardNoticeNote, evaluateBoardSafety, kstSchoolYear, noBoardNoticeNote } from "./board-safety.mjs";
import { createNoticeMediaUploader, fetchNoticeMedia, mediaForNoticeTarget } from "./notice-attachments.mjs";
import {
  findNoticeLeaks,
  isClassRouteTarget,
  isEnglishRoomTarget,
  resolveNoticeClassTarget,
  resolveNoticeEnglishTarget,
  snapshotChildReports,
} from "./notice-class-route.mjs";
import { classRouteHaltReason, haltClassRoute } from "./class-route-halt.mjs";

// 내부 첨부 라우트 게이트(보고서 첨부·/r 스샷과 동일 시크릿). 없으면 라우트가 401 → 한글 사유로 보고된다.
const INTERNAL_SECRET = process.env.CLASSNOTE_INTERNAL_SECRET;

/**
 * 학생 색인 — 매핑 검증에 필요한 두 가지를 한 쿼리로.
 * ⚠️ **퇴원·예비 포함 전 학생**이어야 한다: 앱의 동명이인 게이트는 `status<>'withdrawn'`이라 퇴원하는 순간
 * 풀리는데 ClassNote 보드엔 그 퇴원 가족이 그대로 남는다(실측 김서윤·김채은).
 */
async function loadStudentIndex(sql, tenant) {
  const rows = await sql`select id, name, classnote_name, grade from students where tenant_id = ${tenant}`;
  return {
    allNames: rows.map((x) => (x.classnote_name || x.name || "").trim()).filter(Boolean),
    gradeById: new Map(rows.map((x) => [x.id, x.grade])),
  };
}

const STUCK_MIN = 10;

/** KST 오늘(YYYY-MM-DD) — 게시 date_written. */
function kstToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
}

/**
 * 알림장 게시(내부 API). enrollment = 원아↔보드 연결 id. 성공 응답은 빈 201이라 status가 전부다.
 * 🔴 실패 응답은 **본문까지** 돌려준다 — 사유를 버리면 다음 실패도 원인 미상으로 끝난다
 *    (2026-07-27 공지 11건 `HTTP 409` 사유 소실). 자세한 배경은 `postClassnoteReport` 주석.
 */
async function postReport(page, { clsId, childId, enrollmentId, content, authorName }) {
  return page.evaluate(
    async ([cls, child, enrollment, body, author, date]) => {
      const csrf = (document.cookie.match(/csrftoken=([^;]+)/) || [])[1];
      const res = await fetch("/api/v1_2/reports/", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", ...(csrf ? { "X-CSRFToken": csrf } : {}) },
        body: JSON.stringify({ cls, child, enrollment, content: body, date_written: date, author_name: author, tz: "Asia/Seoul" }),
      });
      if (res.status >= 200 && res.status < 300) return { status: res.status };
      const detail = await res.text().catch(() => "");
      return { status: res.status, detail: (detail || "").slice(0, 500) };
    },
    [clsId, childId, enrollmentId, content, authorName, kstToday()],
  );
}

/**
 * 방금 게시한 리포트 id 조회 — centers/{center}/reports/?child= 목록(최신순)에서 cls+child+content 매칭. 실패 시 null.
 * `strict`면 **내용까지 일치할 때만** 반환한다(=옛 글로 오인 금지). "이미 게시됐나?" 판정처럼
 * 잘못 맞추면 중복/누락으로 이어지는 자리에서 쓴다. 평소(게시 직후 id 캡처)는 폴백을 허용한다.
 */
async function findReportId(page, centerId, { cls, child, content }, { strict = false } = {}) {
  const list = await page.evaluate(
    async ([center, ch]) => {
      const csrf = (document.cookie.match(/csrftoken=([^;]+)/) || [])[1];
      const res = await fetch(
        `/api/v1_2/centers/${center}/reports/?page_size=20&child=${ch}&tz=Asia/Seoul&center_id=${center}`,
        { headers: { accept: "application/json", ...(csrf ? { "X-CSRFToken": csrf } : {}) } },
      );
      if (!res.ok) return null;
      const j = await res.json().catch(() => null);
      return Array.isArray(j) ? j : j && Array.isArray(j.results) ? j.results : [];
    },
    [centerId, child],
  );
  if (!list) return null;
  const exact = list.find(
    (r) => String(r.cls) === String(cls) && String(r.child) === String(child) && r.content === content,
  );
  if (exact || strict) return exact?.id ?? null;
  // content 미저장 폴백=최신
  return list.find((r) => String(r.cls) === String(cls) && String(r.child) === String(child))?.id ?? null;
}

/** 리포트 단건 조회(회수 전 대조) — {status, cls, child}. */
async function getReport(page, id) {
  return page.evaluate(async (i) => {
    const csrf = (document.cookie.match(/csrftoken=([^;]+)/) || [])[1];
    const res = await fetch(`/api/v1_2/reports/${i}/`, {
      headers: { accept: "application/json", ...(csrf ? { "X-CSRFToken": csrf } : {}) },
    });
    const j = await res.json().catch(() => ({}));
    return { status: res.status, cls: j.cls, child: j.child };
  }, id);
}

/** 리포트 삭제 — DELETE /api/v1_2/reports/{id}/ (204). */
async function deleteReport(page, id) {
  return page.evaluate(async (i) => {
    const csrf = (document.cookie.match(/csrftoken=([^;]+)/) || [])[1];
    const res = await fetch(`/api/v1_2/reports/${i}/`, {
      method: "DELETE",
      headers: { accept: "application/json", ...(csrf ? { "X-CSRFToken": csrf } : {}) },
    });
    return { status: res.status };
  }, id);
}

/** 리포트 제자리 수정 — PATCH /api/v1_2/reports/{id}/ {content} (200, 2026-07-14 학원이 실측). */
async function patchReport(page, id, content) {
  return page.evaluate(
    async ([i, c]) => {
      const csrf = (document.cookie.match(/csrftoken=([^;]+)/) || [])[1];
      const res = await fetch(`/api/v1_2/reports/${i}/`, {
        method: "PATCH",
        headers: { "content-type": "application/json", accept: "application/json", ...(csrf ? { "X-CSRFToken": csrf } : {}) },
        body: JSON.stringify({ content: c }),
      });
      return { status: res.status };
    },
    [id, content],
  );
}

/**
 * 공통 첨부 개수(0130a `attachments`) — 이 공지가 첨부 경로를 타야 하는지 판정용.
 * ⚠️ 워커만 먼저 갱신되고 마이그레이션이 아직 안 올라간 DB에서도 죽지 않게 try/catch로 0 처리(= 기존 동작).
 */
async function countCommonAttachments(sql, noticeId) {
  try {
    const [row] = await sql`select case when jsonb_typeof(attachments)='array'
        then jsonb_array_length(attachments) else 0 end as n
      from classnote_notices where id=${noticeId}`;
    return Number(row?.n ?? 0);
  } catch {
    return 0; // 컬럼 없음 = 첨부 기능 이전과 동일 동작
  }
}

/** 학생별 첨부 개수 합(targets[].attachments) — 스키마 변경 없이 targets 안에 들어온다. */
function countTargetAttachments(targets) {
  return (targets ?? []).reduce((n, t) => n + (Array.isArray(t?.attachments) ? t.attachments.length : 0), 0);
}

/** kage 업로드는 작성폼의 네이티브 file input 경유 — 그 폼으로 이동(타깃마다 새로 열어 첨부 누적 방지). */
async function openAddForm(page) {
  await page.goto(`${CLASSNOTE_BASE}/service/report/add`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await dismissHonorificDialog(page).catch(() => {});
  await page.waitForTimeout(1500);
}

/**
 * 타깃 1건 처리 — 보드·원아·enrollment 해석 후 게시 + 리포트 id 캡처. 실패 사유는 한글 note.
 * 🔴 `classId`가 실린 타깃은 **반 보드(영어는 반 방) 경로만** 탄다 — 대상 확정에 실패해도 아래 1인 보드 경로로 떨어지지 않는다
 *    (조용히 옛 보드로 가면 화면의 "반 보드로 보냄"이 거짓이 된다).
 */
export async function processTarget(page, ctx, target, index = 0) {
  if (isClassRouteTarget(target)) {
    // 비상 정지 — 반 보드에서 글이 다른 원아에게 보인 적이 있으면(보고서·공지 어느 쪽이든) 원인을 볼 때까지 올리지 않는다.
    // 영어 반 방도 같은 표식을 따른다(보고서의 영어 반 방 경로와 같다 — 한쪽에서 새면 둘 다 멈춘다).
    if (classRouteHaltReason())
      return { board: target.board, ok: false, note: "반 보드 발송이 비상 정지 중입니다 — 교차 확인 이상으로 멈췄습니다(연동 PC를 다시 켜기 전에 원인 확인 필요)" };
    // 영어 반 방(원장 2026-11-04 · `subject: "english"` 표식)은 대상 확정만 다르다 — 게시·중복 확인·409 재시도·교차 확인은 아래 같은 코드.
    const resolved = isEnglishRoomTarget(target)
      ? await resolveNoticeEnglishTarget(ctx.sql, page, { tenant: ctx.tenant, centerId: ctx.centerId, target })
      : await resolveNoticeClassTarget(ctx.sql, page, { tenant: ctx.tenant, centerId: ctx.centerId, target });
    if (!resolved.ok) return { board: target.board, ok: false, note: resolved.note };
    // 교차 확인 준비 — 이 공지가 그 반 보드에 **처음** 올리기 전에, 그 반의 다른 원아들이 지금 갖고 있는 글을 적어 둔다(기준선).
    // 이 대상의 원아는 올리기 **전에** '대상'으로 적는다 — 게시 확인에 실패해도 제 글이 '다른 원아에게 샌 글'로 세이지 않게.
    let post = ctx.classPosts?.get(resolved.boardId) ?? null;
    if (ctx.classPosts && !post) {
      const baseline = await snapshotChildReports(page, ctx.centerId, resolved.others).catch(() => new Map());
      post = { baseline, targeted: new Set(), contents: new Set(), posted: 0, checked: 0 };
      ctx.classPosts.set(resolved.boardId, post);
    }
    if (post) {
      for (const e of resolved.enrolled) post.targeted.add(Number(e.child.id));
      post.contents.add(target.body != null ? target.body : ctx.body);
    }
    const res = await postToChildren(page, ctx, target, index, { boardId: resolved.boardId, enrolled: resolved.enrolled });
    if (post && res.reports?.length) {
      post.posted += 1;
      // 그 반 보드의 **첫 게시 직후** 한 번 확인한다 — 새는 구조라면 나머지 대상(개인 본문·요청서 이미지)을 올리기 전에 멈춘다.
      if (post.posted === 1) {
        const alert = await checkBoardLeak(page, { centerId: ctx.centerId, boardId: resolved.boardId, post, log: ctx.log }).catch(() => null);
        post.checked = post.posted;
        if (alert) ctx.leakAlert = alert;
      }
    }
    return res;
  }
  const board = ctx.boardByNorm.get(norm(target.board));
  // 1인 보드는 더 만들지 않는다(원장 2026-11-04) — '프로비저닝 필요'라고 하지 않는다(board-safety.mjs `noBoardNoticeNote`).
  if (!board) return { board: target.board, ok: false, note: noBoardNoticeNote(target.board) };

  // ⛔ 보드 안전 게이트 — 발송 워커(classnote-core)와 **같은 순수 판정**(board-safety.mjs)으로 공유 보드 차단.
  // ⚠️ 아래 `enrolled`는 target 이름과 일치하는 원아만 세므로 **이름이 다른 제3의 가족이 같은 보드에 붙어 있으면
  // 못 잡는다**(실사고 2026-07-15: `(수학)박서준`에 초6·중3 두 가족 동거). 총 연결 인원(approved_children)으로
  // 판정해야 잡힌다. 공통 본문도 그 보드의 모든 가족에게 fan-out되므로 **개인화 여부와 무관하게** 게이트한다.
  let verdict = evaluateBoardSafety({ className: target.board, boards: ctx.boards, allowlist: ctx.allowlist });
  // 모호한 이름(같은 이름 2명+ 퇴원 포함 / `이름+알파벳` 형제)일 때만 원아를 실시간 조회해 매핑 검증.
  const amb = boardNameAmbiguity(target.studentName, ctx.allNames ?? []);
  if (verdict.ok && amb.ambiguous) {
    const live = await fetchBoardChildren(page, ctx.centerId, verdict.boardId ?? board.id).catch(() => null);
    verdict = Array.isArray(live)
      ? evaluateBoardSafety({
          className: target.board,
          boards: ctx.boards,
          allowlist: ctx.allowlist,
          mapping: { grade: ctx.gradeById?.get(target.studentId) ?? null, children: live, schoolYear: kstSchoolYear() },
        })
      : {
          ok: false,
          code: "mapping_unknown",
          reason: `동명이인이 있는 이름이라 원아 확인이 필요한데 클래스노트 조회에 실패해 보류합니다(${target.board})`,
        };
    if (!verdict.ok && amb.siblings.length) verdict.reason = `${verdict.reason} (aywa 동명: ${amb.siblings.join(", ")})`;
  }
  if (!verdict.ok) return { board: target.board, ok: false, note: verdict.reason };

  // 원아 해석 = 발송 워커와 **같은 함수**(resolveBoardChildEnrollments). 이름으로 못 찾으면
  // "보드가 곧 매핑" 폴백이 돌고(생년 대조 필수), 그래도 안 되면 아래 note로 사유가 나온다.
  let rejected = null;
  const enrolled = await resolveBoardChildEnrollments(page, board.id, target.studentName, ctx.children, {
    centerId: ctx.centerId,
    grade: ctx.gradeById?.get(target.studentId) ?? null,
    schoolYear: kstSchoolYear(),
    onReject: (v) => {
      rejected = v;
    },
  });
  if (enrolled.length === 0)
    return { board: target.board, ok: false, note: rejected?.reason ?? emptyBoardNoticeNote(target.board) };
  return postToChildren(page, ctx, target, index, { boardId: board.id, enrolled });
}

/**
 * 확정된 원아들에게 게시 — 1인 보드 경로와 반 보드 경로가 **같이 쓰는** 뒷부분(첨부 준비·게시·중복 확인·409 재시도·id 캡처).
 * `boardId` = 글이 올라갈 ClassNote 반(1인 보드든 반 보드든) · `enrolled` = [{child:{id}, enrollment:{id}}] (그 반에서의 배정).
 * 🔴 글은 `child`를 지정해 올라가므로 반 보드에 다른 원아가 있어도 그 원아에게만 보인다(수업보고서 반 보드 발송과 같은 방식).
 */
async function postToChildren(page, ctx, target, index, { boardId, enrolled }) {
  const board = { id: boardId };
  // 개인화 본문(target.body, 학생별) 우선, 없으면 공통 본문(ctx.body).
  // 공유 보드 차단은 위 프리플라이트 게이트가 담당(개인화·공통 **둘 다**) — 옛 개인화-only 체크는 이름 매칭
  // 기반이라 이름 다른 제3 가족을 못 잡아 폐기했다.
  const content = target.body != null ? target.body : ctx.body;

  // 첨부(2단계) — **보드 안전 게이트를 통과한 뒤에** 준비한다(막힐 보드에 업로드 낭비 방지).
  // ⚠️ 하나라도 준비에 실패하면 게시하지 않는다 — 요청서가 빠진 글은 이 기능의 의미가 없다(거짓 발송 방지).
  let media = null;
  if (ctx.mediaFor) {
    media = await ctx.mediaFor(target, index, {});
    if (!media) return { board: target.board, ok: false, note: "첨부 목록에서 이 학생을 찾지 못했습니다(재발송 필요)" };
    if (media.failures.length) return { board: target.board, ok: false, note: `첨부 준비 실패 — ${media.failures.join(" / ")}` };
    // 이 학생 몫이 0장 = 글자만 — 기존 경로로 되돌려 요청 본문을 완전히 동일하게 유지.
    // ⚠️ `expected`는 **앱이 서명하기 전** 장수라 0 = "원래 첨부가 없었다"가 확실하다(서명 실패로 사라진
    //    첨부는 위 failures로 이미 걸린다). 서명 뒤 목록 길이로 판정하면 "전멸 → 글자만 발송 → success"가 된다.
    if (!media.expected) media = null;
  }

  // 이중 등록(부모 계정 2개)이면 전원에게 게시. 성공한 글은 reports[]에 남겨 부분성공도 회수 가능하게.
  const reports = [];
  for (const { child, enrollment } of enrolled) {
    const send = (m) =>
      m
        ? postClassnoteReport(page, {
            cls: board.id,
            child: child.id,
            enrollment: enrollment.id,
            content,
            dateWritten: kstToday(),
            authorName: ctx.authorName,
            attachedImages: m.attachedImages,
            attachedFiles: m.attachedFiles,
          })
        : postReport(page, {
            clsId: board.id,
            childId: child.id,
            enrollmentId: enrollment.id,
            content,
            authorName: ctx.authorName,
          });

    let res = await send(media);
    const failed = (r) => r.status < 200 || r.status >= 300;

    /**
     * 🔴 **실패 응답이면 "그래도 글이 올라갔는지" 확인한다.** ClassNote가 글을 만든 뒤 후처리에서 5xx를 주거나
     *    게이트웨이가 끊기면, 응답만 믿고 실패로 적는 순간 **화면이 사실과 다른 말을** 한다 — 원장은 "안 갔다"고
     *    알고 재발송하는데 학부모 알림장엔 같은 글이 2개 남는다(회수는 id를 캡처한 쪽만 지운다). 반대로 정말
     *    안 갔는데 성공으로 적으면 학부모가 영영 못 받는다. 어느 쪽도 사후에 되돌릴 수 없다.
     * ⚠️ 예전엔 이 확인이 `media?.reused`(첨부 재사용 재시도) 안에 갇혀 있었다 → **첨부 없는 공지는 확인
     *    자체를 건너뛰었다.** 2026-07-27 공지 11건이 `HTTP 409`로 적혔지만 "실제로 갔는지"를 DB만으로는
     *    판정할 수 없었던 이유가 이것이다(원장이 ClassNote를 직접 열어 미게시 확인). 이제 첨부 유무와 무관하고,
     *    **첫 시도·재시도 양쪽 뒤에** 돈다(재시도가 글을 만들고 에러를 줬을 수 있다).
     * @returns 게시돼 있으면 true(reports에 담고 이 원아는 완료), 아니면 false.
     */
    const claimIfPosted = async () => {
      const posted = await findReportId(
        page,
        ctx.centerId,
        { cls: board.id, child: child.id, content },
        { strict: true },
      ).catch(() => null);
      if (posted == null) return false;
      ctx.log?.(`[notice] ${target.board} 게시 응답 실패(HTTP ${res.status})지만 글이 이미 있어 성공으로 처리합니다`);
      reports.push({ id: posted, url: `${CLASSNOTE_BASE}/service/report/${posted}`, cls: board.id, child: child.id });
      return true;
    };

    if (failed(res) && (await claimIfPosted())) continue;

    // 🔴 **409(중복 판정) 백오프 재시도** — 2026-07-27 실측으로 확정한 ClassNote 신설 가드 대응.
    //    ClassNote가 07-23~07-27 사이 "같은 내용을 짧은 간격에 다시 게시"를 콘텐츠 성격에 따라
    //    **보드가 달라도** 409 {"detail":"Already exists."}로 거부하게 바뀌었다(실측: 설명회 안내문은
    //    교차보드 0.3초 간격 거부 / 짧은 평문은 통과 / **~1분 뒤엔 같은 본문도 통과**(T8) — 창은 마지막
    //    성공 게시가 다시 감는다). 다대상 공지는 공통 본문이라 두 번째 타깃부터 전부 걸린다(07-27 11명 실사고).
    //    → 대응 = **기다렸다 그대로 재시도**(30s→60s→90s, 총 3분 = 실측 창 ~90초의 2배 여유).
    //    본문은 절대 변형하지 않는다(학부모 노출 콘텐츠 — 워커가 임의로 바꾸면 안 됨).
    //    재시도 사이마다 claimIfPosted를 다시 돈다(그 사이 다른 경로로 올라갔을 수 있음 = 중복 방지).
    if (failed(res) && res.status === 409) {
      let claimed = false;
      for (const waitMs of [30_000, 60_000, 90_000]) {
        ctx.log?.(`[notice] ${target.board} 중복 판정(409) — ${waitMs / 1000}초 대기 후 재시도`);
        await new Promise((r) => setTimeout(r, waitMs));
        res = await send(media);
        if (!failed(res)) break;
        if (await claimIfPosted()) {
          claimed = true;
          break;
        }
        if (res.status !== 409) break; // 다른 에러로 바뀜 → 백오프는 무의미, 아래 일반 실패 경로로
      }
      if (claimed) continue;
    }

    // ⚠️ **미검증**: kage access_key를 다른 글에 재사용해도 되는지 확인 못 했다 → 재사용분으로 실패하면
    // 이 타깃만 **재업로드해 1회 재시도**한다. 재사용이 원인이 아니면 그대로 실패로 남는다.
    // (위에서 "이미 게시됨"은 걸러졌으므로 여기 오는 건 정말 안 올라간 건이다 = 재시도해도 중복 아님.)
    if (failed(res) && media?.reused && ctx.mediaFor) {
      ctx.log?.(`[notice] ${target.board} 게시 실패(HTTP ${res.status}) — 첨부 재업로드 후 1회 재시도`);
      const fresh = await ctx.mediaFor(target, index, { fresh: true });
      if (fresh && !fresh.failures.length) {
        media = fresh;
        res = await send(media);
        if (failed(res) && (await claimIfPosted())) continue;
      }
    }
    if (failed(res)) {
      // note = 사람이 읽는 한글 요약(화면 노출), detail = 서버 응답 원문(원인 규명용, 화면 미노출).
      // 원문을 note에 이어붙이지 않는다 — UI에 raw 기술 원문을 그대로 내보내지 않는 전역 규약.
      ctx.log?.(`[notice] ${target.board} 게시 실패(HTTP ${res.status}) 응답: ${res.detail ?? "(본문 없음)"}`);
      return {
        board: target.board,
        ok: false,
        note: `게시 실패(HTTP ${res.status})`,
        ...(res.detail ? { detail: res.detail } : {}),
        reports,
      };
    }
    // 게시 성공 → 회수용 id 조회(실패해도 게시는 유지 = id null=회수불가 표시). cls/child 저장(회수 대조용).
    const id = await findReportId(page, ctx.centerId, { cls: board.id, child: child.id, content }).catch(() => null);
    reports.push({ id: id ?? null, url: id ? `${CLASSNOTE_BASE}/service/report/${id}` : null, cls: board.id, child: child.id });
  }
  return { board: target.board, ok: true, reports };
}

/**
 * 한 반 보드의 교차 확인 — 대상이 아닌 원아에게, 올리기 전엔 없던 이 공지의 글이 생겼으면 새어 나간 것이다.
 * 새었으면 반 보드 게시를 전부 멈추고(class-route-halt.mjs — 수업보고서와 같은 표식) 한글 사유를 돌려준다.
 * 조회 실패는 새었다고 단정하지 않는다(로그만).
 * @returns {Promise<string|null>} 새었을 때의 한글 사유(공지 행의 error에 적는다 — 화면에 그대로 나간다)
 */
async function checkBoardLeak(page, { centerId, boardId, post, log }) {
  const others = [...post.baseline.keys()].filter((id) => !post.targeted.has(id));
  if (!others.length) return null;
  const { leakedTo, unknown } = await findNoticeLeaks(page, { centerId, boardId, others, contents: [...post.contents], baseline: post.baseline });
  if (leakedTo.length) {
    haltClassRoute("공지 교차 확인 이상");
    log?.(`[notice] 🔴 교차 확인 이상 — 반 보드 #${boardId} 다른 원아 ${leakedTo.join(",")} · 반 보드 발송 비상 정지`);
    return `🔴 반 보드 교차 확인 이상 — 이 공지가 대상이 아닌 원아(${leakedTo.length}명)의 알림장에서 보입니다. 반 보드 발송을 멈췄습니다(ClassNote에서 확인한 뒤 게시취소해 주세요)`;
  }
  if (unknown) log?.(`[notice] ⚠️ 반 보드 #${boardId} 교차 확인을 다 하지 못했습니다(조회 실패) — 게시는 성공으로 둔다`);
  return null;
}

/**
 * 공지 1건의 **마지막 교차 확인** — 한 반 보드에 여러 대상을 올렸으면(첫 게시 직후 확인 뒤에도 더 올렸으면) 끝에서 한 번 더 본다.
 * @returns {Promise<string|null>} 새었을 때의 한글 사유(첫 게시 직후 확인에서 이미 잡혔으면 그 사유)
 */
export async function crossCheckNoticeBoards(page, { centerId, classPosts, leakAlert = null, log }) {
  let alert = leakAlert;
  for (const [boardId, post] of classPosts ?? []) {
    if (post.posted <= post.checked) continue;
    const found = await checkBoardLeak(page, { centerId, boardId, post, log }).catch(() => null);
    post.checked = post.posted;
    if (found) alert = alert ?? found;
  }
  return alert;
}

/** 게시취소(회수) 1건 — 저장된 reports[].id를 GET 대조(cls/child) 후 DELETE. results를 회수 결과로 갱신. */
async function revokeNotice(page, notice) {
  const results = Array.isArray(notice.results) ? notice.results : [];
  let deleted = 0;
  let failed = 0;
  let missing = 0;
  const out = [];
  for (const r of results) {
    const reps = Array.isArray(r.reports) ? r.reports : [];
    const revoked = [];
    for (const rep of reps) {
      if (rep.id == null) {
        missing++;
        revoked.push({ ...rep, revoked: false, note: "id 미보유(회수 불가)" });
        continue;
      }
      const chk = await getReport(page, rep.id).catch(() => ({ status: 0 }));
      if (chk.status === 404) {
        deleted++;
        revoked.push({ ...rep, revoked: true, note: "이미 삭제됨" });
        continue;
      }
      // cls/child 대조 — 엉뚱한 id로 남 글 삭제 방지.
      const mismatch =
        chk.status !== 200 ||
        (rep.cls != null && String(chk.cls) !== String(rep.cls)) ||
        (rep.child != null && String(chk.child) !== String(rep.child));
      if (mismatch) {
        failed++;
        revoked.push({ ...rep, revoked: false, note: `대조 불일치/접근불가(${chk.status}) — 회수 안 함` });
        continue;
      }
      const del = await deleteReport(page, rep.id).catch(() => ({ status: 0 }));
      if (del.status >= 200 && del.status < 300) {
        deleted++;
        revoked.push({ ...rep, revoked: true });
      } else {
        failed++;
        revoked.push({ ...rep, revoked: false, note: `삭제 실패(${del.status})` });
      }
    }
    out.push({ board: r.board, revoked });
  }
  return { out, deleted, failed, missing };
}

/** 게시 공지 제자리 수정 1건 — 저장된 reports[].id를 GET 대조(cls/child) 후 PATCH {content: notice.body(새 내용)}. */
async function editNotice(page, notice) {
  const results = Array.isArray(notice.results) ? notice.results : [];
  const content = notice.body ?? "";
  let edited = 0;
  let failed = 0;
  let missing = 0;
  const out = [];
  for (const r of results) {
    const reps = Array.isArray(r.reports) ? r.reports : [];
    const patched = [];
    for (const rep of reps) {
      if (rep.id == null || rep.revoked) {
        missing++;
        patched.push({ ...rep }); // 회수됨/ id없음 = 수정 대상 아님(그대로 보존)
        continue;
      }
      const chk = await getReport(page, rep.id).catch(() => ({ status: 0 }));
      if (chk.status === 404) {
        missing++;
        patched.push({ ...rep, note: "이미 삭제됨" });
        continue;
      }
      const mismatch =
        chk.status !== 200 ||
        (rep.cls != null && String(chk.cls) !== String(rep.cls)) ||
        (rep.child != null && String(chk.child) !== String(rep.child));
      if (mismatch) {
        failed++;
        patched.push({ ...rep, note: `대조 불일치/접근불가(${chk.status}) — 수정 안 함` });
        continue;
      }
      const pt = await patchReport(page, rep.id, content).catch(() => ({ status: 0 }));
      if (pt.status >= 200 && pt.status < 300) {
        edited++;
        patched.push({ ...rep });
      } else {
        failed++;
        patched.push({ ...rep, note: `수정 실패(${pt.status})` });
      }
    }
    // 🔴 **원본 항목을 그대로 이어받는다**(`...r`) — 예전엔 `{board, reports}`만 새로 만들어 게시 결과의
    //    `ok`가 사라졌다. 화면의 실패 집계가 `ok` 없는 항목을 실패로 세는 바람에, 7명에게 정상 게시된
    //    공지를 수정하자 "발송 완료 · 실패 7 · 사유 없음"이 됐다(2026-08-25 실사고 — 발송자가 안 갔다고
    //    알고 재발송하면 학부모 알림장에 같은 글이 2개 남고 되돌릴 수 없다).
    //    ⚠️ 이 스프레드를 `revokeNotice`에 따라 하지 말 것 — 회수는 `reports`를 `revoked`로 **갈아끼우는**
    //       것이라 원본을 이어받으면 `reports`가 남아 회수 취소선(flattenNoticeReportLinks)이 죽는다.
    out.push({ ...r, reports: patched });
  }
  return { out, edited, failed, missing };
}

/**
 * 큐 1회 처리 — 게시(queued) + 게시취소(revoke_requested) + 게시본 수정(edit_requested). stale 복구 후 하나씩 클레임(SKIP LOCKED).
 * post=false(dry-run)면 클레임하지 않고 개수만 보고. 게시는 classnoteSendEnabled 킬스위치도 확인(회수·수정은 정리/정정이라 미적용).
 */
export async function processNoticesOnce(
  sql,
  browser,
  // base = aywa 앱 주소(첨부 signed URL을 받는 내부 라우트). 보고서 경로와 같은 env(CLASSNOTE_SCREENSHOT_BASE)를 쓴다
  // — 연동 PC는 공개 도메인이어야 한다(localhost면 첨부 조회가 실패하고 그 사유가 results에 남는다).
  { tenant, post, log = console.log, authorName = DEFAULT_AUTHOR_NAME, base = DEFAULT_BASE },
) {
  // stale 복구 — 크래시로 갇힌 처리중 상태
  await sql`update classnote_notices set status='queued', processing_at=null
    where tenant_id=${tenant} and status='processing' and processing_at < now() - ${STUCK_MIN} * interval '1 minute'`;
  await sql`update classnote_notices set status='revoke_requested', processing_at=null
    where tenant_id=${tenant} and status='revoking' and processing_at < now() - ${STUCK_MIN} * interval '1 minute'`;
  await sql`update classnote_notices set status='edit_requested', processing_at=null
    where tenant_id=${tenant} and status='editing' and processing_at < now() - ${STUCK_MIN} * interval '1 minute'`;

  const [{ n }] = await sql`select count(*)::int as n from classnote_notices where tenant_id=${tenant} and status='queued'`;
  const [{ r }] = await sql`select count(*)::int as r from classnote_notices where tenant_id=${tenant} and status='revoke_requested'`;
  const [{ e }] = await sql`select count(*)::int as e from classnote_notices where tenant_id=${tenant} and status='edit_requested'`;
  if (!n && !r && !e) return { processed: 0 };
  if (!post) {
    log(`[notice] 대기 게시 ${n}건 · 회수 ${r}건 · 수정 ${e}건 — dry-run(--post 없음)`);
    return { processed: 0, pending: n + r + e };
  }
  const sendOk = await isClassnoteSendEnabled(sql, tenant);
  if (n && !sendOk) log("[notice] classnoteSendEnabled OFF — 게시 중단(큐 보존). 회수는 진행.");

  const page = await browser.newPage();
  let processed = 0;
  try {
    await loginClassnote(page);
    const centerId = await fetchCenterId(page);

    // ── 게시(queued) — 킬스위치 ON일 때만 ──
    if (n && sendOk) {
      const boards = await fetchBoards(page, centerId);
      const ctxBase = {
        centerId,
        boards, // 보드 전건(원본 배열) — 프리플라이트 게이트가 보드명 중복 탐지에 필요(boardByNorm은 중복을 뭉갬)
        boardByNorm: new Map(boards.map((b) => [norm(b.name), b])),
        children: await fetchChildren(page, centerId),
        allowlist: await getClassnoteBoardAllowlist(sql, tenant), // 원장이 확인한 공유 보드 발송 예외
        ...(await loadStudentIndex(sql, tenant)), // allNames(동명 판정 우주) + gradeById(매핑 검증용)
        authorName,
      };
      for (let i = 0; i < 5; i++) {
        const [notice] = await sql`update classnote_notices set status='processing', processing_at=now()
          where id = (select id from classnote_notices where tenant_id=${tenant} and status='queued'
                      order by created_at limit 1 for update skip locked)
          returning id, body, targets`;
        if (!notice) break;
        const targets = notice.targets ?? [];

        // ── 첨부 유무 판정(2단계) — 있을 때만 이미지 동반 게시 경로. 0건이면 아래 로직은 전부 건너뛰고
        //    기존 글자 전용 경로 그대로 돈다(회귀 격리). 공통=0130a 컬럼 · 학생별=targets[].attachments.
        const attCount = (await countCommonAttachments(sql, notice.id)) + countTargetAttachments(targets);
        let mediaFor = null;
        let mediaError = null;
        if (attCount) {
          // expectedTotal = DB가 아는 첨부 장수. 라우트가 "전 타깃 0장"을 주면 서명 전멸이라 실패로 잡힌다.
          const fetched = await fetchNoticeMedia({
            base,
            secret: INTERNAL_SECRET,
            noticeId: notice.id,
            expectedTotal: attCount,
          });
          if (!fetched.ok) mediaError = fetched.error;
          else {
            const uploader = createNoticeMediaUploader({
              openForm: () => openAddForm(page),
              upload: (kind, file) =>
                uploadToKage(page, kind === "image" ? "media-attachment-add-input" : "doc-attachment-add-input", file),
              log,
            });
            // 🔴 라우트의 targets[i]는 이미 "공통 + 그 타깃"이 합쳐진 최종 목록 — common을 다시 더하지 않는다(중복 게시).
            mediaFor = async (t, idx, opts) => {
              const entry = mediaForNoticeTarget(fetched.targets, t, idx);
              return entry ? uploader.build(entry, opts) : null;
            };
          }
          log(
            `[notice] ${notice.id} 첨부 ${attCount}건 — ` +
              (mediaError ? `첨부 준비 중단(${mediaError})` : `공통 ${fetched.common.images.length + fetched.common.files.length}장 포함 이미지 동반 게시`),
          );
        }

        log(`[notice] ${notice.id} 게시 시작 — 타깃 ${targets.length}건`);
        // classPosts = 반 보드별 교차 확인 재료(올리기 전 기준선 · 대상 원아 · 올린 본문) — processTarget의 반 보드 분기가 채운다.
        const ctx = { ...ctxBase, sql, tenant, body: notice.body, mediaFor, log, classPosts: new Map(), leakAlert: null };
        const results = [];
        for (const [idx, t] of targets.entries()) {
          // 첨부를 실어야 하는데 목록 자체를 못 받았으면 **한 건도 게시하지 않는다**(요청서 빠진 글 방지).
          if (mediaError) {
            results.push({ board: t.board, ok: false, note: mediaError });
            continue;
          }
          // 하트비트 — 409 백오프(타깃당 최대 ~3분)로 다대상 공지가 STUCK_MIN(10분)을 넘을 수 있다.
          // processing_at을 갱신 안 하면 stale 복구가 **진행 중인** 공지를 죽은 것으로 오판해 재큐잉
          // → 전 타깃 재게시(중복 위험). 타깃마다 한 줄 갱신으로 차단(best-effort — 실패해도 게시는 계속).
          await sql`update classnote_notices set processing_at=now() where id=${notice.id}`.catch(() => {});
          try {
            results.push(await processTarget(page, ctx, t, idx));
          } catch (e) {
            results.push({ board: t.board, ok: false, note: `오류: ${String(e.message).slice(0, 80)}` });
          }
        }
        const okCount = results.filter((x) => x.ok).length;
        // 반 보드 경로 — 대상이 아닌 원아에게 보이지 않는지 확인한다(새었으면 사유를 공지 행에 적고 반 보드 발송을 멈춘다).
        const leak = await crossCheckNoticeBoards(page, { centerId, classPosts: ctx.classPosts, leakAlert: ctx.leakAlert, log }).catch(() => ctx.leakAlert);
        // 🔴 새었으면 '발송 완료'로 두지 않는다 — 초록 상태만 보고 지나치지 않게 '일부 실패'로 올리고 사유를 error에 적는다(화면이 항상 빨갛게 그린다).
        const status = okCount === 0 ? "failed" : okCount === results.length && !leak ? "success" : "partial";
        await sql`update classnote_notices set status=${status}, results=${sql.json(results)},
          processed_at=now(), error=${leak ?? (status === "failed" ? "전 타깃 실패 — results 참조" : null)}
          where id=${notice.id}`;
        log(`[notice] ${notice.id} → ${status} (성공 ${okCount}/${results.length})`);
        processed++;
      }
    }

    // ── 게시취소(revoke_requested) — 저장된 리포트 id 삭제 ──
    for (let i = 0; i < 5; i++) {
      const [rev] = await sql`update classnote_notices set status='revoking', processing_at=now()
        where id = (select id from classnote_notices where tenant_id=${tenant} and status='revoke_requested'
                    order by created_at limit 1 for update skip locked)
        returning id, results`;
      if (!rev) break;
      const { out, deleted, failed, missing } = await revokeNotice(page, rev);
      const status = failed === 0 ? "revoked" : "revoke_partial";
      await sql`update classnote_notices set status=${status}, results=${sql.json(out)}, processed_at=now(),
        error=${failed ? `회수 실패 ${failed}건` : null} where id=${rev.id}`;
      log(`[notice] ${rev.id} 회수 → ${status} (삭제 ${deleted}·실패 ${failed}·id없음 ${missing})`);
      processed++;
    }

    // ── 게시본 수정(edit_requested) — 저장된 리포트 id에 새 내용 PATCH ──
    for (let i = 0; i < 5; i++) {
      const [ed] = await sql`update classnote_notices set status='editing', processing_at=now()
        where id = (select id from classnote_notices where tenant_id=${tenant} and status='edit_requested'
                    order by created_at limit 1 for update skip locked)
        returning id, body, results`;
      if (!ed) break;
      const { out, edited, failed, missing } = await editNotice(page, ed);
      // 수정 후에도 게시 상태 유지(reports 보존 → 재수정·회수 가능). 전건 성공=success, 일부 실패=partial.
      const status = failed === 0 ? "success" : "partial";
      await sql`update classnote_notices set status=${status}, results=${sql.json(out)}, processed_at=now(),
        error=${failed ? `수정 실패 ${failed}건` : null} where id=${ed.id}`;
      log(`[notice] ${ed.id} 수정 → ${status} (반영 ${edited}·실패 ${failed}·대상아님 ${missing})`);
      processed++;
    }
  } finally {
    await page.close().catch(() => {});
  }
  return { processed };
}
