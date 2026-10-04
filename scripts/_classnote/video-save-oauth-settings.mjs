// scripts/_classnote/video-save-oauth-settings.mjs — 발송 PC에서 Drive OAuth 값 파일을 `.env.local`에 적용한다.
//
// 사용(저장소 루트, 보통 `발송PC-영상연결-OAuth.bat`이 부른다):
//   node --env-file=.env.local scripts/_classnote/video-save-oauth-settings.mjs --values=<aywa-video-oauth.txt 경로>
//
// 순서: 값 파일에서 인증 세 키만 읽기 → 그 토큰으로 Drive 인증이 되는지 확인 → `.env.local` 백업 →
//   인증 세 값만 넣고 gcloud 키는 지움 → 값 파일 삭제. 인증 확인에 실패하면 `.env.local`을 건드리지 않는다.
// 저장 폴더 줄은 지우지도 덮어쓰지도 않는다. 폴더는 지점 설정이고, 표가 없는 동안의 env 폴더도 그대로 둔다.
import { copyFile, readFile, unlink, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { oauthRefreshAuth } from "./video-oauth-refresh.mjs";
import { mergeOauthEnv, parseOauthValues } from "./video-oauth-values.mjs";

const valuesPath = process.argv.find((arg) => arg.startsWith("--values="))?.slice("--values=".length);
try {
  if (!valuesPath) throw new Error("--values=<값 파일 경로> 가 필요합니다.");
  const values = parseOauthValues(await readFile(valuesPath, "utf8").catch(() => { throw new Error("값 파일을 찾지 못했습니다."); }));
  try {
    await oauthRefreshAuth({
      clientId: values.GOOGLE_DRIVE_CLIENT_ID, clientSecret: values.GOOGLE_DRIVE_CLIENT_SECRET, refreshToken: values.GOOGLE_DRIVE_REFRESH_TOKEN,
    }).accessToken();
  } catch (error) {
    throw new Error(/[가-힣]/.test(error?.message ?? "") ? error.message : "Drive에 연결하지 못했습니다.");
  }
  const file = ".env.local";
  const body = mergeOauthEnv(await readFile(file, "utf8"), values);
  await copyFile(file, `${file}.video-backup-${Date.now()}`, constants.COPYFILE_EXCL);
  await writeFile(file, body, { mode: 0o600 });
  console.log("영상 Drive 인증 저장 완료. 저장 폴더 설정은 그대로 두었습니다.");
  try { await unlink(valuesPath); console.log("값 파일은 지웠습니다."); }
  catch { console.log(`값 파일을 지우지 못했습니다 — 직접 지워 주세요: ${valuesPath}`); }
} catch (error) {
  console.error(`설정 저장 실패 — ${/[가-힣]/.test(error?.message ?? "") ? error.message : "값 파일과 `.env.local`을 확인하세요."}`);
  if (valuesPath) console.error(`값이 틀렸다면 이 값 파일은 지우고 새로 만들어 주세요: ${valuesPath}`);
  process.exitCode = 1;
}
