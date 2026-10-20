// scripts/_classnote/video-drive-replace.mjs — 이미 Drive에 있는 영상 파일을 **같은 파일 번호 그대로** 내려받고·내용을 바꾸고·옛 버전을 지운다
// (`/v` 영상 사후 압축 전용, video-link-compress.mjs). 파일 번호·폴더·공유 링크·DB 연결이 바뀌지 않아 장부·재생·반려는 손댈 것이 없다.
//
// 🔴 `appProperties`는 보내지 않는다 — 웹 앱이 업로드를 확인한 표식(`aywaSource=link`·`aywaUpload`)이고, 보내지 않은 키는 Drive가 그대로 둔다.
// 🔴 옛 버전은 **원본과 같은 해시의 버전만** 지운다(머리 버전·다른 내용은 남긴다). 못 지워도 Drive가 30일 뒤 스스로 정리한다(보관 고정 아님).
import { createHash } from "node:crypto";
import { open, rename, unlink } from "node:fs/promises";
import { DRIVE_API as API, driveJson as json } from "./video-drive-http.mjs";
import { sendResumableFile } from "./video-drive.mjs";

// driveId·capabilities = 공유 드라이브 파일 판정(공유 드라이브는 `ownedByMe`를 채우지 않는다 — 소유자가 드라이브다).
export const REPLACE_FIELDS = "id,name,mimeType,size,md5Checksum,trashed,ownedByMe,driveId,capabilities(canEdit),headRevisionId,properties";
/** Drive가 공간·사용량 한도로 거절했다는 사유(403 본문) — 시도로 세지 않고 나중에 다시 한다. */
const LIMIT_REASON = /storageQuotaExceeded|quotaExceeded|rateLimitExceeded|userRateLimitExceeded|dailyLimitExceeded/;
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3/files";
const DOWNLOAD_CHUNK = 16 * 1024 * 1024;
const DRIVE_ID = /^[A-Za-z0-9_-]{10,}$/;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function checkId(id) {
  if (!DRIVE_ID.test(String(id ?? ""))) throw new Error("Drive 파일 번호가 올바르지 않습니다.");
  return id;
}

/** 파일 정보 — 없으면 null(404). 그 밖의 오류는 던진다(없음으로 뭉개지 않는다). */
export async function readDriveVideo(request, fileId) {
  const response = await request(`${API}/files/${checkId(fileId)}?supportsAllDrives=true&fields=${REPLACE_FIELDS}`);
  if (response.status === 404) return null;
  return json(response, "Drive 영상 확인");
}

/**
 * 범위 요청으로 나눠 받는다 — 요청 하나의 시간 상한(120초)이 큰 영상(최대 2GB)을 한 번에 못 받는다. 받은 크기·해시를 돌려주고,
 * 크기가 `bytes`와 다르면 던진다. 조각마다 세 번까지 다시 받는다. 끝나기 전에는 `<outPath>.part`에만 쓴다.
 */
export async function downloadDriveVideo(request, fileId, bytes, outPath, { signal, sleep: wait = sleep, chunkBytes = DOWNLOAD_CHUNK } = {}) {
  checkId(fileId);
  if (!Number.isSafeInteger(bytes) || bytes <= 0) throw new Error("내려받을 영상 크기가 올바르지 않습니다.");
  const partial = `${outPath}.part`;
  const md5 = createHash("md5");
  const sha256 = createHash("sha256");
  const file = await open(partial, "w", 0o600);
  let done = false;
  try {
    for (let offset = 0; offset < bytes;) {
      const end = Math.min(bytes, offset + chunkBytes) - 1;
      let chunk = null;
      for (let failures = 0; !chunk;) {
        signal?.throwIfAborted();
        try {
          const response = await request(`${API}/files/${fileId}?alt=media&supportsAllDrives=true`, { signal, headers: { Range: `bytes=${offset}-${end}` } });
          const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get("content-range") ?? "")?.slice(1).map(Number);
          if (response.status !== 206 || !range || range[0] !== offset || range[1] !== end || range[2] !== bytes) {
            await response.body?.cancel();
            throw Object.assign(new Error(`Drive 영상 내려받기 HTTP ${response.status}`), { permanent: response.status === 404 || response.status === 416 });
          }
          const body = Buffer.from(await response.arrayBuffer());
          if (body.length !== end - offset + 1) throw new Error("Drive 영상 조각 크기가 다릅니다.");
          chunk = body;
        } catch (error) {
          if (signal?.aborted || error?.permanent || ++failures > 3) throw error;
          await wait(1000 * 2 ** failures);
        }
      }
      await file.write(chunk, 0, chunk.length, offset);
      md5.update(chunk); sha256.update(chunk);
      offset += chunk.length;
    }
    await file.close();
    done = true;
    await rename(partial, outPath);
    return { filePath: outPath, bytes, md5: md5.digest("hex"), sha256: sha256.digest("hex") };
  } finally {
    if (!done) await file.close().catch(() => {});
    await unlink(partial).catch(() => {});
  }
}

/**
 * 이 계정의 **개인** 남은 공간(바이트) — 한도가 없으면(무제한 계정) null. 공유 드라이브 파일에는 해당하지 않는다(부르는 쪽이 건너뛴다).
 * 새 버전은 옛 버전을 지우기 **전에** 자리를 차지하므로 압축본이 들어갈 자리가 없으면 내려받지도 않는다(인코딩을 다 하고 교체에서 403으로 버리지 않게).
 */
export async function driveFreeBytes(request) {
  const about = await json(await request(`${API}/about?fields=storageQuota(limit,usage)`), "Drive 용량 조회");
  if (about?.storageQuota?.limit === undefined) return null;
  const limit = Number(about.storageQuota.limit);
  const usage = Number(about.storageQuota.usage);
  if (!Number.isFinite(limit) || !Number.isFinite(usage)) throw new Error("Drive 용량 응답이 올바르지 않습니다.");
  return Math.max(0, limit - usage);
}

/** 메타데이터만(새 버전이 생기지 않는다) — 판단만 한 영상의 표식(`properties`)을 남길 때. */
export async function patchDriveProperties(request, fileId, properties) {
  const response = await request(`${API}/files/${checkId(fileId)}?supportsAllDrives=true&fields=${REPLACE_FIELDS}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ properties }),
  });
  return json(response, "Drive 영상 표식");
}

/**
 * 내용을 `upload`(압축본 { filePath, bytes })로 바꾼다 — 같은 파일 번호에 새 버전이 생긴다. 이름·형식(`video/mp4`)·`properties`를 함께 고친다.
 * 끝나면 Drive를 다시 읽어 돌려준다(검증은 부르는 쪽 — 해시·크기).
 */
export async function replaceDriveVideoContent(request, fileId, upload, { name, properties, signal, sleep: wait } = {}) {
  checkId(fileId);
  const start = async () => {
    const response = await request(`${UPLOAD_API}/${fileId}?uploadType=resumable&supportsAllDrives=true&fields=id`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": "video/mp4", "X-Upload-Content-Length": String(upload.bytes) },
      body: JSON.stringify({ ...(name ? { name } : {}), mimeType: "video/mp4", properties }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const limited = response.status === 429 || (response.status === 403 && LIMIT_REASON.test(body));
      throw Object.assign(new Error(`Drive 영상 교체 시작 HTTP ${response.status}${limited ? " — Drive 공간·사용량 한도" : ""}`), { later: limited });
    }
    const session = response.headers.get("location");
    if (!session || new URL(session).origin !== "https://www.googleapis.com") throw new Error("Drive 업로드 세션 응답이 올바르지 않습니다.");
    return session;
  };
  await sendResumableFile(request, upload.filePath, upload.bytes, { session: await start(), restart: start, sleep: wait, signal });
  const after = await readDriveVideo(request, fileId);
  if (!after) throw new Error("교체한 Drive 영상을 찾지 못했습니다.");
  return after;
}

/**
 * 머리 버전이 아닌 버전 중 **해시가 `md5`(원본)인 것만** 지운다. 반환: "deleted"(지움) · "none"(지울 것 없음) · "left"(못 지움 — Drive가 30일 뒤 정리).
 * 버전 목록은 한 쪽(최대 200개)만 본다 — 업로드로만 만든 파일이라 버전이 몇 개뿐이다.
 */
export async function deleteOldRevisions(request, fileId, { headRevisionId, md5 }) {
  checkId(fileId);
  const listed = await request(`${API}/files/${fileId}/revisions?pageSize=200&fields=revisions(id,md5Checksum,keepForever)`);
  if (!listed.ok) return "left";
  const old = ((await listed.json()).revisions ?? []).filter((r) => r?.id && r.id !== headRevisionId && r.md5Checksum === md5);
  if (!old.length) return "none";
  let left = false;
  for (const revision of old) {
    const response = await request(`${API}/files/${fileId}/revisions/${encodeURIComponent(revision.id)}`, { method: "DELETE" });
    if (!response.ok && response.status !== 404) left = true;
  }
  return left ? "left" : "deleted";
}
