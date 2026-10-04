import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { videoDriveAuth } from "./video-drive-auth.mjs";
import { buildAuthUrl, exchangeCode, newLoginAttempt, readClientJson } from "./video-oauth-flow.mjs";
import { DRIVE_SCOPE, oauthRefreshAuth } from "./video-oauth-refresh.mjs";
import { formatOauthValues, isDriveFolderId, mergeOauthEnv, parseOauthValues } from "./video-oauth-values.mjs";

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const creds = { clientId: "cid.apps.googleusercontent.com", clientSecret: "SECRET-abc", refreshToken: "1//REFRESH-xyz" };
const values = {
  GOOGLE_DRIVE_CLIENT_ID: creds.clientId, GOOGLE_DRIVE_CLIENT_SECRET: creds.clientSecret,
  GOOGLE_DRIVE_REFRESH_TOKEN: creds.refreshToken,
};

describe("Drive OAuth 갱신 토큰 인증", () => {
  it("만료 전에는 다시 받지 않고, 만료 2분 전부터 새로 받는다", async () => {
    let t = 1_000_000;
    const fetchImpl = vi.fn().mockImplementation(async () => json({ access_token: `tok${fetchImpl.mock.calls.length}`, expires_in: 3600 }));
    const auth = oauthRefreshAuth({ ...creds, fetchImpl, now: () => t });
    expect(auth.kind).toBe("oauth");
    expect(await auth.accessToken()).toBe("tok1");
    t += 3_400_000; // 56분 40초 — 아직 유효
    expect(await auth.accessToken()).toBe("tok1");
    t += 100_000; // 58분 20초 — 만료 2분 전을 넘김
    expect(await auth.accessToken()).toBe("tok2");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://oauth2.googleapis.com/token");
    expect(Object.fromEntries(new URLSearchParams(init.body))).toEqual({
      client_id: creds.clientId, client_secret: creds.clientSecret, refresh_token: creds.refreshToken, grant_type: "refresh_token",
    });
  });

  it("동시에 여러 번 불러도 갱신 요청은 한 번이다", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ access_token: "tok", expires_in: 3600 }));
    const auth = oauthRefreshAuth({ ...creds, fetchImpl });
    expect(await Promise.all([auth.accessToken(), auth.accessToken(), auth.accessToken()])).toEqual(["tok", "tok", "tok"]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("허락이 취소됐으면 한글 사유를 말하고, 실패한 뒤에도 다음 호출이 다시 시도한다", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(json({ error: "invalid_grant", error_description: "Token has been expired or revoked." }, 400))
      .mockResolvedValueOnce(json({ access_token: "tok", expires_in: 3600 }));
    const auth = oauthRefreshAuth({ ...creds, fetchImpl });
    await expect(auth.accessToken()).rejects.toThrow("영상 연결(OAuth)을 다시");
    expect(await auth.accessToken()).toBe("tok");
  });

  it("오류 문장에 비밀·토큰·서버 원문을 싣지 않는다", async () => {
    for (const fetchImpl of [
      vi.fn().mockResolvedValue(json({ error: "invalid_client", error_description: `bad ${creds.clientSecret}` }, 401)),
      vi.fn().mockResolvedValue(json({ error: "server_error", error_description: creds.refreshToken }, 500)),
      vi.fn().mockRejectedValue(new Error(`connect failed ${creds.refreshToken}`)),
      vi.fn().mockResolvedValue(json({ expires_in: 3600 })),
    ]) {
      const message = await oauthRefreshAuth({ ...creds, fetchImpl }).accessToken().then(() => "", (e) => e.message);
      expect(message).not.toBe("");
      expect(message).not.toContain(creds.clientSecret);
      expect(message).not.toContain(creds.refreshToken);
      expect(message).not.toContain("error_description");
    }
  });

  it("값이 빠지면 만들 때 거절한다", () => {
    expect(() => oauthRefreshAuth({ ...creds, clientSecret: "" })).toThrow("client ID/secret");
    expect(() => oauthRefreshAuth({ ...creds, refreshToken: "" })).toThrow("갱신 토큰");
  });

  it("videoDriveAuth — gcloud 계정이 없고 갱신 토큰이 있으면 OAuth(googleapis 없이)", async () => {
    const auth = await videoDriveAuth({ GOOGLE_DRIVE_CLIENT_ID: creds.clientId, GOOGLE_DRIVE_CLIENT_SECRET: creds.clientSecret, GOOGLE_DRIVE_REFRESH_TOKEN: creds.refreshToken });
    expect(auth.kind).toBe("oauth");
    await expect(videoDriveAuth({ GOOGLE_DRIVE_REFRESH_TOKEN: creds.refreshToken })).rejects.toThrow("client ID/secret");
  });
});

describe("Drive OAuth 값 파일", () => {
  it("만든 값 파일을 그대로 되읽는다", () => {
    expect(parseOauthValues(formatOauthValues(values))).toEqual(values);
    expect(parseOauthValues(`\uFEFF${formatOauthValues(values).replace(/\n/g, "\r\n")}`)).toEqual(values);
  });

  it("키가 빠졌거나 모르는 키가 있거나 값 모양이 이상하면 거절하고, 값은 말하지 않는다", () => {
    const lines = formatOauthValues(values).trimEnd().split("\n");
    expect(() => parseOauthValues(lines.slice(0, -1).join("\n"))).toThrow("GOOGLE_DRIVE_REFRESH_TOKEN");
    expect(() => parseOauthValues(`${lines.join("\n")}\nDATABASE_URL=postgres://x`)).toThrow("영상 연결용 값 파일이 아닙니다");
    expect(() => parseOauthValues("그냥 글")).toThrow("줄 모양");
    const bad = (() => { try { parseOauthValues(lines.join("\n").replace(creds.clientSecret, "SEC RET")); return ""; } catch (e) { return e.message; } })();
    expect(bad).toContain("GOOGLE_DRIVE_CLIENT_SECRET");
    expect(bad).not.toContain("SEC RET");
  });

  it("값 파일에 남은 저장 폴더 줄은 인증 값으로 받지 않는다", () => {
    const text = `${formatOauthValues(values)}CLASSNOTE_VIDEO_DRIVE_FOLDER_ID=1r4PhTUJoCqLdlbdfGN8IhnGrokKK5DmK\n`;
    expect(parseOauthValues(text)).toEqual(values);
    expect(parseOauthValues(`${text}CLASSNOTE_VIDEO_DRIVE_FOLDER_ID=짧음\n`)).toEqual(values);
    expect(formatOauthValues({ ...values, CLASSNOTE_VIDEO_DRIVE_FOLDER_ID: "1r4PhTUJoCqLdlbdfGN8IhnGrokKK5DmK" })).not.toContain("CLASSNOTE_VIDEO_DRIVE_FOLDER_ID");
  });

  it(".env.local에 넣을 때 같은 키의 옛 줄과 gcloud 키는 지우고 나머지는 그대로 둔다", () => {
    const before = [
      "DATABASE_URL=postgres://keep", "GOOGLE_DRIVE_GCLOUD_ACCOUNT='old@example.com'", "CLASSNOTE_UPLOAD_ID=keep-me",
      "GOOGLE_DRIVE_GCLOUD_PATH='C:\\gcloud.ps1'", "GOOGLE_DRIVE_REFRESH_TOKEN='old-token'", "CLASSNOTE_VIDEO_DRIVE_FOLDER_ID='oldFolder12345'", "",
    ].join("\r\n");
    const after = mergeOauthEnv(before, values);
    expect(after).toContain("DATABASE_URL=postgres://keep");
    expect(after).toContain("CLASSNOTE_UPLOAD_ID=keep-me");
    expect(after).not.toContain("GCLOUD");
    expect(after).not.toContain("old-token");
    expect(after).toContain("CLASSNOTE_VIDEO_DRIVE_FOLDER_ID='oldFolder12345'");
    expect(after.match(/^CLASSNOTE_VIDEO_DRIVE_FOLDER_ID=/gm)).toHaveLength(1);
    for (const [key, value] of Object.entries(values)) {
      expect(after.match(new RegExp(`^${key}=`, "gm"))).toHaveLength(1);
      expect(after).toContain(`${key}='${value}'`);
    }
    expect(mergeOauthEnv(after, values)).toBe(after); // 다시 적용해도 같다
    const sneaky = mergeOauthEnv(before, { ...values, CLASSNOTE_VIDEO_DRIVE_FOLDER_ID: "sneakyFolder123" });
    expect(sneaky).not.toContain("sneakyFolder123");
    expect(sneaky).toContain("oldFolder12345");
  });

  it("손으로 고친 줄(공백·export)도 지우고, 이름만 비슷한 키와 주석은 건드리지 않는다", () => {
    const before = [
      "  GOOGLE_DRIVE_GCLOUD_ACCOUNT = 'old@example.com'", "export GOOGLE_DRIVE_REFRESH_TOKEN=old-token",
      "MY_GOOGLE_DRIVE_CLIENT_ID=keep-prefix", "GOOGLE_DRIVE_CLIENT_ID_BACKUP=keep-suffix", "# GOOGLE_DRIVE_GCLOUD_PATH=keep-comment", "LAST=keep-no-newline",
    ].join("\n");
    const after = mergeOauthEnv(before, values);
    expect(after).not.toContain("old@example.com");
    expect(after).not.toContain("old-token");
    for (const kept of ["MY_GOOGLE_DRIVE_CLIENT_ID=keep-prefix", "GOOGLE_DRIVE_CLIENT_ID_BACKUP=keep-suffix", "# GOOGLE_DRIVE_GCLOUD_PATH=keep-comment", "LAST=keep-no-newline\n"]) expect(after).toContain(kept);
  });

  it("폴더 ID 모양 — 주소를 통째로 넣으면 거른다", () => {
    expect(isDriveFolderId("1r4PhTUJoCqLdlbdfGN8IhnGrokKK5DmK")).toBe(true);
    expect(isDriveFolderId("https://drive.google.com/drive/folders/1r4PhTUJoCqLdlbdfGN8IhnGrokKK5DmK")).toBe(false);
    expect(isDriveFolderId("")).toBe(false);
  });
});

describe("Drive OAuth 최초 허락", () => {
  it("'데스크톱 앱' 클라이언트 JSON만 받는다", () => {
    expect(readClientJson(JSON.stringify({ installed: { client_id: "a", client_secret: "b" } }))).toEqual({ clientId: "a", clientSecret: "b" });
    expect(() => readClientJson(JSON.stringify({ web: { client_id: "a", client_secret: "b" } }))).toThrow("데스크톱 앱");
    expect(() => readClientJson(JSON.stringify({ type: "service_account", private_key: "k" }))).toThrow("OAuth 클라이언트 JSON이 아닙니다");
    expect(() => readClientJson("{")).toThrow("읽지 못했습니다");
  });

  it("동의 주소는 Drive 권한·오프라인·매번 동의·PKCE를 담는다", () => {
    const attempt = newLoginAttempt();
    const url = new URL(buildAuthUrl({ clientId: "cid", redirectUri: "http://127.0.0.1:5000", state: attempt.state, challenge: attempt.challenge, account: "a@b.c" }));
    const q = Object.fromEntries(url.searchParams);
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(q).toMatchObject({ client_id: "cid", redirect_uri: "http://127.0.0.1:5000", response_type: "code", scope: DRIVE_SCOPE,
      access_type: "offline", prompt: "consent", code_challenge_method: "S256", login_hint: "a@b.c", state: attempt.state });
    expect(attempt.verifier).not.toBe(attempt.challenge);
    expect(newLoginAttempt().state).not.toBe(attempt.state);
  });

  it("갱신 토큰이 없거나 Drive 권한이 빠지면 거절한다", async () => {
    const args = { ...creds, code: "c", verifier: "v", redirectUri: "http://127.0.0.1:5000" };
    const ok = vi.fn().mockResolvedValue(json({ access_token: "at", refresh_token: "rt", scope: `openid ${DRIVE_SCOPE}` }));
    expect(await exchangeCode({ ...args, fetchImpl: ok })).toEqual({ accessToken: "at", refreshToken: "rt" });
    expect(new URLSearchParams(ok.mock.calls[0][1].body).get("code_verifier")).toBe("v");
    await expect(exchangeCode({ ...args, fetchImpl: vi.fn().mockResolvedValue(json({ access_token: "at", scope: DRIVE_SCOPE })) })).rejects.toThrow("갱신 토큰");
    await expect(exchangeCode({ ...args, fetchImpl: vi.fn().mockResolvedValue(json({ access_token: "at", refresh_token: "rt", scope: "openid" })) })).rejects.toThrow("Drive 권한");
    await expect(exchangeCode({ ...args, fetchImpl: vi.fn().mockResolvedValue(json({ error: "invalid_grant" }, 400)) })).rejects.toThrow();
  });
});

describe("인증 적용은 폴더를 값으로 다루지 않는다", () => {
  it("로그인 안내와 저장 스크립트는 폴더를 묻거나 덮어쓰지 않는다", () => {
    const read = (name) => readFileSync(path.join(process.cwd(), "scripts/_classnote", name), "utf8");
    const login = read("video-oauth-login.mjs");
    const save = read("video-save-oauth-settings.mjs");
    expect(login).not.toContain("--folder=<Drive 폴더 ID>");
    expect(login).not.toContain("CLASSNOTE_VIDEO_DRIVE_FOLDER_ID");
    expect(login).not.toContain("checkDriveFolder");
    expect(save).not.toContain("checkDriveFolder");
    expect(save).not.toContain("CLASSNOTE_VIDEO_DRIVE_FOLDER_ID");
    expect(save).toContain("mergeOauthEnv");
    expect(save).toContain("oauthRefreshAuth");
    expect(save).toContain("process.exitCode = 1");
    const setup = read("setup-video-drive-oauth.ps1");
    expect(setup).not.toContain("AllowFolderChange");
    expect(setup).not.toContain("--allow-folder-change");
    expect(setup).toContain("check-video-drive.mjs");
  });

  it("값 파일을 읽지 못하면 저장 스크립트는 실패로 끝난다", () => {
    const missing = path.join(process.cwd(), "scripts/_classnote", "__missing-oauth-values__.txt");
    const result = spawnSync(process.execPath, [
      path.join(process.cwd(), "scripts/_classnote", "video-save-oauth-settings.mjs"),
      `--values=${missing}`,
    ], { encoding: "utf8", cwd: process.cwd() });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("값 파일을 찾지 못했습니다");
  });
});
