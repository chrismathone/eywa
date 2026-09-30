// scripts/_classnote/video-save-oauth-settings.mjs — 발송 PC에서 Drive OAuth 값 파일을 `.env.local`에 적용한다.
//
// 사용(저장소 루트, 보통 `발송PC-영상연결-OAuth.bat`이 부른다):
//   node --env-file=.env.local scripts/_classnote/video-save-oauth-settings.mjs --values=<aywa-video-oauth.txt 경로> [--allow-folder-change]
//
// 순서: 값 파일 읽기 → 그 값으로 실제 토큰을 받아 영상 폴더에 파일을 넣을 수 있는지 확인 → `.env.local` 백업 →
//   네 값을 넣고 gcloud 키는 지움 → 값 파일 삭제. 🔴 폴더 확인에 실패하면 `.env.local`을 건드리지 않는다.
// 🔴 저장 폴더가 지금 쓰는 것과 다르면 거절한다 — 워커는 영상마다 "처음 정한 폴더"를 기억해서, 폴더가 바뀌면 대기·실패 중인
//   영상이 전부 "최초 저장 폴더와 현재 설정이 다릅니다"로 멈춘다(video-worker). 정말 바꿀 때만 `--allow-folder-change`.
import { copyFile, readFile, unlink, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { checkDriveFolder } from "./video-drive.mjs";
import { oauthRefreshAuth } from "./video-oauth-refresh.mjs";
import { mergeOauthEnv, parseOauthValues } from "./video-oauth-values.mjs";

const valuesPath = process.argv.find((arg) => arg.startsWith("--values="))?.slice("--values=".length);
try {
  if (!valuesPath) throw new Error("--values=<값 파일 경로> 가 필요합니다.");
  const values = parseOauthValues(await readFile(valuesPath, "utf8").catch(() => { throw new Error("값 파일을 찾지 못했습니다."); }));
  const current = process.env.CLASSNOTE_VIDEO_DRIVE_FOLDER_ID;
  if (current && current !== values.CLASSNOTE_VIDEO_DRIVE_FOLDER_ID && !process.argv.includes("--allow-folder-change"))
    throw new Error("값 파일의 저장 폴더가 지금 쓰는 폴더와 다릅니다 — 폴더를 바꾸면 대기 중인 영상이 실패합니다. 같은 폴더로 값 파일을 다시 만들어 주세요.");
  try {
    await checkDriveFolder(values.CLASSNOTE_VIDEO_DRIVE_FOLDER_ID, oauthRefreshAuth({
      clientId: values.GOOGLE_DRIVE_CLIENT_ID, clientSecret: values.GOOGLE_DRIVE_CLIENT_SECRET, refreshToken: values.GOOGLE_DRIVE_REFRESH_TOKEN,
    }));
  } catch (error) {
    // 우리 문장(한글)은 그대로, 그 밖의 원문(HTTP·네트워크)은 한글 요약으로.
    throw new Error(/[가-힣]/.test(error?.message ?? "") ? error.message : "Drive에 연결해 영상 폴더를 확인하지 못했습니다.");
  }
  const file = ".env.local";
  const body = mergeOauthEnv(await readFile(file, "utf8"), values);
  await copyFile(file, `${file}.video-backup-${Date.now()}`, constants.COPYFILE_EXCL);
  await writeFile(file, body, { mode: 0o600 });
  console.log("영상 폴더 접근 확인 및 설정 저장 완료(OAuth)");
  try { await unlink(valuesPath); console.log("값 파일은 지웠습니다."); }
  catch { console.log(`값 파일을 지우지 못했습니다 — 직접 지워 주세요: ${valuesPath}`); }
} catch (error) {
  console.error(`설정 저장 실패 — ${/[가-힣]/.test(error?.message ?? "") ? error.message : "값 파일과 `.env.local`을 확인하세요."}`);
  if (valuesPath) console.error(`값이 틀렸다면 이 값 파일은 지우고 새로 만들어 주세요: ${valuesPath}`);
  process.exitCode = 1;
}
