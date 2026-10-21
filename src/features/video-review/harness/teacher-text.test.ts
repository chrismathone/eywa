import { describe, expect, it } from "vitest";
import { cleanTeacherList, cleanTeacherNote, cleanTeacherText } from "./teacher-text";

describe("선생님 화면 글 정리", () => {
  it("화면 파일 이름·전사 시각을 시각으로 바꾼다", () => {
    expect(cleanTeacherText("f03_00m12s.jpg에서 식이 틀림")).toBe("0:12 화면에서 식이 틀림");
    expect(cleanTeacherText("last_02m05s_hi 참고")).toBe("마지막 화면(2:05) 참고");
    expect(cleanTeacherText("[01:05] 말함")).toBe("1:05 말함");
  });
  it("필드 이름·check 번호·'판독 불가'를 걷되 수식 속 영어는 둔다", () => {
    expect(cleanTeacherText("check 3 기준 판독 불가")).toBe("기준 알아보기 어려움");
    expect(cleanTeacherText("함수 check(x) = x²의 최솟값")).toBe("함수 check(x) = x²의 최솟값");
    expect(cleanTeacherText("check 2x + 1 = 5")).toBe("check 2x + 1 = 5");
    expect(cleanTeacherText("함수 writing(x) = 2x + 1")).toBe("함수 writing(x) = 2x + 1");
  });
  it("'전사함수'·'전사 오류가 아닙니다'는 음성 인식 이야기가 아니다", () => {
    expect(cleanTeacherList(["전사함수라고 했지만 공역의 3에 대응하는 원소가 없음"])).toHaveLength(1);
  });
  it("음성 인식 이야기는 확인 필요 목록에서 뺀다(스크린샷 2026-10-21 사례)", () => {
    expect(cleanTeacherList([
      "[00:15] 음성 '1.24란'은 화면 1.23과 달라 transcript_fixes로 보정했으나 학생 원음은 확인 불가 — 보정 확정 보류",
      "[00:21] '순환항'은 교재의 '순환마디'와 다른 표현이나 전사 원문이라 판단 보류",
      "세 번째 전개도 글씨가 흐려 맞게 그렸는지 확인 필요",
    ])).toEqual(["세 번째 전개도 글씨가 흐려 맞게 그렸는지 확인 필요"]);
  });
  it("띄어쓰기 없는 문장 경계에서도 앞 문장을 지키고, 소수점은 자르지 않는다", () => {
    expect(cleanTeacherNote("분모를 9로 잘못 썼습니다.음성 인식 일부는 확인이 필요합니다.")).toBe("분모를 9로 잘못 썼습니다.");
    expect(cleanTeacherNote("1.24를 1.23으로 고쳐 말했습니다.")).toBe("1.24를 1.23으로 고쳐 말했습니다.");
    expect(cleanTeacherNote("마지막 식은 x = 2. 음성 인식 일부는 확인이 필요합니다.")).toBe("마지막 식은 x = 2.");
  });
  it("'전사 오류로 …'는 거르고 '전사 오류가 아닙니다'는 남긴다", () => {
    expect(cleanTeacherList(["전사 오류로 정확한 발음 확인 필요"])).toEqual([]);
    expect(cleanTeacherList(["1/2 + 1/3 = 2/5라고 썼으며 전사 오류가 아닙니다"])).toHaveLength(1);
  });
  it("메모에서 음성 인식 문장만 뺀다", () => {
    expect(cleanTeacherNote("분모 99를 이유와 함께 말했습니다. 다음에는 분모에 0을 몇 개 쓰는지 말해 보게 해 주세요. 음성 전사 일부는 보정했으니 학생 발화 원음 확인을 권합니다."))
      .toBe("분모 99를 이유와 함께 말했습니다. 다음에는 분모에 0을 몇 개 쓰는지 말해 보게 해 주세요.");
  });
});
