import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import {it,expect,vi,afterEach} from 'vitest';
import {EnrollmentSyncNote} from './enrollment-sync-note';
const m=vi.hoisted(()=>({refresh:vi.fn()}));
vi.mock('next/navigation',()=>({useRouter:()=>({refresh:m.refresh})}));
afterEach(()=>{cleanup();vi.useRealTimers();vi.restoreAllMocks();m.refresh.mockReset();});
const info={students:{syncedAt:'2026-11-03T00:00:00Z',rowCount:100,status:'ok',issue:null},enrollments:null};
it('학생 수집과 수강 연결 수집의 상태를 구분한다',()=>{render(<EnrollmentSyncNote info={info} editing={false}/>);expect(screen.getByText(/수강 자동 수집 기록이 없습니다/)).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'최신 저장정보 반영'}));expect(m.refresh).toHaveBeenCalledOnce();});
it('열린 화면만 자동 갱신하고 기록 편집 중에는 멈춘다',()=>{
  vi.useFakeTimers();vi.spyOn(document,'visibilityState','get').mockReturnValue('visible');
  const r=render(<EnrollmentSyncNote info={info} editing={false}/>);
  vi.advanceTimersByTime(60000);expect(m.refresh).toHaveBeenCalledOnce();
  r.rerender(<EnrollmentSyncNote info={info} editing/>);vi.advanceTimersByTime(120000);expect(m.refresh).toHaveBeenCalledOnce();
  expect(screen.getByRole('button')).toBeDisabled();
});
it('숨겨진 창은 자동 조회하지 않는다',()=>{vi.useFakeTimers();vi.spyOn(document,'visibilityState','get').mockReturnValue('hidden');render(<EnrollmentSyncNote info={info} editing={false}/>);vi.advanceTimersByTime(120000);expect(m.refresh).not.toHaveBeenCalled();});
