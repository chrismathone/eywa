import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
/** Google이 문서화한 gcloud Drive 로그인 사용. 인증 저장소를 직접 읽거나 토큰을 로그에 남기지 않는다. */
export function gcloudVideoAuth(env = process.env) {
  const account = env.GOOGLE_DRIVE_GCLOUD_ACCOUNT;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account ?? "")) throw new Error("Drive 로그인 계정을 설정하세요.");
  const executable = env.GOOGLE_DRIVE_GCLOUD_PATH || "gcloud";
  let token;
  let expires = 0;
  return { kind: "oauth", async accessToken() {
    if (token && Date.now() < expires) return token;
    const args = ["auth", "print-access-token", `--account=${account}`, "--quiet"];
    try {
      const result = /\.ps1$/i.test(executable)
        ? await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", executable, ...args], { windowsHide: true, timeout: 60_000 })
        : await run(executable, args, { windowsHide: true, timeout: 60_000 });
      token = result.stdout.trim();
      if (!token || /\s/.test(token)) throw new Error("token");
      expires = Date.now() + 60_000;
      return token;
    } catch { throw new Error("Drive 로그인 갱신 실패 — 연동 PC에서 영상 Drive 연결을 다시 실행하세요."); }
  } };
}
