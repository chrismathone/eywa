import { protectScreenshotHeaders } from "./screenshot-auth.mjs";
import { buildReportAuthorMap, reportAuthorNameFor } from "./report-author-name.mjs";
// scripts/_classnote/classnote-core.mjs — ClassNote 발송 처리 코어 (one-shot·데몬 공용).
//
// stale 복구 + SKIP LOCKED 원자 클레임 + 건별 스크린샷·내부 API 게시·재시도 로직을 processQueueOnce로 묶어
// one-shot(process-classnote-queue.mjs)과 상주 데몬(watch-classnote-queue.mjs)이 동일 코어를 공유한다.
//
// ⚠️ tenant 격리 필수 — DATABASE_URL 직결(RLS 우회)이라 필터 없으면 다른 테넌트 보고서를 이 계정으로 게시.
import { chromium } from "@playwright/test";
import {
  CLASSNOTE_BASE, dismissHonorificDialog,
  loginClassnote, fetchCenterId, fetchBoards, fetchBoardChildren,
  fetchChildren, uploadToKage, uploadToKageDetailed, resolveBoardChildEnrollments, postClassnoteReport,
  findChildReportId,
} from "./classnote-admin-core.mjs";
import { boardNameAmbiguity, evaluateBoardSafety, kstSchoolYear } from "./board-safety.mjs";
import { homonymPhoneGate } from "./homonym-phone-gate.mjs";
import { fetchAdmissions } from "./math-class-boards-load.mjs";
import { resolveSendWindow, isWithinSendWindow, formatSendWindow } from "./send-window.mjs";
import { hasMentText } from "./ment-text.mjs";
import { CURRENT_SHARE_BASE, shareUrlVariants } from "./share-bases.mjs";
import { fetchVideoSubmitLine, reportPostContent } from "./report-video-line.mjs";
import { attachedVideoOf, isVideoName, videoUploadWaitMs } from "./report-video.mjs";
import { createWriteStream } from "node:fs";
import { readdir, stat, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { decideRoute, pickRouteClass, ROUTE_BLOCKED_MESSAGE } from "./class-route-decide.mjs";
import { crossCheckOthers, isClassRouteEligible, isMakeupDeliveryEligible, resolveClassTargets } from "./classnote-class-route.mjs";
import { classRouteHaltReason, haltClassRoute } from "./class-route-halt.mjs";
import { englishAnchorClass, isMissingTable, loadEnglishClassBoard, resolveEnglishClassTargets } from "./english-class-route.mjs";
import { isRawModuleEnabled } from "../_shared/module-state.mjs";

/**
 * 🔴 게시 엔진 = **워커 내장(내부 API) 단일 경로**. Cloud Run(edutrix Firebase `submitToClassNoteV2`) 분기는
 * 2026-07-29 제거했다(§10 옵션 B 완료).
 *
 * 왜 스위치를 없앴나: 폴백이 남아 있으면 `CLASSNOTE_PUBLISH_MODE=local` **env 한 줄이 빠지는 순간**
 * (워커 재설치·zip 부분전달·PC 교체) 조용히 Cloud Run으로 되돌아간다. edutrix Firebase를 이미 껐다면
 * 그 순간 전 발송이 실패하고, 원인은 "왜 갑자기 안 가지"로만 보인다 — 소등 계획에서 가장 위험한 지뢰였다.
 * 단일 경로면 env가 어떻든 동작이 같다(= 소등해도 안전).
 *
 * 실전 근거: local 모드 전환 후 2026-07-28~29 발송이 내부 API 경로로 정상 처리됐다(무첨부 리포트 포함).
 * 롤백이 필요하면 이 커밋을 되돌린다 — env로 되살리는 길은 의도적으로 남기지 않는다.
 */
export const DEFAULT_BASE = process.env.CLASSNOTE_SCREENSHOT_BASE || "http://localhost:3113"; // 스크린샷용(로컬 dev 가능)
// 게시글 상단 공유 링크(/r) 공개 도메인 — env가 없으면 지금 도메인(share-bases.mjs 단일 소스, 회수와 같은 값).
export const DEFAULT_SHARE_BASE = process.env.CLASSNOTE_SHARE_BASE || CURRENT_SHARE_BASE;
// 작성자 이름이 빈 글의 작성자 표기 — 워커는 PC(=지점)마다 하나라 env로 지점별 값을 준다. 기본값은 종전 그대로(침산 무변화).
export const DEFAULT_AUTHOR_NAME = process.env.CLASSNOTE_AUTHOR_NAME?.trim() || "인재원 학원";
export const BATCH = 2;
// 게시 1건 상한(POST_TIMEOUT_MS 10분)보다 **길어야** 한다(개명 감사 G6) — 같으면 아직 게시 중인 행을 stale로 되살려 다시 집는다.
export const STALE_MIN = 15;
// /r이 이 secret 헤더를 보면 조회로그(share_link_views)를 안 남김 — 워커 스크린샷을 "학부모 열람"으로 오집계 방지(P2a).
const INTERNAL_SECRET = process.env.CLASSNOTE_INTERNAL_SECRET;

const PREFLIGHT_BACKOFF_MAX_MS = 10 * 60_000; // 준비 실패 시 최대 백오프(10분) — 무한 로그인 루프 차단
/** 게시 1건 상한(2026-07-29) — 초과 시 failed 고정. 스샷 업로드+API 왕복은 실측 수~수십초라 10분이면 정상 건은 절대 안 걸린다. */
export const POST_TIMEOUT_MS = 10 * 60_000;

/** 게시 호출에 상한을 씌운다 — 초과하면 `{ ok:false, timedOut:true }`(호출자가 failed로 고정). */
async function withPostTimeout(promise) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, timedOut: true }), POST_TIMEOUT_MS);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

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
/**
 * 반 보드 경로 **비상 정지**(2026-09-29) — 게시 후 교차 확인에서 같은 반 다른 원아에게 이 보고서 링크가 보이면 켜진다.
 * 켜지면 이 프로세스가 사는 동안 반 보드 경로 게시를 전부 멈춘다(1인 보드 경로는 그대로). 워커를 다시 켜야 풀린다 —
 * 사람이 원인을 확인하기 전에 저절로 풀리면 같은 사고가 이어진다.
 */
let classRouteHalted = false;

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

/**
 * too_old 최소날짜 = **오늘 포함 최근 7일 창의 시작일**(오늘-6, 로컬=KST PC 전제).
 * 🔴 2026-07-28 원장 절대 규칙: "학부모가 일주일이 지났는데 이전 보고서를 받는 것도 비합리적" —
 * 앱의 classnoteMinDate(classnote-guard.ts)와 같은 창. 워커는 모든 발송이 지나는 최종 관문이라
 * 앱을 우회한 큐잉(직접 DB·재고·복구분)도 여기서 걸린다. **완화 금지.**
 * 유일한 예외 = 원장이 건마다 지정한 행(0276a, 2026-09-21 — processQueueOnce 위 hasDeadlineExemptColumn).
 */
export function minDate() {
  const d = new Date();
  d.setDate(d.getDate() - 6);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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
  if (row?.on !== true) return false;
  // 모듈이 꺼진 학원은 발송 스위치가 켜져 있어도 보내지 않는다(원장 2026-09-30 "꺼지면 있었는지조차 모르게").
  return isClassnoteModuleEnabled(sql, tenant);
}

/**
 * 이 학원에 ClassNote 기능(모듈)이 켜져 있나 — 앱 `isModuleEnabled(settings.modules.disabled, "classnote")`와 같은 판정.
 * 저장은 `data.modules.disabled`(끈 것만)와 저장 당시 목록 `known`. 일반판은 저장 뒤 추가된 모듈도 끈 것으로 보고,
 * 칸이 없으면 전부 꺼진 채 태어난다(GENERIC_DISABLED_MODULES). 그 밖(침산)은 `known`을 무시하고 전부 켜며,
 * 행이 없으면 침산 = 켜짐(앱 resolve와 같은 쪽으로 기운다).
 * 꺼져 있으면 데몬은 이 학원의 ClassNote 일(발송·공지·회수·동기화·피드·읽음)을 **전부** 건너뛴다.
 */
export async function isClassnoteModuleEnabled(sql, tenant) {
  const [row] = await sql`select data->'preset' as preset, data->'modules' as modules
    from tenant_settings where tenant_id=${tenant}`;
  return isRawModuleEnabled(row, "classnote");
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
 * OFF면 파일 있는 리포트도 스샷만 게시(첨부 안 실음). isClassnoteSendEnabled와 동일하게 커밋값 즉시.
 */
export async function isShowAttachmentsEnabled(sql, tenant) {
  const [row] = await sql`select (data->'report'->>'showAttachments')::boolean as on
    from tenant_settings where tenant_id=${tenant}`;
  return row?.on === true;
}

const IMG_ATTACHMENT_RE = /\.(jpe?g|png|webp|gif)(\?|$)/i;

/**
 * 보고서 영상 하나 → ClassNote 영상 칸(2026-11-06). 앱 서명 주소에서 **임시 파일로** 받아(50MB 넘는 버퍼는 Playwright가 거절)
 * 작성 화면의 사진·영상 입력에 경로로 넣고, 영상 응답(그림 응답이 아닌 것)의 키를 잡는다. 임시 파일은 늘 지운다.
 * 반환 `{ ok, video }` 또는 `{ ok:false, error }`(사람 문장 — classnote_error에 그대로 남는다).
 */
async function uploadReportVideo(adminPage, file, { log, studentName, deadline }) {
  // 🔴 마감(deadline) = 게시 1건 상한(POST_TIMEOUT_MS)보다 **먼저** 끝나게(적대적 리뷰 2026-11-06). 상한을 넘기면 행은 failed로
  //    넘어가지만 이 호출은 같은 작성 화면에서 계속 돌아, 다음 보고서의 응답 키를 잡거나 늦게 게시할 수 있다.
  const left = () => deadline - Date.now();
  const ext = (String(file.name).split(".").pop() || "mp4").toLowerCase().replace(/[^a-z0-9]/g, "") || "mp4";
  const tmp = path.join(tmpdir(), `aywa-report-video-${randomUUID()}.${ext}`);
  const started = Date.now();
  // 지난 실행이 남긴 임시 영상(1시간 넘은 것)을 지운다 — 지우기 실패·강제 종료로 남을 수 있다(최대 100MB · 1.0.19 리뷰).
  for (const n of await readdir(tmpdir()).catch(() => [])) {
    if (!/^aywa-report-video-[0-9a-f-]{36}\.[a-z0-9]+$/.test(n)) continue;
    const old = path.join(tmpdir(), n);
    const st = await stat(old).catch(() => null);
    if (st && Date.now() - st.mtimeMs > 3_600_000) await unlink(old).catch(() => {});
  }
  if (left() < 3 * 60_000) return { ok: false, error: "영상 첨부 실패 — 게시 시간 안에 올릴 시간이 모자랐습니다(다시 시도합니다)" };
  try {
    try {
      const signal = AbortSignal.timeout(Math.max(1_000, Math.min(120_000, left() - 60_000)));
      const res = await fetch(file.url, { signal });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp), { signal });
    } catch (e) {
      log(`  · ${studentName}: 영상 "${file.name}" 다운로드 실패 — ${e.message}`);
      return { ok: false, error: `영상 첨부 실패 — 영상을 내려받지 못했습니다("${file.name}")` };
    }
    const size = (await stat(tmp)).size;
    if (left() < 60_000) return { ok: false, error: "영상 첨부 실패 — 영상을 받는 데 시간이 너무 걸렸습니다(다시 시도합니다)" };
    // 작성 화면을 새로 연다 — 같은 화면에 이미 보고서 그림을 넣어 둔 상태라 화면이 영상을 함께 받지 않을 수 있다
    // (사진·영상이 한 칸이다). 그림·파일의 키는 이미 받아 두었으므로 새로 열어도 잃는 것이 없다.
    try {
      await adminPage.goto(`${CLASSNOTE_BASE}/service/report/add`, { waitUntil: "domcontentloaded", timeout: 30000 });
    } catch {
      return { ok: false, error: "영상 첨부 실패 — ClassNote 작성 화면을 열지 못했습니다" };
    }
    await adminPage.locator("input[data-testid='media-attachment-add-input']").waitFor({ state: "attached", timeout: 15000 }).catch(() => {});
    if (left() < 60_000) return { ok: false, error: "영상 첨부 실패 — 게시 시간 안에 올릴 시간이 모자랐습니다(다시 시도합니다)" };
    const up = await uploadToKageDetailed(
      adminPage,
      "media-attachment-add-input",
      { name: file.name, filePath: tmp },
      { subject: "영상", waitMs: Math.min(videoUploadWaitMs(size), left() - 30_000), accept: (j) => !j?.info?.img },
    );
    const video = up.ok ? attachedVideoOf(up.kage, { name: file.name, size }) : null;
    log(`  · ${studentName}: 영상 ${(size / 1024 / 1024).toFixed(1)}MB ${video ? "업로드" : "업로드 실패"} (${Math.round((Date.now() - started) / 1000)}초)`);
    if (!video) return { ok: false, error: up.reason || "영상 첨부 실패 — ClassNote가 영상을 받지 않았습니다" };
    return { ok: true, video };
  } finally {
    await unlink(tmp).catch(() => {});
  }
}

/**
 * 리포트를 **내부 API로 게시**(2026-07-29부터 **모든** 리포트의 유일 경로) — 스샷=`attached_images` + 파일=`attached_files` 한 POST.
 * ① 스샷 buffer → kage(`img`) ② aywa 내부 엔드포인트로 파일 signed URL → fetch → kage(`etc`) ③ board→child→enrollment
 * 해석 후 postClassnoteReport(이중 계정이면 전원). 반환 { ok, error? }. 리버스엔지니어링·학원이 POC 검증(2026-07-16).
 * ⚠️ 이미지 첨부(교재 등)는 **개별 부착하지 않는다**(2026-07-22 방향 B 확정) — /r 스샷 하단에 크게 실려 세로로
 *    완결(ParentReportCard). ClassNote가 attached_images를 가로로 나열해 세로가 안 됐던 문제를 스샷 내 배치로 우회.
 *    → 이미지만 있는 리포트는 `fileAtts`가 비어 파일 첨부 없이 **스샷만** 게시된다(경로는 동일).
 */
export async function sendReportViaApi(adminPage, { report, studentName, boardId, centerId = null, screenshot, shareUrl, videoUrl = null, base, fileAtts = [], videoAtts = [], children, boardFallback = null, verifyDedup = true, targets = null, log }) {
  const sendStarted = Date.now();
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
  // ⚠️ 실패하면 **사유를 갈라서** 담는다(2026-09-04, 원장 "스샷 경로도 실패 사유 구분되게"). 종전엔
  //    네 갈래(빈 캡처·첨부 칸 없음·kage 거부·무응답)가 전부 "스샷 kage 업로드 실패" 한 줄이라
  //    DB만 보고는 원인을 못 좁혔다(곽하윤 9/4 — 3회 재시도 전건 실패, 이유 불명).
  //    파일첨부(아래)는 2026-07-21에 이미 같은 이유로 단계별 사유를 담게 고쳤다 — 이제 짝이 맞는다.
  const imgKage = await uploadToKageDetailed(
    adminPage,
    "media-attachment-add-input",
    { name: `report_${studentName}.jpg`, mimeType: "image/jpeg", buffer: screenshot },
    { subject: "보고서 이미지" },
  );
  const attachedImages = imgKage.kage?.access_key
    ? [{ access_key: imgKage.kage.access_key, original_file_name: `report_${studentName}.jpg`,
        file_size: imgKage.kage.info?.img?.length ?? screenshot.length, width: imgKage.kage.info?.img?.width, height: imgKage.kage.info?.img?.height }]
    : [];
  // 사유가 비는 경우는 없어야 하지만(ok=false면 항상 채운다) **error가 null로 저장되는 것만은 막는다** —
  // 화면이 "실패인데 사유 없음"으로 보이면 이번에 고친 것이 무의미해진다.
  if (!attachedImages.length) return { ok: false, error: imgKage.reason || "보고서 이미지 업로드 실패 — 원인을 알 수 없습니다. 워커 로그를 확인하세요" };

  // 2) aywa 내부 엔드포인트 → 파일 signed URL → fetch(바이트) → kage(doc input) → attached_files
  // ⚠️ 실패 원인을 **단계별로 구분해 error에 담는다**(2026-07-21). 이전엔 세 단계(목록조회·다운로드·kage)가
  // 전부 "파일 첨부 업로드 실패(전건) — aywa 엔드포인트/스토리지 확인" 한 줄로 뭉개져, 원인을 보려면 연동 PC의
  // watch.log를 사람이 열어야 했다(그 PC에 CLASSNOTE_OUT 폴더가 없으면 로그 파일 자체가 없어 추적 불가).
  // error는 DB(lesson_reports.classnote_error)에 남아 발송 콘솔·원격에서 그대로 읽힌다 = 물리 접근 불필요.
  // 무첨부 리포트(local 게시 모드의 기본 케이스, 2026-07-28)는 이 블록을 통째로 건너뛴다(스샷만 게시).
  const attachedFiles = [];
  // 영상(2026-11-06) — 글의 영상 칸(attached_video) 하나. 같은 내부 엔드포인트가 주는 주소로 받는다(문서 칸으로는 올리지 않는다).
  let attachedVideo = null;
  if (fileAtts.length || videoAtts.length) {
  let epStatus = 0;
  const ep = await fetch(`${base}/api/internal/report-attachments/${report.id}`, {
    redirect: "error", headers: INTERNAL_SECRET ? { "x-eywa-internal": INTERNAL_SECRET } : {},
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
  // 문서 칸에는 영상이 아닌 파일만(첨부 표시가 켜져 있을 때 = fileAtts가 있을 때만) — 영상은 아래에서 영상 칸으로.
  const docFiles = fileAtts.length ? epFiles.filter((f) => !isVideoName(f.name)) : [];
  for (const f of docFiles) {
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
  if (fileAtts.length) {
    if (attachedFiles.length !== fileAtts.length) log(`  · ${studentName}: 파일 ${attachedFiles.length}/${fileAtts.length} 업로드`);
    if (!attachedFiles.length) return { ok: false, error: `파일 첨부 실패 — ${failures.join(" / ") || "원인 불명"}` };
  }
  if (videoAtts.length) {
    // 🔴 영상을 못 올리면 **보내지 않는다**(영상 없이 나가면 선생님이 붙인 영상이 조용히 빠진다) — 재시도에 맡긴다.
    const vf = epFiles.find((f) => isVideoName(f.name));
    if (!vf) return { ok: false, error: "영상 첨부 실패 — 앱이 영상 주소를 주지 않았습니다(스토리지 서명 실패)" };
    // 마감 = 이 게시 호출 시작 + 상한 − 3분(게시·중복 확인 몫)
    const v = await uploadReportVideo(adminPage, vf, { log, studentName, deadline: sendStarted + POST_TIMEOUT_MS - 3 * 60_000 });
    if (!v.ok) return { ok: false, error: v.error };
    attachedVideo = v.video;
  }
  } // if (fileAtts.length || videoAtts.length)

  // 3) board → child → enrollment
  // 이름으로 못 찾으면 **보드가 곧 매핑** 폴백(생년 대조 통과분만) — 학부모가 ClassNote에서 원아 이름을
  // 바꿔도 배정이 살아 있으면 발송된다(2026-07-23 박서연E 사례).
  // 🔴 반 보드 경로(targets)는 이미 확정된 원아만 쓴다 — 이름 해석·"보드가 곧 매핑" 폴백을 **절대 타지 않는다**
  //    (반 보드는 다인 반이라 폴백이 돌면 같은 학년 반 전원이 통과한다 — classnote-class-route.mjs).
  let rejected = null;
  const enrolled = targets
    ? targets
    : await resolveBoardChildEnrollments(adminPage, boardId, studentName, children, {
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
  // ⚠️ 이중 계정(부모·본인) 학생은 원아가 2+다. 앞 원아가 성공한 뒤 뒤가 실패하면 **부분 성공**이고,
  // 이걸 그냥 실패로 돌려주면 워커가 재시도 → 이미 받은 집에 **같은 글이 한 번 더** 간다(ClassNote는 삭제 불가).
  // → 부분 성공은 `partial:true`로 표시해 호출자가 **재시도 없이 failed로 고정**하게 한다(적대 검증 2026-07-29 P2).
  let posted = 0;
  const partialFail = (error) => ({ ok: false, partial: posted > 0, error });
  // ⓐ의 후보 = 이 링크 + **같은 토큰의 옛·새 주소 표기**(share-bases.mjs) — 연동 PC 주소를 바꾸는 날 재시작 순간 게시 중이던
  // 건이 옛 주소로 이미 올라가 있으면 새 주소로만 찾다가 못 알아보고 한 번 더 올린다(2026-09-21 도메인 이전). ⓑⓒ는 방금
  // 올린 이 글 자체의 확인이라 링크 그대로.
  const dedupContents = shareUrlVariants(shareUrl, process.env.CLASSNOTE_SHARE_BASE, process.env.CLASSNOTE_LEGACY_SHARE_BASES);
  for (const { child, enrollment } of enrolled) {
    if (dedupOn) {
      // 🔑 보드를 가리지 않는다(cls: null) — 이 아이가 이 링크를 **어느 보드로든** 이미 받았으면 끝(개명 감사 G3).
      const pre = await findChildReportId(adminPage, centerId, { cls: null, child: child.id, content: dedupContents });
      if (!pre.ok) return partialFail("게시 전 중복 확인 실패(ClassNote 조회 불가) — 안전상 보류");
      if (pre.id) {
        log(`  · ${studentName}: 이미 게시됨(report ${pre.id}, 원아 ${child.id}) — 재게시 생략(멱등)`);
        posted++;
        continue;
      }
    }
    const res = await postClassnoteReport(adminPage, {
      // 본문 = 공유 링크 한 줄, 앱이 영상 줄을 주면 두 줄('보고서 :'·'영상첨부 :' — 2026-10-03부터 올리기 사이트 주소 `/v`)로 낸다(report-video-line.mjs). 아래 확인들은 세 모양을 다 알아본다.
      cls: boardId, child: child.id, enrollment: enrollment.id, content: reportPostContent(shareUrl, videoUrl),
      dateWritten: report.report_date, authorName: report.teacher_name || DEFAULT_AUTHOR_NAME,
      attachedImages, attachedFiles, attachedVideo,
    });
    // 실패 사유는 **응답 본문까지** 남긴다(2026-07-27) — status만 적으면 왜 거부됐는지 영영 모른다.
    // 화면은 humanizeClassnoteError가 한글로 요약하고 원문은 '자세히'로만 보여준다(raw 노출 금지 규약).
    if (res.status < 200 || res.status >= 300) {
      // ⓑ 실패 응답인데 실제로 올라갔나 — 올라가 있으면 성공 취급(재발송=학부모에게 중복, ClassNote는 비가역).
      if (dedupOn) {
        const found = await findChildReportId(adminPage, centerId, { cls: null, child: child.id, content: dedupContents });
        if (found.ok && found.id) {
          log(`  · ${studentName}: 게시 응답 HTTP ${res.status}였으나 실물 확인(report ${found.id}) — 성공 취급`);
          posted++;
          continue;
        }
      }
      return partialFail(`게시 실패(HTTP ${res.status})${res.detail ? ` — ${res.detail}` : ""}`);
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
        return partialFail("게시 응답은 정상이나 알림장 목록에서 확인 실패 — 재시도 대상(멱등 선확인이 중복을 막음)");
      if (!verified?.ok) log(`  · ${studentName}: 게시 확인 조회 실패 — 2xx 응답 근거로 성공 유지(경고)`);
      else log(`  · ${studentName}: 게시 확인 완료(report ${verified.id}, 원아 ${child.id})`);
    }
    posted++;
  }
  return { ok: true };
}

/**
 * ClassNote 발송 큐 한 주기 처리 — stale 복구 → 원자 클레임 → 건별 스크린샷·게시·상태전이.
 * browser는 호출자가 관리(데몬은 루프 밖 1회 launch 재사용, one-shot은 매 실행 launch). tenant 격리 필수.
 * @returns {Promise<{stale:number, claimed:number, success:number, failed:number, requeued:number, blocked:number}>}
 *   blocked = 프리플라이트 보드 안전 게이트가 오발송 위험으로 보류한 건수(classnote_status='blocked_shared').
 */
/**
 * stale 복구 주기(ms) — 데몬 폴(15초)보다 길게 둔다. 대상이 STALE_MIN(15분) 초과 행이라 더 자주 볼 이유가 없다.
 * one-shot 실행은 `lastStaleSweepAt=0`이라 **첫 호출에서 항상** 한 번 돈다(주기 건너뜀 없음).
 */
const STALE_SWEEP_MS = 60_000;
/**
 * ⚠️ **tenant별**로 기록한다. 전역 한 개로 두면 여러 tenant를 도는 루프에서 **첫 tenant만 sweep하고
 * 나머지는 60초 내내 건너뛴다**(지금 워커는 단일 tenant라 증상이 안 보이지만, 다중 tenant가 되는 순간
 * 조용히 복구가 멈춘다 — 조용한 고장은 만들지 않는다).
 */
const lastStaleSweepAt = new Map();

/**
 * **원장이 지정한 기한 예외**(0276a `lesson_reports.classnote_deadline_exempt_at`) — 원장 2026-09-21
 * *"앞으로도 내가 예외로 지정하는건은 기한 지난것도 발송"*. 이 표시가 있는 행은 7일 창(minDate) 밖이어도 클레임한다.
 * 표시는 사람이 건마다 붙인다(`scripts/_reports/resend-past-deadline.mts` — 감사로그 동반). 7일 규칙 자체는 그대로다.
 * ⚠️ 컬럼이 없으면(0276a 미적용) 절을 빼고 종전대로 돈다 — zip이 SQL보다 먼저 가도 발송이 멈추지 않게([[#95]]).
 *    없을 때만 10분마다 다시 묻는다(매 폴 information_schema 조회 금지 — 위 stale 복구 주석과 같은 이유).
 */
const EXEMPT_RECHECK_MS = 600_000;
let exemptColumn = { present: false, checkedAt: 0 };
async function hasDeadlineExemptColumn(sql) {
  if (exemptColumn.present) return true;
  if (Date.now() - exemptColumn.checkedAt < EXEMPT_RECHECK_MS) return false;
  try {
    const rows = await sql`select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'lesson_reports'
        and column_name = 'classnote_deadline_exempt_at' limit 1`;
    exemptColumn = { present: rows.length > 0, checkedAt: Date.now() };
  } catch {
    exemptColumn = { present: false, checkedAt: Date.now() };
  }
  return exemptColumn.present;
}

/**
 * 'ClassNote로 보낼 반'(0303a `lesson_reports.classnote_class_id`) — 반 정보 없는 보강 보고서의 반별 발송 대상 반.
 * 위 기한 예외 칸과 같은 방식으로 **칸이 있을 때만** 읽는다(zip이 SQL보다 먼저 가도 발송이 안 멈추게, [[#95]]).
 */
let sendClassColumn = { present: false, checkedAt: 0 };
async function hasSendClassColumn(sql) {
  if (sendClassColumn.present) return true;
  if (Date.now() - sendClassColumn.checkedAt < EXEMPT_RECHECK_MS) return false;
  try {
    const rows = await sql`select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'lesson_reports'
        and column_name = 'classnote_class_id' limit 1`;
    sendClassColumn = { present: rows.length > 0, checkedAt: Date.now() };
  } catch {
    sendClassColumn = { present: false, checkedAt: Date.now() };
  }
  return sendClassColumn.present;
}

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

  // 1) stale 복구: processing STALE_MIN(15분) 초과 → queued (tenant 격리)
  // ⚠️ **매 폴(15초)마다 돌리지 않는다**(2026-08-13 계측). 대상은 애초에 STALE_MIN(15분)을 넘긴 행이라
  //    15초마다 물어봐야 답이 달라지지 않는데, 59일 실측에서 이 UPDATE 한 줄이 **148,186회·총 89분**으로
  //    DB 전체 1위였다(그때는 인덱스도 없어 매번 19,043행 전수 스캔). 1분 주기면 복구 지연은 최대 +45초고
  //    (이미 10분 기다린 건에 대해) 쿼리 수는 1/4로 준다. 인덱스(lesson_reports_status_idx)는 별도 적용됨.
  let stale = [];
  if (Date.now() - (lastStaleSweepAt.get(tenant) ?? 0) >= STALE_SWEEP_MS) {
    lastStaleSweepAt.set(tenant, Date.now());
    stale = await sql`update lesson_reports set classnote_status='queued'
      where tenant_id = ${tenant} and classnote_status='processing'
        and classnote_processing_at < now() - (${STALE_MIN} || ' minutes')::interval
      returning id`;
    if (stale.length) log(`[worker] stale 복구 ${stale.length}건`);
  }

  // 2) 원자 클레임: queued → processing (FOR UPDATE SKIP LOCKED, tenant 격리)
  //    7일 창 밖은 원장이 지정한 예외 행만(위 hasDeadlineExemptColumn 주석).
  const sendClassSel = (await hasSendClassColumn(sql)) ? sql`, lr.classnote_class_id` : sql``;
  const exemptClause = (await hasDeadlineExemptColumn(sql))
    ? sql`or classnote_deadline_exempt_at is not null`
    : sql``;
  const claimed = await sql`
    with cte as (
      select id from lesson_reports
      where tenant_id = ${tenant} and classnote_status='queued' and (report_date >= ${md} ${exemptClause})
        and revoked_at is null
      order by classnote_queued_at nulls first limit ${BATCH}
      for update skip locked
    )
    update lesson_reports lr set classnote_status='processing', classnote_processing_at=now()
    from cte where lr.id=cte.id
    returning lr.id, lr.share_token, lr.report_date::text as report_date, lr.subject, lr.teacher_name, lr.student_id, lr.attachments, lr.classnote_sent_at, lr.notes, lr.class_id, lr.makeup_class_id ${sendClassSel}`
    .catch((e) => {
      // 컬럼이 사라졌으면(0276a 되돌림 — 42703 undefined_column) 기억을 지워 다음 폴부터 예외 절 없이 돈다.
      // 안 지우면 "있다"는 기억 때문에 매 폴 같은 오류로 발송 전체가 멈춘다.
      if (e?.code === "42703") {
        exemptColumn = { present: false, checkedAt: 0 };
        sendClassColumn = { present: false, checkedAt: 0 };
      }
      throw e;
    });
  const summary = { stale: stale.length, claimed: claimed.length, success: 0, failed: 0, requeued: 0, blocked: 0 };
  if (!claimed.length) return summary;
  log(`[worker] 클레임 ${claimed.length}건`);

  // 2-b) 발송용 이름(0217a users.report_display_name) — 강사가 /me에서 정한 이름이 있으면 게시 작성자명을
  // 실명 대신 그 이름으로. 규칙은 앱(src/features/onescreen/report-author-name.ts)과 동일 복제:
  // **raw 정확 일치**(teacher_name은 저장 시 display_name을 그대로 기록 — 트림 매칭은 앱 .eq와 답이 갈린다)
  // + **같은 표시 이름(display_name)의 직원이 2명 이상이면 매핑하지 않는다**(남의 보고서에 다른 사람 발송용
  // 이름이 붙는 오표시 방지 — 이때는 지금처럼 실명이 나간다). ⚠️ fail-soft: 0217a 미적용(컬럼 부재)·조회
  // 실패면 빈 맵 = 전건 실명 그대로(#95 expand/contract — 발송 자체는 절대 안 막는다).
  let reportNameByTeacher = new Map();
  let reportClassNames = new Map();
  try {
    // 학생 계정 제외 = 앱 resolveReportAuthorName과 동일 필터(동명 학생이 매핑을 끄면 안 된다). 퇴사자는 포함.
    const classIds = [...new Set(claimed.map((r) => r.class_id).filter(Boolean))];
    const [nameRows, classRows] = await Promise.all([
      sql`select display_name, report_display_name, report_class_name_prefix from users
        where tenant_id = ${tenant} and system_role <> 'student'`.catch(async (e) => {
          if (e?.code !== "42703" || !String(e.message).includes("report_class_name_prefix")) throw e;
          return sql`select display_name, report_display_name from users
      where tenant_id = ${tenant} and system_role <> 'student'`;
        }),
      classIds.length ? sql`select id, class_name from classes where tenant_id = ${tenant} and id in ${sql(classIds)}`
        .catch((e) => { log(`[worker] 반명 조회 실패 — 반명 없이 표시: ${e instanceof Error ? e.message : e}`); return []; }) : [],
    ]);
    reportNameByTeacher = buildReportAuthorMap(nameRows);
    reportClassNames = new Map(classRows.map((r) => [r.id, r.class_name]));
  } catch (e) {
    log(`[worker] 발송용 이름 조회 실패(0217a 미적용이면 정상) — 실명으로 발송: ${e instanceof Error ? e.message : e}`);
  }
  /** 이 보고서의 게시 작성자명 — 발송용 이름이 있으면 그 이름, 없으면 저장된 teacher_name 그대로. */
  const authorNameFor = (row) => reportAuthorNameFor(row, reportNameByTeacher, reportClassNames);

  // 3) 프리플라이트 준비(실게시 모드만) — ClassNote 로그인 1회 + 보드 전건 1회 캐시 + 발송 예외 목록.
  // 오발송 방지 게이트(공유 보드 차단)의 근거 데이터. **fail-closed**: 준비에 실패해 보드를 검증할 수 없으면
  // 보내지 않는다 — 클레임분을 즉시 queued로 되돌리고 이 주기를 건너뛴다(다음 폴 재시도). 검증 못 하면 안 보냄이
  // 킬스위치(위)와 같은 원칙. dry-run(post=false)은 게시 자체를 안 하므로 준비도 게이트도 건너뛴다.
  let adminPage = null;
  let centerId = null;
  let boards = null;
  let allowlist = [];
  let allNames = [];
  // 운영관리 명부(원아 → 보호자 전화) — 동명이인 전화 대조(G5)용. 이 폴에서 필요할 때 한 번만 읽는다(undefined = 아직 안 읽음).
  let admissionsCache;
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
    const [stu] = await sql`select name, classnote_name, grade, parent_phone, student_phone, home_phone, other_phone
      from students where id=${r.student_id} and tenant_id=${tenant}`;
    // ClassNote 보드명·원아 = 유효이름(classnote_name 오버라이드 || name). 동명이인은 오버라이드로 구분(0088a).
    const studentName = (stu?.classnote_name?.trim() || stu?.name || "").trim();
    // 🔴 빈 멘트 절대 가드(원장 지시 2026-07-28) — 멘트(notes) 없는 보고서가 나가면 학부모 화면에
    // "작성된 보고 내용이 없습니다"가 노출된다(이날 이관분 22건 실발송→회수 사고). 여기가 **모든 발송
    // 경로의 최종 관문**(앱 큐잉·콘솔·재발송·직접 DB 큐잉·재고·복구분 전부 통과)이라 여기 없으면 절대가
    // 아니다. 재시도 무의미(멘트를 써야 풀림) → 결정적 failed + 한글 사유. dry-run은 상태 무변경 원칙이라
    // post 모드에서만 기록. 실측: 정상 onescreen 발송 232건 중 빈 멘트 0 — 기존 워크플로 파급 없음.
    // 자리 줄(`[시험결과지]`·`[첨부: …]`)은 글이 아니다 — 영어 템플릿 글이 자리 줄뿐이면 빈 멘트(앱 hasTextBesidesMarkers와 같은 판정).
    if (post && !hasMentText(r.notes)) {
      await sql`update lesson_reports set classnote_status='failed',
        classnote_error=${"멘트(학부모 전달 내용)가 비어 있어 발송하지 않았습니다 — 멘트 작성 후 다시 발송하세요"}
        where id=${r.id}`;
      summary.failed++;
      log(`  · ${studentName}: 빈 멘트 — 발송 차단(절대 가드) → failed`);
      continue;
    }
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
    // 수학 = 늘 반 보드(0302a 매칭 원아에게 1:1 · 옛 보고서 설정 '수학 발송 경로'는 2026-11-05에 걷었다) · 그 밖 과목 = 위 1인 보드.
    // needs_class(반 정보 없는 보강) = 반을 추측하지 않는다 — 보강 반(makeup_class_id)이 곧 발송 반이고, 없으면 막는다.
    // 🔴 실제로 올릴 반 보드(원장 2026-09-30, 순수 판정 = class-route-decide.mjs `pickRouteClass`):
    //    정규 = 보고서 반 보드(살아 있으면 · 특강·연결이 남은 종강 포함) · 보강 = 보강 반 보드 · 보드가 없거나 반이 없으면 **막는다**
    //    (반별 경로에서 1인 보드로 돌아가는 길은 없다 — 1인 보드 원아 배정은 2026-11-02에 해제했다).
    //    조회 실패는 "대상"으로 둔다 — 아래 대상 확정에서 다시 드러난다(조용히 다른 보드로 새지 않게).
    const decided = post ? decideRoute(r) : "personal";
    let route = "personal";
    let routeClassId = r.class_id ?? null;
    let makeupWriteBack = null; // 보강 반으로 게시했고 적힌 '보낼 반'이 없으면 게시 뒤 그 반을 적는다
    if (decided !== "personal") {
      // 정규는 보고서 반만 사용한다. 보강은 저장된 전달 반이 다르면 수강·과목·배정을 다시 검증한다.
      // 출결 앵커는 변경하지 않으며 검증되지 않은 반이나 1인 보드로 보내지 않는다.
      const classEligible = r.class_id ? await isClassRouteEligible(sql, tenant, r.class_id, r.student_id).catch(() => true) : false;
      const makeupEligible =
        !r.class_id && r.makeup_class_id
          ? await isClassRouteEligible(sql, tenant, r.makeup_class_id, r.student_id).catch(() => true)
          : false;
      const pick = pickRouteClass({
        route: decided,
        classId: r.class_id ?? null,
        classEligible,
        sendClassId: r.classnote_class_id ?? null,
        makeupClassId: r.makeup_class_id ?? null,
        makeupEligible,
        sendEligible: !r.class_id && r.classnote_class_id && r.classnote_class_id !== r.makeup_class_id
          ? await isMakeupDeliveryEligible(sql, tenant, r).catch(() => false)
          : false,
      });
      if (pick.route === "blocked") {
        const msg = ROUTE_BLOCKED_MESSAGE[pick.reason] ?? ROUTE_BLOCKED_MESSAGE.board_missing;
        await sql`update lesson_reports set classnote_status='failed', classnote_error=${msg} where id=${r.id}`;
        summary.failed++;
        log(`  · ${studentName}: ${msg}`);
        continue;
      }
      route = pick.route;
      routeClassId = pick.classId;
      if (pick.via === "makeup") {
        log(`  · ${studentName}: 보강 반으로`);
        // 적힌 '보낼 반'이 없을 때만 **게시가 끝난 뒤** 이 반을 적는다(아래 success/partial) — 게시 전에 적으면 실패해도 기록이 남는다.
        if (!r.classnote_class_id) makeupWriteBack = pick.classId;
      }
      if (pick.via === "delivery") log(`  · ${studentName}: 보강 출결을 유지하고 선택한 반으로 보고서 전달`);
    }
    // 영어 반 방 경로(원장 2026-10-29, english-class-route.mjs) — 보고서 반(보강은 보강 반)에 반 방 연결(s2_0006)이 있으면
    // 그 반 방의 이 학생 원아에게 1:1로. 연결이 없는 반은 종전 1인 보드. 표가 없으면(SQL 전) 종전 그대로([[#95]]).
    let englishBoard = null;
    const englishAnchor = post && route === "personal" ? englishAnchorClass(r) : null;
    if (englishAnchor) {
      try {
        englishBoard = await loadEnglishClassBoard(sql, tenant, englishAnchor);
      } catch (e) {
        if (!isMissingTable(e)) {
          // 연결이 있는지 모르는 채 1인 보드로 보내면 반 방과 섞인다 — 재시도 카운트를 올려 재큐(3회면 failed).
          const msg = e instanceof Error ? e.message : String(e);
          await sql`update lesson_reports set
            classnote_retry_count = classnote_retry_count + 1,
            classnote_status = case when classnote_retry_count + 1 >= 3 then 'failed' else 'queued' end,
            classnote_error = ${`영어 반 방 연결 확인 실패 — ${msg.slice(0, 160)}`}
            where id=${r.id}`;
          summary.requeued++;
          log(`  · ${studentName}: 영어 반 방 연결 조회 실패(${msg}) → 재시도+1`);
          continue;
        }
      }
      if (englishBoard) {
        route = "class";
        routeClassId = englishAnchor;
      }
    }
    let classTarget = null; // route=class일 때 { boardId, boardName, targets, others }

    // ⛔ 프리플라이트 보드 안전 게이트(실게시 모드만) — **스크린샷·게시 전에** 판정(불필요한 캡처 회피).
    // 한 보드에 서로 다른 2가족+가 연결돼 있으면 이 학생 보고서가 남의 가족에게도 게시된다(실제 사고: 2026-07-15
    // `(수학)박서준`에 초6·중3 두 가족 동거 — 초6 보고서가 중3 집에 노출). aywa DB엔 보드 멤버십이 없어
    // **여기(ClassNote 조회 가능한 워커)가 유일한 차단 지점**. 판정=board-safety.mjs 순수함수(공지 워커와 공용).
    if (post && route === "class") {
      // 반 보드 경로 — 1인 보드 게이트(보드명 해석) 대신 **저장된 매칭 원아**를 쓰고 ClassNote로 실시간 재확인한다.
      // 🔴 이름으로 원아를 찾지 않는다(같은 반 동명이인). 매칭이 없거나 보류면 1인 보드로 돌리지 않고 멈춘다
      //    (설정을 반별로 바꿨는데 조용히 옛 경로로 가면 시험 결과를 오해한다 — 사유는 C.N 카드와 같은 말).
      // 공지 쪽 교차 확인이 멈춘 것도 함께 본다(class-route-halt.mjs — 반 보드 경로는 보고서·공지가 같은 표식을 쓴다).
      if (classRouteHalted || classRouteHaltReason()) {
        await sql`update lesson_reports set classnote_status='queued',
          classnote_error=${"반별 발송 비상 정지 중 — 교차 확인 이상으로 워커가 반별 게시를 멈췄습니다(워커 재시작 전 원인 확인 필요)"}
          where id=${r.id}`;
        summary.requeued++;
        log(`  · ${studentName}: 반별 비상 정지 중 → 재큐`);
        continue;
      }
      let ct;
      try {
        ct = englishBoard
          ? await resolveEnglishClassTargets(sql, adminPage, { tenant, centerId, board: englishBoard, studentId: r.student_id })
          : await resolveClassTargets(sql, adminPage, { tenant, centerId, classId: routeClassId, studentId: r.student_id });
      } catch (e) {
        // 조회 실패(네트워크·표 없음)는 결정적이지 않다 — 재시도 카운트를 올려 재큐(3회면 failed).
        const msg = e instanceof Error ? e.message : String(e);
        await sql`update lesson_reports set
          classnote_retry_count = classnote_retry_count + 1,
          classnote_status = case when classnote_retry_count + 1 >= 3 then 'failed' else 'queued' end,
          classnote_error = ${`반별 발송 준비 실패 — ${msg.slice(0, 160)}`}
          where id=${r.id}`;
        summary.requeued++;
        log(`  · ${studentName}: 반별 대상 확인 실패(${msg}) → 재시도+1`);
        continue;
      }
      if (!ct.ok) {
        await sql`update lesson_reports set classnote_status='failed', classnote_error=${ct.error} where id=${r.id}`;
        summary.failed++;
        log(`  · ${studentName}: ${ct.error}`);
        continue;
      }
      classTarget = ct;
      boardId = ct.boardId;
    } else if (post) {
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
        // G5(2026-09-30) — 생년만으로는 같은 학년 동명이인을 못 가른다. 보호자 전화가 **확실히 다르면** 보류.
        //   명부(운영관리)는 이 폴에서 한 번만 읽는다(모호한 이름일 때만 — 평소엔 요청 0).
        // 원장이 '발송 보류 예외'에 등재한 보드는 사람이 확인한 것이라 전화 대조도 건너뛴다(등재 = 최종 판단).
        if (verdict.ok && !verdict.allowlisted && Array.isArray(live)) {
          if (admissionsCache === undefined) admissionsCache = await fetchAdmissions(adminPage, centerId).catch(() => null);
          const pg = homonymPhoneGate({
            studentPhones: [stu?.parent_phone, stu?.student_phone, stu?.home_phone, stu?.other_phone],
            children: live,
            admissions: admissionsCache,
          });
          if (!pg.ok) verdict = { ok: false, code: "phone_mismatch", reason: `${pg.reason}(${className})` };
        }
        if (!verdict.ok && amb.siblings.length)
          verdict.reason = `${verdict.reason} (aywa 동명: ${amb.siblings.join(", ")}${amb.sameName > 1 ? ` · 같은 이름 ${amb.sameName}명` : ""})`;
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
      });
      await protectScreenshotHeaders(ctx,base,INTERNAL_SECRET);
      const page = await ctx.newPage();
      // waitUntil은 'domcontentloaded' — 'networkidle'은 /r이 로고 이미지를 Firebase 서명 URL로 불러오는데
      // 발송 PC 망에서 그 요청이 늘어지면 '네트워크 완전 정지'가 영영 안 떠 30초 타임아웃(실측 2026-07-10).
      // DOM 로드 후 fonts.ready + 700ms 정착으로 렌더 완성도는 확보되므로 취약한 networkidle 의존을 뺀다.
      const resp = await page.goto(`${base}/r/${r.share_token}`, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.evaluate(() => document.fonts?.ready).catch(() => {});
      // 로고·학생사진 등 이미지가 스크린샷에 담기도록 로드 대기(최대 8초, 실패해도 진행 — 캡처는 계속).
      await page
        .waitForLoadState("load", { timeout: 8000 })
        .catch(() => {});
      await new Promise((x) => setTimeout(x, 700));
      const card = page.locator(".report-capture").first(); // ParentReportCard 루트(공유 컴포넌트) — 폭 유틸과 분리된 안정 마커
      // 🔴 카드가 없으면 **게시하지 않는다**(2026-09-23 전수 점검) — 예전엔 페이지 전체를 찍어 올렸는데,
      //    /r이 DB 오류·만료·취소일 때 띄우는 안내 화면("보고서를 잠시 불러올 수 없습니다")이 그대로 학부모 알림장에
      //    올라갈 수 있었다(되돌릴 수 없는 외부 발신). 재시도 카운트를 올려 3회면 failed로 고정 → 발송 콘솔에서 사람이 본다.
      if (!resp || resp.status() !== 200 || (await card.count()) === 0) {
        await ctx.close();
        // 취소된 보고서는 /r이 취소 화면을 띄운다 — 아래 기존 '취소됨 → skip'과 같은 결말로(재시도 카운트 X).
        const [rv] = await sql`select revoked_at from lesson_reports where id=${r.id}`;
        if (rv?.revoked_at || !post) {
          // dry-run은 상태를 바꾸지 않는다(다시 queued로만).
          await sql`update lesson_reports set classnote_status='queued' where id=${r.id}`;
          summary.requeued++;
          log(`  · ${studentName}: ${rv?.revoked_at ? "취소됨" : "dry-run · 보고서 카드 없음"} → 게시 skip`);
          continue;
        }
        await sql`update lesson_reports set
          classnote_retry_count = coalesce(classnote_retry_count, 0) + 1,
          classnote_status = case when coalesce(classnote_retry_count, 0) + 1 >= 3 then 'failed' else 'queued' end,
          classnote_error = ${`보고서 화면을 불러오지 못해 게시 보류(카드 없음 · HTTP ${resp?.status() ?? "-"})`}
          where id=${r.id}`;
        summary.requeued++;
        log(`  · ${studentName}: 보고서 카드 없음(HTTP ${resp?.status() ?? "-"}) → 게시 보류, 재큐`);
        continue;
      }
      const buf = await card.screenshot({ type: "jpeg", quality: 90 });
      await ctx.close();
      log(`  · ${studentName} (${r.subject ?? "-"}) 보드="${classTarget ? `${classTarget.boardName}(반별)` : className}" img=${buf.length}B`);

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

      // ── 게시 = 내부 API 단일 경로(2026-07-29, Cloud Run 분기 제거) ──
      // 파일 첨부(비이미지)는 showAttachments ON일 때만 싣는다(기존 정책 유지).
      // ⚠️ 이미지 첨부만 있는 리포트는 파일로 싣지 않는다(2026-07-22 방향 B) — 이미지는 /r 스샷 하단에 크게 실림.
      const nonImageAtts = (r.attachments ?? []).filter((a) => a?.name && !IMG_ATTACHMENT_RE.test(a.name));
      // 영상(2026-11-06) = 글의 영상 칸으로 **첨부 표시 설정과 무관하게** 싣는다(한 장에 하나 — 앱이 막지만 여기서도 첫 하나만).
      const videoAtts = nonImageAtts.filter((a) => isVideoName(a.name)).slice(0, 1);
      const fileAtts = nonImageAtts.filter((a) => !isVideoName(a.name));
      // ⚠️ `!boardId`가 아니라 null/빈문자만 본다 — 보드 id가 숫자 0이면 falsy라 정상 건을 보류시킨다.
      // ⚠️ 재시도 카운트를 **올린다**: 예전엔 조건부 경로였지만 이제 전건이 지나므로, 카운트 없이 재큐하면
      //    게이트 결함 1건이 15초마다 영원히 되돌아오는 무한 루프가 된다(로그인 폭풍 유발). 3회면 failed로 고정돼
      //    사람이 발송 콘솔에서 본다.
      if (boardId == null || boardId === "") {
        await sql`update lesson_reports set
          classnote_retry_count = classnote_retry_count + 1,
          classnote_status = case when classnote_retry_count + 1 >= 3 then 'failed' else 'queued' end,
          classnote_error = ${"보드 ID를 얻지 못했습니다(게이트 결함 의심) — 안전상 게시 보류"}
          where id=${r.id}`;
        summary.requeued++;
        log(`  · ${studentName}: boardId 없음 → 보류(재시도+1) [코드 결함 의심 — 점검 필요]`);
        continue;
      }
      const sendFiles = showAttachments ? fileAtts : []; // 첨부 표시 OFF면 파일 안 실음(스샷만) — 기존 정책
      childrenCache ??= await fetchChildren(adminPage, centerId); // 배치 첫 건에 1회(전건이 이 경로)
      // ⏱ 게시 직전에 처리 시각을 새로 찍는다(개명 감사 G6) — 스크린샷·앞 건이 오래 걸려도 게시 중인 이 행을
      //    stale 복구(STALE_MIN)·앱 멈춤복구(STUCK_MINUTES)가 되살리지 못하게. 아직 이 워커가 쥔 processing일 때만.
      //    그 사이 누가 되살렸으면(0행) 이 건은 게시하지 않는다 — 다른 쪽이 다시 집어 간다.
      const kept = await sql`update lesson_reports set classnote_processing_at = now()
        where id = ${r.id} and tenant_id = ${tenant} and classnote_status = 'processing' returning id`;
      if (!kept.length) {
        log(`  · ${studentName}: 게시 직전 확인 — 이미 다른 처리로 넘어간 행이라 게시 생략`);
        continue;
      }
      // '영상첨부' 줄(원장 2026-10-01 → 10-03 올리기 사이트 주소 `/v` 한 줄) — 앱이 정한다(영상 과제 있음 + 검사 대상 반 + 숙제 기한 안 + 사이트를 쓰는 지점).
      // 못 받으면 줄 없이 보낸다(10초 상한 · 실패해도 발송은 그대로). 같은 보고서 재시도의 중복 판정은 첫 줄(공유 링크)로 한다.
      const videoUrl = await fetchVideoSubmitLine({ base, shareBase, reportId: r.id, secret: INTERNAL_SECRET });
      // ⏱ 게시 호출 상한 — Cloud Run 경로에 있던 AbortController(960s)를 제거하면서 **전건이 상한 없는 호출**이 됐다.
      // kage 업로드·API 응답이 영영 안 오면 데몬이 그 건에서 멈춰 큐 전체가 정지한다(폴이 다음으로 못 넘어감).
      // 🔴 타임아웃 시 **재큐하지 않고 failed로 고정**한다: POST가 이미 서버에 닿았을 수 있어(게시됐는지 불명)
      //    자동 재시도는 학부모 중복 게시로 직결된다. 사람이 ClassNote에서 확인 후 재발송하는 게 유일하게 안전하다.
      const result = await withPostTimeout(sendReportViaApi(adminPage, {
        // 발송용 이름(0217a) — 게시 작성자명만 바꾼다. DB의 teacher_name(귀속 축)은 불변(2-b 주석).
        report: { ...r, teacher_name: authorNameFor(r) },
        studentName, boardId, centerId, screenshot: buf, shareUrl: `${shareBase}/r/${r.share_token}`, videoUrl,
        base, fileAtts: sendFiles, videoAtts, children: childrenCache, log,
        // 첫 발송만 3중 방어(멱등·사후확인) — classnote_sent_at 있는 행 = 의도적 재발송이라 content 판정이
        // 옛 게시물에 오염된다(sendReportViaApi 4) 주석). 재발송은 status 코드를 신뢰한다.
        verifyDedup: !r.classnote_sent_at,
        boardFallback: { centerId, grade: stu?.grade ?? null, schoolYear: kstSchoolYear() },
        // 반 보드 경로 = 확정 원아만(이름 해석·폴백 없음).
        targets: classTarget?.targets ?? null,
      }));
      if (result.timedOut) {
        await sql`update lesson_reports set classnote_status='failed',
          classnote_error=${`게시 응답 없음(${Math.round(POST_TIMEOUT_MS / 60000)}분 초과) — ClassNote에서 실제 게시 여부를 확인한 뒤 재발송하세요`}
          where id=${r.id}`;
        summary.failed++;
        log(`    → 타임아웃(${Math.round(POST_TIMEOUT_MS / 60000)}분) → failed 고정(자동 재시도 안 함 — 중복 게시 방지)`);
        continue;
      }
      if (result.ok && classTarget) {
        // 🔴 반 보드 경로 게시 후 교차 확인 — 같은 반 **다른** 원아의 알림장에 이 보고서 링크가 보이면 새어 나간 것.
        //    보이면 비상 정지(이 프로세스에서 반별 게시 전부 멈춤) + 이 건은 failed + 사유. 조회 실패는 경고만.
        const cc = await crossCheckOthers(adminPage, {
          centerId,
          boardId: classTarget.boardId,
          others: classTarget.others,
          contents: shareUrlVariants(`${shareBase}/r/${r.share_token}`, process.env.CLASSNOTE_SHARE_BASE, process.env.CLASSNOTE_LEGACY_SHARE_BASES),
        }).catch(() => ({ ok: false, leakedTo: [], unknown: true }));
        if (!cc.ok && cc.leakedTo.length) {
          classRouteHalted = true;
          haltClassRoute("수업보고서 교차 확인 이상"); // 공지의 반 보드 경로도 함께 멈춘다
          await sql`update lesson_reports set classnote_status='failed', classnote_sent_at=now(),
            classnote_error=${`🔴 반별 발송 교차 확인 이상 — 같은 반 다른 원아(${cc.leakedTo.length}명)의 알림장에서 이 보고서가 보입니다. 반별 발송을 멈췄습니다. ClassNote에서 확인하세요`}
            where id=${r.id}`;
          summary.failed++;
          log(`    → 🔴 교차 확인 이상(다른 원아 ${cc.leakedTo.join(",")}) — 반별 비상 정지`);
          continue;
        }
        if (!cc.ok) log(`    ⚠️ 교차 확인 조회 실패 — 게시는 성공으로 둔다(확인 못 함)`);
      }
      if ((result.ok || result.partial) && makeupWriteBack && (await hasSendClassColumn(sql)))
        // 실제로 간 반을 '보낼 반'에 — 감사·회수가 같은 반을 본다. 비어 있을 때만(조건부) · 실패해도 게시 결과는 그대로.
        await sql`update lesson_reports set classnote_class_id = ${makeupWriteBack}
          where id = ${r.id} and classnote_class_id is null`.catch(() => {});
      if (result.ok) {
        await sql`update lesson_reports set classnote_status='success', classnote_sent_at=now(), classnote_error=null where id=${r.id}`;
        summary.success++;
        log(`    → success (내부 API${classTarget ? " · 반별" : ""}${sendFiles.length ? `, 파일 ${sendFiles.length}건` : ""}${videoAtts.length ? " · 영상" : ""}${videoUrl ? " · 영상첨부 줄" : ""})`);
      } else if (result.partial) {
        // 🔴 이중 계정(부모·본인) 학생에서 **일부 원아는 이미 받았다**. 재시도하면 그 집에 같은 글이 또 간다
        // (ClassNote는 삭제·수정 불가) → 자동 재시도 없이 failed 고정, 사람이 알림장에서 확인 후 판단한다.
        await sql`update lesson_reports set classnote_status='failed',
          classnote_error=${`일부 계정에만 게시됨 — ${result.error} (자동 재시도 안 함: 이미 받은 계정에 중복 게시 방지. 알림장 확인 후 처리하세요)`}
          where id=${r.id}`;
        summary.failed++;
        log(`    → 부분 성공 → failed 고정(중복 방지): ${result.error}`);
      } else {
        await sql`update lesson_reports set
          classnote_retry_count = classnote_retry_count + 1,
          classnote_status = case when classnote_retry_count + 1 >= 3 then 'failed' else 'queued' end,
          classnote_error = ${result.error}
          where id=${r.id}`;
        summary.failed++;
        log(`    → 실패(API): ${result.error} (재시도+1)`);
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
