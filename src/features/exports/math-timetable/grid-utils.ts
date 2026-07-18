// ijw-calander gridUtils.ts 충실 이식(vendored). 로직 무변경. import만 eywa-로컬로.
//
// ⚠️ 여기 있던 `SUBJECT_THEMES`/`getSubjectTheme`(과목 한글명 → 색 하드코딩 맵)은 삭제했다(2026-07-17
// 적대 감사). 어디서도 import하지 않는 죽은 코드였고, 운영 enum(과목 라벨·색)을 코드에 박는 것은
// 금지 패턴이라 그대로 두면 나중에 누가 집어 쓸 위험만 있었다.
// 과목 색이 필요하면 학원설정 단일 소스 `buildSubjectMaps(settings.operations.subjects).colorOf(key)`를 쓸 것.
import type { TimetableClass } from './types';
import { convertLegacyPeriodId } from './constants';

// Get classes for cell
export const getClassesForCell = (
    filteredClasses: TimetableClass[],
    day: string,
    period: string,
    resource: string,
    viewType: 'teacher' | 'room' | 'class'
) => {
    return filteredClasses.filter(cls => {
        // Remove spaces for robust comparison
        const targetSlot = `${day}${period}`.replace(/\s+/g, '');

        // Schedule 매칭 먼저 확인
        const scheduleMatch = cls.schedule?.some(s => {
            const normalizedS = s.replace(/\s+/g, '');
            // Check exact match or sub-period matching
            return normalizedS === targetSlot || normalizedS.startsWith(`${targetSlot}-`);
        });

        if (!scheduleMatch) return false;

        // 리소스 매칭 (Teacher/Room) - slotTeachers/slotRooms 지원
        if (viewType === 'teacher') {
            // slotTeachers 키 생성: 레거시 periodId (1-2)를 새 periodId (2)로 변환
            // period가 "1-2" 형식이면 "2"로, 이미 "2" 형식이면 그대로 사용
            const normalizedPeriod = convertLegacyPeriodId(period);
            const slotKey = `${day}-${normalizedPeriod}`;
            const slotTeacher = cls.slotTeachers?.[slotKey];

            // slotTeacher가 있으면 그것 사용, 없으면 메인 teacher
            const effectiveTeacher = slotTeacher || cls.teacher;
            return effectiveTeacher?.trim() === resource?.trim();
        } else {
            // Room 뷰는 slotRooms 또는 기본 room
            const normalizedPeriod = convertLegacyPeriodId(period);
            const slotKey = `${day}-${normalizedPeriod}`;
            const slotRoom = cls.slotRooms?.[slotKey];
            const effectiveRoom = slotRoom || cls.room;
            return effectiveRoom?.trim() === resource?.trim();
        }
    });
};

// Helper: 특정 슬롯의 effective teacher/room 가져오기
const getEffectiveResource = (
    cls: TimetableClass,
    day: string,
    period: string,
    viewType: 'teacher' | 'room' | 'class'
): string => {
    const normalizedPeriod = convertLegacyPeriodId(period);
    const slotKey = `${day}-${normalizedPeriod}`;

    if (viewType === 'teacher') {
        return cls.slotTeachers?.[slotKey] || cls.teacher || '';
    } else {
        return cls.slotRooms?.[slotKey] || cls.room || '';
    }
};

// Helper: 두 셀의 수업 세트가 동일한지 비교 (className 기준)
// 4-1과 4-2가 다른 Firestore 문서(다른 id)라도 같은 className이면 동일 세트로 간주
export const isSameClassNameSet = (classesA: TimetableClass[], classesB: TimetableClass[]): boolean => {
    const namesA = classesA.map(c => c.className).sort();
    const namesB = classesB.map(c => c.className).sort();
    if (namesA.length !== namesB.length) return false;
    return namesA.every((name, i) => name === namesB[i]);
};

// Calculate how many consecutive periods a class spans starting from given period
export const getConsecutiveSpan = (
    cls: TimetableClass,
    day: string,
    startPeriodIndex: number,
    periods: string[],
    filteredClasses: TimetableClass[],
    viewType: 'teacher' | 'room' | 'class'
): number => {
    let span = 1;
    const startPeriod = periods[startPeriodIndex];
    const startResource = getEffectiveResource(cls, day, startPeriod, viewType);

    for (let i = startPeriodIndex + 1; i < periods.length; i++) {
        const nextPeriod = periods[i];

        // 다음 교시에도 같은 선생님/강의실의 수업이 있는지 확인
        const nextResource = getEffectiveResource(cls, day, nextPeriod, viewType);
        if (nextResource !== startResource) break;

        // 다음 슬롯의 수업 세트와 시작 슬롯의 수업 세트 비교 (className 기준)
        // 4-1/4-2가 다른 문서여도 같은 className이면 병합
        const classesInNextSlot = getClassesForCell(filteredClasses, day, nextPeriod, startResource, viewType);
        if (classesInNextSlot.length === 0) break;

        const classesInStartSlot = getClassesForCell(filteredClasses, day, startPeriod, startResource, viewType);

        if (isSameClassNameSet(classesInStartSlot, classesInNextSlot)) {
            span++;
        } else {
            break;
        }
    }
    return span;
};

// Check if this cell should be skipped (already covered by a rowspan from above)
export const shouldSkipCell = (
    cls: TimetableClass,
    day: string,
    periodIndex: number,
    currentCellClasses: TimetableClass[],
    periods: string[],
    filteredClasses: TimetableClass[],
    viewType: 'teacher' | 'room' | 'class'
): boolean => {
    const currentPeriod = periods[periodIndex];
    const currentResource = getEffectiveResource(cls, day, currentPeriod, viewType);

    // Look backwards to see if any previous consecutive period started a rowspan that covers this cell
    for (let i = periodIndex - 1; i >= 0; i--) {
        const prevPeriod = periods[i];

        // 이전 교시에 같은 선생님/강의실인지 확인
        const prevResource = getEffectiveResource(cls, day, prevPeriod, viewType);
        if (prevResource !== currentResource) {
            return false;
        }

        // 이전 슬롯의 수업 세트와 현재 슬롯의 수업 세트 비교 (className 기준)
        const classesInPrevSlot = getClassesForCell(filteredClasses, day, prevPeriod, currentResource, viewType);
        if (classesInPrevSlot.length === 0) break;

        if (!isSameClassNameSet(currentCellClasses, classesInPrevSlot)) {
            // 수업 세트가 다르면 병합 불가, 새로운 시작점
            return false;
        }

        // 이전 슬롯과 동일한 수업 세트 → 이 셀은 rowspan에 포함됨
        return true;
    }
    return false;
};

