#!/usr/bin/env node
/*
 * eywa 프로덕션 안전 가드 (PreToolUse hook, matcher=Bash)
 * 되돌릴 수 없는/위험한 Bash 명령을 하드 차단한다.
 *   1) main/master 대상 git push        2) force push (--force / -f)
 *   3) db:seed / seed 스크립트(데이터 wipe)  4) 파괴적 SQL(DROP/TRUNCATE/무-WHERE DELETE)·wipe-tenant
 * 우회: 명령에 ALLOW_DANGER 토큰 포함 (원장이 명시적으로 승인한 경우에만).
 * 계약: 차단 = stderr 메시지 + exit 2 / 통과 = exit 0.
 *
 * 설계: git push 는 "명령 세그먼트가 실제로 git push 로 시작할 때만" 검사한다
 *       (echo/grep/커밋메시지에 'git push ... main' 이 텍스트로 들어간 경우 오탐 방지).
 *       현재-브랜치 감지는 훅 실행 컨텍스트(cwd/worktree)에 따라 불안정하므로 쓰지 않는다.
 *       bare `git push`(대상 미명시)는 이 훅으로 못 잡으니, 필요 시 git pre-push 훅으로 보강.
 */
"use strict";

function readStdin() {
  try {
    return require("fs").readFileSync(0, "utf8");
  } catch (_) {
    return "";
  }
}

function block(reason) {
  process.stderr.write(
    "\n⛔ eywa 안전 가드가 이 명령을 차단했습니다.\n" +
      reason +
      "\n\n정말 실행해야 한다면(원장 승인 시): 명령 끝에  # ALLOW_DANGER  를 붙이세요.\n" +
      "예)  git push origin main   # ALLOW_DANGER\n"
  );
  process.exit(2);
}

let cmd = "";
try {
  const data = JSON.parse(readStdin());
  if (data && data.tool_input && typeof data.tool_input.command === "string") {
    cmd = data.tool_input.command;
  }
} catch (_) {
  process.exit(0); // 파싱 불가 = 검사 불가 = 통과
}
if (!cmd) process.exit(0);

// --- 우회 토큰 (원장 승인) ---
if (/ALLOW_DANGER/.test(cmd)) process.exit(0);

// 셸 연산자로 세그먼트 분리 (&&, ||, ;, |)
const segments = cmd.split(/&&|\|\||[;|]/);

// --- 1) & 2) git push (세그먼트가 실제로 git push 로 시작할 때만) ---
for (const seg of segments) {
  if (!/^\s*git\s+push\b/.test(seg)) continue;
  // 2) force push (단, --force-with-lease 는 허용)
  if (/(?:^|\s)(?:-f|--force)(?=\s|$)/.test(seg)) {
    block("사유: force push 금지 (공유 이력 파괴 위험).");
  }
  // 1) main/master 대상 (origin main / HEAD:main / +main / *:main)
  if (/(?:^|\s|:|\+)(?:main|master)(?=$|\s|;)/.test(seg)) {
    block("사유: main(프로덕션)에 직접 push 금지. 브랜치에서 작업·검증·승인 후 반영하세요.");
  }
}

// --- 3)/4)는 "SQL/스크립트를 실제 실행할 수 있는 명령"에만 적용 ---
// git push 세그먼트 검사와 같은 취지의 오탐 방지: git commit 메시지·문서 텍스트에 TRUNCATE/db:seed
// 같은 단어가 들어가도(2026-07-08 실사례: CSS 'truncate' 언급 커밋 차단) 실행 수단이 없으면 통과.
// echo "TRUNCATE x" | psql 류는 전체 명령에 psql이 있어 여전히 걸린다.
const SQL_CAPABLE =
  /\b(?:psql|pg_dump|pg_restore|supabase|node|tsx|ts-node|npx|pnpm|npm|yarn|bun|deno|python3?)\b/i.test(cmd) ||
  /DATABASE_URL|\.sql\b/i.test(cmd);

if (SQL_CAPABLE) {
  // --- 3) db:seed / seed 스크립트 (테넌트 데이터 wipe) ---
  if (/\bdb:seed\b/.test(cmd) || /(?:tsx|node|ts-node)\s+\S*scripts[\/\\]seed\.[a-z]+/.test(cmd)) {
    block("사유: db:seed 는 테넌트 데이터를 전부 wipe합니다. 프로덕션(injaewon) 데이터 파괴 위험.");
  }

  // --- 4) 파괴적 SQL / wipe 스크립트 (인자 안에 들어오므로 substring 검사) ---
  if (/\bwipe-tenant/i.test(cmd)) {
    block("사유: 테넌트 데이터 wipe 스크립트.");
  }
  // TRUNCATE는 SQL 문 형태(뒤에 [TABLE] 식별자)만 — 산문 속 단어 언급(CSS truncate 등)은 통과.
  if (
    /\bdrop\s+(?:table|schema|database)\b/i.test(cmd) ||
    /\btruncate\s+(?:table\s+)?["'`a-z_]/i.test(cmd)
  ) {
    block("사유: 파괴적 SQL (DROP / TRUNCATE).");
  }
  if (/\bdelete\s+from\b/i.test(cmd) && !/\bwhere\b/i.test(cmd)) {
    block("사유: WHERE 없는 DELETE FROM = 전체 행 삭제 위험.");
  }
}

process.exit(0);
