/**
 * 워커가 로컬 파일을 두는 폴더의 **단일 진입점**.
 *
 * ⚠️ 왜 만들었나(2026-07-21 실측 사고): 로그(`watch.log`)와 일일 프로비저닝 마커
 * (`provision-last-run.txt`)가 각자 `process.env.CLASSNOTE_OUT || "D:/tmp/classnote"`를 복사해 쓰고 있었다.
 * 연동 PC엔 그 경로를 만들 수 없었는데(D: 없음) **양쪽 다 실패를 조용히 삼켜** 두 가지가 동시에 죽었다:
 *   ① `watch.log`가 한 줄도 안 남음 → "로그를 보라"는 모든 안내가 무용지물.
 *   ② 마커를 못 써서 `lastRun()`이 항상 빈값 → **하루 1회여야 할 보드 프로비저닝이 매 폴(15초)마다 재실행**
 *      (실측: 워커 기동 07-20, provision 마지막 실행이 조회 시각 19초 전).
 * 그래서 **쓰기 가능한 폴더를 실제로 찾을 때까지 폴백**하고, 결과를 한 곳에서 공유한다.
 * 폴백 순서: `CLASSNOTE_OUT` → `D:/tmp/classnote` → **스크립트 옆 `_logs`**(항상 존재하는 워커 폴더).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

let cached;

/** 실제로 쓰기 가능한 상태 폴더. 전부 실패하면 null(콘솔 출력만, 데몬은 계속). */
export function stateDir() {
  if (cached !== undefined) return cached;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [process.env.CLASSNOTE_OUT, "D:/tmp/classnote", path.join(here, "_logs")].filter(Boolean);
  for (const dir of candidates) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      // mkdir이 통과해도 쓰기 권한이 없을 수 있어 실제로 한 번 써 본다(네트워크 드라이브·읽기전용 대비).
      fs.writeFileSync(path.join(dir, ".write-test"), String(Date.now()));
      fs.unlinkSync(path.join(dir, ".write-test"));
      cached = dir;
      return cached;
    } catch {
      /* 다음 후보 */
    }
  }
  cached = null;
  return cached;
}

/** 상태 폴더 안 파일 경로. 폴더를 못 잡으면 null. */
export function stateFile(name) {
  const dir = stateDir();
  return dir ? path.join(dir, name) : null;
}

/** 화면·하트비트에 보여줄 짧은 설명(어느 후보가 선택됐는지). */
export function stateDirLabel() {
  const dir = stateDir();
  if (!dir) return "없음(쓰기 가능한 폴더 못 찾음 — 콘솔만)";
  if (process.env.CLASSNOTE_OUT && dir === process.env.CLASSNOTE_OUT) return `${dir} (CLASSNOTE_OUT)`;
  if (dir === "D:/tmp/classnote") return `${dir} (기본값)`;
  return `${dir} (폴백)`;
}
