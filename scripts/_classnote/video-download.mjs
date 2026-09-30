import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { link, mkdir, open, readFile, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { writeVideoState } from "./video-state.mjs";

const numericId = (value) => /^[1-9]\d*$/.test(String(value));
const MAX_BYTES = 500 * 1024 * 1024;

export function videoCandidate(post, centerId, anyAuthor = false, allowPending = false) {
  const video = post?.attached_video;
  if ((!anyAuthor && post?.author?.type !== "parent") || !video) return null;
  if (![centerId, post.id, video.id].every(numericId)) return null;
  const sources = ["high", "low"].flatMap((quality) => {
    try {
      const url = new URL(video[quality]);
      return url.protocol === "https:" && !url.username && !url.password ? [{ quality, url: url.href }] : [];
    } catch { return []; }
  });
  if (!sources.length && !allowPending) return null;
  return { centerId: String(centerId), postId: String(post.id), videoId: String(video.id),
    childId: numericId(post.child) ? String(post.child) : null,
    boardId: numericId(post.cls) ? String(post.cls) : null, boardName: String(post.class_name ?? ""),
    postedAt: post.created ?? null, sources };
}

export async function fileDigests(filePath) {
  const sha256 = createHash("sha256");
  const md5 = createHash("md5");
  let bytes = 0;
  for await (const chunk of createReadStream(filePath)) { sha256.update(chunk); md5.update(chunk); bytes += chunk.length; }
  return { bytes, sha256: sha256.digest("hex"), md5: md5.digest("hex") };
}

/** URL·access_key는 로컬 기록에도 남기지 않는다. 재실행은 파일의 해시까지 대조한다. */
export async function downloadVideo(candidate, outputDir, { fetchImpl = fetch } = {}) {
  if (![candidate.centerId, candidate.videoId, candidate.postId].every(numericId)) throw new Error("영상 식별자가 올바르지 않습니다.");
  await mkdir(outputDir, { recursive: true });
  const name = `classnote-${candidate.centerId}-${candidate.videoId}.mp4`;
  const filePath = path.join(outputDir, name);
  const metadataPath = `${filePath}.json`;
  let previous;
  try { previous = JSON.parse(await readFile(metadataPath, "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  if (!previous) {
    // 파일 확정 직후 전원이 끊겨도, 직전에 남긴 해시가 일치하는 파일만 완료 기록으로 복구한다.
    try {
      const pending = JSON.parse(await readFile(`${metadataPath}.pending`, "utf8"));
      const digest = await fileDigests(filePath);
      if (pending.centerId !== candidate.centerId || pending.videoId !== candidate.videoId ||
        pending.sha256 !== digest.sha256 || pending.bytes !== digest.bytes) throw new Error("중단된 다운로드 검증 실패");
      await writeVideoState(metadataPath, pending, { createOnly: true });
      previous = pending;
      await unlink(`${metadataPath}.pending`);
    } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  if (previous) {
    const digest = await fileDigests(filePath);
    if (previous.videoId !== candidate.videoId || previous.centerId !== candidate.centerId ||
      previous.sha256 !== digest.sha256 || previous.bytes !== digest.bytes || previous.md5 !== digest.md5)
      throw new Error("기존 영상 검증 실패 — 파일을 보존했습니다.");
    // 기존 시험 파일에도 같은 게시물에서 확인한 분류용 번호만 보충한다.
    if (previous.postId === candidate.postId && previous.childId === undefined) {
      Object.assign(previous, { childId: candidate.childId ?? null, boardId: candidate.boardId ?? null, boardName: candidate.boardName ?? "" });
      await writeVideoState(metadataPath, previous);
    }
    return { ...previous, filePath, metadataPath, status: "already-downloaded" };
  }
  try { await stat(filePath); throw new Error("기록 없는 기존 영상 파일이 있어 덮어쓰지 않습니다."); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const failures = [];
  for (const source of candidate.sources) {
    const partialPath = `${filePath}.${randomUUID()}.part`;
    let committed = false;
    try {
      const response = await fetchImpl(source.url, { signal: AbortSignal.timeout(10 * 60_000) });
      const length = Number(response.headers.get("content-length") ?? 0);
      const mime = (response.headers.get("content-type") ?? "").split(";")[0];
      if (response.status !== 200 || !response.body || length > MAX_BYTES || !["video/mp4", "application/octet-stream"].includes(mime)) {
        await response.body?.cancel();
        throw new Error(`다운로드 응답 확인 필요(HTTP ${response.status})`);
      }
      let bytes = 0;
      const bound = new Transform({ transform(chunk, _encoding, callback) {
        bytes += chunk.length;
        callback(bytes > MAX_BYTES ? new Error("영상 500MB 상한 초과") : null, chunk);
      } });
      await pipeline(Readable.fromWeb(response.body), bound, createWriteStream(partialPath, { flags: "wx", mode: 0o600 }));
      if (!bytes || length && length !== bytes) throw new Error("다운로드 파일 크기 불일치");
      const handle = await open(partialPath, "r");
      const header = Buffer.alloc(12);
      try { await handle.read(header, 0, 12, 0); } finally { await handle.close(); }
      if (header.toString("ascii", 4, 8) !== "ftyp") throw new Error("MP4 파일 형식이 아닙니다.");
      const digests = await fileDigests(partialPath);
      const record = { version: 1, centerId: candidate.centerId, postId: candidate.postId, videoId: candidate.videoId,
        childId: candidate.childId ?? null, boardId: candidate.boardId ?? null, boardName: candidate.boardName ?? "",
        postedAt: candidate.postedAt, downloadedAt: new Date().toISOString(), name, quality: source.quality,
        mimeType: "video/mp4", ...digests };
      // 같은 폴더의 원자적 링크 생성: 이미 존재하는 파일을 절대 덮어쓰지 않는다.
      await writeVideoState(`${metadataPath}.pending`, record);
      await link(partialPath, filePath);
      committed = true;
      await writeVideoState(metadataPath, record, { createOnly: true });
      await unlink(`${metadataPath}.pending`);
      return { ...record, filePath, metadataPath, status: "downloaded" };
    } catch (error) {
      if (committed || error.code === "EEXIST") throw error;
      failures.push(`${source.quality}: 다운로드 실패`);
    } finally { await unlink(partialPath).catch((error) => { if (error.code !== "ENOENT") throw error; }); }
  }
  throw new Error(failures.join(" / ") || "다운로드할 영상 주소가 없습니다.");
}

/** 이미 받은 파일을 지정해 재개한다. 최신 글이 바뀌어도 이전 전송을 마칠 수 있다. */
export async function loadDownloadedVideo(filePath) {
  const metadataPath = `${filePath}.json`;
  const record = JSON.parse(await readFile(metadataPath, "utf8"));
  const digest = await fileDigests(filePath);
  if (![record.centerId, record.postId, record.videoId].every(numericId) ||
    record.sha256 !== digest.sha256 || record.md5 !== digest.md5 || record.bytes !== digest.bytes ||
    record.name !== path.basename(filePath)) throw new Error("저장된 영상과 기록이 일치하지 않습니다.");
  return { ...record, filePath, metadataPath, status: "already-downloaded" };
}
