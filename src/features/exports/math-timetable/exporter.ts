/* eslint-disable -- ijw-calander excelExport.ts 충실 이식(vendored). 로직 무변경 = 출력 동일이 목표라 스타일/any 룰 비적용. import만 aywa 로컬로 조정. */
import type { TimetableClass, Teacher, UnifiedStudent } from './types';
import { kstTimeOf, kstToday } from "@/lib/date-kst";
import {
    MATH_GROUPED_PERIODS,
    MATH_GROUP_PERIOD_IDS,
    MATH_GROUP_DISPLAY,
    LEGACY_TO_UNIFIED_PERIOD_MAP,
    WEEKEND_PERIOD_TIMES,
} from './constants';
import { getClassesForCell, isSameClassNameSet, getConsecutiveSpan, shouldSkipCell } from './grid-utils';
import { formatSchoolGrade } from './student-format';

export interface ExportTimetableParams {
    weekLabel: string;
    filteredClasses: TimetableClass[];
    allResources: string[];
    orderedSelectedDays: string[];
    weekDates: Record<string, { date: Date; formatted: string }>;
    teachers: Teacher[];
    currentPeriods: string[];
    studentMap: Record<string, UnifiedStudent>;
    subjectFilter: string;
    showHoldStudents?: boolean;
    showWithdrawnStudents?: boolean;
    referenceDate?: string;  // YYYY-MM-DD (기준일, 퇴원/대기 분류용)
    /** 학생이름 → 셀 메모(마우스오버) 텍스트 — 진도+교재. plain object (Functions 직렬화 호환) */
    studentMemoMap?: Record<string, string>;
    /** true면 다운로드 안 하고 xlsx ArrayBuffer 반환 (Google Sheets 업로드용) */
    returnBufferOnly?: boolean;
    /** writeBuffer 직전 워크북에 시트 추가(예: '수강편집' 라운드트립 시트). 서버 빌더가 주입. */
    appendSheets?: (workbook: import("exceljs").Workbook) => void | Promise<void>;
}

const hexToARGB = (hex: string | undefined, fallback: string): string => {
    if (!hex) return fallback;
    const clean = hex.replace('#', '').trim();
    if (clean.length === 6) return `FF${clean.toUpperCase()}`;
    if (clean.length === 8) return clean.toUpperCase();
    if (clean.length === 3) {
        const expanded = clean.split('').map(c => c + c).join('');
        return `FF${expanded.toUpperCase()}`;
    }
    return fallback;
};

const GROUP_COLORS: Record<string, { bg: string; light: string }> = {
    '월/목': { bg: 'FF2563EB', light: 'FFEFF6FF' },
    '화/금': { bg: 'FF9333EA', light: 'FFFAF5FF' },
    '수': { bg: 'FF16A34A', light: 'FFF0FDF4' },
    '주말': { bg: 'FFEA580C', light: 'FFFFF7ED' },
};

const THIN = { style: 'thin' as const, color: { argb: 'FF000000' } };
const MEDIUM = { style: 'medium' as const, color: { argb: 'FF000000' } };
const THICK = { style: 'thick' as const, color: { argb: 'FF000000' } };
const EMPTY_BG = 'FFE5E7EB';
const WITHDRAWN_BG = 'FF1F2937'; // 검정 (퇴원 행)

// 학생 + 합반 인덱스 메타 (합반 시 어느 수업 소속인지)
interface StudentWithMeta {
    student: any;
    classIdx: number;            // 합반: 1, 2, ... / 단일: 0
    attendingCellDays: string[]; // 이 셀의 요일들 중 학생이 실제로 등원하는 요일
}

// 셀 내부 학생을 공통/부분 등원으로 분리
interface PartitionedStudents {
    common: StudentWithMeta[];                            // 모든 셀 요일에 등원 (가로 병합 표시)
    partialByDay: Record<string, StudentWithMeta[]>;      // 일부 요일만 등원 (해당 요일 컬럼에만 표시)
}

interface CellPayload {
    classes: TimetableClass[];
    uniqueClassNames: string[];      // 합반 시 unique 수업명 (라벨링 순서)
    cellDays: string[];              // 이 셀이 커버하는 요일 (예: ['월','목'])
    active: PartitionedStudents;
    hold: PartitionedStudents;
    withdrawnStudents: StudentWithMeta[];  // 퇴원은 요일 분리 없음 (ClassCard 와 동일)
    activeTotal: number;             // 재원 전체 인원 (헤더용)
    holdTotal: number;
    withdrawnTotal: number;
    headerLines: string[];           // 수업명 (강의실은 별도 줄)
    roomLines: string[];             // 강의실 (수업별)
    bgColor?: string;
    textColor?: string;
}

// 학생이 특정 요일에 등원하는지 (ClassCard.tsx isStudentAttendingDay 와 동일)
const isStudentAttendingDay = (student: any, day: string): boolean => {
    const attendanceDays = student.attendanceDays;
    if (!attendanceDays || attendanceDays.length === 0) return true;  // 설정 없으면 모든 요일 등원
    return attendanceDays.includes(day);
};

// 학생별 엑셀 스타일 (ClassCard.tsx:608-620 와 동일 규칙)
const resolveStudentStyle = (
    student: any,
    refDateMs: number,
): { bgARGB: string; fgARGB: string; bold: boolean } => {
    // 반이동 입학: 초록 (bg-green-200)
    if (student.isTransferredIn) {
        return { bgARGB: 'FFBBF7D0', fgARGB: 'FF111827', bold: true };
    }
    // firstSubjectEnrollmentDate 우선, 없으면 enrollmentDate
    const baseDate = student.firstSubjectEnrollmentDate || student.enrollmentDate;
    if (baseDate) {
        const days = Math.ceil((refDateMs - new Date(baseDate).getTime()) / 86400000);
        if (days <= 30) return { bgARGB: 'FFEF4444', fgARGB: 'FFFFFFFF', bold: true };
        if (days <= 60) return { bgARGB: 'FFFCE7F3', fgARGB: 'FF111827', bold: true };
    }
    return { bgARGB: 'FFFFFFFF', fgARGB: 'FF111827', bold: false };
};

// 정렬 가중치 (ClassCard 와 동일: 반이동 -1 → underline 0 → 일반 1 → 60일 2 → 30일 3)
const getEnrollmentWeight = (student: any, refDateMs: number): number => {
    if (student.isTransferredIn) return -1;
    if (student.underline) return 0;
    if (student.enrollmentDate) {
        const days = Math.ceil((refDateMs - new Date(student.enrollmentDate).getTime()) / 86400000);
        if (days <= 30) return 3;
        if (days <= 60) return 2;
    }
    return 1;
};

// 정렬 + filter 헬퍼 (재원/대기/퇴원 공통)
const sortActiveByWeight = (
    arr: StudentWithMeta[],
    today: string,
    refDateMs: number,
): StudentWithMeta[] => {
    arr.sort((a, b) => {
        const aIsWS = (a.student.withdrawalDate && a.student.withdrawalDate > today && !a.student.isTransferred) ? 1 : 0;
        const bIsWS = (b.student.withdrawalDate && b.student.withdrawalDate > today && !b.student.isTransferred) ? 1 : 0;
        if (aIsWS !== bIsWS) return aIsWS - bIsWS;
        const wA = getEnrollmentWeight(a.student, refDateMs);
        const wB = getEnrollmentWeight(b.student, refDateMs);
        if (wA !== wB) return wA - wB;
        if (a.classIdx !== b.classIdx) return a.classIdx - b.classIdx;
        return (a.student.name || '').localeCompare(b.student.name || '', 'ko');
    });
    return arr;
};

const buildCellPayload = (
    cellClasses: TimetableClass[],
    cellDays: string[],
    referenceDateStr: string,
): CellPayload | null => {
    if (cellClasses.length === 0) return null;

    // 합반 처리: unique 수업명 순서 (className 첫 등장 순)
    const uniqueClassNames: string[] = [];
    const classIdxMap = new Map<string, number>();
    cellClasses.forEach(c => {
        if (c.className && !classIdxMap.has(c.className)) {
            uniqueClassNames.push(c.className);
            classIdxMap.set(c.className, uniqueClassNames.length); // 1부터
        }
    });
    const isMergedClass = uniqueClassNames.length > 1;

    const headerLines = uniqueClassNames.slice();
    const roomLines = uniqueClassNames.map(name => {
        const cls = cellClasses.find(c => c.className === name);
        return cls?.room || '';
    });

    // 학생 수집: 학생ID 별 첫 등장 cls 기준으로 classIdx 결정
    const studentMap = new Map<string, { student: any; classIdx: number }>();
    cellClasses.forEach(c => {
        const classIdx = isMergedClass ? (classIdxMap.get(c.className || '') || 0) : 0;
        (c.studentList || []).forEach((s: any) => {
            if (s.id && !studentMap.has(s.id)) studentMap.set(s.id, { student: s, classIdx });
        });
    });

    // 주차 마지막일(일요일) 기준 — 그 주에 발생하는 퇴원도 그 주에 포함되도록
    const today = (() => {
        const d = new Date(referenceDateStr);
        d.setDate(d.getDate() + 6);
        const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, '0'); const dd = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${dd}`;
    })();
    const weekEndMs = new Date(today).getTime();
    // 신입 sort 가중치 계산용 — 입학일 30일 윈도우는 refDateStr(월요일) 기준 유지
    const refDateMs = new Date(referenceDateStr).getTime();

    // 분류 (재원/대기/퇴원) + cellDays 기준 attendingCellDays 계산
    const activeAll: StudentWithMeta[] = [];
    const holdAll: StudentWithMeta[] = [];
    const withdrawnAll: StudentWithMeta[] = [];

    studentMap.forEach(({ student: s, classIdx }) => {
        const attendingCellDays = cellDays.filter(d => isStudentAttendingDay(s, d));
        // 셀의 어느 요일에도 등원하지 않으면 제외
        if (attendingCellDays.length === 0) return;

        const meta: StudentWithMeta = { student: s, classIdx, attendingCellDays };
        const isFutureWithdrawal = s.withdrawalDate && s.withdrawalDate > today;
        const hasActiveWithdrawal = s.withdrawalDate && s.withdrawalDate <= today && !s.isTransferred;

        if (hasActiveWithdrawal) {
            const daysSince = Math.floor((weekEndMs - new Date(s.withdrawalDate).getTime()) / 86400000);
            if (daysSince <= 30) withdrawnAll.push(meta);
        } else if (s.onHold && !s.withdrawalDate) {
            holdAll.push(meta);
        } else if (!s.withdrawalDate || isFutureWithdrawal) {
            activeAll.push(meta);
        }
    });

    sortActiveByWeight(activeAll, today, refDateMs);
    holdAll.sort((a, b) => (a.student.name || '').localeCompare(b.student.name || '', 'ko'));
    withdrawnAll.sort((a, b) => (a.student.name || '').localeCompare(b.student.name || '', 'ko'));

    // 공통/부분 분리 (active, hold만 — withdrawn은 요일 분리 안 함)
    const partition = (arr: StudentWithMeta[]): PartitionedStudents => {
        const common: StudentWithMeta[] = [];
        const partialByDay: Record<string, StudentWithMeta[]> = {};
        cellDays.forEach(d => { partialByDay[d] = []; });
        arr.forEach(meta => {
            if (meta.attendingCellDays.length === cellDays.length) {
                common.push(meta);
            } else {
                meta.attendingCellDays.forEach(d => {
                    if (partialByDay[d]) partialByDay[d].push(meta);
                });
            }
        });
        return { common, partialByDay };
    };

    const first = cellClasses[0];
    return {
        classes: cellClasses,
        uniqueClassNames,
        cellDays,
        active: partition(activeAll),
        hold: partition(holdAll),
        withdrawnStudents: withdrawnAll,
        activeTotal: activeAll.length,
        holdTotal: holdAll.length,
        withdrawnTotal: withdrawnAll.length,
        headerLines,
        roomLines,
        bgColor: first.bgColor ? hexToARGB(first.bgColor, 'FFFFFFFF') : undefined,
        textColor: first.textColor ? hexToARGB(first.textColor, 'FF111827') : undefined,
    };
};

interface GroupSpec {
    title: string;
    days: string[];
    resources: { resource: string; days: string[] }[];
}

interface ResolvedCell {
    startCol: number;
    endCol: number;
    payload: CellPayload | null;
    isGroupRightEdge: boolean;
    dayCols: Array<{ day: string; col: number }>;
    // Sub-period 정보 (1교시 = 1-1 + 1-2): 평일 셀만 사용
    subTopClasses?: TimetableClass[];  // 1-1, 2-1, 3-1, 4-1 (firstPeriod)
    subBotClasses?: TimetableClass[];  // 1-2, 2-2, 3-2, 4-2 (secondPeriod)
}

// 주말 셀: 슬롯 단위 + getConsecutiveSpan 으로 N슬롯 세로 병합
interface WeekendCell {
    startCol: number;
    endCol: number;            // 가로 병합 (같은 className 세트 요일 묶음)
    slotIndex: number;         // 시작 슬롯 인덱스 (0~7, weekendPeriods 기준)
    slotSpan: number;          // 연속 슬롯 수 (1~)
    payload: CellPayload | null;
    isGroupRightEdge: boolean;
    dayCols: Array<{ day: string; col: number }>;
}

// 학생 행 텍스트: "김아름/5칠성초" (합반 시 "[1] 김아름/5칠성초")
const formatStudentRowText = (
    meta: StudentWithMeta,
    isMerged: boolean,
): string => {
    const { student, classIdx } = meta;
    const prefix = isMerged && classIdx > 0 ? `[${classIdx}] ` : '';
    const schoolGrade = formatSchoolGrade(student.school, student.grade);
    return `${prefix}${student.name}/${schoolGrade}`;
};

// 학생 셀 메모(마우스오버) 텍스트 — 진도 + 교재 (ClassCard 툴팁과 동일 형식)
export function buildStudentMemoText(
    textbook?: { month?: string; textbookName?: string } | null,
    report?: { progress?: string; date?: string } | null,
): string {
    const parts: string[] = [];
    if (textbook?.textbookName) {
        parts.push(`교재: ${textbook.month ? `${textbook.month} ` : ''}${textbook.textbookName}`);
    }
    const progress = report?.progress?.trim();
    if (progress) {
        let dateLabel = '';
        if (report?.date) {
            const d = new Date(report.date);
            if (!isNaN(d.getTime())) {
                const yy = String(d.getFullYear()).slice(2);
                const mm = String(d.getMonth() + 1).padStart(2, '0');
                const dd = String(d.getDate()).padStart(2, '0');
                dateLabel = ` ${yy}.${mm}.${dd}`;
            }
        }
        parts.push(`[진도]${dateLabel}\n${progress}`);
    }
    return parts.join('\n────────\n');
}

export async function exportMathTimetableToExcel(params: ExportTimetableParams): Promise<void | ArrayBuffer> {
    const ExcelJS = (await import('exceljs')).default;
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'ijw-Calander';
    workbook.created = new Date();

    // 학생 셀에 진도+교재 메모(마우스오버) 부착 — studentMemoMap 없으면 no-op
    const applyMemo = (cell: any, studentName?: string) => {
        const memo = studentName ? params.studentMemoMap?.[studentName] : undefined;
        if (memo) cell.note = { texts: [{ text: memo }] };
    };

    const {
        weekLabel,
        orderedSelectedDays,
        weekDates,
        teachers,
        currentPeriods,
        subjectFilter,
        referenceDate,
    } = params;

    // 기준일: param > weekDates 첫 일자 > 오늘
    const refStr = referenceDate
        || (() => {
            const firstDay = orderedSelectedDays[0];
            const d = firstDay && weekDates[firstDay]?.date;
            if (d) {
                const y = d.getFullYear();
                const m = String(d.getMonth() + 1).padStart(2, '0');
                const dd = String(d.getDate()).padStart(2, '0');
                return `${y}-${m}-${dd}`;
            }
            // 기준일 폴백도 **KST 오늘**(서버는 UTC라 한국 새벽에 어제가 찍힌다).
            return kstToday();
        })();

    // ─── 한 워크시트(탭) 렌더링 헬퍼 ───
    // 전체 시트와 강사별 시트가 동일한 그리기 로직을 공유한다.
    //   sheetClasses      : 이 탭에 그릴 수업 목록 (전체 or 강사별로 필터된 것)
    //   sheetNameOverride : 탭 이름 (없으면 "과목 주차")
    //   sheetResources    : 표시할 리소스(강사 컬럼) 목록 (강사별 탭은 [강사명] 1개만)
    // 반환: { safeSheetName, metaEntries } — _meta(라운드트립) 작성용
    const buildSheet = (
        sheetClasses: TimetableClass[],
        sheetNameOverride?: string,
        sheetResources?: string[],
    ) => {
        // 본문 전체가 참조하는 변수를 인자로 shadow (알고리즘 무변경)
        const filteredClasses = sheetClasses;
        const allResources = sheetResources ?? params.allResources;

        // 시트명: 과목 + 주차 (전체 탭) 또는 강사명 (강사별 탭)
        const safeSheetName = (sheetNameOverride ?? `${subjectFilter || '수학'} ${weekLabel}`)
            .replace(/[\\/:*?"\[\]]/g, '_').slice(0, 31);
        const sheet = workbook.addWorksheet(safeSheetName, {
            views: [{ state: 'frozen', xSplit: 1, ySplit: 4 }],
        });

    // 그룹 분류
    const monThuDays = orderedSelectedDays.filter(d => d === '월' || d === '목');
    const tueFriDays = orderedSelectedDays.filter(d => d === '화' || d === '금');
    const hasWed = orderedSelectedDays.includes('수');
    const hasSat = orderedSelectedDays.includes('토');
    const hasSun = orderedSelectedDays.includes('일');
    const weekendDaysList = [hasSat ? '토' : null, hasSun ? '일' : null].filter(Boolean) as string[];

    // 리소스 → 요일 lookup
    const resourceDayLookup = new Map<string, Set<string>>();
    filteredClasses.forEach(cls => {
        (cls.schedule || []).forEach(slot => {
            if (typeof slot !== 'string') return;
            const parts = slot.trim().split(/\s+/);
            if (parts.length < 2) return;
            const day = parts[0];
            const normalizedPeriod = LEGACY_TO_UNIFIED_PERIOD_MAP[parts[1]] || parts[1];
            const slotKey = `${day}-${normalizedPeriod}`;
            const resource = cls.slotTeachers?.[slotKey] || cls.teacher;
            const trimmed = resource?.trim();
            if (!trimmed) return;
            if (!resourceDayLookup.has(trimmed)) resourceDayLookup.set(trimmed, new Set());
            resourceDayLookup.get(trimmed)!.add(day);
        });
    });

    const getResourcesForDays = (days: string[]) => {
        const out: { resource: string; days: string[] }[] = [];
        allResources.forEach(resource => {
            const has = days.filter(d => resourceDayLookup.get(resource?.trim())?.has(d));
            if (has.length > 0) out.push({ resource, days: has });
        });
        return out;
    };

    const weekdayGroups: GroupSpec[] = [];
    if (monThuDays.length > 0) {
        const r = getResourcesForDays(monThuDays);
        if (r.length > 0) weekdayGroups.push({ title: '월/목', days: monThuDays, resources: r });
    }
    if (tueFriDays.length > 0) {
        const r = getResourcesForDays(tueFriDays);
        if (r.length > 0) weekdayGroups.push({ title: '화/금', days: tueFriDays, resources: r });
    }
    if (hasWed) {
        const r = getResourcesForDays(['수']);
        if (r.length > 0) weekdayGroups.push({ title: '수', days: ['수'], resources: r });
    }

    const weekdayGroupColCounts = weekdayGroups.map(g => g.resources.reduce((acc, r) => acc + r.days.length, 0));
    const totalWeekdayDayCols = weekdayGroupColCounts.reduce((a, b) => a + b, 0);

    const weekendResources = weekendDaysList.length > 0 ? getResourcesForDays(weekendDaysList) : [];
    const totalWeekendDayCols = weekendResources.reduce((a, r) => a + r.days.length, 0);
    const hasWeekend = weekendResources.length > 0;

    const WEEKDAY_PERIOD_COL = 1;
    const WEEKDAY_FIRST_DAY_COL = 2;
    const WEEKDAY_LAST_DAY_COL = 1 + totalWeekdayDayCols;
    const WEEKEND_PERIOD_COL = hasWeekend ? WEEKDAY_LAST_DAY_COL + 1 : 0;
    const WEEKEND_FIRST_DAY_COL = hasWeekend ? WEEKEND_PERIOD_COL + 1 : 0;
    const WEEKEND_LAST_DAY_COL = hasWeekend ? WEEKEND_PERIOD_COL + totalWeekendDayCols : 0;
    const totalCols = hasWeekend ? WEEKEND_LAST_DAY_COL : WEEKDAY_LAST_DAY_COL;

    const weekdayGroupStartCols: number[] = [];
    {
        let acc = WEEKDAY_FIRST_DAY_COL;
        for (let i = 0; i < weekdayGroups.length; i++) {
            weekdayGroupStartCols.push(acc);
            acc += weekdayGroupColCounts[i];
        }
    }

    // 열 너비 (ExcelJS 문자 단위 — Google Sheets에서 약 width*7 px)
    // - 교시 열: 약 80px (시간 표기가 잘리지 않게)
    // - 평일 요일 열: 약 52px (월/목·화/금은 2열 병합이라 좁아도 균형)
    // - 수요일·주말 열: 약 104px (단독 요일이라 2배 너비)
    const PERIOD_COL_W = 11.5; // 교시 열 — 약 80px
    const DAY_COL_W = 7.5;     // 평일 요일 열 — 약 52px
    const WED_COL_W = 15;      // 수요일·주말 단독 요일 — 약 104px

    sheet.getColumn(WEEKDAY_PERIOD_COL).width = PERIOD_COL_W;
    for (let c = WEEKDAY_FIRST_DAY_COL; c <= WEEKDAY_LAST_DAY_COL; c++) {
        sheet.getColumn(c).width = DAY_COL_W;
    }
    // 수요일 그룹 컬럼은 넓게 (단독 요일)
    weekdayGroups.forEach((group, gi) => {
        if (group.title === '수') {
            const startCol = weekdayGroupStartCols[gi];
            const colCount = weekdayGroupColCounts[gi];
            for (let c = startCol; c < startCol + colCount; c++) {
                sheet.getColumn(c).width = WED_COL_W;
            }
        }
    });
    if (hasWeekend) {
        sheet.getColumn(WEEKEND_PERIOD_COL).width = PERIOD_COL_W;
        // 주말 요일(토/일)도 단독 요일이라 수요일과 동일하게 넓게
        for (let c = WEEKEND_FIRST_DAY_COL; c <= WEEKEND_LAST_DAY_COL; c++) {
            sheet.getColumn(c).width = WED_COL_W;
        }
    }

    // ─── 전체 학생 집계 (상단 합계 행용) ───
    const refMs0 = new Date(refStr).getTime();
    // 주차 마지막일(일요일) 기준 — 퇴원 미래/과거 분기 및 30일 윈도우 통일
    const weekEndStr0 = (() => {
        const d = new Date(refStr);
        d.setDate(d.getDate() + 6);
        const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, '0'); const dd = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${dd}`;
    })();
    const weekEndMs0 = new Date(weekEndStr0).getTime();
    // 학생 dedupe: 한 학생이 여러 반에 있으면 "최고 상태(재원>대기>퇴원)"를 대표로 채택
    // (TimetableHeader studentCounts와 동일 — A반 퇴원 + B반 재원이면 재원으로 집계)
    const getStatusRank = (s: any): number => {
        if (!s.withdrawalDate && !s.onHold) return 3; // 재원
        if (s.onHold && !s.withdrawalDate) return 2;  // 대기
        return s.isTransferred ? 0 : 1;               // 퇴원 (숨김 0 / 대표 1)
    };
    const allStudentsAggMap = new Map<string, any>();
    filteredClasses.forEach(c => {
        (c.studentList || []).forEach((s: any) => {
            if (!s.id) return;
            const existing = allStudentsAggMap.get(s.id);
            if (!existing || getStatusRank(s) > getStatusRank(existing)) {
                allStudentsAggMap.set(s.id, s);
            }
        });
    });

    let totalActive = 0, totalHold = 0, totalWithdrawn = 0, totalNew30 = 0, totalTransferIn = 0;
    allStudentsAggMap.forEach((s: any) => {
        const isFutureWithdrawal = s.withdrawalDate && s.withdrawalDate > weekEndStr0;
        const hasActiveWithdrawal = s.withdrawalDate && s.withdrawalDate <= weekEndStr0 && !s.isTransferred;
        if (hasActiveWithdrawal) {
            const daysSince = Math.floor((weekEndMs0 - new Date(s.withdrawalDate).getTime()) / 86400000);
            if (daysSince <= 30) totalWithdrawn++;
        } else if (s.onHold && !s.withdrawalDate) {
            totalHold++;
        } else if (!s.withdrawalDate || isFutureWithdrawal) {
            totalActive++;
            if (s.isTransferredIn) totalTransferIn++;
            const baseDate = s.firstSubjectEnrollmentDate || s.enrollmentDate;
            if (baseDate && !s.isTransferredIn) {
                const days = Math.ceil((refMs0 - new Date(baseDate).getTime()) / 86400000);
                if (days <= 30) totalNew30++;
            }
        }
    });

    // ─── Row 1: 합계 행 ───
    let rowIdx = 1;
    const summaryRow = rowIdx++;
    sheet.getRow(summaryRow).height = 24;
    sheet.mergeCells(summaryRow, 1, summaryRow, totalCols);
    const sumCell = sheet.getCell(summaryRow, 1);
    // 생성 시각 (HH:mm, 24시간) — 시트가 언제 갱신됐는지 가독성
    // 생성 시각도 **KST** — 서버가 UTC라 로컬 게터로 찍으면 시트에 9시간 이른 시각이 남는다.
    const genHHmm = kstTimeOf(new Date()) ?? '00:00';
    sumCell.value = `${subjectFilter || '수학'} ${weekLabel}    |    재원 ${totalActive}명    |    신입(30일) ${totalNew30}명    |    반이동 ${totalTransferIn}명    |    대기 ${totalHold}명    |    퇴원 ${totalWithdrawn}명    |    기준일: ${refStr} ${genHHmm}`;
    sumCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF111827' } };
    sumCell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11, name: 'Malgun Gothic' };
    sumCell.alignment = { horizontal: 'center', vertical: 'middle' };
    sumCell.border = { top: MEDIUM, bottom: THICK, left: MEDIUM, right: MEDIUM };

    // ─── Row 2: Group titles ───
    const groupTitleRow = rowIdx++;
    sheet.getRow(groupTitleRow).height = 22;

    weekdayGroups.forEach((group, gi) => {
        const startCol = weekdayGroupStartCols[gi];
        const endCol = startCol + weekdayGroupColCounts[gi] - 1;
        if (endCol > startCol) sheet.mergeCells(groupTitleRow, startCol, groupTitleRow, endCol);
        const cell = sheet.getCell(groupTitleRow, startCol);
        cell.value = group.title;
        const color = GROUP_COLORS[group.title] || { bg: 'FF6B7280', light: 'FFF3F4F6' };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color.bg } };
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 12 };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = { top: MEDIUM, bottom: THIN, left: MEDIUM, right: MEDIUM };
    });
    if (hasWeekend) {
        if (WEEKEND_LAST_DAY_COL > WEEKEND_FIRST_DAY_COL) {
            sheet.mergeCells(groupTitleRow, WEEKEND_FIRST_DAY_COL, groupTitleRow, WEEKEND_LAST_DAY_COL);
        }
        const cell = sheet.getCell(groupTitleRow, WEEKEND_FIRST_DAY_COL);
        cell.value = '주말';
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GROUP_COLORS['주말'].bg } };
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 12 };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = { top: MEDIUM, bottom: THIN, left: MEDIUM, right: MEDIUM };
    }

    // ─── Rows 2-3: Teacher + Day ───
    const teacherRow = rowIdx++;
    const dayRow = rowIdx++;
    sheet.getRow(teacherRow).height = 22;
    sheet.getRow(dayRow).height = 28;

    sheet.mergeCells(teacherRow, WEEKDAY_PERIOD_COL, dayRow, WEEKDAY_PERIOD_COL);
    const wdPH = sheet.getCell(teacherRow, WEEKDAY_PERIOD_COL);
    wdPH.value = '교시';
    wdPH.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
    wdPH.font = { bold: true, color: { argb: 'FF000000' } };
    wdPH.alignment = { horizontal: 'center', vertical: 'middle' };
    wdPH.border = { top: MEDIUM, bottom: THICK, left: MEDIUM, right: THICK };

    const renderTeacherDayRow = (
        groups: GroupSpec[],
        groupStartCols: number[],
        groupColCounts: number[],
    ) => {
        groups.forEach((group, gi) => {
            let col = groupStartCols[gi];
            group.resources.forEach(({ resource, days }) => {
                const teacherData = teachers.find(t => t.name === resource);
                const bg = hexToARGB(teacherData?.bgColor, 'FF3B82F6');
                const fg = hexToARGB(teacherData?.textColor, 'FFFFFFFF');
                const sc = col;
                const ec = col + days.length - 1;
                if (days.length > 1) sheet.mergeCells(teacherRow, sc, teacherRow, ec);
                const tCell = sheet.getCell(teacherRow, sc);
                tCell.value = resource;
                tCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
                tCell.font = { bold: true, color: { argb: fg }, size: 11 };
                tCell.alignment = { horizontal: 'center', vertical: 'middle' };
                tCell.border = { top: THIN, bottom: THIN, left: gi === 0 && col === groupStartCols[0] ? MEDIUM : THIN, right: THICK };
                days.forEach((day, di) => {
                    const dCell = sheet.getCell(dayRow, col + di);
                    const dateInfo = weekDates[day];
                    dCell.value = dateInfo ? `${day}\n${dateInfo.formatted}` : day;
                    const isWeekend = day === '토' || day === '일';
                    const dayBg = isWeekend ? 'FFFFF7ED' : day === '수' ? 'FFF0FDF4' : 'FFF3F4F6';
                    dCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: dayBg } };
                    dCell.font = { bold: true, color: { argb: 'FF000000' }, size: 10 };
                    dCell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
                    const isLastInGroup = di === days.length - 1;
                    const groupEndCol = groupStartCols[gi] + groupColCounts[gi] - 1;
                    dCell.border = {
                        top: THIN,
                        bottom: THICK,
                        left: di === 0 && col === groupStartCols[gi] ? MEDIUM : THIN,
                        right: isLastInGroup && col + days.length - 1 === groupEndCol
                            ? MEDIUM : isLastInGroup ? THICK : THIN,
                    };
                });
                col = ec + 1;
            });
        });
    };

    renderTeacherDayRow(weekdayGroups, weekdayGroupStartCols, weekdayGroupColCounts);

    if (hasWeekend) {
        sheet.mergeCells(teacherRow, WEEKEND_PERIOD_COL, dayRow, WEEKEND_PERIOD_COL);
        const weH = sheet.getCell(teacherRow, WEEKEND_PERIOD_COL);
        weH.value = '교시';
        weH.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GROUP_COLORS['주말'].light } };
        weH.font = { bold: true, color: { argb: 'FF000000' } };
        weH.alignment = { horizontal: 'center', vertical: 'middle' };
        weH.border = { top: MEDIUM, bottom: THICK, left: MEDIUM, right: THICK };

        const weekendGroup: GroupSpec = { title: '주말', days: weekendDaysList, resources: weekendResources };
        renderTeacherDayRow([weekendGroup], [WEEKEND_FIRST_DAY_COL], [totalWeekendDayCols]);
    }

    // ════════════════════════════════════════════════════════════════
    //  고정 행 시간 그리드 모델
    //  - 평일·주말 모두 1시간 단위 슬롯 8개 (1-1, 1-2, ..., 4-2)
    //  - 1슬롯 = 고정 SLOT_ROWS 행 → 교시(2슬롯) = GROUP_ROWS 행
    //  - 평일: 1교시(2슬롯) 블록 단위로 렌더 (수업명·강의실 시각 묶음)
    //  - 주말: 슬롯 단위 + getConsecutiveSpan 으로 N슬롯 세로 병합 → 학생 1회 표시
    //  - 평일 1교시 ↔ 주말 2슬롯이 같은 행 범위를 공유 → 시간 정렬 자동
    // ════════════════════════════════════════════════════════════════
    const SLOT_ROWS = 12;                 // 1시간 슬롯당 고정 행 수
    const GROUP_ROWS = SLOT_ROWS * 2;     // 1교시(2슬롯) = 24행

    // 평일 교시 블록 내부 섹션 행 배분 (합계 = GROUP_ROWS)
    //   수업명 2 / 강의실 1 / 재원헤더 1 / 재원 14 / 대기헤더 1 / 대기 2 / 퇴원헤더 1 / 퇴원 1 / 카운트 1 = 24
    const WD_NAME_ROWS = 2;
    const WD_ROOM_ROWS = 1;
    const WD_ACTIVE_HEADER_ROWS = 1;
    const WD_ACTIVE_ROWS = 14;
    const WD_HOLD_HEADER_ROWS = 1;
    const WD_HOLD_ROWS = 2;
    const WD_WITHDRAWN_HEADER_ROWS = 1;
    const WD_WITHDRAWN_ROWS = 1;
    const WD_COUNT_ROWS = 1;

    // 평일 8슬롯(legacy id) — getConsecutiveSpan/shouldSkipCell 의 periods 인자
    const WEEKDAY_SLOTS = currentPeriods.slice();  // 수학: MATH_PERIODS = ['1-1'..'4-2']

    // 평일 교시 그룹 사전 계산
    const weekdayPeriodGroups = MATH_GROUPED_PERIODS
        .map(gid => {
            const periodIds = MATH_GROUP_PERIOD_IDS[gid];
            const [firstPeriod, secondPeriod] = periodIds;
            const hasFirst = currentPeriods.includes(firstPeriod);
            const hasSecond = currentPeriods.includes(secondPeriod);
            if (!hasFirst && !hasSecond) return null;
            return { gid, firstPeriod, secondPeriod, hasFirst, hasSecond, info: MATH_GROUP_DISPLAY[gid] };
        })
        .filter(Boolean) as Array<{
            gid: string; firstPeriod: string; secondPeriod: string;
            hasFirst: boolean; hasSecond: boolean; info: { label: string; time: string };
        }>;

    // ─── 완전 빈 (강사×요일) 컬럼 탐지 ───
    // 평일: 모든 교시·서브교시에 수업 없으면 fully-empty
    const fullyEmptyWeekdayCols = new Set<number>();
    weekdayGroups.forEach((group, gi) => {
        let col = weekdayGroupStartCols[gi];
        group.resources.forEach(({ resource, days }) => {
            days.forEach(day => {
                const hasAny = weekdayPeriodGroups.some(pg => {
                    const f = pg.hasFirst ? getClassesForCell(filteredClasses, day, pg.firstPeriod, resource, 'teacher') : [];
                    const s = pg.hasSecond ? getClassesForCell(filteredClasses, day, pg.secondPeriod, resource, 'teacher') : [];
                    return f.length > 0 || s.length > 0;
                });
                if (!hasAny) fullyEmptyWeekdayCols.add(col);
                col++;
            });
        });
    });

    // 주말 8슬롯 — 평일과 동일한 1시간 단위 슬롯. getConsecutiveSpan 의 periods 인자
    const weekendPeriods = currentPeriods.filter(p => WEEKEND_PERIOD_TIMES[p]);

    // 주말 교시 그룹 (평일 교시 라벨과 세로 정렬용 — 4그룹 = 8슬롯)
    const weekendPeriodGroups = MATH_GROUPED_PERIODS
        .map(gid => {
            const periodIds = MATH_GROUP_PERIOD_IDS[gid];
            const [firstPeriod, secondPeriod] = periodIds;
            const hasFirst = weekendPeriods.includes(firstPeriod);
            const hasSecond = weekendPeriods.includes(secondPeriod);
            if (!hasFirst && !hasSecond) return null;
            const firstTime = WEEKEND_PERIOD_TIMES[firstPeriod] || '';
            const secondTime = WEEKEND_PERIOD_TIMES[secondPeriod] || '';
            const startT = (firstTime || secondTime).split('~')[0] || '';
            const endT = (secondTime || firstTime).split('~')[1] || '';
            return {
                gid, firstPeriod, secondPeriod, hasFirst, hasSecond,
                info: { label: `${gid}교시`, time: `${startT}~${endT}` },
            };
        })
        .filter(Boolean) as Array<{
            gid: string; firstPeriod: string; secondPeriod: string;
            hasFirst: boolean; hasSecond: boolean; info: { label: string; time: string };
        }>;

    const fullyEmptyWeekendCols = new Set<number>();
    if (hasWeekend) {
        let col = WEEKEND_FIRST_DAY_COL;
        weekendResources.forEach(({ resource, days }) => {
            days.forEach(day => {
                const hasAny = weekendPeriods.some(p => {
                    const cls = getClassesForCell(filteredClasses, day, p, resource, 'teacher');
                    return cls.length > 0;
                });
                if (!hasAny) fullyEmptyWeekendCols.add(col);
                col++;
            });
        });
    }

    // ─── 셀 계산 헬퍼: 평일 (교시 그룹 = 2슬롯 묶음) ───
    // 평일 수업은 한 교시(2슬롯) 안에서 끝나므로 교시 그룹 단위로 셀을 만든다.
    const computeWeekdayCells = (pg: typeof weekdayPeriodGroups[0]): ResolvedCell[] => {
        const cells: ResolvedCell[] = [];
        weekdayGroups.forEach((group, gi) => {
            let col = weekdayGroupStartCols[gi];
            const groupEndCol = col + weekdayGroupColCounts[gi] - 1;
            group.resources.forEach(({ resource, days }) => {
                let di = 0;
                while (di < days.length) {
                    const day = days[di];
                    // 완전 빈 컬럼이면 셀 자체를 만들지 않음 (외부에서 세로 병합 처리)
                    if (fullyEmptyWeekdayCols.has(col)) {
                        col++;
                        di++;
                        continue;
                    }
                    const firstCls = pg.hasFirst ? getClassesForCell(filteredClasses, day, pg.firstPeriod, resource, 'teacher') : [];
                    const secondCls = pg.hasSecond ? getClassesForCell(filteredClasses, day, pg.secondPeriod, resource, 'teacher') : [];

                    const mergedSet = new Map<string, TimetableClass>();
                    firstCls.forEach(c => mergedSet.set(c.className, c));
                    secondCls.forEach(c => { if (!mergedSet.has(c.className)) mergedSet.set(c.className, c); });
                    const cellClasses = Array.from(mergedSet.values());

                    let colSpan = 1;
                    if (cellClasses.length > 0 && days.length > 1 && di < days.length - 1) {
                        for (let ni = di + 1; ni < days.length; ni++) {
                            const nDay = days[ni];
                            const nCol = col + (ni - di);
                            // 다음 컬럼이 fully-empty면 병합 금지
                            if (fullyEmptyWeekdayCols.has(nCol)) break;
                            const nFirst = pg.hasFirst ? getClassesForCell(filteredClasses, nDay, pg.firstPeriod, resource, 'teacher') : [];
                            const nSecond = pg.hasSecond ? getClassesForCell(filteredClasses, nDay, pg.secondPeriod, resource, 'teacher') : [];
                            const nMerged = new Map<string, TimetableClass>();
                            nFirst.forEach(c => nMerged.set(c.className, c));
                            nSecond.forEach(c => { if (!nMerged.has(c.className)) nMerged.set(c.className, c); });
                            const nCellClasses = Array.from(nMerged.values());
                            if (isSameClassNameSet(cellClasses, nCellClasses)) {
                                colSpan++;
                            } else {
                                break;
                            }
                        }
                    }

                    // dayCols 계산 (셀이 커버하는 요일들 + 컬럼 매핑)
                    const dayCols: Array<{ day: string; col: number }> = [];
                    const cellDays: string[] = [];
                    for (let k = 0; k < colSpan; k++) {
                        dayCols.push({ day: days[di + k], col: col + k });
                        cellDays.push(days[di + k]);
                    }
                    const payload = buildCellPayload(cellClasses, cellDays, refStr);
                    const startCol = col;
                    const endCol = col + colSpan - 1;
                    cells.push({
                        startCol,
                        endCol,
                        payload,
                        isGroupRightEdge: endCol === groupEndCol,
                        dayCols,
                        subTopClasses: firstCls,
                        subBotClasses: secondCls,
                    });
                    col += colSpan;
                    di += colSpan;
                }
            });
        });
        return cells;
    };

    // ─── 셀 계산 헬퍼: 주말 (1시간 슬롯 단위 + N슬롯 세로 병합) ───
    // 클라이언트 TimetableGrid 주말 렌더와 동일:
    //   - 각 슬롯(1시간)을 순회하며 getConsecutiveSpan 으로 연속 슬롯 수 계산
    //   - shouldSkipCell 로 이미 위 슬롯 병합 범위에 포함된 슬롯은 skip
    //   - 같은 className 세트 + 같은 span 인 이웃 요일은 가로 병합
    const computeWeekendCells = (): WeekendCell[] => {
        const cells: WeekendCell[] = [];
        if (!hasWeekend) return cells;
        const groupEndCol = WEEKEND_LAST_DAY_COL;

        // (resource,day) → 컬럼 매핑
        const dayColMap = new Map<string, number>();
        {
            let col = WEEKEND_FIRST_DAY_COL;
            weekendResources.forEach(({ resource, days }) => {
                days.forEach(day => {
                    dayColMap.set(`${resource}__${day}`, col);
                    col++;
                });
            });
        }

        weekendResources.forEach(({ resource, days }) => {
            for (let si = 0; si < weekendPeriods.length; si++) {
                const slot = weekendPeriods[si];
                let di = 0;
                while (di < days.length) {
                    const day = days[di];
                    const col = dayColMap.get(`${resource}__${day}`)!;
                    if (fullyEmptyWeekendCols.has(col)) {
                        di++;
                        continue;
                    }
                    const cellClasses = getClassesForCell(filteredClasses, day, slot, resource, 'teacher');

                    // 수직 병합 skip: 위 슬롯의 병합 범위에 포함되면 건너뜀
                    const skip = cellClasses.some(cls =>
                        shouldSkipCell(cls, day, si, cellClasses, weekendPeriods, filteredClasses, 'teacher')
                    );
                    if (skip) {
                        di++;
                        continue;
                    }

                    // 수직 병합 span (이 수업이 몇 슬롯 연속인지)
                    const slotSpan = Math.max(1, ...cellClasses.map(cls =>
                        getConsecutiveSpan(cls, day, si, weekendPeriods, filteredClasses, 'teacher')
                    ));

                    // 가로 병합: 같은 className 세트 + 같은 span 인 이웃 요일
                    let colSpan = 1;
                    if (cellClasses.length > 0) {
                        for (let ni = di + 1; ni < days.length; ni++) {
                            const nDay = days[ni];
                            const nCol = dayColMap.get(`${resource}__${nDay}`)!;
                            if (fullyEmptyWeekendCols.has(nCol)) break;
                            const nClasses = getClassesForCell(filteredClasses, nDay, slot, resource, 'teacher');
                            if (nClasses.length === 0) break;
                            if (!isSameClassNameSet(cellClasses, nClasses)) break;
                            const nSpan = Math.max(1, ...nClasses.map(c =>
                                getConsecutiveSpan(c, nDay, si, weekendPeriods, filteredClasses, 'teacher')
                            ));
                            if (nSpan !== slotSpan) break;
                            colSpan++;
                        }
                    }

                    const dayCols: Array<{ day: string; col: number }> = [];
                    const cellDays: string[] = [];
                    for (let k = 0; k < colSpan; k++) {
                        dayCols.push({ day: days[di + k], col: col + k });
                        cellDays.push(days[di + k]);
                    }
                    const payload = buildCellPayload(cellClasses, cellDays, refStr);
                    const endCol = col + colSpan - 1;
                    cells.push({
                        startCol: col,
                        endCol,
                        slotIndex: si,
                        slotSpan,
                        payload,
                        isGroupRightEdge: endCol === groupEndCol,
                        dayCols,
                    });
                    di += colSpan;
                }
            }
        });
        return cells;
    };

    const refDateMs = new Date(refStr).getTime();

    // ─── 라운드트립 메타데이터 (Phase 1) ───
    // 가져오기 시 셀 위치 ↔ 의미 매핑 복원용. _meta hidden 시트로 출력.
    // 학생 추가/삭제/이동 + 반이름 변경 + 수업 색상 변경 감지.
    type MetaEntry = {
        kind: 'class_name' | 'class_room' | 'student';
        row: number;
        startCol: number;
        endCol: number;
        section?: 'active' | 'hold' | 'withdrawn';     // student kind 전용
        subPeriod?: 'top' | 'bot' | 'both';            // class_name/class_room 전용
        classId?: string;                              // 수업 식별
        classNameSnapshot?: string;                    // 수업명 (라운드트립 비교용)
        roomSnapshot?: string;                         // 강의실 (라운드트립 비교용)
        studentId?: string;                            // 학생 식별
        studentNameSnapshot?: string;                  // 학생 표시 텍스트 (라운드트립 비교용)
        sourceClassId?: string;                        // 학생이 속한 수업 (이동 감지용)
        bgColorSnapshot?: string;                      // class_name 셀 배경 ARGB (색상 변경 감지용)
        textColorSnapshot?: string;                    // class_name 셀 글자 ARGB
    };
    const metaEntries: MetaEntry[] = [];

    // 셀의 sub-period 구조: 상/하가 다른 수업이면 분할 필요
    const cellNeedsSubSplit = (c: ResolvedCell): boolean => {
        const topNames = new Set((c.subTopClasses || []).map(cls => cls.className).filter(Boolean) as string[]);
        const botNames = new Set((c.subBotClasses || []).map(cls => cls.className).filter(Boolean) as string[]);
        if (topNames.size !== botNames.size) return true;
        for (const n of topNames) if (!botNames.has(n)) return true;
        return false;
    };

    // ════════════════════════════════════════════════════════════════
    //  고정 행 시간 그리드: 4개 교시 블록 (각 GROUP_ROWS 행)
    //  - 평일·주말에 등장하는 교시 그룹의 합집합을 활성 블록으로 함
    //  - 블록 g 는 bodyStartRow 부터 GROUP_ROWS 단위로 연속 배치
    //  - 슬롯 s (0~7) → 블록 floor(s/2), 블록 내 (s%2) 번째 SLOT_ROWS
    // ════════════════════════════════════════════════════════════════
    const allWeekendCells = computeWeekendCells();

    // 활성 교시 그룹 인덱스 (MATH_GROUPED_PERIODS 의 0~3) — 평일 ∪ 주말
    const weekdayGroupByIdx = new Map<number, typeof weekdayPeriodGroups[0]>();
    weekdayPeriodGroups.forEach(pg => {
        const idx = MATH_GROUPED_PERIODS.indexOf(pg.gid as typeof MATH_GROUPED_PERIODS[number]);
        if (idx >= 0) weekdayGroupByIdx.set(idx, pg);
    });
    const weekendGroupByIdx = new Map<number, typeof weekendPeriodGroups[0]>();
    weekendPeriodGroups.forEach(pg => {
        const idx = MATH_GROUPED_PERIODS.indexOf(pg.gid as typeof MATH_GROUPED_PERIODS[number]);
        if (idx >= 0) weekendGroupByIdx.set(idx, pg);
    });
    // 주말 셀이 시작 슬롯 기준으로 어느 교시 그룹에 속하는지도 활성 블록에 반영
    allWeekendCells.forEach(wc => {
        const gIdx = Math.floor(wc.slotIndex / 2);
        if (!weekendGroupByIdx.has(gIdx) && gIdx >= 0 && gIdx < MATH_GROUPED_PERIODS.length) {
            // 라벨용 그룹 정보가 없으면 빈 그룹으로 등록 (라벨은 생략)
            weekendGroupByIdx.set(gIdx, null as any);
        }
    });
    const activeGroupIndices: number[] = [];
    for (let g = 0; g < MATH_GROUPED_PERIODS.length; g++) {
        if (weekdayGroupByIdx.has(g) || weekendGroupByIdx.has(g)) activeGroupIndices.push(g);
    }

    // 본문 시작 row + 각 활성 블록의 시작 row
    const bodyStartRow2 = rowIdx;
    const blockStartRowByGroupIdx = new Map<number, number>();
    activeGroupIndices.forEach((gIdx, order) => {
        blockStartRowByGroupIdx.set(gIdx, bodyStartRow2 + order * GROUP_ROWS);
    });
    const totalBodyRows = activeGroupIndices.length * GROUP_ROWS;
    const bodyEndRow = bodyStartRow2 + totalBodyRows - 1;
    rowIdx = bodyEndRow + 1;

    // 모든 본문 행 높이 지정 (학생 행 16, 헤더/이름 행은 그룹 렌더 시 조정)
    for (let r = bodyStartRow2; r <= bodyEndRow; r++) {
        sheet.getRow(r).height = 16;
    }

    // 슬롯 인덱스(0~7) → 시트 시작 row
    const slotStartRow = (slotIdx: number): number => {
        const gIdx = Math.floor(slotIdx / 2);
        const blockStart = blockStartRowByGroupIdx.get(gIdx);
        if (blockStart == null) return bodyStartRow2;
        return blockStart + (slotIdx % 2) * SLOT_ROWS;
    };

    // ─── 셀 렌더 공통 레이아웃 ───
    interface CellLayout {
        nameTopRow: number;       // 수업명 상단 행
        nameBotRow: number;       // 수업명 하단 행 (분할 시 1-2, 비분할 시 nameTopRow 와 병합)
        roomRow: number;
        activeHeaderRow: number;
        activeStartRow: number;
        activeRows: number;       // 재원 학생 표시 가능 행 수
        holdHeaderRow: number;
        holdStartRow: number;
        holdRows: number;
        withdrawnHeaderRow: number;
        withdrawnStartRow: number;
        withdrawnRows: number;
        countRow: number;
        blockEndRow: number;      // 셀이 차지하는 마지막 행
    }

    // 평일 교시 블록(2슬롯=GROUP_ROWS) 의 고정 섹션 레이아웃
    const weekdayLayout = (blockStart: number): CellLayout => {
        let r = blockStart;
        const nameTopRow = r; r += WD_NAME_ROWS;
        const roomRow = r; r += WD_ROOM_ROWS;
        const activeHeaderRow = r; r += WD_ACTIVE_HEADER_ROWS;
        const activeStartRow = r; r += WD_ACTIVE_ROWS;
        const holdHeaderRow = r; r += WD_HOLD_HEADER_ROWS;
        const holdStartRow = r; r += WD_HOLD_ROWS;
        const withdrawnHeaderRow = r; r += WD_WITHDRAWN_HEADER_ROWS;
        const withdrawnStartRow = r; r += WD_WITHDRAWN_ROWS;
        const countRow = r; r += WD_COUNT_ROWS;
        return {
            nameTopRow, nameBotRow: nameTopRow + 1,
            roomRow, activeHeaderRow, activeStartRow, activeRows: WD_ACTIVE_ROWS,
            holdHeaderRow, holdStartRow, holdRows: WD_HOLD_ROWS,
            withdrawnHeaderRow, withdrawnStartRow, withdrawnRows: WD_WITHDRAWN_ROWS,
            countRow, blockEndRow: r - 1,
        };
    };

    // 주말 셀(N슬롯 = N*SLOT_ROWS) 의 적응형 레이아웃
    //   고정: 이름 2 / 강의실 1 / 재원헤더 1 / 카운트 1 = 5
    //   대기/퇴원 섹션은 학생이 있을 때만 행 예약 → 재원 영역 최대화
    const weekendLayout = (cell: WeekendCell): CellLayout => {
        const blockStart = slotStartRow(cell.slotIndex);
        const totalRows = cell.slotSpan * SLOT_ROWS;
        const p = cell.payload;
        const holdCount = p ? cellHoldRowsFromPayload(p) : 0;
        const wdCount = p ? p.withdrawnStudents.length : 0;
        const holdRows = holdCount > 0 ? holdCount : 0;
        const withdrawnRows = wdCount > 0 ? wdCount : 0;
        const holdHeader = holdRows > 0 ? 1 : 0;
        const withdrawnHeader = withdrawnRows > 0 ? 1 : 0;
        // 고정 행: 이름2 + 강의실1 + 재원헤더1 + 카운트1 = 5
        const fixed = WD_NAME_ROWS + WD_ROOM_ROWS + WD_ACTIVE_HEADER_ROWS + WD_COUNT_ROWS;
        const reserved = fixed + holdHeader + holdRows + withdrawnHeader + withdrawnRows;
        const activeRows = Math.max(1, totalRows - reserved);

        let r = blockStart;
        const nameTopRow = r; r += WD_NAME_ROWS;
        const roomRow = r; r += WD_ROOM_ROWS;
        const activeHeaderRow = r; r += WD_ACTIVE_HEADER_ROWS;
        const activeStartRow = r; r += activeRows;
        const holdHeaderRow = r; r += holdHeader;
        const holdStartRow = r; r += holdRows;
        const withdrawnHeaderRow = r; r += withdrawnHeader;
        const withdrawnStartRow = r; r += withdrawnRows;
        const countRow = blockStart + totalRows - 1;  // 카운트는 항상 맨 마지막 행
        return {
            nameTopRow, nameBotRow: nameTopRow + 1,
            roomRow, activeHeaderRow, activeStartRow, activeRows,
            holdHeaderRow: holdHeader > 0 ? holdHeaderRow : 0,
            holdStartRow, holdRows,
            withdrawnHeaderRow: withdrawnHeader > 0 ? withdrawnHeaderRow : 0,
            withdrawnStartRow, withdrawnRows,
            countRow, blockEndRow: blockStart + totalRows - 1,
        };
    };

    // payload 기준 hold 행 수 (공통 + max 부분 등원)
    function cellHoldRowsFromPayload(p: CellPayload): number {
        const cN = p.hold.common.length;
        const pMax = Math.max(0, ...Object.values(p.hold.partialByDay).map(arr => arr.length));
        return cN + pMax;
    }

    // ─── 통합 셀 렌더 함수 ───
    // weekday/weekend 공통. layout 의 섹션 행 인덱스에 맞춰 그린다.
    const renderCell = (opts: {
        startCol: number;
        endCol: number;
        payload: CellPayload | null;
        isGroupRightEdge: boolean;
        dayCols: Array<{ day: string; col: number }>;
        subTopClasses?: TimetableClass[];
        subBotClasses?: TimetableClass[];
        layout: CellLayout;
        forceSubSplit: boolean;     // 평일: 교시 내 다른 셀이 분할되면 이름 2행 분할 정렬 위해
    }) => {
        const { startCol, endCol, payload, isGroupRightEdge, dayCols, subTopClasses, subBotClasses, layout, forceSubSplit } = opts;
        const rightBorder = isGroupRightEdge ? MEDIUM : THICK;
        const colSpan = endCol - startCol + 1;
        const L = layout;

        const mergeAndGet = (row: number) => {
            if (colSpan > 1) sheet.mergeCells(row, startCol, row, endCol);
            return sheet.getCell(row, startCol);
        };

        if (!payload) {
            // 빈 셀: 셀 영역 전체 회색 세로/가로 병합
            sheet.mergeCells(L.nameTopRow, startCol, L.blockEndRow, endCol);
            const c = sheet.getCell(L.nameTopRow, startCol);
            c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: EMPTY_BG } };
            c.border = { top: THIN, bottom: THICK, left: THIN, right: rightBorder };
            return;
        }

        const isMergedClass = payload.uniqueClassNames.length > 1;
        const nameBg = payload.bgColor || 'FFFFFFFF';
        const nameFg = payload.textColor || 'FF111827';

        const topNames = Array.from(new Set((subTopClasses || []).map(c => c.className).filter(Boolean) as string[]));
        const botNames = Array.from(new Set((subBotClasses || []).map(c => c.className).filter(Boolean) as string[]));
        // 이 셀이 sub-period 분할 필요한지 (상/하 수업 세트가 다름)
        const splits = (() => {
            if (topNames.length !== botNames.length) return true;
            const bSet = new Set(botNames);
            return topNames.some(n => !bSet.has(n));
        })();
        const cellSplitsSub = forceSubSplit && splits;

        const primaryClassId = payload.classes[0]?.id || '';
        const primaryClassName = payload.uniqueClassNames[0] || '';

        // 1) 수업명 행 (이름 2행 — 비분할 시 병합, 분할 시 위/아래)
        if (!cellSplitsSub) {
            sheet.mergeCells(L.nameTopRow, startCol, L.nameBotRow, endCol);
            const nc = sheet.getCell(L.nameTopRow, startCol);
            nc.value = payload.headerLines
                .map((name, i) => isMergedClass ? `[${i + 1}] ${name}` : name)
                .join('\n');
            nc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: nameBg } };
            nc.font = { bold: true, color: { argb: nameFg }, size: 10 };
            nc.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
            nc.border = { top: THIN, bottom: THIN, left: THIN, right: rightBorder };

            metaEntries.push({
                kind: 'class_name',
                row: L.nameTopRow,
                startCol,
                endCol,
                subPeriod: 'both',
                classId: primaryClassId,
                classNameSnapshot: primaryClassName,
                bgColorSnapshot: nameBg,
                textColorSnapshot: nameFg,
            });
        } else {
            // 위 (1-1)
            if (colSpan > 1) sheet.mergeCells(L.nameTopRow, startCol, L.nameTopRow, endCol);
            const ntc = sheet.getCell(L.nameTopRow, startCol);
            if (topNames.length > 0) {
                const topFirst = (subTopClasses || []).find(c => c.className) || payload.classes[0];
                const topBg = topFirst?.bgColor ? hexToARGB(topFirst.bgColor, 'FFFFFFFF') : nameBg;
                const topFg = topFirst?.textColor ? hexToARGB(topFirst.textColor, 'FF111827') : nameFg;
                ntc.value = topNames.map((name, i) => isMergedClass ? `[${i + 1}] ${name}` : name).join('\n');
                ntc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: topBg } };
                ntc.font = { bold: true, color: { argb: topFg }, size: 10 };
                metaEntries.push({
                    kind: 'class_name',
                    row: L.nameTopRow,
                    startCol,
                    endCol,
                    subPeriod: 'top',
                    classId: topFirst?.id || '',
                    classNameSnapshot: topNames[0] || '',
                    bgColorSnapshot: topBg,
                    textColorSnapshot: topFg,
                });
            } else {
                ntc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: EMPTY_BG } };
            }
            ntc.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
            ntc.border = { top: THIN, bottom: THIN, left: THIN, right: rightBorder };

            // 아래 (1-2)
            if (colSpan > 1) sheet.mergeCells(L.nameBotRow, startCol, L.nameBotRow, endCol);
            const nbc = sheet.getCell(L.nameBotRow, startCol);
            if (botNames.length > 0) {
                const botFirst = (subBotClasses || []).find(c => c.className) || payload.classes[0];
                const botBg = botFirst?.bgColor ? hexToARGB(botFirst.bgColor, 'FFFFFFFF') : nameBg;
                const botFg = botFirst?.textColor ? hexToARGB(botFirst.textColor, 'FF111827') : nameFg;
                nbc.value = botNames.map((name, i) => isMergedClass ? `[${i + 1}] ${name}` : name).join('\n');
                nbc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: botBg } };
                nbc.font = { bold: true, color: { argb: botFg }, size: 10 };
                metaEntries.push({
                    kind: 'class_name',
                    row: L.nameBotRow,
                    startCol,
                    endCol,
                    subPeriod: 'bot',
                    classId: botFirst?.id || '',
                    classNameSnapshot: botNames[0] || '',
                    bgColorSnapshot: botBg,
                    textColorSnapshot: botFg,
                });
            } else {
                nbc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: EMPTY_BG } };
            }
            nbc.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
            nbc.border = { top: THIN, bottom: THIN, left: THIN, right: rightBorder };
        }
        sheet.getRow(L.nameTopRow).height = 22;
        sheet.getRow(L.nameBotRow).height = 22;

        // 2) 강의실 행
        const rc = mergeAndGet(L.roomRow);
        const roomText = payload.roomLines.filter(r => r).join(' / ');
        rc.value = roomText;
        rc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
        rc.font = { color: { argb: 'FF374151' }, size: 9 };
        rc.alignment = { horizontal: 'center', vertical: 'middle' };
        rc.border = { top: THIN, bottom: THIN, left: THIN, right: rightBorder };
        sheet.getRow(L.roomRow).height = 16;
        metaEntries.push({
            kind: 'class_room',
            row: L.roomRow,
            startCol,
            endCol,
            classId: primaryClassId,
            roomSnapshot: roomText,
        });

        // 3) 재원 헤더
        const ah = mergeAndGet(L.activeHeaderRow);
        if (payload.activeTotal > 0) {
            ah.value = `${payload.activeTotal}명 - 재원생`;
            ah.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF2FF' } };
            ah.font = { bold: true, color: { argb: 'FF4F46E5' }, size: 9 };
        } else {
            ah.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
        }
        ah.alignment = { horizontal: 'center', vertical: 'middle' };
        ah.border = { top: THIN, bottom: THIN, left: THIN, right: rightBorder };
        sheet.getRow(L.activeHeaderRow).height = 18;

        // 4) 재원 학생 행: 공통(가로병합) + 부분 등원(요일 컬럼)
        const commonActive = payload.active.common;
        const partialActive = payload.active.partialByDay;
        const partialActiveMax = Math.max(0, ...Object.values(partialActive).map(arr => arr.length));
        const usedActive = commonActive.length + partialActiveMax;
        if (usedActive > L.activeRows) {
            console.warn(`[excelExport] 재원 학생 ${usedActive}명이 고정 행(${L.activeRows})을 초과 — 일부 잘림 (반: ${primaryClassName})`);
        }

        for (let i = 0; i < L.activeRows; i++) {
            const row = L.activeStartRow + i;
            if (i < commonActive.length) {
                const c = mergeAndGet(row);
                const meta = commonActive[i];
                const style = resolveStudentStyle(meta.student, refDateMs);
                const textVal = formatStudentRowText(meta, isMergedClass);
                c.value = textVal;
                applyMemo(c, meta.student.name);
                c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: style.bgARGB } };
                c.font = { bold: style.bold, color: { argb: style.fgARGB }, size: 9, name: 'Malgun Gothic' };
                c.alignment = { horizontal: 'left', vertical: 'middle', indent: 1, shrinkToFit: true };
                c.border = { top: THIN, bottom: THIN, left: THIN, right: rightBorder };
                metaEntries.push({
                    kind: 'student',
                    row,
                    startCol,
                    endCol,
                    section: 'active',
                    studentId: meta.student.id || '',
                    studentNameSnapshot: textVal,
                    sourceClassId: primaryClassId,
                });
            } else if (i < commonActive.length + partialActiveMax) {
                const pIdx = i - commonActive.length;
                dayCols.forEach(({ day, col }, dci) => {
                    const dayList = partialActive[day] || [];
                    const cc = sheet.getCell(row, col);
                    if (pIdx < dayList.length) {
                        const meta = dayList[pIdx];
                        const style = resolveStudentStyle(meta.student, refDateMs);
                        const textVal = formatStudentRowText(meta, isMergedClass);
                        cc.value = textVal;
                        applyMemo(cc, meta.student.name);
                        cc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: style.bgARGB } };
                        cc.font = { bold: style.bold, color: { argb: style.fgARGB }, size: 9, name: 'Malgun Gothic' };
                        metaEntries.push({
                            kind: 'student',
                            row,
                            startCol: col,
                            endCol: col,
                            section: 'active',
                            studentId: meta.student.id || '',
                            studentNameSnapshot: textVal,
                            sourceClassId: primaryClassId,
                        });
                    } else {
                        cc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
                    }
                    // 분리등원(단일 요일 열)은 폭이 공통 병합셀의 절반이라 shrinkToFit이면 폰트가 더 축소돼
                    // 다른 학생보다 글씨가 작아진다(사용자 제보). shrinkToFit 제거 → 공통과 동일 size 9 유지
                    // (긴 이름은 이웃 요일칸으로 넘침/잘림 — ijw 클라 truncate와 동일 취지).
                    cc.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
                    cc.border = {
                        top: THIN,
                        bottom: THIN,
                        left: THIN,
                        right: dci === dayCols.length - 1 ? rightBorder : THIN,
                    };
                });
            } else {
                // 빈 행 (정렬용)
                const c = mergeAndGet(row);
                c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
                c.border = { top: THIN, bottom: THIN, left: THIN, right: rightBorder };
            }
        }

        // 5) 대기 섹션
        if (L.holdHeaderRow > 0 && L.holdRows > 0) {
            const hh = mergeAndGet(L.holdHeaderRow);
            if (payload.holdTotal > 0) {
                hh.value = `${payload.holdTotal}명 - 대기`;
                hh.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF9C3' } };
                hh.font = { bold: true, color: { argb: 'FFCA8A04' }, size: 9 };
            } else {
                hh.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
            }
            hh.alignment = { horizontal: 'center', vertical: 'middle' };
            hh.border = { top: THIN, bottom: THIN, left: THIN, right: rightBorder };
            sheet.getRow(L.holdHeaderRow).height = 18;

            const commonHold = payload.hold.common;
            const partialHold = payload.hold.partialByDay;
            const partialHoldMax = Math.max(0, ...Object.values(partialHold).map(arr => arr.length));

            for (let i = 0; i < L.holdRows; i++) {
                const row = L.holdStartRow + i;
                if (i < commonHold.length) {
                    const c = mergeAndGet(row);
                    const meta = commonHold[i];
                    const textVal = formatStudentRowText(meta, isMergedClass);
                    c.value = textVal;
                    applyMemo(c, meta.student.name);
                    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
                    c.font = { color: { argb: 'FF92400E' }, size: 9, name: 'Malgun Gothic' };
                    c.alignment = { horizontal: 'left', vertical: 'middle', indent: 1, shrinkToFit: true };
                    c.border = { top: THIN, bottom: THIN, left: THIN, right: rightBorder };
                    metaEntries.push({
                        kind: 'student',
                        row,
                        startCol,
                        endCol,
                        section: 'hold',
                        studentId: meta.student.id || '',
                        studentNameSnapshot: textVal,
                        sourceClassId: primaryClassId,
                    });
                } else if (i < commonHold.length + partialHoldMax) {
                    const pIdx = i - commonHold.length;
                    dayCols.forEach(({ day, col }, dci) => {
                        const dayList = partialHold[day] || [];
                        const cc = sheet.getCell(row, col);
                        if (pIdx < dayList.length) {
                            const meta = dayList[pIdx];
                            const textVal = formatStudentRowText(meta, isMergedClass);
                            cc.value = textVal;
                            applyMemo(cc, meta.student.name);
                            cc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
                            cc.font = { color: { argb: 'FF92400E' }, size: 9, name: 'Malgun Gothic' };
                            metaEntries.push({
                                kind: 'student',
                                row,
                                startCol: col,
                                endCol: col,
                                section: 'hold',
                                studentId: meta.student.id || '',
                                studentNameSnapshot: textVal,
                                sourceClassId: primaryClassId,
                            });
                        } else {
                            cc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
                        }
                        // 분리등원(단일 요일 열)은 폭이 공통 병합셀의 절반이라 shrinkToFit이면 폰트가 더 축소돼
                    // 다른 학생보다 글씨가 작아진다(사용자 제보). shrinkToFit 제거 → 공통과 동일 size 9 유지
                    // (긴 이름은 이웃 요일칸으로 넘침/잘림 — ijw 클라 truncate와 동일 취지).
                    cc.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
                        cc.border = {
                            top: THIN,
                            bottom: THIN,
                            left: THIN,
                            right: dci === dayCols.length - 1 ? rightBorder : THIN,
                        };
                    });
                } else {
                    const c = mergeAndGet(row);
                    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
                    c.border = { top: THIN, bottom: THIN, left: THIN, right: rightBorder };
                }
            }
        }

        // 6) 퇴원 섹션 (검정 배경)
        if (L.withdrawnHeaderRow > 0 && L.withdrawnRows > 0) {
            const wh = mergeAndGet(L.withdrawnHeaderRow);
            if (payload.withdrawnStudents.length > 0) {
                wh.value = `${payload.withdrawnStudents.length}명 - 퇴원`;
                wh.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 9 };
            }
            wh.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: WITHDRAWN_BG } };
            wh.alignment = { horizontal: 'center', vertical: 'middle' };
            wh.border = { top: THIN, bottom: THIN, left: THIN, right: rightBorder };
            sheet.getRow(L.withdrawnHeaderRow).height = 18;

            for (let i = 0; i < L.withdrawnRows; i++) {
                const row = L.withdrawnStartRow + i;
                const c = mergeAndGet(row);
                if (i < payload.withdrawnStudents.length) {
                    const meta = payload.withdrawnStudents[i];
                    const textVal = formatStudentRowText(meta, isMergedClass);
                    c.value = textVal;
                    applyMemo(c, meta.student.name);
                    c.font = { color: { argb: 'FFD1D5DB' }, size: 9, name: 'Malgun Gothic' };
                    metaEntries.push({
                        kind: 'student',
                        row,
                        startCol,
                        endCol,
                        section: 'withdrawn',
                        studentId: meta.student.id || '',
                        studentNameSnapshot: textVal,
                        sourceClassId: primaryClassId,
                    });
                }
                c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: WITHDRAWN_BG } };
                c.alignment = { horizontal: 'left', vertical: 'middle', indent: 1, shrinkToFit: true };
                c.border = { top: THIN, bottom: THIN, left: THIN, right: rightBorder };
            }
        }

        // 7) 인원 통계 행 (각 컬럼별 재원 인원수)
        sheet.getRow(L.countRow).height = 20;
        dayCols.forEach(({ day, col }, dci) => {
            const dayCount = commonActive.length + (partialActive[day]?.length || 0);
            const cc = sheet.getCell(L.countRow, col);
            cc.value = dayCount;
            cc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
            cc.font = { bold: true, color: { argb: 'FF111827' }, size: 10 };
            cc.alignment = { horizontal: 'center', vertical: 'middle' };
            cc.border = {
                top: THICK,
                bottom: THICK,
                left: THIN,
                right: dci === dayCols.length - 1 ? rightBorder : THIN,
            };
        });
    };

    // ─── 교시 그룹 블록별 렌더 ───
    activeGroupIndices.forEach(gIdx => {
        const blockStart = blockStartRowByGroupIdx.get(gIdx)!;
        const blockEnd = blockStart + GROUP_ROWS - 1;
        const weekdayPg = weekdayGroupByIdx.get(gIdx);
        const weekendPg = weekendGroupByIdx.get(gIdx);

        // 평일 교시 라벨 (좌측 첫 컬럼) — 블록 전체 세로 병합
        sheet.mergeCells(blockStart, WEEKDAY_PERIOD_COL, blockEnd, WEEKDAY_PERIOD_COL);
        const wpl = sheet.getCell(blockStart, WEEKDAY_PERIOD_COL);
        if (weekdayPg) {
            wpl.value = `${weekdayPg.info.label}\n${weekdayPg.info.time}`;
            wpl.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } };
            wpl.font = { bold: true, color: { argb: 'FF000000' }, size: 11 };
            wpl.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
            wpl.border = { top: THIN, bottom: THICK, left: MEDIUM, right: THICK };
        } else {
            wpl.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFAFAFA' } };
            wpl.border = { top: THIN, bottom: THIN, left: MEDIUM, right: THICK };
        }

        // 주말 교시 라벨
        if (hasWeekend) {
            sheet.mergeCells(blockStart, WEEKEND_PERIOD_COL, blockEnd, WEEKEND_PERIOD_COL);
            const epl = sheet.getCell(blockStart, WEEKEND_PERIOD_COL);
            if (weekendPg) {
                epl.value = `${weekendPg.info.label}\n${weekendPg.info.time}`;
                epl.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GROUP_COLORS['주말'].light } };
                epl.font = { bold: true, color: { argb: 'FF000000' }, size: 11 };
                epl.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
                epl.border = { top: THIN, bottom: THICK, left: MEDIUM, right: THICK };
            } else {
                epl.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFAFAFA' } };
                epl.border = { top: THIN, bottom: THIN, left: MEDIUM, right: THICK };
            }
        }

        // 평일 셀 렌더 — 교시 그룹 단위 고정 레이아웃
        if (weekdayPg) {
            const wdCells = computeWeekdayCells(weekdayPg);
            // 교시 내 어느 셀이라도 sub-period 분할 필요하면 모든 셀 이름 2행 정렬
            const forceSubSplit = wdCells.some(c => c.payload && cellNeedsSubSplit(c));
            const layout = weekdayLayout(blockStart);
            wdCells.forEach(cell => {
                renderCell({
                    startCol: cell.startCol,
                    endCol: cell.endCol,
                    payload: cell.payload,
                    isGroupRightEdge: cell.isGroupRightEdge,
                    dayCols: cell.dayCols,
                    subTopClasses: cell.subTopClasses,
                    subBotClasses: cell.subBotClasses,
                    layout,
                    forceSubSplit,
                });
            });
        }
    });

    // 주말 셀 렌더 — 슬롯 단위 + N슬롯 세로 병합 (블록 경계 넘을 수 있음)
    allWeekendCells.forEach(cell => {
        const layout = weekendLayout(cell);
        renderCell({
            startCol: cell.startCol,
            endCol: cell.endCol,
            payload: cell.payload,
            isGroupRightEdge: cell.isGroupRightEdge,
            dayCols: cell.dayCols,
            // 주말은 sub-period 분할 없음 (슬롯=1시간 단위, getConsecutiveSpan 이 병합 처리)
            subTopClasses: cell.payload?.classes || [],
            subBotClasses: cell.payload?.classes || [],
            layout,
            forceSubSplit: false,
        });
    });

    // ─── 완전 빈 (강사×요일) 컬럼 세로 병합 ───
    const lastBodyRow = bodyEndRow;
    fullyEmptyWeekdayCols.forEach(col => {
        if (lastBodyRow >= bodyStartRow2) {
            sheet.mergeCells(bodyStartRow2, col, lastBodyRow, col);
            const c = sheet.getCell(bodyStartRow2, col);
            c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: EMPTY_BG } };
            c.border = { top: THIN, bottom: THICK, left: THIN, right: THICK };
        }
    });
    fullyEmptyWeekendCols.forEach(col => {
        if (lastBodyRow >= bodyStartRow2) {
            sheet.mergeCells(bodyStartRow2, col, lastBodyRow, col);
            const c = sheet.getCell(bodyStartRow2, col);
            c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: EMPTY_BG } };
            c.border = { top: THIN, bottom: THICK, left: THIN, right: THICK };
        }
    });

        return { safeSheetName, metaEntries };
    };
    // ─── buildSheet 끝 ───

    // ① 전체 시트 (기존 동작 그대로 — 모든 강사 컬럼 포함)
    const { safeSheetName, metaEntries } = buildSheet(params.filteredClasses);

    // ② 강사별 시트 — 전체 탭에 표시되는 강사(allResources: 정렬·숨김 이미 반영)마다 탭 1개.
    //    각 탭은 그 강사가 담당하는 수업·컬럼만 포함한다 (allResources=[강사명]).
    //    · 수업이 없는 강사는 스킵
    //    · 시트명 31자/금지문자/중복(_meta·전체탭·동명이인) 처리
    const usedSheetNames = new Set<string>([safeSheetName, '_meta']);
    (params.allResources || []).forEach(resource => {
        const teacherName = (resource || '').trim();
        if (!teacherName) return;
        // 이 강사가 담당하는 수업만 필터 (대표강사 또는 슬롯강사)
        const teacherClasses = params.filteredClasses.filter(c => {
            if ((c.teacher || '').trim() === teacherName) return true;
            const slots = c.slotTeachers || {};
            return Object.values(slots).some(v => (v || '').trim() === teacherName);
        });
        if (teacherClasses.length === 0) return;
        // 시트명 결정 (충돌 시 " (2)" 접미)
        let sheetName = teacherName.replace(/[\\/:*?"\[\]]/g, '_').slice(0, 31);
        let n = 2;
        while (usedSheetNames.has(sheetName)) {
            sheetName = `${teacherName.slice(0, 27)} (${n++})`.slice(0, 31);
        }
        usedSheetNames.add(sheetName);
        buildSheet(teacherClasses, sheetName, [teacherName]);
    });

    // ─── _meta hidden 시트 작성 (라운드트립 가져오기용) ───
    // 첫 행: 스키마 버전 + 워크북 메타 (가져오기 시 호환성 체크용)
    // 헤더 행: 컬럼 이름
    // 본문: metaEntries
    const metaSheet = workbook.addWorksheet('_meta', { state: 'hidden' });
    // 스키마 헤더
    metaSheet.addRow(['__schema_version__', 'subjectFilter', 'weekLabel', 'referenceDate', 'sheetName']);
    metaSheet.addRow(['1', subjectFilter || '수학', weekLabel, refStr, safeSheetName]);
    metaSheet.addRow([]); // 빈 행
    // entry 헤더
    metaSheet.addRow([
        'kind', 'row', 'startCol', 'endCol',
        'section', 'subPeriod',
        'classId', 'classNameSnapshot', 'roomSnapshot',
        'studentId', 'studentNameSnapshot', 'sourceClassId',
        'bgColorSnapshot', 'textColorSnapshot',
    ]);
    metaEntries.forEach(e => {
        metaSheet.addRow([
            e.kind, e.row, e.startCol, e.endCol,
            e.section || '', e.subPeriod || '',
            e.classId || '', e.classNameSnapshot || '', e.roomSnapshot || '',
            e.studentId || '', e.studentNameSnapshot || '', e.sourceClassId || '',
            e.bgColorSnapshot || '', e.textColorSnapshot || '',
        ]);
    });

    // 서버 빌더가 주입한 추가 시트(예: '수강편집' 라운드트립 시트)를 직렬화 직전에 덧붙임.
    await params.appendSheets?.(workbook);

    const buffer = await workbook.xlsx.writeBuffer();

    // Sheets 업로드 모드: ArrayBuffer 반환만 (다운로드 X)
    if (params.returnBufferOnly) {
        return buffer;
    }

    // 다운로드 (기본 모드)
    const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const safeWeekLabel = weekLabel.replace(/[\\/:*?"<>|]/g, '_');
    const filename = `${subjectFilter || '수학'}_시간표_${safeWeekLabel}.xlsx`;
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
