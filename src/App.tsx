import { createDemoWorkspace } from './domain/workspace';
export default function App() {
  const workspace = createDemoWorkspace();
  return <main><h1>DeskTwin</h1><p>Your desk, understood.</p><p>{workspace.devices.length}개 예시 기기 · 실제 연결 상태 미확인</p></main>;
}
