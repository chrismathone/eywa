"use client";

import { startTransition } from "react";
import type { FormEvent } from "react";

/**
 * `<form action={서버액션}>`(네이티브 액션 제출) 대신 쓰는 제출 헬퍼.
 *
 * ⚠️ **왜 필요한가** — React 19는 액션 폼을 제출하면 액션 실행 직전에 `requestFormReset`을 **무조건** 건다
 * (react-dom `startHostTransition`, 19.2.4 소스 확인). 커밋 시 `form.reset()`이 돌아 모든 입력이 *마운트 시점*
 * 값으로 되돌아간다. 그런데 React는 자기 prop(state)이 안 바뀌었으니 DOM을 다시 쓰지 않으므로, **제출 후에도
 * 화면에 남는 폼**에선 DOM과 state가 갈라진 채 굳는다. 두 가지 증상으로 나타난다:
 *   ① 보이는 값이 옛 값으로 돌아감(체크박스가 대표적 — `defaultChecked`는 state를 안 따라간다).
 *   ② **더 위험**: React state를 담아 나르는 hidden input(payload)도 마운트 시점 값으로 리셋된다. 그 뒤
 *      일부만 고치고 다시 저장하면 **안 고친 칸은 옛 값이 제출돼 직전 저장이 되돌아간다**(조용한 데이터 손실).
 * 실측 2026-07-21: 컨트롤드 입력의 `value`는 바뀌어도 `defaultValue`는 마운트 값 그대로 → reset이 되돌린다.
 *
 * 네이티브 제출과 **동일한 FormData**(제출 버튼의 name/value 포함)를 만들어 액션에 직접 넘기므로 동작은 같고,
 * 자동 리셋만 사라진다. Enter 키 저장도 그대로 살아 있다(submit 이벤트는 여전히 발생).
 *
 * ⚠️ **쓰면 안 되는 곳**: 제출 후 비워져야 하는 **추가(create) 폼**. 거기선 자동 리셋이 "입력칸 비우기"라
 * 의도된 동작이므로 `action={...}`을 그대로 둔다. 이 헬퍼는 **편집 폼·제출 후 남는 폼** 전용.
 *
 * @example
 * <form onSubmit={(e) => submitAction(e, formAction)}>
 */
export function submitAction(
  e: FormEvent<HTMLFormElement>,
  action: (formData: FormData) => void,
) {
  e.preventDefault();
  const form = e.currentTarget;
  const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
  let formData: FormData;
  try {
    // 2-arg FormData(form, submitter) = 네이티브 제출과 동일(누른 버튼의 name/value 포함).
    formData = new FormData(form, submitter ?? undefined);
  } catch {
    // 구형 브라우저 폴백 — submitter 인자 미지원. 버튼 name/value를 직접 붙인다.
    formData = new FormData(form);
    if (submitter?.name) formData.append(submitter.name, submitter.value);
  }
  startTransition(() => action(formData));
}
