import { videoDriveAuth } from "./video-drive-auth.mjs";
import { checkDriveFolder } from "./video-drive.mjs";

try {
  await checkDriveFolder(process.env.CLASSNOTE_VIDEO_DRIVE_FOLDER_ID, await videoDriveAuth());
  console.log("Drive 로그인과 영상 폴더 쓰기 권한을 확인했습니다.");
} catch { console.error("Drive 최초 로그인 또는 폴더 접근 확인이 필요합니다."); process.exitCode = 1; }
