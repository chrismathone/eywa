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
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const ANSI = /\x1b\[[0-9;]*m/g;

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
    const rel = path.relative(root, file.name);
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
function messageOf(text, root) {
  return String(text ?? "").replace(ANSI, "").split(root).join("<root>/").replace(ABS_TO_REPO, "<root>/")
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
    if (e.startsWith(PREFIX) && Date.now() - statSync(path.join(parent, e)).mtimeMs > 30 * 60_000) { git("worktree", "remove", "--force", path.join(parent, e)); rmSync(path.join(parent, e), { recursive: true, force: true }); }
  }
  git("worktree", "prune");
  let dir = null;
  const cleanup = () => {
    if (!dir) return;
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
    symlinkSync(path.join(root, "node_modules"), path.join(dir, "node_modules"));
    sweepAppleDouble(dir);
    const atBase = files.filter((f) => existsSync(path.join(dir, f)));
    let baseFailures = [];
    if (atBase.length) {
      const json = path.join(dir, ".verify-base.json");
      // 🔴 기준 사본은 **자기** vitest.config로 돌린다 — 작업본 설정을 넘기면 그 안의 `@` 별칭(`path.resolve(__dirname, "./src")`)이
      //    작업본 src를 가리켜, 기준 사본의 테스트가 바뀐 코드를 읽는다 → 새 회귀가 기준에서도 실패해 "기존"으로 묻힌다(3차 리뷰 재현).
      const config = path.join(dir, "verify-base.vitest.config.mts");
      writeFileSync(config, `import { mergeConfig } from "vitest/config";\nimport base from "./vitest.config";\nexport default mergeConfig(base, { test: { chaiConfig: { truncateThreshold: 0 } } });\n`);
      spawnSync(path.join(root, "node_modules", ".bin", "vitest"), ["run", "--config", config, "--exclude", "**/._*", "--reporter=json", `--outputFile=${json}`, ...atBase], { cwd: dir, stdio: "ignore" });
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
