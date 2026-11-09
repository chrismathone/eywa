#!/usr/bin/env node
/**
 * 로컬 게이트 — 바뀐 파일과 그 영향만 검사한다(AGENTS.md "검증 범위 원칙", 수정 계획 P0-1).
 *
 * CI가 꺼져 있거나 배포를 막지 못하는 동안(next.config.ts `ignoreBuildErrors`) 이게 유일한 게이트다.
 *   ① 린트   — 바뀐 JS/TS 파일
 *   ② 타입   — 바뀐 TS + 그 import + **역의존**(export 줄이 바뀌었거나 지우거나 옮긴 파일을 import하는 쪽).
 *              역의존이 너무 많으면 전체 tsc로 올린다(바뀐 파일만 보면 시그니처 변경이 "통과"로 새어 나간다).
 *   ③ 테스트 — `vitest related` + 바뀐 파일 이름을 **글자로** 적은 테스트(SQL·CSS·JSON 포함 — 문자열로 소스를 읽는
 *              가드는 import 그래프에 안 잡힌다) + **폴더 전체를 훑는 가드**(파일 이름을 안 적으니 늘 돈다)
 *
 * 쓰는 법: `pnpm verify` (기준 = origin/main과의 merge-base) · `pnpm verify <기준>` · `--skip-tests` · `--all-types`
 * 결과 한 줄은 `.verify/log.txt`에 커밋 sha와 함께 남는다(gitignore).
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, appendFileSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { compareWithBase, failuresOf, sweepAppleDouble } from "./verify-baseline.mjs";
import { reverseDependents } from "./verify-deps.mjs";
import path from "node:path";

const git = (...a) => execFileSync("git", ["-c", "core.quotePath=false", ...a], { encoding: "utf8", maxBuffer: 1 << 26 }).trim();
const gitTry = (...a) => spawnSync("git", ["-c", "core.quotePath=false", ...a], { encoding: "utf8", maxBuffer: 1 << 26 }).stdout ?? "";
const root = git("rev-parse", "--show-toplevel");
process.chdir(root);
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const baseArg = args.find((a) => !a.startsWith("--"));
const bin = (name) => path.join(root, "node_modules", ".bin", name);
const tscJs = path.join(root, "node_modules", "typescript", "bin", "tsc");
const REVERSE_LIMIT = 60;
const TEST_GLOBS = ["*.test.ts", "*.test.tsx", "*.test.mjs"];
const isJunk = (f) => path.basename(f).startsWith("._"); // exFAT 외장 SSD의 AppleDouble
const isCode = (f) => /\.(m|c)?(t|j)sx?$/.test(f) && !f.endsWith(".d.ts");
const isTs = (f) => /\.(m)?tsx?$/.test(f) && !f.endsWith(".d.ts") && !f.startsWith("experiments/");
const isTest = (f) => /\.(test|spec)\.(m)?(t|j)sx?$/.test(f);
const lines = (s) => s.split("\n").map((x) => x.trim()).filter(Boolean);
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ── 바뀐 파일(기준 이후 커밋 + 작업 중 + 새 파일)과 사라진 경로(삭제·이름 변경의 옛 경로) ───────────────
const base = baseArg ?? git("merge-base", "HEAD", "origin/main");
const gone = new Set();
for (const range of [`${base}...HEAD`, "HEAD"]) {
  for (const l of lines(git("diff", "--name-status", "-M", range))) {
    const [kind, oldPath] = l.split("\t");
    if (kind.startsWith("D") || kind.startsWith("R")) gone.add(oldPath);
  }
}
const untracked = lines(git("ls-files", "--others", "--exclude-standard"));
const changed = [...new Set([
  ...lines(git("diff", "--name-only", "--diff-filter=ACMR", `${base}...HEAD`)),
  ...lines(git("diff", "--name-only", "--diff-filter=ACMR", "HEAD")),
  ...untracked,
])].filter((f) => !isJunk(f) && existsSync(f));
for (const f of [...gone]) if (existsSync(f)) gone.delete(f);
const code = changed.filter(isCode);
const ts = changed.filter(isTs);

console.log(`기준 ${base.slice(0, 9)} · 바뀐 파일 ${changed.length}개(코드 ${code.length}) · 사라진 경로 ${gone.size}개`);
if (changed.length === 0 && gone.size === 0) {
  console.log("바뀐 것이 없습니다.");
  process.exit(0);
}

// 외장 SSD가 만든 `._*`는 vitest·폴더 훑는 가드가 소스로 읽어 거짓 실패를 낸다. `.git/info/exclude`로 무시돼 git 목록엔 안 나오고
// 한글 이름은 `find`가 정규화(NFD) 차이로 못 지운다 — Node로 순회해 지운다. 외장 SSD가 아니면 0개.
const junkCount = sweepAppleDouble(".");
if (junkCount) console.log(`외장 SSD 메타 파일(._*) ${junkCount}개 정리`);

const results = [];
let failed = false; // 판정은 값으로 — 결과 문구("기존 실패 9건")로 판정하면 통과가 실패로 뒤집힌다
const note = (text, ok) => { results.push(text); if (!ok) failed = true; };
const run = (label, cmd, cmdArgs) => {
  console.log(`\n━━ ${label} ━━`);
  const r = spawnSync(cmd, cmdArgs, { stdio: "inherit" });
  note(`${label} ${r.status === 0 ? "통과" : "실패"}`, r.status === 0);
};

// ① 린트
if (code.length) run("린트", bin("eslint"), ["--no-warn-ignored", ...code]);

// ② 타입 — 역의존: 바뀐 TS 파일 **전부**와 사라진 TS 경로를 import하는 파일(`verify-deps.mjs` — export 줄만 보면 여러 줄 시그니처가 빠진다)
const reverse = reverseDependents([...ts.filter((f) => !isTest(f)), ...[...gone].filter((g) => /\.(m)?tsx?$/.test(g))]);
mkdirSync(".verify", { recursive: true });
writeFileSync(path.join(".verify", "next-env.d.ts"), '/// <reference types="next" />\n/// <reference types="next/image-types/global" />\n');
const scoped = path.join(".verify", "tsconfig.json");
const fullTypes = flag("--all-types") || reverse.size > REVERSE_LIMIT;
if (fullTypes) {
  if (!flag("--all-types")) console.log(`\n역의존 ${reverse.size}개 > ${REVERSE_LIMIT} — 전체 tsc로 올린다`);
  run("타입(전체)", process.execPath, ["--max-old-space-size=12288", tscJs, "--noEmit"]);
} else if (ts.length || reverse.size) {
  const targets = [...new Set([...ts, ...reverse])];
  const dts = lines(git("ls-files", "*.d.ts")).filter((f) => !f.startsWith("experiments/"));
  writeFileSync(scoped, JSON.stringify({
    extends: "../tsconfig.json",
    compilerOptions: { incremental: false, plugins: [] },
    include: [],
    files: ["next-env.d.ts", ...dts.map((f) => `../${f}`), ...targets.map((f) => `../${f}`)],
  }, null, 2));
  console.log(`\n━━ 타입(바뀐 TS ${ts.length} · 역의존 ${reverse.size} + import) ━━`);
  const r = spawnSync(process.execPath, ["--max-old-space-size=8192", tscJs, "-p", scoped, "--noEmit", "--pretty", "false"], { encoding: "utf8" });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  const errs = out.split("\n").filter((l) => / error TS\d+/.test(l));
  const mine = errs.filter((l) => targets.some((f) => l.startsWith(f)));
  if (errs.length) console.log(errs.join("\n"));
  else if (r.status !== 0) console.log(out.slice(-2000));
  console.log(`오류 ${errs.length}건(바뀐·역의존 파일 ${mine.length}건 · 그 밖의 import ${errs.length - mine.length}건)`);
  note(`타입 ${r.status === 0 ? "통과" : `실패(바뀐·역의존 ${mine.length}·그 밖 ${errs.length - mine.length})`}`, r.status === 0);
}
rmSync(scoped, { force: true });

// ③ 테스트
if (!flag("--skip-tests")) {
  // 게이트 전용 설정(값을 줄여 쓰지 않음 — 기준선 비교가 내용을 본다) + 외장 SSD `._*` 제외
  const APPLEDOUBLE = ["--config", path.join(root, "scripts", "verify-vitest.config.mts"), "--exclude", "**/._*"];
  const srcChanged = code.filter((f) => !isTest(f) && /\.(m)?(t|j)sx?$/.test(f));
  const tests = new Set(changed.filter(isTest));
  // 이름 언급 — 코드뿐 아니라 SQL·CSS·JSON도(#139 시즌2 파일 이름 가드 같은 것). `server/actions.ts`처럼 이름이 흔하면
  // 그 파일이 속한 기능 폴더 이름(server·components 같은 일반 폴더를 건너뛴 가장 가까운 조상)도 함께 적힌 테스트만.
  const GENERIC = new Set(["server", "components", "_components", "lib", "src", "features", "app", "(shell)", "utils", "hooks", "migrations", "supabase"]);
  const ownerOf = (f) => f.split("/").slice(0, -1).reverse().find((seg) => !GENERIC.has(seg) && !seg.startsWith("[")) ?? "";
  for (const file of [...changed.filter((f) => !isTest(f)), ...gone]) {
    const name = path.basename(file);
    const owner = ownerOf(file);
    const stem = name.replace(/\.[^.]+$/, "");
    // `.gitignore`처럼 확장자를 떼면 비거나 아주 짧은 이름은 쓰지 않는다 — `""` 한 쌍이 테스트 1,184개를 끌어왔다.
    const pattern = stem.length >= 3 ? `${escRe(name)}|["'/]${escRe(stem)}["']` : escRe(name);
    const hit = gitTry("grep", "-l", "-E", pattern, "--", ...TEST_GLOBS);
    for (const t of lines(hit)) if (!owner || t.includes(`/${owner}/`) || readFileSync(t, "utf8").includes(owner)) tests.add(t);
  }
  // 폴더 전체를 훑는 가드(postgrest-embed-hints · server-action-exports · migrations-corpus …) — 파일 이름을 안 적으니 늘 돈다.
  for (const t of lines(gitTry("grep", "-l", "-E", "readdirSync|globSync|readdir\\(|walk\\(|ls-files", "--", ...TEST_GLOBS))) tests.add(t);
  const failures = [];
  const vitestJson = (label, vitestArgs, name) => {
    const json = path.join(".verify", `${name}.json`);
    rmSync(json, { force: true });
    console.log(`\n━━ ${label} ━━`);
    spawnSync(bin("vitest"), [...vitestArgs, "--reporter=default", "--reporter=json", `--outputFile.json=${json}`], { stdio: "inherit" });
    const got = failuresOf(json, root);
    if (got === null) failures.push({ file: "(vitest)", title: label, message: "결과 파일이 없다 — 실행 자체가 실패" });
    else failures.push(...got);
  };
  if (srcChanged.length) vitestJson(`테스트(import 그래프 — 바뀐 소스 ${srcChanged.length}개)`, ["related", "--run", ...APPLEDOUBLE, ...srcChanged], "related");
  if (tests.size) vitestJson(`테스트(바뀐 테스트 + 이름 언급 + 폴더 훑는 가드 ${tests.size}개)`, ["run", ...APPLEDOUBLE, ...tests], "named");
  // 많이 한꺼번에 돌리면 시간에 민감한 테스트가 흔들린다 — 실패한 파일만 혼자 한 번 더 돌려, 그때도 실패한 것만 남긴다.
  let steady = failures;
  let flaky = [];
  const failedFiles = [...new Set(failures.map((f) => f.file))].filter((f) => existsSync(f));
  if (failedFiles.length) {
    const json = path.join(".verify", "retry.json");
    rmSync(json, { force: true });
    spawnSync(bin("vitest"), ["run", ...APPLEDOUBLE, "--reporter=json", `--outputFile=${json}`, ...failedFiles], { stdio: "ignore" });
    const again = failuresOf(json, root) ?? failures;
    const key = (f) => `${f.file}\u0000${f.title}`;
    const still = new Set(again.map(key));
    // 재실행에서 파일째 깨졌거나(수집 오류) 다시 돌릴 수 없던 항목은 "통과"가 아니다 — 불안정으로 빼지 않는다.
    const brokeOnRetry = new Set(again.filter((f) => f.title === "(파일 오류)").map((f) => f.file));
    steady = failures.filter((f) => still.has(key(f)) || brokeOnRetry.has(f.file) || !existsSync(f.file));
    flaky = failures.filter((f) => !still.has(key(f)));
    for (const f of flaky) console.log(`  불안정(혼자 돌리면 통과) · ${f.file} · ${f.title}`);
  }
  if (steady.length === 0) note(flaky.length ? `테스트 통과(불안정 ${flaky.length}건)` : "테스트 통과", true);
  else {
    const failures = steady;
    console.log(`\n실패 ${failures.length}건 — 기준(${base.slice(0, 9)})에서 같은 파일을 다시 돌려 기존 실패를 가른다`);
    const { fresh, known, baseError } = compareWithBase({ root, base, failures });
    if (baseError) console.log(baseError);
    for (const f of known) console.log(`  기존 실패(기준에서도 같음) · ${f.file} · ${f.title}`);
    for (const f of fresh) console.log(`  ✗ 새 실패 · ${f.file} · ${f.title}\n      ${f.message}`);
    note(fresh.length ? `테스트 실패(새 ${fresh.length} · 기존 ${known.length})` : `테스트 통과(기존 실패 ${known.length}건 — 이번 변경 무관)`, fresh.length === 0);
  }
}

const sha = git("rev-parse", "--short", "HEAD");
const dirty = git("status", "--porcelain").length > 0 ? "+작업중" : "";
const line = `${new Date().toISOString()} ${sha}${dirty} 기준=${base.slice(0, 9)} 파일=${changed.length} 사라짐=${gone.size} · ${results.join(" · ")}`;
appendFileSync(path.join(".verify", "log.txt"), `${line}\n`);
console.log(`\n${line}`);
process.exit(failed ? 1 : 0);
