import { describe, expect, it } from "vitest";
import { iosNeedsInstall, urlBase64ToBytes } from "./push-key";

describe("urlBase64ToBytes — VAPID 공개키 변환", () => {
  it("패딩 없는 base64url을 그대로 받아 바이트로 만든다", () => {
    // 실제 VAPID 공개키는 65바이트(0x04 + x + y). 형식이 같은 짧은 샘플로 규약만 확인한다.
    const bytes = urlBase64ToBytes("BAEC"); // 3바이트
    expect(Array.from(bytes)).toEqual([4, 1, 2]);
  });

  it("`-`·`_`(url-safe)를 `+`·`/`로 되돌린다", () => {
    // "++/+" 를 url-safe로 쓰면 "--_-" — 표준 base64로 바꾸지 않으면 atob이 던진다.
    expect(Array.from(urlBase64ToBytes("--_-"))).toEqual(Array.from(urlBase64ToBytes("++/+")));
  });

  it("길이가 4의 배수가 아니어도 패딩을 채워 통과시킨다(실 VAPID 키가 이 모양이다)", () => {
    expect(() => urlBase64ToBytes("BAECBQ")).not.toThrow();
    expect(urlBase64ToBytes("BAECBQ")).toHaveLength(4);
  });

  it("빈 값은 조용히 넘어가지 않고 던진다(키 미설정을 '아무 일 없음'으로 만들지 않기)", () => {
    expect(() => urlBase64ToBytes("")).toThrow();
    expect(() => urlBase64ToBytes("   ")).toThrow();
  });
});

describe("iosNeedsInstall — 아이폰은 홈 화면에 추가해야 푸시가 온다", () => {
  const IPHONE =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
  const ANDROID =
    "Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";

  it("사파리에서 그냥 연 아이폰 = 안내가 필요하다", () => {
    expect(iosNeedsInstall(IPHONE, false)).toBe(true);
  });

  it("홈 화면 아이콘으로 들어온 아이폰 = 바로 켤 수 있다", () => {
    expect(iosNeedsInstall(IPHONE, true)).toBe(false);
  });

  it("안드로이드는 설치 없이도 된다", () => {
    expect(iosNeedsInstall(ANDROID, false)).toBe(false);
  });
});
