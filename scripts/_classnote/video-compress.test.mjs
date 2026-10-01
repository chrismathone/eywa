import { execFileSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fileDigests } from "./video-download.mjs";
import {
  COMPRESS_PROFILE, compressionPaths, compressionStatus, ffmpegArgs, prepareCompressedUpload,
  removeArchiveLeftovers, resetCompressionStats, targetSize,
} from "./video-compress.mjs";
import { defaultRunner, findFfmpeg, parseFfmpegVersion, readProbe, resetFfmpegCache } from "./video-ffmpeg.mjs";
import { mkdir } from "node:fs/promises";

const dirs = [];
async function original(bytes = 1000) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "aywa-compress-test-")); dirs.push(dir);
  const filePath = path.join(dir, "classnote-12-34.mp4");
  await writeFile(filePath, Buffer.alloc(bytes, 3));
  return { filePath, metadataPath: `${filePath}.json`, centerId: "12", videoId: "34", ...await fileDigests(filePath) };
}
const SOURCE = { streams: [
  { codec_type: "video", codec_name: "h264", width: 1920, height: 1080, color_transfer: "bt709", side_data_list: [{ side_data_type: "Display Matrix", rotation: -90 }] },
  { codec_type: "audio", codec_name: "aac", bit_rate: "96000" }], format: { duration: "14.83" } };
const OUTPUT = { streams: [{ codec_type: "video", codec_name: "h264", width: 1080, height: 1920 }, { codec_type: "audio", codec_name: "aac" }], format: { duration: "14.83" } };

/** ffmpeg 대역 — 원본 조회엔 source, 압축 조각(.part) 조회엔 output을 돌려주고, 인코딩은 지정한 크기의 파일을 쓴다. */
function runner({ source = SOURCE, output = OUTPUT, outBytes = 500, encode, missing = false } = {}) {
  return {
    text: vi.fn(async (_bin, args) => {
      if (missing) throw Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" });
      if (args.includes("-encoders")) return " V....D libx264              libx264 H.264 / AVC";
      if (args.includes("-version")) return "ffmpeg version 8.0.1-full_build-www.gyan.dev";
      return JSON.stringify(String(args.at(-1)).endsWith(".part") ? output : source);
    }),
    encode: vi.fn(encode ?? (async (_bin, args) => { await writeFile(args.at(-1), Buffer.alloc(outBytes, 9)); })),
  };
}
const quiet = () => {};
beforeEach(() => { resetFfmpegCache(); resetCompressionStats(); });
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });

describe("압축 명령(화질 우선 H.264)", () => {
  const probe = (width, height, audio = { codec: "aac", bitRate: 96_000 }) => ({ width, height, audio });
  it("H.264 High·CRF 22·medium·8비트·프레임 타이밍 그대로·faststart — H.265는 쓰지 않는다", () => {
    const args = ffmpegArgs("in.mp4", "out.part", probe(1080, 1920));
    const joined = args.join(" ");
    expect(joined).toContain("-c:v libx264 -preset medium -crf 22 -profile:v high -pix_fmt yuv420p");
    expect(joined).toContain("-fps_mode passthrough");
    expect(joined).toContain("-movflags +faststart -f mp4 out.part");
    expect(joined).not.toMatch(/x265|hevc|-r /);
    expect(args).not.toContain("-vf"); // 1920 이하 = 해상도 원본 그대로
    expect(joined).toContain("-c:a copy"); // 원본 AAC는 다시 깎지 않는다
  });
  it("긴 변이 1920을 넘을 때만(4K 가로·세로) 비율대로 줄이고, 홀수 크기는 짝수로 맞춘다", () => {
    expect(targetSize(3840, 2160)).toEqual({ width: 1920, height: 1080 });
    expect(targetSize(2160, 3840)).toEqual({ width: 1080, height: 1920 });
    expect(targetSize(1280, 720)).toEqual({ width: 1280, height: 720 });
    expect(targetSize(1079, 1919)).toEqual({ width: 1078, height: 1918 });
    expect(ffmpegArgs("i", "o", probe(2160, 3840))).toEqual(expect.arrayContaining(["-vf", "scale=1080:1920:flags=lanczos"]));
  });
  it("AAC가 아니거나 비트레이트가 높으면 AAC 128k, 소리가 없으면 오디오 인자 없음, 옛 ffmpeg는 -vsync", () => {
    expect(ffmpegArgs("i", "o", probe(1280, 720, { codec: "opus", bitRate: 64_000 })).join(" ")).toContain("-c:a aac -b:a 128k");
    expect(ffmpegArgs("i", "o", probe(1280, 720, { codec: "aac", bitRate: 320_000 })).join(" ")).toContain("-c:a aac -b:a 128k");
    expect(ffmpegArgs("i", "o", probe(1280, 720, null)).join(" ")).not.toContain("-c:a");
    expect(ffmpegArgs("i", "o", probe(1280, 720), { legacyVsync: true }).join(" ")).toContain("-vsync passthrough");
  });
  it("ffprobe: 회전(세로 영상)은 화면 방향 크기로, HDR(PQ·HLG·돌비)·표지 그림을 가려낸다", () => {
    expect(readProbe(SOURCE)).toMatchObject({ width: 1080, height: 1920, rotation: -90, duration: 14.83, hdr: false, audio: { codec: "aac", bitRate: 96_000 } });
    const hdr = (extra) => readProbe({ streams: [{ codec_type: "video", width: 1920, height: 1080, ...extra }] }).hdr;
    expect(hdr({ color_transfer: "arib-std-b67" })).toBe(true);
    expect(hdr({ color_transfer: "smpte2084" })).toBe(true);
    expect(hdr({ side_data_list: [{ side_data_type: "DOVI configuration record" }] })).toBe(true);
    expect(readProbe({ streams: [{ codec_type: "video", width: 600, height: 600, disposition: { attached_pic: 1 } }] })).toBeNull();
    expect(parseFfmpegVersion("ffmpeg version 4.4.2-0ubuntu").legacyVsync).toBe(true);
    expect(parseFfmpegVersion("ffmpeg version 8.0.1-full_build").legacyVsync).toBe(false);
    expect(parseFfmpegVersion("ffmpeg version N-112233-gabc").legacyVsync).toBe(false);
  });
});

describe("업로드 전 압축 판단", () => {
  it("충분히 줄면 압축본을 돌려주고, 재시도 때는 다시 인코딩하지 않는다", async () => {
    const video = await original(1000); const r = runner({ outBytes: 500 });
    const first = await prepareCompressedUpload(video, { log: quiet, env: {}, runner: r });
    expect(first).toMatchObject({ marker: COMPRESS_PROFILE.id, filePath: compressionPaths(video.filePath).output, bytes: 500 });
    expect(first.md5).toBe((await fileDigests(first.filePath)).md5);
    expect(await prepareCompressedUpload(video, { log: quiet, env: {}, runner: r })).toEqual(first);
    expect(r.encode).toHaveBeenCalledTimes(1);
    expect(compressionStatus()).toMatchObject({ ffmpeg: "ok", compressed: 1, savedBytes: 500 });
    expect((await readdir(path.dirname(video.filePath))).filter((n) => n.endsWith(".part"))).toEqual([]);
  });
  it("절감이 15% 미만이면 원본을 쓰고(판단만 표시), 그 판단도 기억한다", async () => {
    const video = await original(1000); const r = runner({ outBytes: 900 });
    expect(await prepareCompressedUpload(video, { log: quiet, env: {}, runner: r })).toEqual({ marker: "kept-savings" });
    expect(await prepareCompressedUpload(video, { log: quiet, env: {}, runner: r })).toEqual({ marker: "kept-savings" });
    expect(r.encode).toHaveBeenCalledTimes(1);
    expect((await readdir(path.dirname(video.filePath))).some((n) => n.endsWith(".aywa.mp4"))).toBe(false);
  });
  it("인코딩 실패·시간 초과면 원본(null) — 조각 파일을 남기지 않고, 재시도 때 다시 인코딩하지 않는다", async () => {
    const video = await original(); const logs = [];
    const r = runner({ encode: async (_b, args) => { await writeFile(args.at(-1), "half"); throw new Error("압축 시간 상한 초과"); } });
    expect(await prepareCompressedUpload(video, { log: (m) => logs.push(m), env: {}, runner: r })).toBeNull();
    expect(logs.at(-1)).toContain("원본을 올립니다");
    expect((await readdir(path.dirname(video.filePath))).sort()).toEqual(["classnote-12-34.aywa.json", "classnote-12-34.mp4"]);
    expect(await prepareCompressedUpload(video, { log: (m) => logs.push(m), env: {}, runner: r })).toBeNull();
    expect(r.encode).toHaveBeenCalledTimes(1);
    expect(compressionStatus().failed).toBe(1);
  });
  it("원본 비트레이트가 이미 낮으면(ClassNote 1080p 약 4Mbps) 인코딩하지 않고 원본", async () => {
    const low = { ...SOURCE, streams: [{ ...SOURCE.streams[0], bit_rate: "4140138", avg_frame_rate: "30/1" }, SOURCE.streams[1]] };
    const r = runner({ source: low });
    expect(await prepareCompressedUpload(await original(), { log: quiet, env: {}, runner: r })).toEqual({ marker: "kept-bitrate" });
    expect(r.encode).not.toHaveBeenCalled();
    const high = { ...SOURCE, streams: [{ ...SOURCE.streams[0], bit_rate: "16000000", avg_frame_rate: "30/1" }, SOURCE.streams[1]] };
    expect((await prepareCompressedUpload(await original(), { log: quiet, env: {}, runner: runner({ source: high }) }))?.marker).toBe(COMPRESS_PROFILE.id);
  });
  it("소리만 이어지고 영상이 끊긴 출력(영상 길이 불일치)은 쓰지 않는다", async () => {
    const src = { ...SOURCE, streams: [{ ...SOURCE.streams[0], duration: "14.83" }, SOURCE.streams[1]] };
    const cut = { ...OUTPUT, streams: [{ ...OUTPUT.streams[0], duration: "6.0" }, OUTPUT.streams[1]] };
    const r = runner({ source: src, output: cut });
    expect(await prepareCompressedUpload(await original(), { log: quiet, env: {}, runner: r, threads: 3 })).toBeNull();
    expect(r.encode).toHaveBeenCalledTimes(1);
    expect(r.encode.mock.calls[0][2]).toEqual({ timeoutMs: 10 * 60_000 }); // 짧은 영상도 최소 10분
  });
  it("잘린 출력(길이 불일치)·크기 불일치는 압축본으로 쓰지 않는다", async () => {
    const video = await original();
    const short = { ...OUTPUT, format: { duration: "9.0" } };
    expect(await prepareCompressedUpload(video, { log: quiet, env: {}, runner: runner({ output: short }) })).toBeNull();
    const wrong = { ...OUTPUT, streams: [{ codec_type: "video", width: 1920, height: 1080 }, OUTPUT.streams[1]] };
    expect(await prepareCompressedUpload(video, { log: quiet, env: {}, runner: runner({ output: wrong }) })).toBeNull();
  });
  it("ffmpeg가 없으면 원본(null)이고 안내는 한 번만 남긴다", async () => {
    const video = await original(); const logs = [];
    const r = runner({ missing: true });
    expect(await prepareCompressedUpload(video, { log: (m) => logs.push(m), env: {}, runner: r })).toBeNull();
    expect(await prepareCompressedUpload(video, { log: (m) => logs.push(m), env: {}, runner: r })).toBeNull();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("발송PC-영상압축-설치.bat");
    expect(compressionStatus().ffmpeg).toBe("missing");
  });
  it("HDR 영상은 인코딩하지 않고 원본, 끄기 설정이면 ffmpeg도 찾지 않는다", async () => {
    const video = await original();
    const hdr = { ...SOURCE, streams: [{ ...SOURCE.streams[0], color_transfer: "arib-std-b67" }, SOURCE.streams[1]] };
    const r = runner({ source: hdr });
    expect(await prepareCompressedUpload(video, { log: quiet, env: {}, runner: r })).toEqual({ marker: "kept-hdr" });
    expect(r.encode).not.toHaveBeenCalled();
    const off = runner();
    expect(await prepareCompressedUpload(await original(), { log: quiet, env: { CLASSNOTE_VIDEO_COMPRESS: "off" }, runner: off })).toBeNull();
    expect(off.text).not.toHaveBeenCalled();
  });
  it("다른 설정·다른 원본의 지난 기록은 버리고 새로 만든다 · 완료 뒤 정리는 원본을 건드리지 않고 업로드 재개 기록까지 지운다", async () => {
    const video = await original(1000); const paths = compressionPaths(video.filePath);
    await writeFile(paths.record, JSON.stringify({ version: 1, profile: "old", source: { md5: video.md5, bytes: video.bytes, sha256: video.sha256 }, decision: "kept", marker: "kept-savings" }));
    const r = runner({ outBytes: 400 });
    expect((await prepareCompressedUpload(video, { log: quiet, env: {}, runner: r })).bytes).toBe(400);
    await writeFile(`${paths.output}.stale.part`, "x");
    await writeFile(`${video.filePath}.drive-state.json`, "{}");
    await writeFile(path.join(path.dirname(video.filePath), "classnote-12-345.aywa.mp4"), "다른 영상");
    await removeArchiveLeftovers(video.filePath);
    expect((await readdir(path.dirname(video.filePath))).sort()).toEqual(["classnote-12-34.mp4", "classnote-12-345.aywa.mp4"]);
    expect((await readFile(video.filePath)).length).toBe(1000);
  });
});

describe("ffmpeg 찾기", () => {
  it("링크를 못 만든 계정은 winget 설치 폴더에서 찾는다(설치 직후 워커 PATH엔 아직 없다)", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "aywa-ffmpeg-find-")); dirs.push(dir);
    const exe = process.platform === "win32" ? ".exe" : "";
    const bin = path.join(dir, "Microsoft", "WinGet", "Packages", "Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe", "ffmpeg-8.0.1-full_build", "bin");
    await mkdir(bin, { recursive: true });
    const r = runner(); const real = r.text;
    r.text = vi.fn(async (b, args) => { if (!String(b).startsWith(bin)) throw new Error("ENOENT"); return real(b, args); });
    expect(await findFfmpeg({ env: { LOCALAPPDATA: dir }, runner: r })).toMatchObject({ ffmpeg: path.join(bin, `ffmpeg${exe}`), ffprobe: path.join(bin, `ffprobe${exe}`) });
  });
});

function hasFfmpeg() {
  try {
    execFileSync("ffprobe", ["-version"], { stdio: "pipe" });
    return execFileSync("ffmpeg", ["-hide_banner", "-encoders"], { stdio: "pipe" }).toString().includes("libx264");
  } catch { return false; }
}

describe.skipIf(!hasFfmpeg())("실제 ffmpeg(이 PC에 있을 때만)", () => {
  it("세로 회전 영상을 화면 방향 그대로·짧아지지 않게·faststart로 압축한다", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "aywa-compress-real-")); dirs.push(dir);
    const raw = path.join(dir, "raw.mp4"); const filePath = path.join(dir, "classnote-12-34.mp4");
    const ff = (args) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", ...args], { stdio: "pipe" });
    // 손실 없는(큰) 원본 = 휴대폰 원본처럼 비트레이트가 높은 영상의 대역. 가로 640×360에 90° 회전 표시 → 화면엔 세로 360×640.
    ff(["-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30:duration=1", "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
      "-c:v", "libx264", "-preset", "ultrafast", "-qp", "0", "-c:a", "aac", "-b:a", "128k", "-shortest", raw]);
    ff(["-display_rotation", "90", "-i", raw, "-c", "copy", filePath]);
    const video = { filePath, centerId: "12", videoId: "34", ...await fileDigests(filePath) };
    const profile = { ...COMPRESS_PROFILE, maxLongSide: 320 }; // 축소 경로까지 보려고 상한만 낮춘다
    // 실제 워커는 낮은 우선순위로 돌린다(발송 방해 금지) — CPU가 꽉 찬 개발 PC에선 수십 배 느려져 시험만 보통 우선순위로.
    const normal = { text: defaultRunner.text, encode: async (bin, args) => { execFileSync(bin, args, { stdio: "pipe" }); } };
    const result = await prepareCompressedUpload(video, { log: quiet, env: {}, profile, threads: 2, runner: normal });
    expect(result).toMatchObject({ marker: COMPRESS_PROFILE.id });
    expect(result.bytes).toBeLessThan(video.bytes * 0.85);
    const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", result.filePath]).toString());
    const v = probe.streams.find((s) => s.codec_type === "video");
    expect(v).toMatchObject({ codec_name: "h264", profile: "High", pix_fmt: "yuv420p", width: 180, height: 320 });
    expect(readProbe(probe).rotation).toBe(0); // 픽셀을 돌렸으므로 회전 표시가 없어야 화면 방향이 같다
    expect(Math.abs(Number(probe.format.duration) - 1)).toBeLessThan(0.1);
    expect(probe.streams.some((s) => s.codec_type === "audio")).toBe(true);
    const head = (await readFile(result.filePath)).toString("latin1");
    expect(head.indexOf("moov")).toBeLessThan(head.indexOf("mdat")); // faststart
  }, 60_000);
});
