// scripts/_classnote/video-compress.mjs — 숙제 영상을 Drive에 올리기 전 압축(원장 2026-10-01 *"화질은 최대한 보존해서 압축"*).
//
// 설정(근거는 video-archive-guide.md '압축' 절): H.264 High + yuv420p(8비트) · CRF 22 · preset medium · 해상도 원본 유지
// (긴 변 1920 초과만 1920으로) · 프레임 타이밍 그대로(passthrough) · 회전은 화면에 보이는 방향으로 · AAC(원본 AAC면 그대로 복사)
// · faststart. H.265는 쓰지 않는다(Drive 미리보기·브라우저 재생이 기기마다 갈린다).
//
// 🔴 압축은 보관을 막지 않는다 — ffmpeg 없음·실패·시간 초과·검증 불일치는 전부 **원본을 올린다**(null 반환).
// 🔴 절감이 15% 미만이면 원본을 올린다(ClassNote가 이미 압축해 내려주는 영상은 대부분 여기에 걸린다).
// 🔴 중복 판정은 원본 지문(원본 md5·크기)으로 한다 — 압축본의 md5는 실행마다 같다는 보장이 없다(video-drive.mjs).
import { link, readdir, readFile, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileDigests } from "./video-download.mjs";
import { writeVideoState } from "./video-state.mjs";
import { defaultRunner, findFfmpeg, probeVideo } from "./video-ffmpeg.mjs";

export const COMPRESS_PROFILE = Object.freeze({
  id: "h264-crf22-medium-v1", crf: 22, preset: "medium", maxLongSide: 1920, audioBitrate: "128k", minSavings: 0.15,
  // 원본 영상 비트레이트가 이미 이만큼(픽셀·프레임당 비트) 낮으면 인코딩하지 않는다 — 실측: ClassNote 1080p 4.1Mbps(0.067)를
  // CRF 22로 다시 만들면 0.10이 필요해 오히려 1.56배가 됐다. 0.08 미만에서 15%를 줄이려면 그보다 1.5배 쉬운 화면이어야 한다.
  skipBelowBpp: 0.08,
});
const stats = { ffmpeg: null, compressed: 0, kept: 0, failed: 0, savedBytes: 0 };
let announced;

/** 하트비트용 — 이 워커 프로세스가 켜진 뒤의 압축 결과. */
export function compressionStatus() { return { ...stats }; }

/** 시험용 — 상태·안내 기억을 비운다. */
export function resetCompressionStats() { Object.assign(stats, { ffmpeg: null, compressed: 0, kept: 0, failed: 0, savedBytes: 0 }); announced = undefined; }

export const compressionDisabled = (env = process.env) => /^(0|off|false|no)$/i.test(String(env.CLASSNOTE_VIDEO_COMPRESS ?? "").trim());

/** 긴 변이 상한을 넘을 때만 비율대로 줄인다. H.264 4:2:0은 짝수 크기만 받으므로 짝수로 맞춘다. */
export function targetSize(width, height, maxLongSide = COMPRESS_PROFILE.maxLongSide) {
  const scale = Math.min(1, maxLongSide / Math.max(width, height));
  const even = (n) => Math.max(2, Math.floor((n * scale) / 2) * 2);
  return { width: even(width), height: even(height) };
}

/** 압축 명령 인자. 회전은 ffmpeg 자동 회전(기본값)이 픽셀을 돌린 뒤라 크기는 화면 방향 기준이다. */
export function ffmpegArgs(input, output, probe, { threads = 2, legacyVsync = false, profile = COMPRESS_PROFILE } = {}) {
  const size = targetSize(probe.width, probe.height, profile.maxLongSide);
  // 워커(node)가 강제 종료되면 ffmpeg도 함께 끝난다 — Windows에서 node는 자식을 '부모와 함께 종료' 작업 개체에 넣는다(실측).
  // (-timelimit은 Windows ffmpeg에서 구현돼 있지 않아 조용히 무시되므로 쓰지 않는다.)
  const args = ["-hide_banner", "-nostdin", "-loglevel", "error", "-n", "-i", input,
    "-map", "0:v:0", "-map", "0:a:0?", "-map_metadata", "0",
    "-c:v", "libx264", "-preset", profile.preset, "-crf", String(profile.crf), "-profile:v", "high", "-pix_fmt", "yuv420p"];
  if (size.width !== probe.width || size.height !== probe.height) args.push("-vf", `scale=${size.width}:${size.height}:flags=lanczos`);
  args.push(...(legacyVsync ? ["-vsync", "passthrough"] : ["-fps_mode", "passthrough"]));
  if (probe.audio) {
    const copy = probe.audio.codec === "aac" && (probe.audio.bitRate === null || probe.audio.bitRate <= 192_000);
    args.push(...(copy ? ["-c:a", "copy"] : ["-c:a", "aac", "-b:a", profile.audioBitrate]));
  }
  args.push("-threads", String(threads), "-max_muxing_queue_size", "1024", "-movflags", "+faststart", "-f", "mp4", output);
  return args;
}

/** 원본 `classnote-1-2.mp4` 옆에 두는 압축 산출물 이름(접두가 `classnote-1-2.aywa.`로 고정 — 정리가 이 접두로 지운다). */
export function compressionPaths(originalPath) {
  const dir = path.dirname(originalPath);
  const stem = path.basename(originalPath).replace(/\.mp4$/i, "");
  return { dir, prefix: `${stem}.aywa.`, output: path.join(dir, `${stem}.aywa.mp4`), record: path.join(dir, `${stem}.aywa.json`) };
}

/**
 * Drive·DB 완료 뒤 워커가 부른다 — 압축본·판단 기록·중단된 조각, 그리고 원본의 업로드 재개 기록(`*.mp4.drive-state.json`,
 * 완료 뒤엔 쓸모가 없는데 지금까지 영영 남았다). 원본·원본 기록 정리는 워커 몫이다.
 */
export async function removeArchiveLeftovers(originalPath) {
  const { dir, prefix } = compressionPaths(originalPath);
  const state = `${path.basename(originalPath)}.drive-state.json`;
  let names = [];
  try { names = await readdir(dir); } catch { return; }
  for (const name of names.filter((n) => n.startsWith(prefix) || n.startsWith(state))) await unlink(path.join(dir, name)).catch(() => {});
}

const sameSource = (record, video, profile) => record?.version === 1 && record.profile === profile.id &&
  record.source?.md5 === video.md5 && record.source?.bytes === video.bytes && record.source?.sha256 === video.sha256;

async function remember(paths, video, profile, decision) {
  await writeVideoState(paths.record, { version: 1, profile: profile.id, source: { md5: video.md5, bytes: video.bytes, sha256: video.sha256 }, ...decision });
  return decision;
}

/** 지난 실행의 판단 재사용 — 재시도 때 같은 영상을 또 인코딩하지 않는다. 안 맞으면 지우고 처음부터. */
async function cachedDecision(paths, video, profile) {
  let record;
  try { record = JSON.parse(await readFile(paths.record, "utf8")); } catch { record = null; }
  if (record && sameSource(record, video, profile)) {
    if (record.decision === "kept") return { decision: "kept", marker: record.marker };
    // 실패도 기억한다 — 원본 업로드가 이어서 실패해 재시도할 때 같은 영상을 또 (최대 60분) 인코딩하며 큐를 막지 않게.
    if (record.decision === "failed") return { decision: "failed" };
    if (record.decision === "compressed") {
      const digest = await fileDigests(paths.output).catch(() => null);
      if (digest && digest.md5 === record.upload?.md5 && digest.bytes === record.upload?.bytes && digest.sha256 === record.upload?.sha256)
        return { decision: "compressed", marker: record.marker, upload: record.upload };
    }
  }
  await unlink(paths.record).catch(() => {});
  await unlink(paths.output).catch(() => {});
  return null;
}

const keep = (marker) => ({ decision: "kept", marker });
const KEPT_REASON = { "kept-hdr": "HDR 영상", "kept-bitrate": "이미 충분히 압축된 영상", "kept-savings": "절감 15% 미만" };
const encodeTimeout = (seconds) => Math.min(60, Math.max(10, Math.ceil((seconds * 8) / 60) + 2)) * 60_000;

async function compressOnce(video, paths, tools, { runner, profile, threads, signal }) {
  const source = await probeVideo(tools, video.filePath, runner);
  if (!source) throw new Error("영상 정보를 읽지 못했습니다.");
  if (source.hdr) return keep("kept-hdr");
  const size = targetSize(source.width, source.height, profile.maxLongSide);
  const bpp = source.videoBitRate && source.fps ? source.videoBitRate / (size.width * size.height * source.fps) : null;
  if (bpp !== null && bpp < profile.skipBelowBpp) return keep("kept-bitrate");
  const partial = `${paths.output}.${randomUUID()}.part`;
  const timeoutMs = encodeTimeout(source.duration);
  const near = (a, b) => Math.abs(a - b) <= Math.max(0.5, b * 0.01);
  try {
    await runner.encode(tools.ffmpeg, ffmpegArgs(video.filePath, partial, source, { threads, legacyVsync: tools.legacyVsync, profile }), { timeoutMs, signal });
    const out = await probeVideo(tools, partial, runner);
    // 잘린 출력(입력 손상·중단)을 압축본으로 올리면 영상 일부가 사라진다 — 길이(파일·영상 각각)·크기·소리 유무가 원본과 맞아야 쓴다.
    if (!out || out.width !== size.width || out.height !== size.height || out.rotation % 360 !== 0 || !out.audio !== !source.audio ||
      !near(out.duration, source.duration) || (source.videoDuration && !(out.videoDuration && near(out.videoDuration, source.videoDuration))))
      throw new Error("압축본 검증 실패(길이·크기·소리)");
    const digest = await fileDigests(partial);
    if (digest.bytes > video.bytes * (1 - profile.minSavings)) return keep("kept-savings");
    await link(partial, paths.output);
    return { decision: "compressed", marker: profile.id, upload: { name: path.basename(paths.output), ...digest } };
  } finally { await unlink(partial).catch(() => {}); }
}

/**
 * Drive 업로드 직전에 부른다(uploadVideoToDrive의 `prepareUpload`). 반환:
 *   null — 원본을 그대로(압축 판단 없음: 꺼짐·ffmpeg 없음·실패) · { marker } — 원본을 그대로(판단함: 이미 낮은 비트레이트·절감 부족·HDR)
 *   { marker, filePath, md5, bytes, sha256 } — 압축본을 올린다.
 * `signal`(선택)이 끊기면 인코딩을 멈추고 **던진다**(실패로 기억하지 않는다 — 다음에 처음부터 다시 판단한다).
 */
export async function prepareCompressedUpload(video, { log = console.log, env = process.env, runner = defaultRunner, profile = COMPRESS_PROFILE, threads, signal } = {}) {
  const tools = compressionDisabled(env) ? null : await findFfmpeg({ env, runner });
  stats.ffmpeg = compressionDisabled(env) ? "off" : tools ? "ok" : "missing";
  if (announced !== stats.ffmpeg) { // 상태가 바뀔 때만 한 번(영상마다 찍지 않는다)
    announced = stats.ffmpeg;
    log(stats.ffmpeg === "off" ? "[영상 압축] 꺼짐(CLASSNOTE_VIDEO_COMPRESS) — 원본 그대로 올립니다."
      : tools ? `[영상 압축] ffmpeg ${tools.label} 확인 — 새 영상은 H.264(CRF ${profile.crf})로 압축해 올립니다.`
      : "[영상 압축] ffmpeg를 찾지 못했습니다 — 원본 그대로 올립니다. 발송 PC에서 scripts/_classnote/발송PC-영상압축-설치.bat 실행.");
  }
  if (!tools) return null;
  const paths = compressionPaths(video.filePath);
  try {
    let result = await cachedDecision(paths, video, profile);
    if (!result) {
      for (const name of (await readdir(paths.dir)).filter((n) => n.startsWith(paths.prefix) && n.endsWith(".part")))
        await unlink(path.join(paths.dir, name)).catch(() => {});
      const cpu = os.availableParallelism?.() ?? os.cpus().length;
      result = await remember(paths, video, profile, await compressOnce(video, paths, tools,
        { runner, profile, threads: threads ?? Math.max(1, Math.min(8, Math.floor(cpu / 2))), signal }));
      const mb = (n) => `${(n / 1048576).toFixed(1)}MB`;
      if (result.decision === "compressed") {
        stats.compressed++; stats.savedBytes += video.bytes - result.upload.bytes;
        log(`[영상 압축] ${mb(video.bytes)} → ${mb(result.upload.bytes)}`);
      } else { stats.kept++; log(`[영상 압축] 원본 유지(${KEPT_REASON[result.marker] ?? "판단"}) · ${mb(video.bytes)}`); }
    }
    if (result.decision === "failed") return null;
    if (result.decision === "kept") return { marker: result.marker };
    return { marker: result.marker, filePath: paths.output, md5: result.upload.md5, bytes: result.upload.bytes, sha256: result.upload.sha256 };
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    stats.failed++;
    await remember(paths, video, profile, { decision: "failed" }).catch(() => {});
    log(`[영상 압축] 실패 — 원본 그대로 씁니다. (${String(error?.message ?? error).slice(0, 120)})`);
    return null;
  }
}

/** 워커 배선용: `uploadVideoToDrive(…, { prepareUpload: archiveUploadPreparer({ log }) })`. */
export const archiveUploadPreparer = (options = {}) => (video) => prepareCompressedUpload(video, options);
