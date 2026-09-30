import { readFile, copyFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { videoDriveAuth } from "./video-drive-auth.mjs";
import { checkDriveFolder } from "./video-drive.mjs";

try {
  const folderId = process.env.CLASSNOTE_VIDEO_DRIVE_FOLDER_ID;
  await checkDriveFolder(folderId, await videoDriveAuth());
  const file = ".env.local";
  let body = await readFile(file, "utf8");
  for (const key of ["GOOGLE_DRIVE_GCLOUD_ACCOUNT", "GOOGLE_DRIVE_GCLOUD_PATH", "CLASSNOTE_VIDEO_DRIVE_FOLDER_ID"]) {
    const value = process.env[key];
    if (!value || /[\r\n"']/.test(value)) throw new Error("설정 값이 올바르지 않습니다.");
    body = body.replace(new RegExp(`^${key}=.*(?:\\r?\\n|$)`, "gm"), "");
    body = `${body.trimEnd()}\n${key}='${value}'\n`;
  }
  await copyFile(file, `${file}.video-backup-${Date.now()}`, constants.COPYFILE_EXCL);
  await writeFile(file, body, { mode: 0o600 });
  console.log("영상 폴더 접근 확인 및 설정 저장 완료");
} catch { console.error("설정 저장 실패 — Google 로그인·폴더 쓰기 권한을 확인하세요."); process.exitCode = 1; }
