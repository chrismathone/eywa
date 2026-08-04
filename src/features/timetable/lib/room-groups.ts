/**
 * 강의실 **건물 · 층** 묶음 — 교실 활성도 표의 정렬과 구분선 근거.
 *
 * 원장 지시 2026-08-04: *"고수/본원 구분선 해줄 것. 본원도 2층 3층 6층에 구분선(앞자리 보면 추측 가능)"* ·
 * *"SKY는 2층에 편입, 205호 아래에 둘 것"*.
 *
 * 이름 규약: `건물명 + 호수`(고수801·바른602·본원305). 호수 **앞자리 = 층**이다.
 * ⚠️ 호수가 층을 말해준다는 건 이 학원의 실제 표기 규약이지 보편 법칙이 아니다 — 다른 표기의 방이
 *    생기면 층 없는 묶음(건물만)으로 떨어지고 그 건물 끝에 붙는다(정렬이 죽지 않게 fail-soft).
 */

/** 층을 이름으로 알 수 없는 방의 자리 — 실제 운영 정보라 코드에 적어 둘 수밖에 없다(classrooms에 층 컬럼이 없다). */
const FLOOR_OVERRIDES: Record<string, { floor: number; order: number }> = {
  // '본원SKY'는 이름에 호수가 없지만 **2층**이고, 자리는 205호 바로 아래다(원장 2026-08-04).
  // order를 크게 잡아 그 층의 맨 끝에 세운다. 205보다 큰 값이면 되고, 새 2층 호수가 생겨도 안 밀린다.
  SKY: { floor: 2, order: 9999 },
};

export type RoomGroup = {
  /** 건물명(고수·바른·본원). 못 읽으면 이름 전체. */
  building: string;
  /** 층. 이름으로 알 수 없으면 null. */
  floor: number | null;
  /** 구분선 위에 붙일 라벨. 예: "본원 2층", 층을 모르면 "바른". */
  label: string;
  /** 같은 층 안에서의 자리. */
  order: number;
};

/** 이름 하나를 건물·층·자리로 읽는다. */
export function roomGroupOf(name: string): RoomGroup {
  const trimmed = name.trim();
  const m = /^(\D+?)\s*(\d+)\s*$/.exec(trimmed);
  if (m) {
    const building = m[1]!.trim();
    const no = Number(m[2]);
    const floor = Number(String(no)[0]);
    return { building, floor, label: `${building} ${floor}층`, order: no };
  }
  // 숫자 호수가 없는 이름 — 알려진 방이면 지정 자리, 아니면 건물만으로 묶는다.
  const alpha = /^(\D+?)\s*([A-Za-z]+)\s*$/.exec(trimmed);
  const building = alpha ? alpha[1]!.trim() : trimmed;
  const suffix = alpha?.[2]?.toUpperCase() ?? "";
  const override = FLOOR_OVERRIDES[suffix];
  if (override) {
    return { building, floor: override.floor, label: `${building} ${override.floor}층`, order: override.order };
  }
  return { building, floor: null, label: building, order: Number.MAX_SAFE_INTEGER };
}

/** 그룹 동일성 — 구분선을 그을지 판단하는 키. */
export function roomGroupKey(g: RoomGroup): string {
  return `${g.building}|${g.floor ?? "?"}`;
}

export type WithRoomGroup<T> = T & {
  group: RoomGroup;
  /** 이 행에서 새 묶음이 시작되는가 = 위에 구분선을 긋는다(첫 행은 false — 표 머리와 겹친다). */
  groupStart: boolean;
};

/**
 * 건물 → 층 → 호수 순으로 정렬하고 묶음 경계를 표시한다.
 *
 * 건물 순서는 **입력에 나온 순서**를 지킨다 — 가나다로 강제하면 원장이 익숙한 배치(고수·바른·본원)가
 * 학원마다 흔들린다. 층·호수만 숫자로 정렬한다.
 */
export function groupRooms<T extends { name: string }>(rows: readonly T[]): WithRoomGroup<T>[] {
  const buildingOrder = new Map<string, number>();
  const tagged = rows.map((r) => {
    const group = roomGroupOf(r.name);
    if (!buildingOrder.has(group.building)) buildingOrder.set(group.building, buildingOrder.size);
    return { ...r, group };
  });
  tagged.sort((a, b) => {
    const ba = buildingOrder.get(a.group.building)!;
    const bb = buildingOrder.get(b.group.building)!;
    if (ba !== bb) return ba - bb;
    // 층을 모르는 방은 그 건물의 맨 끝으로(정렬 불능을 앞자리에 두면 표가 어수선해진다).
    const fa = a.group.floor ?? Number.MAX_SAFE_INTEGER;
    const fb = b.group.floor ?? Number.MAX_SAFE_INTEGER;
    if (fa !== fb) return fa - fb;
    if (a.group.order !== b.group.order) return a.group.order - b.group.order;
    return a.name.localeCompare(b.name, "ko");
  });
  let prev = "";
  return tagged.map((r, i) => {
    const key = roomGroupKey(r.group);
    const groupStart = i > 0 && key !== prev;
    prev = key;
    return { ...r, groupStart };
  });
}
