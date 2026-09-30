import { mkdir, open, readFile, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import postgres from "postgres";
import { resolveTenant } from "./classnote-core.mjs";
import { findRecentVideo } from "./video-source.mjs";
import { downloadVideo, loadDownloadedVideo } from "./video-download.mjs";
import { videoDriveAuth } from "./video-drive-auth.mjs";
import { checkDriveFolder, uploadVideoToDrive } from "./video-drive.mjs";
import { resolveVideoTeacher } from "./video-teacher-route.mjs";
import { ensureTeacherFolder } from "./video-drive-folders.mjs";
import { writeVideoState } from "./video-state.mjs";
import { videoFilename } from "./video-filename.mjs";
import { videoFolderRegistry, videoFileRegistry } from "./video-folder-registry.mjs";

const option = (key) => process.argv.find((arg) => arg.startsWith(`--${key}=`))?.slice(key.length + 3);
const localFile = option("file") ? path.resolve(option("file")) : null;
const outputDir = localFile ? path.dirname(localFile) : path.resolve(option("out") || process.env.CLASSNOTE_VIDEO_OUT || path.join(os.homedir(), "Downloads", "aywa-classnote-videos"));
const upload = process.argv.includes("--upload");
const folderId = option("folder") || process.env.CLASSNOTE_VIDEO_DRIVE_FOLDER_ID;

async function main() {
  if (upload && process.argv.includes("--plan")) throw new Error("--plan은 분류 확인 전용입니다. --upload와 함께 사용할 수 없습니다.");
  await mkdir(outputDir, { recursive: true });
  const lockPath = path.join(outputDir, ".download.lock");
  let lock;
  let registryDb;
  try { lock = await open(lockPath, "wx"); }
  catch (error) { if (error.code === "EEXIST") throw new Error("같은 저장 폴더에서 작업 중입니다. 이전 프로세스 종료 여부를 확인하세요."); throw error; }
  try {
    await lock.writeFile(String(process.pid));
    let driveOptions;
    if (upload) {
      if (!folderId) throw new Error("--upload에는 --folder=<Drive 폴더 ID> 또는 CLASSNOTE_VIDEO_DRIVE_FOLDER_ID 설정이 필요합니다.");
      driveOptions = await videoDriveAuth();
      await checkDriveFolder(folderId, driveOptions);
    }
    let scanned = 0;
    let video;
    if (localFile) video = await loadDownloadedVideo(localFile);
    else {
      console.log("클래스노트에서 최근 영상 1건을 찾습니다.");
      const found = await findRecentVideo({ anyAuthor: process.argv.includes("--any-author") });
      scanned = found.scanned;
      video = await downloadVideo(found.candidate, outputDir);
    }
    const result = { scanned, download: video.status, filePath: video.filePath, bytes: video.bytes, sha256: video.sha256 };
    if (process.argv.includes("--plan")) result.teacher = await resolveVideoTeacher(video);
    if (upload) {
      // 재시도 중 담임이 변경돼도 최초 저장 위치를 유지한다. 기존 영상을 다른 담임 폴더로 복제하지 않는다.
      const routePath = `${video.filePath}.route.json`;
      let saved;
      try { saved = JSON.parse(await readFile(routePath, "utf8")); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
      if (saved && (saved.rootId !== folderId || saved.sha256 !== video.sha256)) throw new Error("이 영상의 최초 저장 폴더·파일과 다릅니다.");
      if (!saved) {
        saved = { rootId: folderId, sha256: video.sha256, route: result.teacher ?? await resolveVideoTeacher(video) };
        await writeVideoState(routePath, saved, { createOnly: true });
      }
      result.teacher = saved.route;
      const displayName = videoFilename(video, saved.route);
      registryDb = postgres(process.env.DATABASE_URL, { prepare: false, max: 1, connect_timeout: 15 });
      const tenant = await resolveTenant(registryDb);
      if (tenant !== saved.route.tenantId) throw new Error("저장된 영상 분류의 지점이 현재 설정과 다릅니다.");
      driveOptions = { ...driveOptions, folderRegistry: videoFolderRegistry(registryDb, tenant, folderId), fileRegistry: videoFileRegistry(registryDb, tenant) };
      result.folder = await ensureTeacherFolder(folderId, saved.route, video.centerId, outputDir, driveOptions);
      result.drive = await uploadVideoToDrive({ ...video, name: displayName }, result.folder.id, driveOptions);
    }
    await writeVideoState(path.join(outputDir, "last-result.json"), result);
    console.log(JSON.stringify(result, null, 2));
  } finally { await registryDb?.end(); await lock.close(); await unlink(lockPath); }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
