// scripts/_classnote/halt-marker.mjs — **멈춤 표식** 한 벌(반 보드 자동 해제 · 명부 퇴원처리가 같이 쓴다).
//
// 예상 밖 변화(다른 배정·원아가 함께 사라짐 등)를 보면 표식 파일을 남기고, 사람이 그 파일을 지우면 다시 시작한다.
// 🔴 모르면 멈춘다 — 되돌릴 수 없는 퇴원처리도 이 모듈을 쓴다:
//    · 파일이 있는데 읽지 못하면 멈춤으로 본다(2차 리뷰 F2 — 예전엔 '멈춤 아님'이었다).
//    · 파일을 못 쓰면(폴더 권한·디스크) 이 프로세스의 메모리 표식이 대신 막는다 — 읽을 때 **파일 사유 || 메모리 사유**(R3).
//      그 사유에는 '연동 앱을 다시 시작해야 풀립니다'를 붙인다(보고서의 '파일을 지우면 다시 시작' 안내와 어긋나지 않게 · F3).
//    · 파일을 쓴 경우 메모리는 비운다 — 사람이 파일을 지우면 같은 프로세스에서도 바로 다시 시작한다.
// 보고서에 내는 사유의 시각은 KST로 바꿔 보여 준다(파일 안은 UTC ISO 그대로 · F4).
import fs from "node:fs";
import { stateFile } from "./classnote-paths.mjs";

export const HALT_UNREADABLE = "멈춤 표식 파일을 읽지 못했습니다";
export const MEMORY_ONLY_NOTE = "(표식 파일을 쓰지 못해 연동 앱을 다시 시작해야 풀립니다)";

/** 파일 머리의 UTC ISO 시각을 KST(`YYYY-MM-DD HH:MM KST`)로 — 사유 글은 그대로. 머리에 시각이 없으면 원문 그대로. */
export function kstHaltText(text) {
  const m = String(text ?? "").match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z)\s+([\s\S]*)$/);
  if (!m) return String(text ?? "");
  const at = new Date(m[1]);
  if (Number.isNaN(at.getTime())) return String(text ?? "");
  return `${at.toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 16)} KST ${m[2]}`;
}

/**
 * @param {string} name  상태 폴더 안 파일 이름
 * @param {{ fsImpl?: typeof fs }} [opts]  테스트용(읽기 실패 흉내)
 * @returns {{ reason: () => string, set: (why: string) => void, resetForTest: () => void }}
 */
export function haltMarker(name, { fsImpl = fs } = {}) {
  const file = stateFile(name);
  let memory = "";
  return {
    reason() {
      let fromFile = "";
      if (file && fsImpl.existsSync(file)) {
        try {
          fromFile = kstHaltText(fsImpl.readFileSync(file, "utf8").trim()) || "사유 미기록";
        } catch {
          fromFile = HALT_UNREADABLE; // 있는데 못 읽었다 — 멈춤으로 본다
        }
      }
      return fromFile || (memory ? `${memory} ${MEMORY_ONLY_NOTE}` : "");
    },
    set(why) {
      const text = String(why ?? "").slice(0, 300) || "사유 미기록";
      let wrote = false;
      if (file) {
        try {
          fsImpl.writeFileSync(file, `${new Date().toISOString()} ${text}`);
          wrote = true;
        } catch {
          wrote = false;
        }
      }
      memory = wrote ? "" : text; // 파일을 쓰면 메모리는 비운다(지우면 바로 재개) · 못 쓰면 메모리가 막는다
    },
    resetForTest() {
      memory = "";
    },
  };
}
