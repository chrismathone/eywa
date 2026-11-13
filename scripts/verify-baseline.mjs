/**
 * 로컬 게이트(`verify-changed.mjs`)의 테스트 기준선 비교.
 *
 * main에는 이미 빨간 테스트가 있다(2026-11-09 실측: 폴더를 훑는 가드 8파일 + ClassNote 워커 3파일 — CI가 꺼진 동안 쌓였다).
 * 그대로면 게이트가 늘 빨갛고, 늘 빨간 게이트는 아무도 안 본다. 그래서 실패한 테스트 **파일만** 기준 커밋에서 다시 돌려
 * (파일 · 테스트 제목 · 스택을 뺀 실패 메시지 **전체**)가 같으면 "기존 실패"로 따로 보이고, 새로 생기거나 달라진 실패만 게이트 실패로 친다.
 * 게이트는 값을 줄여 쓰지 않는 설정(`verify-vitest.config.mts`)으로 돌린다 — 메시지에 위반 목록이 그대로 들어가, 개수가 같아도
 * 내용이 바뀌면(하나 고치고 하나 더함) **새 실패**로 잡힌다. 남는 한계: 메시지가 값을 안 담는 단언(`expected false to be true`)은
 * 같은 테스트 안의 새 원인을 구별하지 못한다.
 */
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const ANSI = /\x1b\[[0-9;]*m/g;

/**
 * 패키지 실행 파일의 **JS 진입점**(`package.json`의 `bin`) — `spawnSync(process.execPath, [binEntry(…), …인자])`로 띄운다.
 * 🔴 `node_modules/.bin/<이름>`을 그대로 띄우지 말 것 — 맥·리눅스에선 셸 스크립트라 돌지만 **윈도에선 확장자 없는 셸 스크립트·`.cmd`라
 *    `spawnSync`가 띄우지 못해** 린트·테스트가 "실행 자체가 실패"로 끝났다(2026-11-13). node로 진입점을 직접 띄우면 어디서나 같다.
 */
export function binEntry(root, pkg, name = pkg) {
  const dir = path.join(root, "node_modules", pkg);
  const meta = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
  const rel = typeof meta.bin === "string" ? meta.bin : meta.bin?.[name];
  if (!rel) throw new Error(`${pkg} 패키지에 '${name}' 실행 파일이 없다`);
  return path.join(dir, rel);
}

/** 경로를 `/`로 — 윈도의 `path.relative`는 `\`로 돌려준다(git·vitest 필터·화면은 `/`). 맥·리눅스에선 그대로. */
const posix = (p) => p.split(path.sep).join("/");

/**
 * 기준 사본의 node_modules 링크만 뗀다 — 사본을 지우기 **전에** 먼저(지우는 쪽이 링크를 따라 들어가 작업본 node_modules를 지우지 않게).
 * 윈도 정션도 `lstat`에선 링크로 보이고 `unlink`가 링크만 지운다(2026-11-13 실측 — 대상 파일은 그대로). 실물 폴더면 손대지 않는다.
 */
function dropModulesLink(dir) {
  const link = path.join(dir, "node_modules");
  let st;
  try {
    st = lstatSync(link);
  } catch {
    return; // 없다
  }
  if (st.isSymbolicLink()) unlinkSync(link);
}

/**
 * 외장 SSD(exFAT)는 파일마다 `._이름` AppleDouble을 만든다 — 체크아웃 직후에도 생긴다. vitest·폴더 훑는 가드가 이걸 소스로 읽어
 * 거짓 실패를 낸다(SQL 폴더 규칙 가드는 `._s2_0001….sql`을 "규칙 밖 SQL"로 보고 수집 단계에서 터진다). `.git/info/exclude`로 무시돼
 * git 목록엔 안 나오고, 한글 이름은 `find`가 정규화(NFD) 차이로 못 지운다 — Node로 순회해 지운다. 외장 SSD가 아니면 0개.
 */
export function sweepAppleDouble(dir) {
  let count = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".git" || e.name === ".next") continue;
    const p = path.join(dir, e.name);
    if (e.name.startsWith("._")) { rmSync(p, { force: true, recursive: true }); count++; } else if (e.isDirectory()) count += sweepAppleDouble(p);
  }
  return count;
}

/** vitest json 결과 → 실패 목록. 경로는 저장소 기준 상대로, 메시지는 스택 줄을 뺀 전부(절대 경로는 `<root>/`로). */
export function failuresOf(jsonPath, root) {
  if (!existsSync(jsonPath)) return null; // 결과 파일이 없다 = vitest가 시작도 못 했다(수집 오류) — 호출부가 실패로 친다
  const r = JSON.parse(readFileSync(jsonPath, "utf8"));
  const out = [];
  for (const file of r.testResults ?? []) {
    const rel = posix(path.relative(root, file.name));
    const failed = (file.assertionResults ?? []).filter((a) => a.status === "failed");
    // 파일 단위 오류(수집·문법 오류)는 테스트가 없어 assertion이 비어 있다 — 파일 하나로 센다.
    if (file.status !== "passed" && failed.length === 0) out.push({ file: rel, title: "(파일 오류)", message: messageOf(file.message, root) });
    for (const a of failed) out.push({ file: rel, title: a.fullName ?? a.title, message: messageOf(a.failureMessages?.[0], root) });
  }
  return out;
}

// 실패 메시지 속 절대 경로는 작업본·기준 사본마다 다르고, 표기도 제각각이다(원문 · NFD · `%E1%84…` 퍼센트 인코딩).
// 저장소 안 최상위 폴더 이름 앞까지를 통째로 `<root>`로 바꾼다.
const ABS_TO_REPO = /(?:file:\/\/)?\/[^\s'"`]*?\/(?=(?:src|scripts|tests|supabase|docs|apps|public)\/)/g;
// 윈도: 경로 조각의 구분자를 `/` 하나로 맞춘 뒤라 `/`만 본다 — 드라이브 글자(`C:`)와 `file:///C:/…`만 더 먹는다.
const ABS_TO_REPO_WIN = /(?:file:\/\/\/?)?(?:\b[A-Za-z]:)?\/[^\s'"`]*?\/(?=(?:src|scripts|tests|supabase|docs|apps|public)\/)/g;
// 윈도 경로 조각 — 루트를 지운 자리(`<root>/…`)나 드라이브 글자로 시작하는 것만(그 밖의 `\`는 경로가 아니다: `\d+` 같은 정규식).
const WIN_PATH_TOKEN = /(?:<root>\/|\b[A-Za-z]:[\\/])[^\s'"`]*/g;
const WIN = path.sep === "\\";
function messageOf(text, root) {
  let s = String(text ?? "").replace(ANSI, "");
  if (WIN) {
    // 🔴 윈도는 같은 경로가 메시지마다 `C:\…\tests\unit\a.ts` · `C:/…/tests/unit/a.ts` · 이스케이프된 `C:\\…`로 섞인다(작업본 root = git의
    //    `C:/…` · 기준 사본 = realpath의 `C:\…` · vitest는 `/` · node 오류는 `\`). 루트만 지우면 그 뒤 구분자가 달라 같은 실패가 '새 실패'가 된다
    //    (Codex 재현). ① 루트를 모든 표기로 먼저 지운다(기준 사본 폴더 이름엔 공백이 있어 경로 조각 패턴으론 못 잡는다) ② 경로 조각 **안의**
    //    구분자 묶음만 `/` 하나로. 🔴 메시지 전체의 `\`를 바꾸지 말 것 — `\d+`와 `/d+`가 같아져 새 실패가 기존 실패로 묻힌다(Codex 재리뷰 재현).
    const parts = root.split(/[\\/]+/);
    const roots = [...new Set([root, parts.join("/"), parts.join("\\"), parts.join("\\\\")])].sort((a, b) => b.length - a.length);
    for (const r of roots) s = s.split(r).join("<root>/");
    s = s.replace(WIN_PATH_TOKEN, (p) => p.replace(/[\\/]+/g, "/"));
    return s.replace(ABS_TO_REPO_WIN, "<root>/")
      .split("\n").filter((l) => !/^\s+at\s/.test(l) && !/^\s*❯/.test(l)).join("\n").trim();
  }
  // 맥·리눅스 — 예전 그대로.
  return s.split(root).join("<root>/").replace(ABS_TO_REPO, "<root>/")
    .split("\n").filter((l) => !/^\s+at\s/.test(l) && !/^\s*❯/.test(l)).join("\n").trim();
}

const PREFIX = ".aywa-verify-base-";
const keyOf = (f) => `${f.file}\u0000${f.title}\u0000${f.message}`;

/**
 * 기준 커밋을 임시 폴더에 꺼내(`git worktree add --detach`) 실패한 파일만 돌린다. node_modules는 링크.
 * 임시 폴더는 저장소 **밖**(내장 디스크 임시 폴더)에 둔다 — 안에 두면 전체 tsc·eslint가 그 사본까지 훑는다. 외장 SSD(exFAT)에 두면
 * 한글 파일명(NFD)이 `rm -rf`로도 안 지워져 실행마다 찌꺼기가 쌓인다(2026-11-09 실측). 대신 상위 폴더 이름에 **한글·공백**을 넣어
 * 작업본(`/Volumes/새 볼륨/…`)과 경로 조건을 맞춘다 — 한글 경로를 `URL.pathname` 그대로 여는 테스트가 양쪽에서 같게 깨져야
 * 메시지(`<root>/…`로 정규화)가 같아진다.
 * @returns {{ fresh: object[], known: object[], baseError: string | null }}
 */
export function compareWithBase({ root, base, failures }) {
  const files = [...new Set(failures.map((f) => f.file))].filter((f) => !f.startsWith("._"));
  const git = (...a) => spawnSync("git", ["-C", root, ...a], { encoding: "utf8" });
  const parent = path.join(realpathSync(os.tmpdir()), "aywa 검증 기준");
  mkdirSync(parent, { recursive: true });
  // 지난 실행이 중단돼 남긴 사본(폴더가 남아 있으면 `worktree prune`으로도 안 지워진다)을 먼저 치운다. 다른 세션이 동시에 돌 수
  // 있다 — 지금 돌고 있는 남의 사본을 지우지 않게 30분 넘게 묵은 것만.
  for (const e of readdirSync(parent)) {
    const stale = path.join(parent, e);
    if (e.startsWith(PREFIX) && Date.now() - statSync(stale).mtimeMs > 30 * 60_000) { dropModulesLink(stale); git("worktree", "remove", "--force", stale); rmSync(stale, { recursive: true, force: true }); }
  }
  git("worktree", "prune");
  let dir = null;
  const cleanup = () => {
    if (!dir) return;
    dropModulesLink(dir);
    git("worktree", "remove", "--force", dir);
    rmSync(dir, { recursive: true, force: true });
    dir = null;
  };
  const onSignal = () => { cleanup(); process.exit(130); };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  try {
    dir = realpathSync(mkdtempSync(path.join(parent, PREFIX)));
    const add = git("worktree", "add", "--detach", "--force", dir, base);
    if (add.status !== 0) return { fresh: failures, known: [], baseError: `기준 사본을 만들지 못했다: ${add.stderr.trim()}` };
    // 윈도는 정션 — 폴더 심볼릭 링크는 관리자·개발자 모드가 있어야 만들어진다(정션은 아무나). 맥·리눅스에선 셋째 인자를 무시한다.
    // 작업본 node_modules가 이미 정션(공유 트리를 가리킴)이어도 realpath로 실물을 가리킨다 — 링크의 링크를 만들지 않게.
    symlinkSync(realpathSync(path.join(root, "node_modules")), path.join(dir, "node_modules"), "junction");
    sweepAppleDouble(dir);
    const atBase = files.filter((f) => existsSync(path.join(dir, f)));
    let baseFailures = [];
    if (atBase.length) {
      const json = path.join(dir, ".verify-base.json");
      // 🔴 기준 사본은 **자기** vitest.config로 돌린다 — 작업본 설정을 넘기면 그 안의 `@` 별칭(`path.resolve(__dirname, "./src")`)이
      //    작업본 src를 가리켜, 기준 사본의 테스트가 바뀐 코드를 읽는다 → 새 회귀가 기준에서도 실패해 "기존"으로 묻힌다(3차 리뷰 재현).
      const config = path.join(dir, "verify-base.vitest.config.mts");
      writeFileSync(config, `import { mergeConfig } from "vitest/config";\nimport base from "./vitest.config";\nexport default mergeConfig(base, { test: { chaiConfig: { truncateThreshold: 0 } } });\n`);
      spawnSync(process.execPath, [binEntry(root, "vitest"), "run", "--config", config, "--exclude", "**/._*", "--reporter=json", `--outputFile=${json}`, ...atBase], { cwd: dir, stdio: "ignore" });
      const got = failuresOf(json, dir);
      // 기준 커밋의 설정을 못 불러오면 결과 파일이 없다 — 이유 없이 전부 "새 실패"로 보이지 않게 이유를 붙인다(실패 쪽으로 닫는 건 그대로).
      if (got === null) return { fresh: failures, known: [], baseError: "기준 사본에서 vitest를 시작하지 못했다(설정 로드 실패 추정) — 전부 새 실패로 친다" };
      baseFailures = got;
    }
    const seen = new Set(baseFailures.map(keyOf));
    return {
      fresh: failures.filter((f) => !seen.has(keyOf(f))),
      known: failures.filter((f) => seen.has(keyOf(f))),
      baseError: null,
    };
  } catch (err) {
    return { fresh: failures, known: [], baseError: `기준 비교를 못 했다(전부 새 실패로 친다): ${err.message}` };
  } finally {
    cleanup();
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  }
}
