// scripts/_classnote/classnote-class-notice-core.mjs — **반 단체 공지** 큐(0304a) 처리(연동 PC 워커).
//
// 원장 2026-09-29: 반 공지를 "반 단체 공지(반 보드에 공지 1건)"와 "원생 개별 공지(학생마다 1:1)"로 가른다.
// 원생 개별 공지는 classnote-notice-core.mjs(그대로). 여기는 ClassNote **공지사항**으로 반 보드에 1건.
//
// 🔴 안전장치(전부 매번):
//   ① 보드 번호는 큐 값이 아니라 `classnote_class_boards`(0302a)에서 반 id로 다시 찾는다(큐 위조·옛 값 무시).
//   ② 보드의 **지금** 원아 = 그 반 재원생(0302a ok ∩ 오늘 수강 중)이어야 보낸다 — 반을 옮긴 학생이 보드에 남아 있으면
//      반 공지가 그 집에도 간다(원아 해제는 화면에서 손으로만 된다).
//   ③ `classes_to`는 정확히 반 하나(class-notice-guard.mjs) — 빠지면 기관 전체 공지일 수 있다.
//   ④ 같은 제목·내용이 그 반에 이미 있으면 다시 올리지 않는다(크래시 재시도 중복 방지) · 올린 뒤 목록에서 실물 확인.
//   ⑤ 발송 스위치(classnoteSendEnabled) OFF면 손대지 않는다. 테스트 발송은 `[수학] 테스트반`(학원* 원아만)으로만.
//
// **이미지 첨부**(원장 2026-10-03 *"반공지 이미지 가능하게"*): 큐 행 `targets[].attachments`(전 반 공통 이미지)가 있으면
//   ① 앱 내부 라우트에서 서명 주소를 받고 ② ClassNote 내부 저장소(kage)에 올려 ③ 공지의 `attached_images`에 싣는다.
//   2026-10-03 테스트반 실측: 알림장 작성폼의 이미지 입력으로 올린 키를 공지에 실어도 붙는다(공지 단건·목록의 `attached_images`).
//   🔴 이미지가 하나라도 준비되지 않으면 그 반에는 **올리지 않는다** — 이미지가 빠진 공지가 '발송 완료'로 남으면 아무도 모른다.
//   🔴 이미지 공지는 같은 제목·내용의 공지가 이미 있어도 **이 큐 행이 직접 올린 것일 때만** '이미 올라가 있음(성공)'으로 넘긴다.
//      글만 먼저 보낸 뒤 이미지를 붙여 다시 보냈거나, 이미지를 바꿔 다시 보낸 경우는 올리지도 않고 '이미지 N장 · 발송 완료'로 남는다
//      (장수만 세면 "다른 이미지 1장"을 못 가린다). 이 행이 올린 공지 번호는 반마다 큐 행에 적어 두고(진행 기록) 다시 집혔을 때 대조한다.
//      그 밖에는 사유와 함께 보류한다(자동으로 한 건 더 올리지 않는다 — 같은 글이 두 번 간다).
//   🔴 올리기는 **반마다 새로** — 같은 키를 여러 공지에 다시 써도 되는지 확인하지 못했다. 내려받기는 행당 한 번(이미지는 전 반 공통).
//   🔴 이미지 준비 실패(내려받기·올리기)는 반과 무관한 사유다 — 한 번 실패하면 남은 반은 **다시 시도하지 않고** 같은 사유로 보류한다
//      (10장 × 20개 반을 끝까지 시도하면 그 사이 수업보고서·개별 공지 발송이 전부 멈춘다).
import { CLASSNOTE_BASE, dismissHonorificDialog, fetchBoardChildren, fetchCenterId, loginClassnote, uploadToKageDetailed } from "./classnote-admin-core.mjs";
import { isClassnoteSendEnabled, DEFAULT_AUTHOR_NAME, DEFAULT_BASE } from "./classnote-core.mjs";
import { buildClassNoticePayload, classNoticeAttachments, evaluateClassNoticeBoard, isTestOnlyBoard, TEST_NOTICE_BOARD } from "./class-notice-guard.mjs";
import { downloadAttachment, kageImagePayload, mimeForNoticeName } from "./notice-attachments.mjs";

// 내부 첨부 라우트 게이트(보고서 첨부·원생 개별 공지 첨부와 같은 시크릿).
const INTERNAL_SECRET = process.env.CLASSNOTE_INTERNAL_SECRET;

const STALE_MIN = 10;

async function listBoardNotices(page, centerId) {
  return page.evaluate(async (c) => {
    // 최근 100건 — 중복 확인의 창이다(2026-10-03 실측: page_size=100이 받아들여진다). 30건이면 반이 많은 공지가 도중에 죽어 다시 집혔을 때
    // 앞쪽 반의 공지가 창 밖으로 밀려 한 번 더 올라갈 수 있다.
    const r = await fetch(`/api/v1/centers/${c}/notices?page_size=100`, { headers: { accept: "application/json" } });
    if (!r.ok) return null;
    const j = await r.json().catch(() => null);
    return Array.isArray(j) ? j : j && Array.isArray(j.results) ? j.results : null;
  }, centerId);
}

async function postNotice(page, payload) {
  return page.evaluate(async (body) => {
    const csrf = (document.cookie.match(/csrftoken=([^;]+)/) || [])[1];
    const r = await fetch("/api/v1_2/notices/", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", ...(csrf ? { "X-CSRFToken": csrf } : {}) },
      body: JSON.stringify(body),
    });
    if (!r.ok) return { status: r.status, detail: (await r.text().catch(() => "")).slice(0, 300), id: null, images: null };
    // 성공 응답 본문(있으면) — 올라간 공지 번호와 붙은 이미지 장수. 목록에서 못 찾았을 때의 대조 근거다.
    const j = await r.json().catch(() => null);
    return { status: r.status, detail: "", id: j && typeof j.id === "number" ? j.id : null, images: j && Array.isArray(j.attached_images) ? j.attached_images.length : null };
  }, payload);
}

/** 그 반 재원생의 매칭 확인 원아(0302a ok ∩ 오늘 수강 중 ∩ 재원). */
async function allowedChildren(sql, tenant, classId) {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  const rows = await sql`
    select distinct m.child_id from classnote_class_board_members m
    join enrollments e on e.tenant_id = m.tenant_id and e.class_id = m.class_id and e.student_id = m.student_id
      and (e.start_date is null or e.start_date <= ${today}) and (e.end_date is null or e.end_date >= ${today})
    join students s on s.id = m.student_id and s.status = 'enrolled'
    where m.tenant_id = ${tenant} and m.class_id = ${classId} and m.status = 'ok' and m.child_id is not null`;
  return new Set(rows.map((r) => Number(r.child_id)));
}

/** 이미지 목록 라우트 응답 상태 → 한글 사유. 화면(발송 이력)에 그대로 나가므로 설정 이름·원문을 넣지 않는다(원문은 로그로). */
function mediaListFailure(status) {
  if (!status) return "앱에 연결하지 못했습니다";
  if (status === 401) return "연동 PC와 앱의 인증이 맞지 않습니다(연동 PC 설정 확인이 필요합니다)";
  if (status === 404) return "앱에서 이 공지의 이미지 목록을 찾지 못했습니다";
  if (status === 500 || status === 200) return "앱이 이미지 주소를 만들지 못했습니다";
  return `앱 응답 오류(${status})`;
}

/**
 * 이 공지의 이미지 목록(서명 주소) — `GET {base}/api/internal/class-notice-attachments/{id}`.
 * @returns {Promise<{ok:true, entry:{images:Array<{name:string,url:string}>, files:[], expected:number, missing:string[]}} | {ok:false, error:string}>}
 *   실패 사유는 한글(화면에 그대로 나간다). `expected` = 서명 전 장수 — 준비 결과와 대조하는 기준(조용한 누락 차단).
 */
export async function fetchClassNoticeMedia({ base, secret, noticeId, expected, fetchImpl = globalThis.fetch, log = () => {} }) {
  const url = `${String(base || "").replace(/\/+$/, "")}/api/internal/class-notice-attachments/${noticeId}`;
  let status = 0;
  let json = null;
  try {
    const res = await fetchImpl(url, { headers: secret ? { "x-eywa-internal": secret } : {} });
    status = res.status;
    if (res.ok) json = await res.json();
  } catch (e) {
    log(`[class-notice] 이미지 목록 조회 오류: ${String(e?.message ?? e).slice(0, 200)}`);
    return { ok: false, error: `이미지 목록을 받지 못했습니다 — ${mediaListFailure(0)}` };
  }
  const pick = (list) => (Array.isArray(list) ? list : []).filter((x) => x && typeof x.url === "string" && x.url).map((x) => ({ name: String(x.name || "이미지"), url: x.url }));
  const images = pick(json?.images);
  const missing = (Array.isArray(json?.missing) ? json.missing : []).map((n) => String(n || "이미지"));
  // 큐 행이 아는 장수(expected)보다 적게 왔으면 어디선가 빠진 것 — 그대로 진행하면 이미지가 빠진 공지가 나간다.
  if (!json || images.length + missing.length < expected) return { ok: false, error: `이미지 목록을 받지 못했습니다 — ${mediaListFailure(status)}` };
  return { ok: true, entry: { images, files: [], expected: Math.max(expected, images.length + missing.length), missing } };
}

/** kage 업로드는 알림장 작성폼의 파일 입력을 거친다 — 그 폼으로 이동(공지 작성 화면에는 처음부터 떠 있는 입력이 없다). */
async function openUploadForm(page) {
  await page.goto(`${CLASSNOTE_BASE}/service/report/add`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await dismissHonorificDialog(page).catch(() => {});
  await page.waitForTimeout(1500);
}

/**
 * 이 공지(큐 행)의 **이미지 준비기** — 반마다 부르면 그 반 공지에 실을 `attached_images`를 돌려준다.
 *  · 내려받기는 행당 한 번(이미지는 전 반 공통) · 올리기는 반마다 새로(같은 키를 여러 공지에 다시 쓰지 않는다).
 *  · 올리기는 한 번 다시 해 본다(작성폼을 새로 열고). 그래도 안 되면 **그 뒤로는 시도하지 않는다** — 내려받기·올리기 실패는
 *    반과 무관해서, 남은 반에서 되풀이하면 그 시간만큼 다른 발송(수업보고서·개별 공지)이 멈춘다.
 *  · 사유는 한글만 돌려준다(발송 이력에 그대로 나간다). 원문은 `log`로.
 * page에 의존하는 동작(`openForm`·`upload`)은 주입받는다 — 테스트가 갈아 끼운다.
 * @param {{images:Array<{name:string,url:string}>, expected:number, missing:string[]}} entry
 * @returns {() => Promise<{ok:true, attachedImages:object[]} | {ok:false, reason:string}>}
 */
export function createClassNoticeImagePreparer({ entry, openForm, upload, download = downloadAttachment, log = () => {} }) {
  const bytes = new Map(); // url → Buffer(행당 한 번)
  let broken = null;
  const fail = (reason) => {
    broken = reason;
    return { ok: false, reason };
  };
  const others = (n) => (n > 1 ? ` 외 ${n - 1}장` : "");
  return async function prepare() {
    if (broken) return { ok: false, reason: broken };
    const images = Array.isArray(entry?.images) ? entry.images : [];
    const missing = Array.isArray(entry?.missing) ? entry.missing : [];
    if (missing.length) return fail(`앱이 이미지 주소를 만들지 못했습니다("${missing[0]}"${others(missing.length)})`);
    if (!images.length || images.length !== Number(entry?.expected ?? 0)) return fail("받은 이미지 목록이 보낸 장수와 다릅니다");
    for (const item of images) {
      if (bytes.has(item.url)) continue;
      try {
        const buf = await download(item.url);
        if (!buf?.length) throw new Error("0바이트");
        bytes.set(item.url, buf);
      } catch (e) {
        log(`[class-notice] 이미지 "${item.name}" 내려받기 실패: ${String(e?.message ?? e).slice(0, 200)}`);
        return fail(`"${item.name}" 이미지를 앱 저장소에서 받지 못했습니다`);
      }
    }
    const attachedImages = [];
    let opened = false;
    for (const item of images) {
      const buffer = bytes.get(item.url);
      let reason = "";
      let kage = null;
      // 한 번 다시 해 본다 — 작성폼이 덜 떴거나 저장소가 잠깐 응답하지 않은 경우(둘째 시도는 폼을 새로 연다).
      for (let attempt = 0; attempt < 2 && !kage; attempt++) {
        try {
          if (!opened || attempt > 0) {
            await openForm();
            opened = true;
          }
          const r = await upload({ name: item.name, mimeType: mimeForNoticeName(item.name, "image"), buffer });
          if (r?.ok && r.kage) kage = r.kage;
          else {
            // 사유 끝의 `[원문]` 꼬리(예외·응답 원문 요약)는 화면에 내지 않는다 — 전체 문장은 로그로.
            const full = String(r?.reason || "");
            if (full) log(`[class-notice] 이미지 "${item.name}" 올리기 실패: ${full}`);
            reason = full.replace(/\s*\[[^\]]*\]\s*$/, "") || "ClassNote가 이미지를 받지 않았습니다";
          }
        } catch (e) {
          log(`[class-notice] 이미지 "${item.name}" 올리기 오류: ${String(e?.message ?? e).slice(0, 200)}`);
          reason = "ClassNote 작성 화면에서 이미지를 올리지 못했습니다";
        }
      }
      const payload = kage ? kageImagePayload(kage, { name: item.name, byteLength: buffer.length }) : null;
      if (!payload) return fail(`"${item.name}" ${reason || "ClassNote가 이미지를 받지 않았습니다"}`);
      attachedImages.push(payload);
    }
    return { ok: true, attachedImages };
  };
}

/**
 * 한 반에 공지 1건 — 안전장치 ②~④. 반환 { ok, noticeId?, note?, images? }.
 * `prepareImages` = 이 반에 붙일 이미지를 준비해 주는 함수(없으면 글만) · `imageCount` = 붙어야 할 장수(중복 확인·사후 확인의 기준).
 * `ownNoticeIds` = **이 큐 행이 앞선 시도에서 이미지까지 올려 둔** 공지 번호(다시 집혔을 때의 진행 기록).
 */
async function sendToBoard(page, centerId, { boardId, live, allowed, title, body, authorName, isTest, prepareImages = null, imageCount = 0, ownNoticeIds = new Set() }) {
  const guard = isTest
    ? isTestOnlyBoard(live)
      ? { ok: true }
      : { ok: false, reason: "테스트반에 학원* 테스트 원아가 아닌 원아가 있어 보내지 않았습니다" }
    : evaluateClassNoticeBoard({ live, allowed });
  if (!guard.ok) return { ok: false, note: guard.reason };
  const same = (n) => String(n.cls) === String(boardId) && n.title === title && n.content === body;
  const before = await listBoardNotices(page, centerId);
  if (!before) return { ok: false, note: "ClassNote 공지 목록 조회 실패 — 안전상 보류(다시 보내세요)" };
  const dup = before.find(same);
  if (dup) {
    if (!imageCount) return { ok: true, noticeId: dup.id, note: "이미 올라가 있음(재게시 생략)" };
    // 🔴 이미지 공지 — 장수가 맞고 **이 행이 직접 올린 공지**일 때만 성공으로 넘긴다(워커가 올린 직후 죽었다 다시 집은 경우).
    //    그 밖(글만 먼저 보냄 · 이미지를 바꿔 다시 보냄 · 누가 올린 건지 알 수 없음)은 보류한다. 한 건 더 올리지도 않는다
    //    (같은 글이 두 번 간다) — 사람이 그 공지를 지우거나 제목을 바꿔 다시 보낸다.
    const has = Array.isArray(dup.attached_images) ? dup.attached_images.length : null;
    if (has !== null && has >= imageCount && ownNoticeIds.has(Number(dup.id))) return { ok: true, noticeId: dup.id, images: imageCount, note: "이미 올라가 있음(재게시 생략)" };
    const how = has === null ? "이미" : has === 0 ? "이미지 없이 이미" : has < imageCount ? `이미지 ${has}장만 붙은 채 이미` : "이미";
    const hint = has !== null && has >= imageCount ? "(붙어 있는 이미지가 이번에 보낸 것과 같은지는 확인할 수 없습니다)" : "";
    return {
      ok: false,
      noticeId: dup.id,
      note: `같은 제목·내용의 공지가 ${how} 올라가 있어 다시 올리지 않았습니다${hint} — ClassNote에서 그 공지를 지우거나 제목을 바꿔 다시 보내 주세요`,
    };
  }
  // 이미지 — 가드·중복 확인을 통과한 **뒤에** 올린다(막힐 반에 업로드를 낭비하지 않는다). 하나라도 실패하면 이 반엔 올리지 않는다.
  let attachedImages = [];
  if (prepareImages) {
    const media = await prepareImages();
    if (!media.ok) return { ok: false, note: `이미지 준비 실패 — ${media.reason}` };
    attachedImages = media.attachedImages;
    if (attachedImages.length !== imageCount) return { ok: false, note: "이미지 준비 실패 — 준비된 장수가 보낸 장수와 다릅니다" };
  }
  const payload = buildClassNoticePayload({ boardId, title, body, centerId, authorName, attachedImages });
  const res = await postNotice(page, payload);
  if (res.status < 200 || res.status >= 300) return { ok: false, note: `게시 실패(HTTP ${res.status})` };
  await page.waitForTimeout(1200);
  const after = await listBoardNotices(page, centerId);
  const hit = after?.find(same);
  const want = attachedImages.length;
  if (!hit) {
    // 목록에서 못 찾았다 — 글만이면 예전 그대로(잠시 뒤 확인). 이미지 공지는 게시 응답이 장수를 확인해 줄 때만 성공으로 남긴다.
    if (!want) return { ok: true, note: "게시 응답은 정상이나 목록 확인 전(잠시 뒤 확인)" };
    if (res.images !== null && res.images >= want) return { ok: true, ...(res.id ? { noticeId: res.id } : {}), images: want, note: "게시 응답은 정상이나 목록 확인 전(잠시 뒤 확인)" };
    return { ok: false, ...(res.id ? { noticeId: res.id } : {}), note: "공지는 올라갔지만 이미지가 붙었는지 확인하지 못했습니다 — ClassNote에서 확인하세요" };
  }
  // 🔴 사후 확인 — 반드시 그 반 하나에만, 기관 전체가 아니게.
  if (hit.is_center_notice) return { ok: false, noticeId: hit.id, note: "🔴 기관 전체 공지로 올라갔습니다 — 즉시 ClassNote에서 확인하세요" };
  // 이미지 사후 확인 — 올린 장수만큼 붙었는가(모자라거나 확인할 수 없으면 글은 올라갔지만 사람이 봐야 한다).
  if (want) {
    const got = Array.isArray(hit.attached_images) ? hit.attached_images.length : res.images;
    if (got === null) return { ok: false, noticeId: hit.id, note: "공지는 올라갔지만 이미지가 붙었는지 확인하지 못했습니다 — ClassNote에서 확인하세요" };
    if (got < want) return { ok: false, noticeId: hit.id, note: `공지는 올라갔지만 이미지 ${want}장 중 ${got}장만 붙었습니다 — ClassNote에서 확인하세요` };
  }
  return { ok: true, noticeId: hit.id, ...(want ? { images: want } : {}) };
}

/**
 * 공지 한 건(큐 행)을 처리해 반별 결과를 돌려준다 — 큐 집기·상태 기록은 호출부(`processClassNoticesOnce`)가 한다.
 * `media` = 이미지 목록을 받아 오는 함수(기본 = 앱 내부 라우트) · `preparer` = 이미지 준비기를 만드는 함수. 테스트·실측이 갈아 끼운다.
 * 🔴 `results` = 호출부가 넘긴 배열에 **반마다 그 자리에서** 쌓는다 — 도중에 던져도 이미 올린 반의 결과가 남는다
 *    (반환값으로만 주면 3번째 반에서 던졌을 때 앞의 두 반이 '실패 · 결과 없음'으로 기록된다 — 학부모는 이미 받았다).
 * `onProgress(results)` = 반 하나가 끝날 때마다 불린다(호출부가 큐 행에 진행 기록을 남긴다) · `row.results` = 앞선 시도의 진행 기록
 *    (워커가 죽어 다시 집힌 행) — 거기서 이미지까지 올린 공지 번호를 뽑아 중복 확인에 쓴다.
 * @returns {Promise<Array<{classId:string|null, className:string, ok:boolean, noticeId?:number, note?:string, images?:number}>>}
 */
export async function sendClassNoticeRow(page, sql, row, { tenant, centerId, authorName = DEFAULT_AUTHOR_NAME, log = console.log, base = DEFAULT_BASE, media = null, preparer = null, results = [], onProgress = null }) {
  // 이미지가 있으면 목록(서명 주소)을 먼저 받는다 — 못 받으면 **한 반에도 올리지 않는다**(이미지 빠진 공지 방지).
  const wanted = classNoticeAttachments(row);
  let prepareImages = null;
  if (wanted.length) {
    const fetched = await (media ?? ((a) => fetchClassNoticeMedia({ base, secret: INTERNAL_SECRET, log, ...a })))({ noticeId: row.id, expected: wanted.length });
    if (!fetched.ok) {
      const names = row.is_test ? [{ classId: null, className: TEST_NOTICE_BOARD.name }] : (row.targets ?? []).map((t) => ({ classId: t.classId ?? null, className: t.className ?? "" }));
      log(`[class-notice] 이미지 준비 중단 — ${fetched.error}`);
      for (const n of names) results.push({ ...n, ok: false, note: fetched.error });
      return results;
    }
    // 받은 목록이 큐 행이 아는 장수와 다르면(많아도) 한 반에도 올리지 않는다 — 반마다 올린 뒤에야 어긋남을 알게 되지 않게.
    const listed = (fetched.entry?.images?.length ?? 0) + (fetched.entry?.missing?.length ?? 0);
    if (listed !== wanted.length) {
      const names = row.is_test ? [{ classId: null, className: TEST_NOTICE_BOARD.name }] : (row.targets ?? []).map((t) => ({ classId: t.classId ?? null, className: t.className ?? "" }));
      const note = "이미지 목록을 받지 못했습니다 — 받은 이미지 목록이 보낸 장수와 다릅니다";
      log(`[class-notice] 이미지 준비 중단 — 받은 목록 ${listed}장 · 큐 행 ${wanted.length}장`);
      for (const n of names) results.push({ ...n, ok: false, note });
      return results;
    }
    prepareImages = (preparer ?? createClassNoticeImagePreparer)({
      entry: fetched.entry,
      openForm: () => openUploadForm(page),
      upload: (file) => uploadToKageDetailed(page, "media-attachment-add-input", file, { subject: "이미지" }),
      log,
    });
    log(`[class-notice] 이미지 ${wanted.length}장 — 반마다 올려서 함께 게시`);
  }
  const imageCount = wanted.length;
  // 이 행이 앞선 시도에서 **이미지까지 다 붙여** 올려 둔 공지 번호 — 다시 집혔을 때 '이미 올라가 있음'으로 넘길 수 있는 유일한 근거.
  const ownNoticeIds = new Set(
    (Array.isArray(row.results) ? row.results : [])
      .filter((x) => x && x.ok === true && imageCount > 0 && x.images === imageCount && Number.isFinite(Number(x.noticeId)))
      .map((x) => Number(x.noticeId)),
  );
  const done = async (entry) => {
    results.push(entry);
    // 진행 기록 — 실패해도 발송은 계속한다(기록이 없으면 다시 집혔을 때 보류로 떨어질 뿐이다).
    if (onProgress) await Promise.resolve(onProgress(results)).catch((e) => log(`[class-notice] 진행 기록 실패: ${String(e?.message ?? e).slice(0, 120)}`));
  };
  if (row.is_test) {
    const live = await fetchBoardChildren(page, centerId, TEST_NOTICE_BOARD.id);
    const r = await sendToBoard(page, centerId, { boardId: TEST_NOTICE_BOARD.id, live, allowed: new Set(), title: row.title, body: row.body, authorName, isTest: true, prepareImages, imageCount, ownNoticeIds });
    await done({ classId: null, className: TEST_NOTICE_BOARD.name, ...r });
    return results;
  }
  for (const t of row.targets ?? []) {
    // ① 보드 번호는 연결표에서 다시.
    const [b] = await sql`select board_id, board_name from classnote_class_boards where tenant_id=${tenant} and class_id=${t.classId}`;
    if (!b) {
      await done({ classId: t.classId, className: t.className, ok: false, note: "ClassNote 반 연결 없음" });
      continue;
    }
    // 매 반 직전 스위치 재확인 — 배치 중에 꺼졌으면 여기서 멈춘다.
    if (!(await isClassnoteSendEnabled(sql, tenant))) {
      await done({ classId: t.classId, className: t.className, ok: false, note: "발송 스위치가 꺼져 보내지 않음" });
      continue;
    }
    const boardId = Number(b.board_id);
    const [live, allowed] = await Promise.all([fetchBoardChildren(page, centerId, boardId).catch(() => null), allowedChildren(sql, tenant, t.classId)]);
    const r = await sendToBoard(page, centerId, { boardId, live, allowed, title: row.title, body: row.body, authorName, isTest: false, prepareImages, imageCount, ownNoticeIds });
    await done({ classId: t.classId, className: t.className, ...r });
    log(`[class-notice] ${t.className}: ${r.ok ? "게시" : "보류"}${r.note ? ` — ${r.note}` : ""}`);
  }
  return results;
}

/**
 * 큐 1회 처리. `post=false`(dry-run)면 대기 건수만 알린다.
 * @returns {Promise<{processed:number}>}
 */
export async function processClassNoticesOnce(sql, browser, { tenant, post = false, log = console.log, base = DEFAULT_BASE }) {
  // 표가 없으면(0304a 전) 조용히 넘어간다.
  const stale = await sql`update classnote_class_notices set status='queued'
    where tenant_id=${tenant} and status='processing' and processing_at < now() - (${STALE_MIN} || ' minutes')::interval
    returning id`.catch(() => null);
  if (stale === null) return { processed: 0 };
  const [{ n }] = await sql`select count(*)::int as n from classnote_class_notices where tenant_id=${tenant} and status='queued'`;
  if (!n) return { processed: 0 };
  if (!post) {
    log(`[class-notice] 반 단체 공지 대기 ${n}건 — dry-run이라 보내지 않음`);
    return { processed: 0 };
  }
  if (!(await isClassnoteSendEnabled(sql, tenant))) {
    log("[class-notice] 발송 스위치 OFF — 반 단체 공지 보류(큐 보존)");
    return { processed: 0 };
  }
  const [row] = await sql`
    with cte as (select id from classnote_class_notices where tenant_id=${tenant} and status='queued'
      order by created_at limit 1 for update skip locked)
    update classnote_class_notices c set status='processing', processing_at=now() from cte where c.id=cte.id
    returning c.id, c.title, c.body, c.targets, c.is_test, c.results`;
  if (!row) return { processed: 0 };

  const page = await browser.newPage();
  // 반마다 여기에 쌓인다 — 도중에 던져도 이미 올린 반의 결과가 남아 아래 catch가 '일부 성공'으로 적는다.
  const results = [];
  try {
    await loginClassnote(page);
    const centerId = await fetchCenterId(page);
    // 진행 기록 — 반 하나가 끝날 때마다 큐 행에 적는다. 워커가 도중에 죽어 다시 집히면 `row.results`로 "이 행이 올린 공지"를 가린다.
    const onProgress = (list) => sql`update classnote_class_notices set results=${sql.json(list)} where id=${row.id} and status='processing'`;
    await sendClassNoticeRow(page, sql, row, { tenant, centerId, authorName: DEFAULT_AUTHOR_NAME, log, base, results, onProgress });
    const okN = results.filter((x) => x.ok).length;
    const status = okN === results.length ? "success" : okN > 0 ? "partial" : "failed";
    await sql`update classnote_class_notices set status=${status}, results=${sql.json(results)}, processed_at=now(), error=null where id=${row.id}`;
    return { processed: 1 };
  } catch (e) {
    const msg = String(e?.message ?? e).slice(0, 200);
    // 🔴 재큐하지 않는다 — 로그인 실패 같은 오류는 매 폴 되풀이돼 로그인 폭풍이 된다. 사람이 목록에서 보고 다시 보낸다.
    await sql`update classnote_class_notices set status=${results.some((x) => x.ok) ? "partial" : "failed"},
      results=${sql.json(results)}, error=${`처리 중 오류: ${msg}`} where id=${row.id}`;
    log(`[class-notice] 처리 오류: ${msg}`);
    return { processed: 0 };
  } finally {
    await page.close().catch(() => {});
  }
}
