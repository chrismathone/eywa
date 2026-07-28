// scripts/_classnote/classnote-core.mjs — ClassNote 발송 처리 코어 (one-shot·데몬 공용).
//
// stale 복구 + SKIP LOCKED 원자 클레임 + 건별 스크린샷·Cloud Run 게시·재시도 로직을 processQueueOnce로 묶어
// one-shot(process-classnote-queue.mjs)과 상주 데몬(watch-classnote-queue.mjs)이 동일 코어를 공유한다.
//
// ⚠️ tenant 격리 필수 — DATABASE_URL 직결(RLS 우회)이라 필터 없으면 다른 테넌트 보고서를 이 계정으로 게시.
import { chromium } from "@playwright/test";
import {
  CLASSNOTE_BASE, dismissHonorificDialog,
  loginClassnote, fetchCenterId, fetchBoards, fetchBoardChildren,
  fetchChildren, uploadToKage, resolveBoardChildEnrollments, postClassnoteReport,
  findChildReportId,
} from "./classnote-admin-core.mjs";
import { boardNameAmbiguity, evaluateBoardSafety, kstSchoolYear } from "./board-safety.mjs";
import { resolveSendWindow, isWithinSendWindow, formatSendWindow } from "./send-window.mjs";

export const CLOUD_RUN = "https://submittoclassnotev2-q4dmdhnkvq-uc.a.run.app";
/**
 * 게시 엔진 스위치(2026-07-28, §10 옵션 B) — "local"이면 **모든** 보고서를 워커 내장 내부 API 경로로 게시
 * (Cloud Run 미호출 = edutrix Firebase 의존 0). 그 외/미설정 = 기존 Cloud Run 경로(파일첨부 리포트만 API).
 * 롤백 = 연동 PC .env.local에서 이 키 제거 후 워커 재시작. classreport-web 소등 후엔 local이 유일 경로다.
 */
export const isLocalPublish = () => process.env.CLASSNOTE_PUBLISH_MODE === "local";
export const DEFAULT_BASE = process.env.CLASSNOTE_SCREENSHOT_BASE || "http://localhost:3113"; // 스크린샷용(로컬 dev 가능)
export const DEFAULT_SHARE_BASE = process.env.CLASSNOTE_SHARE_BASE || "https://eywa-alpha.vercel.app"; // 게시글 상단 공유 링크(/r) 공개 도메인
export const BATCH = 2;
export const STALE_MIN = 10;
// /r이 이 secret 헤더를 보면 조회로그(share_link_views)를 안 남김 — 워커 스크린샷을 "학부모 열람"으로 오집계 방지(P2a).
const INTERNAL_SECRET = process.env.CLASSNOTE_INTERNAL_SECRET;

const PREFLIGHT_BACKOFF_MAX_MS = 10 * 60_000; // 준비 실패 시 최대 백오프(10분) — 무한 로그인 루프 차단

/**
 * 프리플라이트용 **로그인 세션을 폴 사이에 유지**한다.
 *
 * ⚠️ 원래는 폴마다 `browser.newPage()`(= 새 컨텍스트 = 쿠키 없음) + `loginClassnote`이라 **BATCH(2)건마다 로그인 1회**였다.
 * 이 경로는 게이트 도입 전엔 PC 로그인이 **0회**였다(Cloud Run이 payload 자격증명으로 서버측 로그인) → 전부 신규 부하.
 * 실측 발송량이 하루 63~272건이라 85건이면 로그인 ~43회, 272건 버스트면 ~136회를 한 IP·한 계정으로 던진다.
 * 반복 로그인은 **~50%가 실패**한다(2026-07-15 실측 봇 스로틀) → 실패가 재큐를 부르고 재큐가 또 로그인을 불러 자기강화.
 * → 로그인된 페이지를 살려두고 폴마다 **fetch만** 한다(피드 폴러 classnote-feed-core.mjs와 같은 패턴).
 * 세션이 죽으면(페이지 닫힘·브라우저 교체·조회 throw) 다음 시도에서 1회 재로그인.
 */
let adminCache = null; // { browser, page, centerId }
let preflightFails = 0;
let preflightBackoffUntil = 0;
// 발송 허용 시간대 로그 스로틀 — 매 폴(15초) "시간대 밖 대기"를 찍으면 밤새 수백 줄 스팸이 된다(2026-07-22 원장 제보).
// 상태 전이(밖→안·안→밖)에서만 한 줄씩 남긴다. null=미확인(첫 폴은 항상 남김). true=창 안, false=창 밖.
let sendWindowOpen = null;

async function getAdminSession(browser) {
  if (adminCache && adminCache.browser === browser && !adminCache.page.isClosed()) return adminCache;
  await dropAdminSession();
  const page = await browser.newPage(); // ⚠️ 스크린샷용 context(아래 newContext)와 분리 — 그건 매 건 닫힘
  try {
    await loginClassnote(page);
    const centerId = await fetchCenterId(page);
    adminCache = { browser, page, centerId };
    return adminCache;
  } catch (e) {
    // cached에 못 넣은 page는 여기서 안 닫으면 영영 안 닫힌다 → 실패가 반복되면 컨텍스트가 쌓여 데몬 OOM.
    await page.close().catch(() => {});
    throw e;
  }
}

async function dropAdminSession() {
  const c = adminCache;
  adminCache = null;
  if (c) await c.page.close().catch(() => {});
}

/** too_old 최소날짜 = 오늘(로컬) 기준 전 달 1일. 워커도 belt-and-suspenders 가드. */
export function minDate() {
  const d = new Date();
  const y = d.getMonth() === 0 ? d.getFullYear() - 1 : d.getFullYear();
  const m = d.getMonth() === 0 ? 12 : d.getMonth(); // getMonth()=0-based → 전 달 = 그대로(1-based로 -1)
  return `${y}-${String(m).padStart(2, "0")}-01`;
}

/**
 * subject(subjectKey) → ClassNote 과목 라벨. injaewon ClassNote는 학생모드 보드 `(과목)학생명` 사용(실게시 검증됨).
 * P0-3(2026-07-10): 화이트리스트 — math·subject_1(고등수학)→수학, english→영어, **그 외/불명 = null(발송 불가)**.
 * 구버전은 else→"수학"이라 비수학 과목이 전부 (수학) 보드로 오게시될 수 있었음. 앱 게이트(classnote-guard.ts
 * CLASSNOTE_SENDABLE_SUBJECTS)와 동일 목록 유지할 것. (영어 학생모드 보드 실존 = 2026-07-10 기관설정 실사.)
 */
export function subjectLabel(subject) {
  if (subject === "english") return "영어";
  if (subject === "math" || subject === "subject_1") return "수학";
  return null;
}

/** ClassNote 보드 target(className) = 학생모드 `(과목)학생명`. 함수가 이 prefix로 학생모드 판정. */
export function boardClassName(subject, studentName) {
  const label = subjectLabel(subject);
  if (!label) throw new Error(`지원하지 않는 발송 과목(${subject ?? "없음"}) — ClassNote 보드 매핑 없음`);
  return `(${label})${studentName}`;
}

/** CLASSNOTE_TENANT_ID env 우선, 없으면 단일 테넌트 자동 해석, 여럿이면 오발송 방지 위해 중단. */
export async function resolveTenant(sql) {
  const env = process.env.CLASSNOTE_TENANT_ID;
  if (env) return env;
  const rows = await sql`select id from tenants`;
  if (rows.length === 1) return rows[0].id;
  throw new Error(`테넌트 ${rows.length}개 — CLASSNOTE_TENANT_ID env를 지정해야 함(공유 DB 오발송 방지)`);
}

/**
 * 발송 안전 스위치(긴급 킬스위치) — tenant_settings.data->'report'->>'classnoteSendEnabled'가 true일 때만 실게시.
 * 앱 게이트(saveAndQueue·retry·send)는 **신규 큐 진입만** 막고 이미 queued인 재고·멈춤복구분은 못 막았다(구조 구멍).
 * 워커가 매 폴 이 값을 직접 읽어 OFF면 게시를 건너뛴다 → 앱에서 스위치를 끄면 폴 주기(~15초) 내 실게시가 완전히 정지.
 * 워커는 postgres 직결이라 앱 unstable_cache와 무관하게 **커밋값을 즉시** 읽는다. 미저장/미토글/false = OFF
 * (fail-safe: 모르면 안 보냄). tenant 스코프 필수(공유 DB 오발송 방지 원칙).
 */
export async function isClassnoteSendEnabled(sql, tenant) {
  const [row] = await sql`select (data->'report'->>'classnoteSendEnabled')::boolean as on
    from tenant_settings where tenant_id=${tenant}`;
  return row?.on === true;
}

/**
 * 발송 허용 시간창(학원설정 `report.classnoteSendWindowStart/End`, KST "HH:MM") — 밤 수업 보고서가
 * 밤에 학부모 폰을 울리지 않게. 창 밖이면 processQueueOnce가 실게시 주기를 건너뛴다(큐 보존 —
 * 창 진입 시 그대로 이어서 발송). 미설정/한쪽만/형식 오류 = null(무제한, fail-open — 설정 실수로
 * 발송이 영영 멈추지 않게. 긴급 정지는 킬스위치 담당). isClassnoteSendEnabled와 동일하게 postgres
 * 직결이라 커밋값 즉시 반영. tenant 스코프 필수.
 */
export async function getClassnoteSendWindow(sql, tenant) {
  const [row] = await sql`select data->'report'->>'classnoteSendWindowStart' as s,
      data->'report'->>'classnoteSendWindowEnd' as e
    from tenant_settings where tenant_id=${tenant}`;
  return resolveSendWindow(row?.s ?? "", row?.e ?? "");
}

/**
 * 공유 보드 발송 예외 목록(학원설정 `report.classnoteSharedBoardAllowlist`) — 원장이 운영관리에서
 * **직접 확인해** "같은 학생이 학부모·본인 등 다계정으로 붙은 것"이라 판정한 보드명 배열(`(수학)안은지` 형식).
 * 프리플라이트 게이트는 연결 가족 2+ 보드를 기본 차단하는데, 여기 등재된 보드만 예외로 발송을 허용한다.
 * 미설정/빈 배열 = 예외 없음(모든 공유 보드 차단 = fail-safe). isClassnoteSendEnabled와 동일하게 postgres
 * 직결이라 커밋값을 즉시 읽는다(앱 캐시 무관). tenant 스코프 필수.
 */
export async function getClassnoteBoardAllowlist(sql, tenant) {
  const [row] = await sql`select coalesce(data->'report'->'classnoteSharedBoardAllowlist', '[]'::jsonb) as list
    from tenant_settings where tenant_id=${tenant}`;
  return Array.isArray(row?.list) ? row.list.filter((s) => typeof s === "string" && s.trim()) : [];
}

/**
 * 첨부 표시 토글(tenant_settings.data->'report'->>'showAttachments'). Phase 2 파일첨부 라우팅 게이트 —
 * OFF면 파일 있는 리포트도 Cloud Run(스샷)만(첨부 안 실음). isClassnoteSendEnabled와 동일하게 커밋값 즉시.
 */
export async function isShowAttachmentsEnabled(sql, tenant) {
  const [row] = await sql`select (data->'report'->>'showAttachments')::boolean as on
    from tenant_settings where tenant_id=${tenant}`;
  return row?.on === true;
}

const IMG_ATTACHMENT_RE = /\.(jpe?g|png|webp|gif)(\?|$)/i;

/**
 * 파일(비이미지) 첨부가 있는 리포트를 **내부 API로 게시**(Phase 2) — 스샷=`attached_images` + 파일=`attached_files` 한 POST.
 * ① 스샷 buffer → kage(`img`) ② eywa 내부 엔드포인트로 파일 signed URL → fetch → kage(`etc`) ③ board→child→enrollment
 * 해석 후 postClassnoteReport(이중 계정이면 전원). 반환 { ok, error? }. 리버스엔지니어링·학원이 POC 검증(2026-07-16).
 * ⚠️ 이미지 첨부(교재 등)는 **개별 부착하지 않는다**(2026-07-22 방향 B 확정) — /r 스샷 하단에 크게 실려 세로로
 *    완결(ParentReportCard). ClassNote가 attached_images를 가로로 나열해 세로가 안 됐던 문제를 스샷 내 배치로 우회.
 *    → 이미지만 있는 리포트는 이 경로로 **진입하지 않고**(진입 조건 fileAtts.length) Cloud Run 스샷 경로로 게시된다.
 */
export async function sendReportViaApi(adminPage, { report, studentName, boardId, centerId = null, screenshot, shareUrl, base, fileAtts = [], children, boardFallback = null, verifyDedup = true, log }) {
  // kage 업로드는 작성폼 네이티브 file input 경유(수동 FormData는 415) → adminPage를 add 폼으로 이동.
  // 이후 API 호출(resolve·post)은 same-origin이라 add 폼에서도 그대로 유효.
  await adminPage.goto(`${CLASSNOTE_BASE}/service/report/add`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await dismissHonorificDialog(adminPage).catch(() => {});
  // 폼 준비 대기 = **상태 기반**(2026-07-28 속도). 기존 고정 1.5초는 빠른 날엔 낭비, 느린 날엔 부족했다.
  // 실제로 필요한 건 "kage 업로드용 file input이 DOM에 붙었는가" 하나뿐이라 그것만 기다린다(보통 수백 ms).
  // 15초 안에 안 붙으면 그대로 진행 — 다음 단계(uploadToKage)의 Playwright auto-wait이 다시 기다리고,
  // 거기서도 없으면 그 단계의 오류로 명확히 실패한다(여기서 throw하면 원인이 뭉개진다).
  await adminPage
    .locator("input[data-testid='media-attachment-add-input']")
    .waitFor({ state: "attached", timeout: 15000 })
    .catch(() => {});

  // 1) 스샷 → kage(img input) → attached_images
  const imgKage = await uploadToKage(adminPage, "media-attachment-add-input", { name: `report_${studentName}.jpg`, mimeType: "image/jpeg", buffer: screenshot });
  const attachedImages = imgKage?.access_key
    ? [{ access_key: imgKage.access_key, original_file_name: `report_${studentName}.jpg`,
        file_size: imgKage.info?.img?.length ?? screenshot.length, width: imgKage.info?.img?.width, height: imgKage.info?.img?.height }]
    : [];
  if (!attachedImages.length) return { ok: false, error: "스샷 kage 업로드 실패" };

  // 2) eywa 내부 엔드포인트 → 파일 signed URL → fetch(바이트) → kage(doc input) → attached_files
  // ⚠️ 실패 원인을 **단계별로 구분해 error에 담는다**(2026-07-21). 이전엔 세 단계(목록조회·다운로드·kage)가
  // 전부 "파일 첨부 업로드 실패(전건) — eywa 엔드포인트/스토리지 확인" 한 줄로 뭉개져, 원인을 보려면 연동 PC의
  // watch.log를 사람이 열어야 했다(그 PC에 CLASSNOTE_OUT 폴더가 없으면 로그 파일 자체가 없어 추적 불가).
  // error는 DB(lesson_reports.classnote_error)에 남아 발송 콘솔·원격에서 그대로 읽힌다 = 물리 접근 불필요.
  // 무첨부 리포트(local 게시 모드의 기본 케이스, 2026-07-28)는 이 블록을 통째로 건너뛴다(스샷만 게시).
  const attachedFiles = [];
  if (fileAtts.length) {
  let epStatus = 0;
  const ep = await fetch(`${base}/api/internal/report-attachments/${report.id}`, {
    headers: INTERNAL_SECRET ? { "x-eywa-internal": INTERNAL_SECRET } : {},
  })
    .then(async (r) => {
      epStatus = r.status;
      return r.ok ? await r.json() : { files: [] };
    })
    .catch((e) => {
      epStatus = -1;
      log(`  · ${studentName}: 첨부 목록 조회 네트워크 실패 — ${e.message}`);
      return { files: [] };
    });
  const epFiles = ep.files ?? [];
  // 파일 첨부 리포트(경로 진입)인데 파일 URL을 하나도 못 받으면 서명/조회 실패.
  if (!epFiles.length) {
    const why =
      epStatus === -1
        ? "네트워크 연결 실패"
        : epStatus === 401
          ? "인증 실패(CLASSNOTE_INTERNAL_SECRET 불일치/미설정)"
          : epStatus === 404
            ? "엔드포인트 없음(앱 미배포)"
            : epStatus === 200
              ? "앱이 첨부 URL을 못 만듦(스토리지 서명 실패)"
              : `HTTP ${epStatus}`;
    return { ok: false, error: `첨부 목록 조회 실패 — ${why}` };
  }
  const failures = [];
  for (const f of epFiles) {
    let bytes;
    try {
      const res = await fetch(f.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      bytes = Buffer.from(await res.arrayBuffer());
    } catch (e) {
      failures.push(`다운로드 실패("${f.name}": ${e.message})`);
      log(`  · ${studentName}: 파일 "${f.name}" 다운로드 실패 — ${e.message}`);
      continue;
    }
    try {
      const fk = await uploadToKage(adminPage, "doc-attachment-add-input", { name: f.name, mimeType: "application/octet-stream", buffer: bytes });
      if (fk?.access_key) attachedFiles.push({ access_key: fk.access_key, original_file_name: f.name, file_size: fk.info?.size ?? bytes.length });
      else failures.push(`ClassNote 업로드 거부("${f.name}": access_key 없음)`);
    } catch (e) {
      failures.push(`ClassNote 업로드 실패("${f.name}": ${e.message})`);
      log(`  · ${studentName}: 파일 "${f.name}" ClassNote 업로드 실패 — ${e.message}`);
    }
  }
  if (attachedFiles.length !== fileAtts.length) log(`  · ${studentName}: 파일 ${attachedFiles.length}/${fileAtts.length} 업로드`);
  if (!attachedFiles.length) return { ok: false, error: `파일 첨부 실패 — ${failures.join(" / ") || "원인 불명"}` };
  } // if (fileAtts.length)

  // 3) board → child → enrollment
  // 이름으로 못 찾으면 **보드가 곧 매핑** 폴백(생년 대조 통과분만) — 학부모가 ClassNote에서 원아 이름을
  // 바꿔도 배정이 살아 있으면 발송된다(2026-07-23 박서연E 사례).
  let rejected = null;
  const enrolled = await resolveBoardChildEnrollments(adminPage, boardId, studentName, children, {
    ...(boardFallback ?? {}),
    onReject: (v) => {
      rejected = v;
    },
  });
  if (!enrolled.length)
    return { ok: false, error: rejected?.reason ?? "원아·enrollment 해석 실패(미가입/미배정)" };

  // 4) 게시 — 이중 계정(부모·본인)이면 전원. centerId가 있고 **첫 발송**(verifyDedup)일 때 자식별 3중 방어(2026-07-28):
  //    ⓐ 멱등 선확인 — 같은 share 링크가 이 원아에게 이미 게시돼 있으면 재게시 생략(크래시-재시도 중복 차단,
  //       §7-2 중복 게시 창의 구조적 해소). 조회 실패(ok=false)는 fail-closed(확인 못 하면 안 보냄 — 킬스위치 원칙).
  //    ⓑ 게시 실패 시에도 실게시 여부 재확인 — 응답만 믿으면 화면이 사실과 다른 말(공지 409 사고 교훈, 2026-07-27).
  //       실제로 올라갔으면 성공 취급해 재발송 중복을 원천 차단.
  //    ⓒ 게시 사후확인 — 2xx여도 목록에서 실물을 재확인(§7-3 '침묵 미발송 success' 계열의 역방향 방어).
  //       확인 조회 자체가 실패하면 2xx(REST 응답)를 근거로 성공 유지 + 경고 로그(재큐 루프 방지).
  //    ⚠️ verifyDedup=false = **의도적 재발송**(classnote_sent_at 있는 행) — 같은 share 링크의 옛 게시물이
  //       실존하므로 content 일치 판정 ⓐⓑⓒ 전부가 옛 글에 오염된다(ⓐ면 새 게시가 조용히 생략됨 = 침묵 무발송).
  //       재발송은 오늘의 Cloud Run과 동일하게 status 코드 신뢰로 동작한다.
  const dedupOn = centerId != null && verifyDedup;
  for (const { child, enrollment } of enrolled) {
    if (dedupOn) {
      const pre = await findChildReportId(adminPage, centerId, { cls: boardId, child: child.id, content: shareUrl });
      if (!pre.ok) return { ok: false, error: "게시 전 중복 확인 실패(ClassNote 조회 불가) — 안전상 보류" };
      if (pre.id) {
        log(`  · ${studentName}: 이미 게시됨(report ${pre.id}, 원아 ${child.id}) — 재게시 생략(멱등)`);
        continue;
      }
    }
    const res = await postClassnoteReport(adminPage, {
      cls: boardId, child: child.id, enrollment: enrollment.id, content: shareUrl,
      dateWritten: report.report_date, authorName: report.teacher_name || "인재원 학원",
      attachedImages, attachedFiles,
    });
    // 실패 사유는 **응답 본문까지** 남긴다(2026-07-27) — status만 적으면 왜 거부됐는지 영영 모른다.
    // 화면은 humanizeClassnoteError가 한글로 요약하고 원문은 '자세히'로만 보여준다(raw 노출 금지 규약).
    if (res.status < 200 || res.status >= 300) {
      // ⓑ 실패 응답인데 실제로 올라갔나 — 올라가 있으면 성공 취급(재발송=학부모에게 중복, ClassNote는 비가역).
      if (dedupOn) {
        const posted = await findChildReportId(adminPage, centerId, { cls: boardId, child: child.id, content: shareUrl });
        if (posted.ok && posted.id) {
          log(`  · ${studentName}: 게시 응답 HTTP ${res.status}였으나 실물 확인(report ${posted.id}) — 성공 취급`);
          continue;
        }
      }
      return { ok: false, error: `게시 실패(HTTP ${res.status})${res.detail ? ` — ${res.detail}` : ""}` };
    }
    if (dedupOn) {
      // 사후확인은 **먼저 조회하고, 없을 때만 기다린다**(2026-07-28 속도). 게시 직후 목록에 바로 뜨는 게
      // 보통이라 선(先)대기는 건당 1.5초를 그냥 버리는 셈이었다. 반영이 늦는 경우만 1.5초씩 최대 2회 더 본다.
      let verified = null;
      for (let i = 0; i < 3; i++) {
        if (i > 0) await adminPage.waitForTimeout(1500);
        verified = await findChildReportId(adminPage, centerId, { cls: boardId, child: child.id, content: shareUrl });
        if (verified.ok && verified.id) break;
      }
      if (verified?.ok && !verified.id)
        return { ok: false, error: "게시 응답은 정상이나 알림장 목록에서 확인 실패 — 재시도 대상(멱등 선확인이 중복을 막음)" };
      if (!verified?.ok) log(`  · ${studentName}: 게시 확인 조회 실패 — 2xx 응답 근거로 성공 유지(경고)`);
      else log(`  · ${studentName}: 게시 확인 완료(report ${verified.id}, 원아 ${child.id})`);
    }
  }
  return { ok: true };
}

/**
 * ClassNote 발송 큐 한 주기 처리 — stale 복구 → 원자 클레임 → 건별 스크린샷·게시·상태전이.
 * browser는 호출자가 관리(데몬은 루프 밖 1회 launch 재사용, one-shot은 매 실행 launch). tenant 격리 필수.
 * @returns {Promise<{stale:number, claimed:number, success:number, failed:number, requeued:number, blocked:number}>}
 *   blocked = 프리플라이트 보드 안전 게이트가 오발송 위험으로 보류한 건수(classnote_status='blocked_shared').
 */
export async function processQueueOnce(sql, browser, opts) {
  const {
    tenant,
    post = false,
    base = DEFAULT_BASE,
    shareBase = DEFAULT_SHARE_BASE,
    log = console.log,
  } = opts;
  const md = minDate();

  // 0) 긴급 킬스위치 — 실게시 모드(post)인데 발송 스위치가 OFF면 이 주기를 통째로 건너뛴다.
  // 앱 게이트가 못 막는 queued 재고·resetStuckClassnote 복구분까지 차단(단일 정지점). 큐는 손대지 않아
  // (클레임·stale 복구도 안 함) 스위치를 다시 켜면 그대로 이어서 처리된다. dry-run(post=false)은 영향 없음.
  if (post && !(await isClassnoteSendEnabled(sql, tenant))) {
    log("[worker] classnoteSendEnabled OFF — 실게시 중단(큐 보존, 클레임 안 함)");
    return { stale: 0, claimed: 0, success: 0, failed: 0, requeued: 0, blocked: 0 };
  }

  // 0-a) 발송 허용 시간창 — 실게시 모드(post)인데 창 밖이면 이 주기를 통째로 건너뛴다(킬스위치와 동형).
  // 큐는 손대지 않아(클레임·stale 복구도 안 함) 창 진입 폴부터 그대로 이어서 발송된다. 캡처(/r)는 발송
  // 시점에 일어나므로 지연은 무손실. dry-run(post=false)은 영향 없음(밤에도 파이프라인 점검 가능).
  // 무제한(null) = 기존 동작. 창 라벨은 로그로 남겨 watch.log에서 대기 사유가 보이게.
  if (post) {
    const sendWindow = await getClassnoteSendWindow(sql, tenant);
    if (!isWithinSendWindow(sendWindow)) {
      // 상태 전이(창 안/미확인 → 밖)에서만 한 줄 — 매 폴(15초) 반복 스팸 방지(sendWindowOpen 스로틀, 2026-07-22).
      if (sendWindowOpen !== false)
        log(`[worker] 발송 허용 시간대(${formatSendWindow(sendWindow)}) 밖 — 대기 시작(창 진입까지 조용히 대기, 큐 보존)`);
      sendWindowOpen = false;
      return { stale: 0, claimed: 0, success: 0, failed: 0, requeued: 0, blocked: 0 };
    }
    // 창 밖 → 안 전이도 한 줄(대기 재개 사유가 로그에서 닫히게).
    if (sendWindowOpen === false) log(`[worker] 발송 허용 시간대(${formatSendWindow(sendWindow)}) 진입 — 발송 재개`);
    sendWindowOpen = true;
  }

  // 0-b) 프리플라이트 백오프 — 준비가 연속 실패 중이면 **클레임조차 하지 않는다**.
  // 클레임 후 실패하면 claim→requeue가 매 폴 반복되며 로그인 폭풍을 만든다(자기강화 스로틀). 큐는 그대로 보존.
  if (post && Date.now() < preflightBackoffUntil) {
    log(`[worker] 프리플라이트 백오프 중(${Math.round((preflightBackoffUntil - Date.now()) / 1000)}초 남음) — 이 주기 건너뜀`);
    return { stale: 0, claimed: 0, success: 0, failed: 0, requeued: 0, blocked: 0 };
  }

  // 1) stale 복구: processing 10분 초과 → queued (tenant 격리)
  const stale = await sql`update lesson_reports set classnote_status='queued'
    where tenant_id = ${tenant} and classnote_status='processing'
      and classnote_processing_at < now() - (${STALE_MIN} || ' minutes')::interval
    returning id`;
  if (stale.length) log(`[worker] stale 복구 ${stale.length}건`);

  // 2) 원자 클레임: queued → processing (FOR UPDATE SKIP LOCKED, tenant 격리)
  const claimed = await sql`
    with cte as (
      select id from lesson_reports
      where tenant_id = ${tenant} and classnote_status='queued' and report_date >= ${md}
        and revoked_at is null
      order by classnote_queued_at nulls first limit ${BATCH}
      for update skip locked
    )
    update lesson_reports lr set classnote_status='processing', classnote_processing_at=now()
    from cte where lr.id=cte.id
    returning lr.id, lr.share_token, lr.report_date::text as report_date, lr.subject, lr.teacher_name, lr.student_id, lr.attachments, lr.classnote_sent_at`;
  const summary = { stale: stale.length, claimed: claimed.length, success: 0, failed: 0, requeued: 0, blocked: 0 };
  if (!claimed.length) return summary;
  log(`[worker] 클레임 ${claimed.length}건`);

  // 3) 프리플라이트 준비(실게시 모드만) — ClassNote 로그인 1회 + 보드 전건 1회 캐시 + 발송 예외 목록.
  // 오발송 방지 게이트(공유 보드 차단)의 근거 데이터. **fail-closed**: 준비에 실패해 보드를 검증할 수 없으면
  // 보내지 않는다 — 클레임분을 즉시 queued로 되돌리고 이 주기를 건너뛴다(다음 폴 재시도). 검증 못 하면 안 보냄이
  // 킬스위치(위)와 같은 원칙. dry-run(post=false)은 게시 자체를 안 하므로 준비도 게이트도 건너뛴다.
  let adminPage = null;
  let centerId = null;
  let boards = null;
  let allowlist = [];
  let allNames = [];
  let showAttachments = false; // Phase 2: 파일 리포트를 내부 API로 보낼지 라우팅 게이트
  let childrenCache = null; // Phase 2: 파일 리포트 첫 만남에 fetchChildren 1회 캐시
  if (post) {
    try {
      const admin = await getAdminSession(browser); // 세션 유지 — 폴마다 로그인하지 않는다(아래 주석)
      adminPage = admin.page;
      centerId = admin.centerId;
      // 독립 조회 — 직렬 대기 금지(B4).
      // ⚠️ allNames = **퇴원·예비 포함 전 학생** 유효이름 — 동명 판정 우주(boardNameAmbiguity)에 쓴다.
      // 재원만 보면 안 된다: 앱의 동명이인 게이트가 `status<>'withdrawn'`이라 **퇴원하는 순간 풀리는데**
      // ClassNote 보드엔 그 퇴원 가족이 그대로 남는다(실측: 김서윤·김채은이 이 경로로 무방비였다).
      const [b, a, nameRows] = await Promise.all([
        fetchBoards(adminPage, centerId),
        getClassnoteBoardAllowlist(sql, tenant),
        sql`select name, classnote_name from students where tenant_id = ${tenant}`,
      ]);
      boards = b;
      allowlist = a;
      allNames = nameRows.map((x) => (x.classnote_name || x.name || "").trim()).filter(Boolean);
      showAttachments = await isShowAttachmentsEnabled(sql, tenant);
      preflightFails = 0;
      preflightBackoffUntil = 0;
    } catch (e) {
      await dropAdminSession(); // 세션이 상했을 수 있다 → 다음 시도는 새 로그인
      adminPage = null;
      const ids = claimed.map((c) => c.id);
      const msg = e instanceof Error ? e.message : String(e);
      preflightFails++;
      // ⚠️ 지수 백오프 — 없으면 **조용한 무한 로그인 루프**가 된다: 비번 오류·CAPTCHA·스로틀이면
      // 매 폴(15초) claim → 로그인 실패 → 재큐를 영원히 반복하고, 화면엔 "대기 N · 실패 0 · 워커 온라인"으로
      // 완전 정상으로 보인다(하트비트는 이 함수 밖에서 찍힌다). 게다가 실패 로그인을 하루 수천 번 던져
      // 스로틀을 자기강화한다(실측: 반복 로그인 ~50% 실패).
      preflightBackoffUntil = Date.now() + Math.min(2 ** Math.min(preflightFails, 6) * 15_000, PREFLIGHT_BACKOFF_MAX_MS);
      // 사유를 행에 남긴다 — 재큐만 하면 원장 화면에 아무 흔적이 없어 "왜 안 나가지"를 알 길이 없다.
      await sql`update lesson_reports set classnote_status='queued',
        classnote_error=${`발송 준비 실패(${preflightFails}회) — ClassNote 확인 불가라 안전상 보류: ${msg.slice(0, 120)}`}
        where id in ${sql(ids)}`;
      log(
        `[worker] 프리플라이트 준비 실패 ${preflightFails}회(${msg}) — 안전상 게시 보류, ${ids.length}건 재큐잉 · ` +
          `${Math.round((preflightBackoffUntil - Date.now()) / 1000)}초 백오프`,
      );
      return { ...summary, requeued: ids.length };
    }
  }

  try {
  for (const r of claimed) {
    const [stu] = await sql`select name, classnote_name, grade from students where id=${r.student_id} and tenant_id=${tenant}`;
    // ClassNote 보드명·원아 = 유효이름(classnote_name 오버라이드 || name). 동명이인은 오버라이드로 구분(0088a).
    const studentName = (stu?.classnote_name?.trim() || stu?.name || "").trim();
    // P0-3: 보드 라벨이 없는 과목(비수학·비영어·subject null)은 재시도 무의미한 결정적 실패 — 즉시 failed.
    if (!subjectLabel(r.subject)) {
      await sql`update lesson_reports set classnote_status='failed',
        classnote_error=${`지원하지 않는 발송 과목(${r.subject ?? "없음"}) — ClassNote 보드 매핑이 없어 발송 불가`}
        where id=${r.id}`;
      summary.failed++;
      log(`  · ${studentName}: 과목 ${r.subject ?? "없음"} — 보드 매핑 없음 → failed`);
      continue;
    }
    const className = boardClassName(r.subject, studentName); // 학생모드 보드 `(과목)학생명`
    let boardId = null; // Phase 2 내부 API 경로용 — 보드안전 게이트 통과 시 verdict.boardId

    // ⛔ 프리플라이트 보드 안전 게이트(실게시 모드만) — **스크린샷·게시 전에** 판정(불필요한 캡처 회피).
    // 한 보드에 서로 다른 2가족+가 연결돼 있으면 이 학생 보고서가 남의 가족에게도 게시된다(실제 사고: 2026-07-15
    // `(수학)박서준`에 초6·중3 두 가족 동거 — 초6 보고서가 중3 집에 노출). eywa DB엔 보드 멤버십이 없어
    // **여기(ClassNote 조회 가능한 워커)가 유일한 차단 지점**. 판정=board-safety.mjs 순수함수(공지 워커와 공용).
    if (post) {
      // 1차 = 보드 존재/중복 + 예외 등재 확인(보드 조회 캐시만 사용, 추가 요청 0).
      let verdict = evaluateBoardSafety({ className, boards, allowlist });
      // 2차 = **모호한 이름일 때만** 원아를 실시간 조회해 매핑 검증(생일 ↔ 학년). 모호하지 않으면 요청 0.
      // 모호 = 같은 이름 2명+(퇴원 포함) 또는 `이름+알파벳` 형제 — 학부모는 가입 시 알파벳을 안 붙이므로
      // 보드명 하나가 여러 학생을 가리킬 수 있다(박서준 사고 경로).
      const amb = boardNameAmbiguity(studentName, allNames);
      if (verdict.ok && amb.ambiguous) {
        const live = await fetchBoardChildren(adminPage, centerId, verdict.boardId).catch(() => null);
        verdict = Array.isArray(live)
          ? evaluateBoardSafety({
              className,
              boards,
              allowlist,
              mapping: { grade: stu?.grade ?? null, children: live, schoolYear: kstSchoolYear() },
            })
          : {
              ok: false,
              code: "mapping_unknown",
              reason: `동명이인이 있는 이름이라 원아 확인이 필요한데 클래스노트 조회에 실패해 보류합니다(${className})`,
            };
        if (!verdict.ok && amb.siblings.length)
          verdict.reason = `${verdict.reason} (eywa 동명: ${amb.siblings.join(", ")}${amb.sameName > 1 ? ` · 같은 이름 ${amb.sameName}명` : ""})`;
      }
      if (!verdict.ok) {
        await sql`update lesson_reports set classnote_status='blocked_shared',
          classnote_error=${verdict.reason}, classnote_queued_at=null where id=${r.id}`;
        summary.blocked++;
        log(`  · ${studentName}: 게시 보류(${verdict.code}) — ${className}`);
        continue;
      }
      boardId = verdict.boardId ?? null;
    }
    try {
      // 스크린샷 (INTERNAL_SECRET 헤더 → /r이 조회로그 skip)
      const ctx = await browser.newContext({
        viewport: { width: 800, height: 1200 },
        deviceScaleFactor: 2,
        ...(INTERNAL_SECRET ? { extraHTTPHeaders: { "x-eywa-internal": INTERNAL_SECRET } } : {}),
      });
      const page = await ctx.newPage();
      // waitUntil은 'domcontentloaded' — 'networkidle'은 /r이 로고 이미지를 Firebase 서명 URL로 불러오는데
      // 발송 PC 망에서 그 요청이 늘어지면 '네트워크 완전 정지'가 영영 안 떠 30초 타임아웃(실측 2026-07-10).
      // DOM 로드 후 fonts.ready + 700ms 정착으로 렌더 완성도는 확보되므로 취약한 networkidle 의존을 뺀다.
      await page.goto(`${base}/r/${r.share_token}`, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.evaluate(() => document.fonts?.ready).catch(() => {});
      // 로고·학생사진 등 이미지가 스크린샷에 담기도록 로드 대기(최대 8초, 실패해도 진행 — 캡처는 계속).
      await page
        .waitForLoadState("load", { timeout: 8000 })
        .catch(() => {});
      await new Promise((x) => setTimeout(x, 700));
      const card = page.locator(".report-capture").first(); // ParentReportCard 루트(공유 컴포넌트) — 폭 유틸과 분리된 안정 마커
      const buf = (await card.count())
        ? await card.screenshot({ type: "jpeg", quality: 90 })
        : await page.screenshot({ type: "jpeg", quality: 90, fullPage: true });
      await ctx.close();
      const imageBase64 = `data:image/jpeg;base64,${buf.toString("base64")}`;
      const payload = {
        loginId: process.env.CLASSNOTE_UPLOAD_ID,
        loginPw: process.env.CLASSNOTE_UPLOAD_PW,
        reports: [{
          reportId: r.id, studentName, className, teacherName: className,
          reportDate: `${r.report_date}T12:00:00`, imageBase64, isExactMatchNeeded: true,
          shareUrl: `${shareBase}/r/${r.share_token}`,
        }],
      };
      log(`  · ${studentName} (${r.subject ?? "-"}) 보드="${className}" img=${buf.length}B`);

      if (!post) {
        // dry-run: 게시 안 하고 다시 queued로 반환(재처리 가능하게)
        await sql`update lesson_reports set classnote_status='queued' where id=${r.id}`;
        summary.requeued++;
        continue;
      }
      // 게시 직전 취소(revoke) 재확인 — claim~여기 사이에 강사가 취소했을 수 있음(死링크 게시 방지).
      // + 킬스위치 재확인(2026-07-28) — 주기 시작 후 스위치가 꺼졌으면 이 건부터 게시하지 않는다(배치 중 정지).
      const [fresh] = await sql`select revoked_at from lesson_reports where id=${r.id}`;
      if (fresh?.revoked_at) {
        await sql`update lesson_reports set classnote_status='queued' where id=${r.id}`;
        summary.requeued++;
        log(`  · ${studentName}: 취소됨 → 게시 skip`);
        continue;
      }
      if (!(await isClassnoteSendEnabled(sql, tenant))) {
        await sql`update lesson_reports set classnote_status='queued' where id=${r.id}`;
        summary.requeued++;
        log(`  · ${studentName}: 킬스위치 OFF 감지(주기 중) → 게시 skip, 재큐`);
        continue;
      }

      // ── 내부 API 게시 경로 ──
      // 진입 조건 2종:
      //  · Phase 2(기존): 파일 첨부(비이미지) + showAttachments ON — 스샷=attached_images + 파일=attached_files.
      //  · local 게시 모드(2026-07-28, §10 옵션 B): CLASSNOTE_PUBLISH_MODE=local이면 **모든** 리포트가 이 경로
      //    (Cloud Run 미호출). 파일 첨부는 showAttachments ON일 때만 싣는다(기존 정책 유지).
      // ⚠️ 이미지 첨부만 있는 리포트는 파일로 싣지 않는다(2026-07-22 방향 B) — 이미지는 /r 스샷 하단에 크게 실림.
      const fileAtts = (r.attachments ?? []).filter((a) => a?.name && !IMG_ATTACHMENT_RE.test(a.name));
      const localMode = isLocalPublish();
      const wantApiPath = (showAttachments && fileAtts.length > 0) || localMode;
      if (wantApiPath && !boardId) {
        // 이론상 도달 불가(post 게이트 통과 시 boardId 확보) — 도달하면 코드 결함이므로 fail-closed 재큐 + 명시 로그.
        await sql`update lesson_reports set classnote_status='queued',
          classnote_error=${"내부 API 게시 경로인데 보드 ID가 없음(게이트 결함 의심) — 안전상 보류"} where id=${r.id}`;
        summary.requeued++;
        log(`  · ${studentName}: boardId 없음(API 경로) → 재큐 [코드 결함 의심 — 점검 필요]`);
        continue;
      }
      if (wantApiPath) {
        const sendFiles = showAttachments ? fileAtts : []; // 첨부 표시 OFF면 파일 안 실음(스샷만) — 기존 정책
        childrenCache ??= await fetchChildren(adminPage, centerId); // 첫 만남에 1회
        const result = await sendReportViaApi(adminPage, {
          report: r, studentName, boardId, centerId, screenshot: buf, shareUrl: `${shareBase}/r/${r.share_token}`,
          base, fileAtts: sendFiles, children: childrenCache, log,
          // 첫 발송만 3중 방어(멱등·사후확인) — classnote_sent_at 있는 행 = 의도적 재발송이라 content 판정이
          // 옛 게시물에 오염된다(sendReportViaApi 4) 주석). 재발송은 status 코드 신뢰(오늘의 Cloud Run과 동일 의미).
          verifyDedup: !r.classnote_sent_at,
          boardFallback: { centerId, grade: stu?.grade ?? null, schoolYear: kstSchoolYear() },
        });
        if (result.ok) {
          await sql`update lesson_reports set classnote_status='success', classnote_sent_at=now(), classnote_error=null where id=${r.id}`;
          summary.success++;
          log(`    → success (내부 API${sendFiles.length ? `, 파일 ${sendFiles.length}건` : ""}${localMode ? ", local" : ""})`);
        } else {
          await sql`update lesson_reports set
            classnote_retry_count = classnote_retry_count + 1,
            classnote_status = case when classnote_retry_count + 1 >= 3 then 'failed' else 'queued' end,
            classnote_error = ${result.error}
            where id=${r.id}`;
          summary.failed++;
          log(`    → 실패(API): ${result.error} (재시도+1)`);
        }
        continue;
      }

      // 실게시 (Cloud Run — 파일 없는 리포트, 기존 경로. local 모드에선 위 API 경로가 전건을 가져가 도달 불가)
      // ⚠️ 중복 게시 방지(구멍2): abort 타임아웃을 Cloud Run 함수 상한(900s) **위**로 둔다. 이전 120s는
      // 함수가 아직 게시 중인데 워커가 중도 abort→catch에서 retry_count+1 후 queued로 되돌려 다음 폴에
      // 재게시 = 같은 보고서가 학부모에게 2번 갔다(fetch를 끊어도 서버 실행은 안 멈춤). 함수 상한 위로 올리면
      // 정상 실행 중 abort가 사라져 이 중복 창이 닫힌다. (완전 멱등은 함수측 reportId dedupe 필요 — edutrix repo.)
      const ac = new AbortController();
      const to = setTimeout(() => ac.abort(), 960000);
      const res = await fetch(CLOUD_RUN, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: ac.signal });
      clearTimeout(to);
      const json = await res.json().catch(() => ({}));
      const ok = json?.success && json?.results?.[0]?.success;
      if (ok) {
        await sql`update lesson_reports set classnote_status='success', classnote_sent_at=now(), classnote_error=null where id=${r.id}`;
        summary.success++;
        log(`    → success`);
      } else {
        const msg = json?.results?.[0]?.message || json?.message || `HTTP ${res.status}`;
        await sql`update lesson_reports set
          classnote_retry_count = classnote_retry_count + 1,
          classnote_status = case when classnote_retry_count + 1 >= 3 then 'failed' else 'queued' end,
          classnote_error = ${msg}
          where id=${r.id}`;
        summary.failed++;
        log(`    → 실패: ${msg} (재시도 카운트+1)`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await sql`update lesson_reports set
        classnote_retry_count = classnote_retry_count + 1,
        classnote_status = case when classnote_retry_count + 1 >= 3 then 'failed' else 'queued' end,
        classnote_error = ${msg}
        where id=${r.id}`;
      summary.failed++;
      log(`  · ${studentName}: 처리 오류 → ${msg}`);
    }
  }
  } catch (e) {
    // 처리 중 예기치 못한 오류 → 세션이 상했을 수 있으니 버린다(다음 폴에서 새 로그인). 누수 방지도 겸함.
    await dropAdminSession();
    throw e;
  }
  // ⚠️ 여기서 adminPage를 닫지 않는다 — **폴 사이에 세션을 유지**하는 게 이 코어의 비용 설계다(getAdminSession 주석).
  // one-shot(process-classnote-queue.mjs)은 프로세스가 끝나며 browser가 닫히므로 함께 정리된다.
  return summary;
}

/** 세션 정리 — 데몬이 브라우저를 버릴 때(오류 복구) 함께 호출해 누수를 막는다. */
export async function closeClassnoteAdminSession() {
  await dropAdminSession();
}

/** Playwright chromium 실행 헬퍼(코어와 데몬 공용 — 옵션 통일). */
export function launchBrowser() {
  return chromium.launch({ headless: true });
}
