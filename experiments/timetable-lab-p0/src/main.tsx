import { createRoot } from 'react-dom/client';
import './style.css';

// 시험용 화면: 편집기 본체는 앱 소스(src/features/timetable-lab/editor)에 있고 여기서는 띄우기만 한다.
const params = new URLSearchParams(location.search), root = createRoot(document.getElementById('root')!);
if (params.has('compare')) {
  const { App } = await import('./comparison-app');
  root.render(<App />);
} else {
  const [{ App }, { DraftStore }, { emptyDraft }, { makeNativeFixture }] = await Promise.all([
    import('@/features/timetable-lab/editor/app'), import('@/features/timetable-lab/editor/store'),
    import('@/features/timetable-lab/editor/model'), import('@/features/timetable-lab/editor/native-fixture'),
  ]);
  const store = new DraftStore(params.has('sample') ? makeNativeFixture() : emptyDraft());
  window.labProbe = store;
  root.render(<App store={store} loginHref="http://127.0.0.1:4320/login" />);
}
