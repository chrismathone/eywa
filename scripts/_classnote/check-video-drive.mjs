import { videoDriveAuth } from "./video-drive-auth.mjs";
import { checkDriveFolder } from "./video-drive.mjs";
import postgres from "postgres";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveTenant } from "./classnote-core.mjs";
import { loadWorkerVideoDriveSetting } from "./video-drive-settings.mjs";

/** 인증을 다시 적용해도 저장 위치는 현재 지점 설정을 따른다. */
export async function checkConfiguredVideoDrive(sql, tenant, { auth } = {}) {
  const setting = await loadWorkerVideoDriveSetting(sql, tenant);
  if (setting.error) throw new Error("영상 저장 폴더 설정을 확인하지 못했습니다.");
  const credentials = auth ?? await videoDriveAuth();
  if (setting.enabled && setting.rootId) {
    await checkDriveFolder(setting.rootId, credentials);
    return "folder";
  }
  await credentials.accessToken();
  return "auth";
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1, connect_timeout: 15 });
  try {
    const kind = await checkConfiguredVideoDrive(sql, await resolveTenant(sql));
    console.log(kind === "folder" ? "Drive 로그인과 지점 영상 폴더 쓰기 권한을 확인했습니다." :
      "Drive 로그인을 확인했습니다. 영상 저장 폴더는 학원설정의 연동 화면에서 지정해 주세요.");
  } catch { console.error("Drive 로그인 또는 지점 폴더 접근 확인이 필요합니다."); process.exitCode = 1; }
  finally { await sql.end(); }
}
