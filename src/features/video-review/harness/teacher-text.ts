/**
 * 선생님 화면에 나가는 글 정리(순수) — 판정 모델의 작업 용어를 선생님이 읽을 말로 바꾼다(원장 2026-10-21 "이상한 알아볼 수 없는 말 전부 수정").
 * 화면 파일 이름(`f03_00m12s`·`last_02m05s_hi`)·전사 시각(`[00:15]`) → '0:12'·'마지막 화면(2:05)', 필드 이름·check 번호 제거,
 * 음성 인식(전사)·보정 이야기는 선생님이 할 일이 아니라서 목록·메모에서 뺀다. 저장된 옛 결과에도 화면에 내릴 때 같은 규칙을 쓴다.
 */

const time = (m: string, s: string) => `${Number(m)}:${s}`;

/**
 * 음성 인식·전사 보정에 관한 말 — 선생님 확인 거리가 아니다. 🔴 '전사' 한 글자로 판정하지 말 것('전사함수'는 수학 용어 · "전사 오류가 아닙니다"는
 * 실제 오류 설명이다, 적대 리뷰 2026-10-21) — 작업 과정을 뜻하는 꼴만 잡는다. 확인된 오류(mistakes)에는 아예 쓰지 않는다.
 */
const TRANSCRIPT_TALK = /transcript|전사\s*(?:원문|일부|문구|상으로|로는|된|보정|오류(?!가\s*아[니닙닌]))|보정(?:했|함|표|\s*확정)|원음|음성\s*인식|STT|발화\s*원음/i;

export function isTranscriptTalk(text: string): boolean {
  return TRANSCRIPT_TALK.test(text);
}

export function cleanTeacherText(text: string): string {
  return text
    .replace(/last_(\d{2})m(\d{2})s_hi(?:\.jpg)?/g, (_, m: string, s: string) => `마지막 화면(${time(m, s)})`)
    .replace(/f\d{2}_(\d{2})m(\d{2})s(?:\.jpg)?/g, (_, m: string, s: string) => `${time(m, s)} 화면`)
    .replace(/\[(\d{2}):(\d{2})\]/g, (_, m: string, s: string) => time(m, s))
    // 밑줄 든 필드 이름과 'check 3'꼴(숫자 뒤에 글자가 없을 때)만 — 'check(x)'·'check 2x'처럼 수식에 든 영어 단어는 그대로.
    .replace(/\b(?:transcript_fixes|teacher_note|why_wrong)\b/gi, "")
    .replace(/\bcheck\s*#?\d+\b(?![A-Za-z(])/gi, "")
    .replace(/판독\s*불가/g, "알아보기 어려움")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.)])/g, "$1")
    .trim();
}

/** 메모 — 음성 인식 이야기를 하는 문장은 통째로 뺀다(남은 문장만). */
export function cleanTeacherNote(note: string): string {
  // '~다.'·'~요.'·'!?' 뒤(띄어쓰기가 없어도) 또는 '.' 뒤에 띄어쓰기가 올 때 자른다 — 소수점(1.24)은 띄어쓰기가 없어 안 잘린다.
  const sentences = note.split(/(?<=[다요음함]\.)\s*|(?<=[!?。])\s*|(?<=\.)\s+/);
  return cleanTeacherText(sentences.filter((s) => !isTranscriptTalk(s)).join(" "));
}

/** 목록 — 음성 인식 이야기는 빼고 나머지를 다듬는다. */
export function cleanTeacherList(items: readonly string[]): string[] {
  return items.filter((t) => !isTranscriptTalk(t)).map(cleanTeacherText).filter(Boolean);
}
