/**
 * scripts/_classnote/notice-attachments.mjs — 공지(classnote_notices) 첨부 게시 보조.
 *
 * 교재요청서를 만든 강사가 학부모에게 보내는 알림장 글은 **글자 + 이미지**(학생별 요청서 PNG · 공통 교재 표지)로
 * 나가야 한다(0130a). 앱이 첨부를 큐 행에 실어두면, 워커가 여기 헬퍼로 ① 내부 라우트에서 signed URL을 받고
 * ② 바이트를 내려받아 ③ ClassNote 내부 스토리지(kage)에 올려 access_key를 얻는다.
 * 게시 자체는 classnote-notice-core.mjs가 postClassnoteReport로 한다.
 *
 * ⚠️ **@playwright/test를 import하지 말 것**(board-safety.mjs와 같은 규칙) — 이 모듈은 Vitest가 픽업한다.
 *    page가 필요한 동작(작성폼 이동·kage 업로드)은 전부 **호출자가 주입**한다(createNoticeMediaUploader).
 * ⚠️ 실패 문구는 전부 한글 — 원장이 연동 PC 로그를 열지 않아도 results[].note로 원인이 보이게.
 */

/** 첨부 이름 → 업로드 MIME. 라우트가 이미 이미지/파일을 갈라 주므로 kind는 그 결과를 따른다. */
export function mimeForNoticeName(name, kind = "image") {
  if (kind !== "image") return "application/octet-stream";
  const ext = String(name || "")
    .toLowerCase()
    .match(/\.([a-z0-9]+)(?:\?|$)/)?.[1];
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  return "image/png";
}

/** 내부 라우트 응답 상태 → 한글 사유(보고서 경로 sendReportViaApi와 같은 분류). */
export function noticeEndpointFailureReason(status) {
  if (status === -1) return "네트워크 연결 실패";
  if (status === 401) return "인증 실패(CLASSNOTE_INTERNAL_SECRET 불일치/미설정)";
  if (status === 404) return "첨부 목록을 못 받음(앱 미배포 또는 공지 없음)";
  if (status === 500) return "앱이 첨부 URL을 못 만듦(스토리지 서명 실패)";
  if (status === 200) return "앱이 첨부 URL을 못 만듦(스토리지 서명 실패)";
  return `HTTP ${status}`;
}

const emptySplit = () => ({ images: [], files: [], expected: 0, missing: [] });

/**
 * 라우트 응답 한 칸 정규화 — url·name 있는 항목만 담되, **`expected`(서명 전 장수)와 `missing`(서명 실패 이름)은
 * 그대로 보존**한다. 이 둘이 "몇 장이 빠졌는지"의 유일한 근거다(없으면 부분 실패가 조용히 성공으로 남는다).
 * 구버전 앱(라우트에 expected 없음)이면 목록 길이로 폴백한다.
 */
function normalizeSplit(v) {
  const pick = (list) =>
    (Array.isArray(list) ? list : [])
      .filter((x) => x && typeof x.url === "string" && x.url)
      .map((x) => ({ name: String(x.name || "첨부"), url: x.url }));
  const images = pick(v?.images);
  const files = pick(v?.files);
  const missing = (Array.isArray(v?.missing) ? v.missing : []).map((n) => String(n || "첨부"));
  const expected = Number.isFinite(v?.expected) ? Number(v.expected) : images.length + files.length + missing.length;
  return { images, files, expected, missing };
}

/**
 * 첨부 signed URL 조회 — `GET {base}/api/internal/notice-attachments/{noticeId}`.
 *
 * 🔴 **계약**: `targets[i]`는 이미 "공통 + 그 타깃"이 합쳐진 **최종 목록**이다(중복 path 제거됨) —
 *    게시할 때 `common`을 다시 더하면 중복 첨부가 된다. `common`은 진단용(공통이 몇 장이었나).
 *    `targets`는 큐 행 `targets`와 같은 순서·같은 길이(첨부 없는 타깃도 빈 칸으로 자리를 채움).
 *
 * @param {number} [expectedTotal] DB가 알고 있는 첨부 장수(공통+학생별). **0보다 큰데 라우트가 전 타깃 0장을
 *   돌려주면 서명이 전멸한 것**이라 실패로 본다 — 그대로 진행하면 글자만 게시되고 success로 기록된다.
 */
export async function fetchNoticeMedia({ base, secret, noticeId, expectedTotal = 0, fetchImpl = globalThis.fetch }) {
  const url = `${String(base || "").replace(/\/+$/, "")}/api/internal/notice-attachments/${noticeId}`;
  let status = 0;
  let json = null;
  try {
    const res = await fetchImpl(url, { headers: secret ? { "x-eywa-internal": secret } : {} });
    status = res.status;
    if (res.ok) json = await res.json();
  } catch (e) {
    return { ok: false, error: `첨부 목록 조회 실패 — 네트워크 연결 실패(${e.message})`, common: emptySplit(), targets: [] };
  }
  const targets = Array.isArray(json?.targets) ? json.targets.map((t) => ({ board: String(t?.board ?? ""), ...normalizeSplit(t) })) : [];
  const fail = (reason) => ({ ok: false, error: `첨부 목록 조회 실패 — ${reason}`, common: emptySplit(), targets: [] });
  // ① 목록 자체가 비었다(=응답 실패·공지 행 못 찾음) → 글자만 나가는 사고라 실패로 본다.
  if (!targets.length) return fail(noticeEndpointFailureReason(status));
  // ② 타깃 칸은 왔는데 **올릴 첨부가 한 장도 없다** — DB엔 있는데(expectedTotal>0) 라우트가 0장이면 서명 전멸이다.
  //    (칸 길이만 보던 옛 가드는 학생 수만 세서 이 경우를 절대 못 잡았다 — 적대검증 2026-07-21.)
  if (expectedTotal > 0 && targets.every((t) => !t.expected)) return fail(noticeEndpointFailureReason(status));
  return { ok: true, common: normalizeSplit(json?.common), targets };
}

/**
 * 이 타깃 몫의 첨부 찾기 — 같은 순서(index) 우선, 보드명이 어긋나면 board로 재탐색.
 * 못 찾으면 **null**(호출자는 게시하지 않고 보류 — 첨부 빠진 글이 나가는 것 방지).
 */
export function mediaForNoticeTarget(routeTargets, target, index) {
  const list = Array.isArray(routeTargets) ? routeTargets : [];
  const board = target?.board ?? "";
  const byIndex = list[index];
  if (byIndex && (!byIndex.board || !board || byIndex.board === board)) return byIndex;
  return list.find((e) => e?.board && e.board === board) ?? null;
}

/** kage 응답 → attached_images 원소. access_key 없으면 null(업로드 거부). */
export function kageImagePayload(kage, { name, byteLength }) {
  if (!kage?.access_key) return null;
  const img = kage.info?.img ?? {};
  return {
    access_key: kage.access_key,
    original_file_name: name,
    file_size: img.length ?? byteLength,
    width: img.width,
    height: img.height,
  };
}

/** kage 응답 → attached_files 원소. */
export function kageFilePayload(kage, { name, byteLength }) {
  if (!kage?.access_key) return null;
  return { access_key: kage.access_key, original_file_name: name, file_size: kage.info?.size ?? byteLength };
}

/** signed URL → Buffer. 실패는 `HTTP 403`처럼 짧게 던진다(호출자가 한글 문장으로 감쌈). */
export async function downloadAttachment(url) {
  const res = await globalThis.fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * 첨부 준비기 — 다운로드 → kage 업로드 → 게시 payload. page 의존은 전부 주입받는다.
 *
 * @param {object} deps
 * @param {() => Promise<void>} deps.openForm  알림장 작성폼(/service/report/add)으로 이동. **타깃마다 1회** 호출된다
 *   (한 폼에 첨부가 계속 쌓이면 ClassNote 프론트 상한에 걸려 업로드가 조용히 실패할 수 있음 — 보고서 경로도 건마다 새로 연다).
 * @param {(kind: "image"|"file", file: {name:string, mimeType:string, buffer:Buffer}) => Promise<any>} deps.upload  kage 업로드(uploadToKage 래핑).
 * @param {(url: string) => Promise<Buffer>} [deps.download]
 *
 * ⚠️ **미검증**: kage access_key를 **여러 타깃(글)에 재사용해도 되는지 확인하지 못했다**(실발송 금지 상태에서 개발).
 *   그래서 기본은 재사용(캐시)하되, 게시가 실패하면 호출자가 `{ fresh: true }`로 다시 불러 **타깃마다 재업로드**한다.
 *   재사용이 실제로 거부되는 것으로 밝혀지면 캐시를 걷어내고 항상 fresh로 바꿀 것.
 */
export function createNoticeMediaUploader({ openForm, upload, download = downloadAttachment, log = () => {} }) {
  const cache = new Map(); // url → payload(kage access_key 포함)

  async function put(kind, item, { fresh, ensureForm }) {
    if (!fresh) {
      const hit = cache.get(item.url);
      if (hit) return { payload: hit, reused: true };
    }
    let bytes;
    try {
      bytes = await download(item.url);
    } catch (e) {
      throw new Error(`다운로드 실패(${e.message})`);
    }
    let kage;
    try {
      await ensureForm();
      kage = await upload(kind, { name: item.name, mimeType: mimeForNoticeName(item.name, kind), buffer: bytes });
    } catch (e) {
      throw new Error(`ClassNote 업로드 실패(${e.message})`);
    }
    const payload =
      kind === "image"
        ? kageImagePayload(kage, { name: item.name, byteLength: bytes.length })
        : kageFilePayload(kage, { name: item.name, byteLength: bytes.length });
    if (!payload) throw new Error("ClassNote 업로드 거부(access_key 없음)");
    cache.set(item.url, payload);
    return { payload, reused: false };
  }

  return {
    /**
     * 한 타깃 몫 준비. 반환 `{ attachedImages, attachedFiles, failures, reused, expected }`.
     * ⚠️ 실패가 하나라도 있으면 호출자는 **게시하지 말 것** — 요청서 빠진 글이 나가면 이 기능의 의미가 없다.
     * ⚠️ `expected`는 **라우트가 준 서명 전 장수**다(목록 길이가 아니다). 앱에서 서명에 실패해 목록에서
     *    빠진 첨부(`missing`)와, 준비 도중 실패한 첨부를 합쳐 **개수가 모자라면 실패로 만든다** —
     *    이 대조가 없으면 "첨부 0장 = 원래 없었던 글"로 오인해 글자만 게시된다(적대검증 2026-07-21).
     */
    async build(entry, { fresh = false } = {}) {
      let opened = false;
      const ensureForm = async () => {
        if (opened) return;
        await openForm();
        opened = true;
      };
      const attachedImages = [];
      const attachedFiles = [];
      const failures = [];
      let reused = false;
      // 앱에서 서명에 실패한 첨부 — 목록엔 아예 없으므로 여기서 먼저 실패로 기록한다(조용한 누락 차단).
      for (const name of Array.isArray(entry?.missing) ? entry.missing : []) {
        failures.push(`"${name}" 앱이 파일 주소를 만들지 못했습니다(스토리지 서명 실패)`);
        log(`[notice] 첨부 "${name}" 준비 실패 — 앱 서명 실패`);
      }
      for (const [kind, list] of [
        ["image", entry?.images ?? []],
        ["file", entry?.files ?? []],
      ]) {
        for (const item of list) {
          try {
            const r = await put(kind, item, { fresh, ensureForm });
            if (r.reused) reused = true;
            (kind === "image" ? attachedImages : attachedFiles).push(r.payload);
          } catch (e) {
            failures.push(`"${item.name}" ${e.message}`);
            log(`[notice] 첨부 "${item.name}" 준비 실패 — ${e.message}`);
          }
        }
      }
      const listed = (entry?.images ?? []).length + (entry?.files ?? []).length;
      // 기준은 **라우트가 준 서명 전 장수**. 없으면(구버전 앱) 목록+missing으로 폴백.
      const expected = Number.isFinite(entry?.expected)
        ? Number(entry.expected)
        : listed + (Array.isArray(entry?.missing) ? entry.missing.length : 0);
      // 준비된 장수 + 실패로 설명된 장수 < 기대치 = 어디선가 조용히 사라졌다 → 남은 차이도 실패로 만든다.
      const short = expected - (attachedImages.length + attachedFiles.length) - failures.length;
      if (short > 0) failures.push(`첨부 ${short}장이 앱 목록에서 빠졌습니다(재발송 필요)`);
      return { attachedImages, attachedFiles, failures, reused, expected };
    },
  };
}
