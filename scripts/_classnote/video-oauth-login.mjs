// scripts/_classnote/video-oauth-login.mjs — Drive OAuth 최초 허락(브라우저 로그인 1회) → 값 파일(`aywa-video-oauth.txt`) 만들기.
//
// 어느 PC에서든 돌릴 수 있다(발송 PC일 필요 없다). 만들어진 값 파일을 발송 PC로 옮겨 `발송PC-영상연결-OAuth.bat`을 누르면 끝.
// 사용(저장소 루트에서):
//   node scripts/_classnote/video-oauth-login.mjs --client=<client_secret_….json> --account=<구글 계정> --folder=<Drive 폴더 ID> [--out=<값 파일 경로>]
//
// 하는 일: 내 PC의 127.0.0.1에 잠깐 서버를 열고 → 브라우저로 구글 동의 화면 → 돌아온 코드를 토큰으로 바꾸고
//   ① 허락한 계정이 --account와 같은지 ② 그 계정이 폴더에 파일을 넣을 수 있는지 확인한 뒤에만 값 파일을 쓴다.
// 🔴 비밀·토큰은 화면·로그에 찍지 않는다(값 파일에만 쓴다). 확인에 실패하면 값 파일을 만들지 않는다.
// 🔴 허락을 자동으로 취소(revoke)하지 않는다 — 취소는 그 계정·클라이언트의 허락 전체를 없애 발송 PC가 쓰던 토큰까지 죽인다.
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { checkDriveFolder } from "./video-drive.mjs";
import { DRIVE_API } from "./video-drive-http.mjs";
import { buildAuthUrl, exchangeCode, newLoginAttempt, readClientJson } from "./video-oauth-flow.mjs";
import { formatOauthValues, isDriveFolderId, OAUTH_VALUES_FILE } from "./video-oauth-values.mjs";

const WAIT_MS = 10 * 60_000;
const option = (key) => process.argv.find((arg) => arg.startsWith(`--${key}=`))?.slice(key.length + 3);
const page = (title, body) => `<!doctype html><html lang="ko"><meta charset="utf-8"><title>aywa 영상 보관</title>
<body style="font-family:sans-serif;padding:48px;line-height:1.6"><h2>${title}</h2><p>${body}</p></body></html>`;

function openBrowser(url) {
  if (process.platform === "win32") execFile("rundll32", ["url.dll,FileProtocolHandler", url], { windowsHide: true }, () => {});
  else execFile(process.platform === "darwin" ? "open" : "xdg-open", [url], () => {});
}

/** 127.0.0.1 임시 서버로 돌아온 코드를 한 번 받는다. */
function waitForCode(server, state) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("10분 안에 로그인이 끝나지 않았습니다 — 다시 실행해 주세요.")), WAIT_MS);
    server.on("request", (req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== "/") { res.writeHead(404).end(); return; }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      const done = (error, code) => { clearTimeout(timer); if (error) reject(error); else resolve(code); };
      if (url.searchParams.get("state") !== state) {
        res.end(page("확인 실패", "이 창은 닫고, 터미널에 나온 주소로 다시 시작해 주세요."));
        return; // 남의 요청일 수 있다 — 기다리던 로그인은 그대로 둔다.
      }
      if (url.searchParams.get("error")) {
        res.end(page("허락하지 않았습니다", "이 창은 닫아도 됩니다."));
        done(new Error("동의 화면에서 허락하지 않았습니다."));
        return;
      }
      const code = url.searchParams.get("code");
      if (!code) { res.end(page("확인 실패", "코드를 받지 못했습니다.")); done(new Error("코드를 받지 못했습니다.")); return; }
      res.end(page("허락을 받았습니다", "이 창은 닫아도 됩니다. 터미널에서 확인이 끝나면 값 파일이 만들어집니다."));
      done(null, code);
    });
  });
}

const server = http.createServer();
try {
  const clientPath = option("client");
  const account = option("account");
  const folderId = option("folder");
  const out = option("out") || path.join(os.homedir(), "Downloads", OAUTH_VALUES_FILE);
  if (!clientPath || !account || !folderId) throw new Error("--client=<JSON 경로> --account=<구글 계정> --folder=<Drive 폴더 ID> 가 필요합니다.");
  // 모양 검사는 브라우저를 열기 전에 — 동의까지 받고 나서 오타로 실패하면 허락만 남는다.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account)) throw new Error("--account 는 구글 계정(이메일) 모양이어야 합니다.");
  if (!isDriveFolderId(folderId)) throw new Error("--folder 는 Drive 폴더 ID여야 합니다(주소 전체가 아니라 folders/ 뒤의 글자).");
  const { clientId, clientSecret } = readClientJson(await readFile(clientPath, "utf8").catch(() => { throw new Error("클라이언트 JSON 파일을 찾지 못했습니다."); }));

  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const redirectUri = `http://127.0.0.1:${server.address().port}`;
  const attempt = newLoginAttempt();
  const authUrl = buildAuthUrl({ clientId, redirectUri, state: attempt.state, challenge: attempt.challenge, account });
  console.log(`브라우저에서 ${account} 계정으로 로그인하고 '허용'을 눌러 주세요.`);
  console.log("'Google에서 확인하지 않은 앱' 화면이 나오면 [고급] → [… (으)로 이동]을 누르면 됩니다.");
  console.log("⚠️ 구글 클라우드 콘솔의 '대상' 게시 상태가 '프로덕션'이어야 합니다 — '테스트'면 7일 뒤 연결이 끊깁니다.");
  console.log(`브라우저가 안 열리면 이 주소를 직접 여세요:\n${authUrl}\n`);
  openBrowser(authUrl);

  const code = await waitForCode(server, attempt.state);
  const tokens = await exchangeCode({ clientId, clientSecret, code, verifier: attempt.verifier, redirectUri });
  const auth = { kind: "oauth", accessToken: async () => tokens.accessToken };
  const about = await fetch(`${DRIVE_API}/about?fields=user(emailAddress)`, { headers: { Authorization: `Bearer ${tokens.accessToken}` }, signal: AbortSignal.timeout(30_000) })
    .catch(() => { throw new Error("로그인한 계정을 확인하지 못했습니다(Drive 연결 실패)."); });
  const email = about.ok ? (await about.json().catch(() => null))?.user?.emailAddress : null;
  if (!email) throw new Error("로그인한 계정을 확인하지 못했습니다.");
  if (email.toLowerCase() !== account.toLowerCase()) {
    // 🔴 여기서 허락을 자동으로 취소하지 않는다 — 취소는 그 계정이 이 클라이언트에 준 허락 **전체**를 없앤다. 같은 계정의 다른 표기
    //    (지메일 점 표기·별칭)를 "다른 계정"으로 오판하면 발송 PC가 쓰고 있는 토큰까지 죽는다. 값 파일만 만들지 않고 안내한다.
    throw new Error(`다른 계정으로 로그인했습니다 — ${account} 계정으로 다시 해 주세요. (방금 허락이 필요 없으면 https://myaccount.google.com/permissions 에서 지우면 됩니다.)`);
  }
  try { await checkDriveFolder(folderId, auth); }
  catch { throw new Error(`${account} 계정이 그 폴더에 파일을 넣을 수 없습니다 — 폴더 ID와 편집 권한을 확인하고 다시 실행해 주세요.`); }
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, formatOauthValues({
    GOOGLE_DRIVE_CLIENT_ID: clientId, GOOGLE_DRIVE_CLIENT_SECRET: clientSecret,
    GOOGLE_DRIVE_REFRESH_TOKEN: tokens.refreshToken, CLASSNOTE_VIDEO_DRIVE_FOLDER_ID: folderId,
  }), { mode: 0o600 });
  console.log(`확인 완료 — ${account} 계정이 영상 폴더에 파일을 넣을 수 있습니다.`);
  console.log(`값 파일: ${out}`);
  console.log("이 파일을 발송 PC의 다운로드 폴더에 옮기고 '발송PC-영상연결-OAuth.bat'을 실행하세요. 적용이 끝나면 이 PC의 파일도 지우세요.");
  console.log("🔴 값 파일을 워커 폴더(scripts\\_classnote)나 zip 안에 넣지 마세요 — 비밀이 zip에 실려 남습니다.");
} catch (error) {
  console.error(`영상 연결(OAuth) 실패 — ${error?.message ?? "알 수 없는 오류"}`);
  process.exitCode = 1;
} finally {
  server.close();
  server.closeAllConnections?.();
}
