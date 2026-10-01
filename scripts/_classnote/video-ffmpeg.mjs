// scripts/_classnote/video-ffmpeg.mjs — 발송 PC의 ffmpeg 찾기·실행(영상 압축 전용, 원장 2026-10-01).
//
// ffmpeg는 워커 zip에 넣지 않는다(바이너리 100MB+, GPL 빌드 재배포 부담). 발송 PC에 winget으로 한 번 설치하고
// (`발송PC-영상압축-설치.bat`), 워커는 아래 순서로 찾는다. 못 찾으면 압축 없이 원본을 올린다(보관이 먼저).
//   ① CLASSNOTE_FFMPEG_PATH(ffprobe는 CLASSNOTE_FFPROBE_PATH 또는 같은 폴더) ② PATH의 ffmpeg
//   ③ winget 링크 폴더(사용자·전체) ④ winget 설치 폴더(링크를 못 만드는 계정은 PATH에만 등록한다) — 설치 직후엔
//      돌고 있는 워커의 PATH에 아직 없어서 직접 본다.
import { execFile, spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const FOUND_TTL = 60 * 60_000;
const MISSING_TTL = 10 * 60_000;
let cache = { at: 0, value: undefined };

function candidates(env) {
  const exe = process.platform === "win32" ? ".exe" : "";
  const sibling = (bin) => path.join(path.dirname(bin), path.basename(bin).replace(/ffmpeg/i, "ffprobe"));
  const list = [];
  if (env.CLASSNOTE_FFMPEG_PATH) list.push({ ffmpeg: env.CLASSNOTE_FFMPEG_PATH, ffprobe: env.CLASSNOTE_FFPROBE_PATH || sibling(env.CLASSNOTE_FFMPEG_PATH) });
  list.push({ ffmpeg: "ffmpeg", ffprobe: "ffprobe" });
  for (const base of [env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "Microsoft", "WinGet", "Links"), env.ProgramFiles && path.join(env.ProgramFiles, "WinGet", "Links")]) {
    if (base) list.push({ ffmpeg: path.join(base, `ffmpeg${exe}`), ffprobe: path.join(base, `ffprobe${exe}`) });
  }
  const packages = env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "Microsoft", "WinGet", "Packages");
  const dirs = (dir, re) => { try { return readdirSync(dir).filter((n) => re.test(n)).map((n) => path.join(dir, n)); } catch { return []; } };
  for (const pkg of packages ? dirs(packages, /^Gyan\.FFmpeg/i) : []) {
    for (const build of dirs(pkg, /^ffmpeg-/i)) list.push({ ffmpeg: path.join(build, "bin", `ffmpeg${exe}`), ffprobe: path.join(build, "bin", `ffprobe${exe}`) });
  }
  return list;
}

/** `ffmpeg version 8.0.1-…` → 5.1 미만이면 `-fps_mode`가 없어 옛 `-vsync`를 쓴다. 숫자가 아닌 개발 빌드는 최신으로 본다. */
export function parseFfmpegVersion(text) {
  const m = /ffmpeg version n?(\d+)\.(\d+)/i.exec(String(text));
  if (!m) return { label: "개발 빌드", legacyVsync: false };
  const [major, minor] = [Number(m[1]), Number(m[2])];
  return { label: `${major}.${minor}`, legacyVsync: major < 5 || (major === 5 && minor < 1) };
}

export const defaultRunner = {
  async text(bin, args, timeoutMs = 30_000) {
    const { stdout } = await run(bin, args, { windowsHide: true, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 });
    return stdout;
  },
  /** 인코딩: 발송(Playwright)이 본업이라 낮은 우선순위로 돌리고, 시간 상한을 넘기면 끊는다. */
  encode(bin, args, { timeoutMs }) {
    return new Promise((resolve, reject) => {
      const child = spawn(bin, args, { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
      try { os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* 우선순위는 best-effort */ }
      let tail = "";
      let timedOut = false;
      child.stderr.on("data", (chunk) => { tail = (tail + chunk).slice(-400); });
      const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
      child.on("error", (error) => { clearTimeout(timer); reject(error); });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (timedOut) reject(new Error("압축 시간 상한 초과"));
        else if (code === 0) resolve();
        else reject(Object.assign(new Error(`ffmpeg 종료 코드 ${code}`), { tail }));
      });
    });
  },
};

/** 쓸 수 있는 ffmpeg(+libx264)·ffprobe 한 쌍. 없으면 null. 찾은 결과는 1시간, 없음은 10분 기억한다(설치하면 재시작 없이 잡힌다). */
export async function findFfmpeg({ env = process.env, runner = defaultRunner, now = Date.now } = {}) {
  const ttl = cache.value ? FOUND_TTL : MISSING_TTL;
  if (cache.value !== undefined && now() - cache.at < ttl) return cache.value;
  let value = null;
  for (const pair of candidates(env)) {
    try {
      const version = parseFfmpegVersion(await runner.text(pair.ffmpeg, ["-hide_banner", "-version"]));
      if (!/\blibx264\b/.test(await runner.text(pair.ffmpeg, ["-hide_banner", "-encoders"]))) continue;
      await runner.text(pair.ffprobe, ["-hide_banner", "-version"]);
      value = { ...pair, ...version };
      break;
    } catch { /* 다음 후보 */ }
  }
  cache = { at: now(), value };
  return value;
}

/** 시험용 — 찾기 결과 기억을 비운다. */
export function resetFfmpegCache() { cache = { at: 0, value: undefined }; }

/** ffprobe JSON → 압축 판단에 쓰는 값. 회전(세로 영상)을 반영한 **화면에 보이는** 가로·세로를 돌려준다. */
export function readProbe(json) {
  const streams = Array.isArray(json?.streams) ? json.streams : [];
  const video = streams.find((s) => s.codec_type === "video" && !s.disposition?.attached_pic);
  if (!video || !(video.width > 0) || !(video.height > 0)) return null;
  const audio = streams.find((s) => s.codec_type === "audio");
  const sideRotation = (video.side_data_list ?? []).find((d) => d.rotation !== undefined)?.rotation;
  const rotation = Number(sideRotation ?? video.tags?.rotate ?? 0) || 0;
  const quarter = Math.abs(Math.round(rotation / 90)) % 2 === 1;
  const dolby = (video.side_data_list ?? []).some((d) => /dovi|dolby/i.test(String(d.side_data_type ?? "")));
  const rate = (value) => { const [n, d] = String(value ?? "").split("/").map(Number); return n > 0 && d > 0 ? n / d : null; };
  return {
    width: quarter ? video.height : video.width,
    height: quarter ? video.width : video.height,
    rotation,
    duration: Number(json.format?.duration ?? video.duration) || 0,
    videoDuration: Number(video.duration) || null, // 소리만 이어지고 영상이 끊긴 출력을 가려낸다
    fps: rate(video.avg_frame_rate) ?? rate(video.r_frame_rate),
    videoBitRate: Number(video.bit_rate) || null,
    videoCodec: String(video.codec_name ?? ""),
    // HDR(PQ·HLG·돌비 비전)을 8비트 H.264로 옮기면 색이 바랜다 — 원본을 올린다.
    hdr: dolby || ["smpte2084", "arib-std-b67"].includes(video.color_transfer),
    audio: audio ? { codec: String(audio.codec_name ?? ""), bitRate: Number(audio.bit_rate) || null } : null,
  };
}

export async function probeVideo(tools, filePath, runner = defaultRunner) {
  const text = await runner.text(tools.ffprobe, ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", filePath], 60_000);
  return readProbe(JSON.parse(text));
}
