/**
 * ClassNote 기능 게이트 — 학원 설정의 **모듈 스위치**와 **발송 스위치**를 한 곳에서 읽는다.
 *
 * - `classnoteModuleOn` = 이 학원에 ClassNote 기능이 *있나*(설정 '기능' 면). 꺼지면 화면에서 ClassNote의 흔적을
 *   전부 감춘다(원장 2026-09-30 *"스위치가 꺼져있을때 이 기능이 있었는지조차 모르게"*).
 * - `classnoteSendOn` = 실제로 *보내나* = 모듈 켜짐 **그리고** `report.classnoteSendEnabled`. 모든 서버 발송 경로가
 *   이 함수로 판정한다 — 모듈을 끈 학원에 옛 발송 스위치가 켜져 남아 있어도 한 건도 나가지 않게.
 *   (발송 PC 워커도 같은 판정: scripts/_classnote/classnote-core.mjs `isClassnoteSendEnabled`·`isClassnoteModuleEnabled`.)
 * - `classnoteReplyMode` = 학부모 글 **답글·공감**(0317a·0319a)의 모드 = 모듈 켜짐일 때의 `report.classnoteParentReplyMode`
 *   (끔 off · 시험 test · 전체 on, 기본 끔). 모듈이 꺼졌거나 모르는 값이면 끔. 앱의 모든 답글·공감 경로가 이 함수로 읽는다
 *   (워커는 같은 판정을 `loadReplyMode`로 — scripts/_classnote/classnote-parent-reply-core.mjs).
 * 침산은 꺼진 모듈이 없어 `classnoteSendOn` ≡ 종전 `classnoteSendEnabled`다.
 * ⚠️ 순수 모듈 — 서버·클라가 같이 import한다(`server-only` 금지, #61).
 */
import { isModuleEnabled, type ModuleId } from "@/lib/modules";

type GateSettings = {
  modules: { disabled?: readonly ModuleId[] };
  report: { classnoteSendEnabled?: boolean };
};

export function classnoteModuleOn(settings: { modules: { disabled?: readonly ModuleId[] } }): boolean {
  return isModuleEnabled(settings.modules.disabled, "classnote");
}

export function classnoteSendOn(settings: GateSettings): boolean {
  return classnoteModuleOn(settings) && settings.report.classnoteSendEnabled === true;
}

export type ClassnoteReplyMode = "off" | "test" | "on";

/** 학부모 글 답글·공감 모드 — 모듈이 꺼졌거나 값이 셋(끔·시험·전체) 밖이면 끔. */
export function classnoteReplyMode(settings: { modules: { disabled?: readonly ModuleId[] }; report: { classnoteParentReplyMode?: unknown } }): ClassnoteReplyMode {
  if (!classnoteModuleOn(settings)) return "off";
  const raw = settings.report.classnoteParentReplyMode;
  return raw === "test" || raw === "on" ? raw : "off";
}
