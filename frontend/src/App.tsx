import { useScenarioStore } from './stores/scenarioStore';
import { useUiStore } from './stores/uiStore';
import { isMockMode } from './api/client';
import { EditorPage } from './pages/EditorPage';
import { SimulationPage } from './pages/SimulationPage';
import type { AppTab } from './stores/uiStore';

function OrbitMark() {
  return (
    <div
      className="flex h-9 w-9 shrink-0 items-center justify-center border border-sky-500/50 bg-sky-500/10"
      style={{
        clipPath:
          'polygon(6px 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%, 0 6px)',
      }}
    >
      <svg viewBox="0 0 32 32" className="h-5 w-5" aria-hidden="true">
        <circle cx="16" cy="16" r="3.2" fill="#38bdf8" />
        <ellipse
          cx="16"
          cy="16"
          rx="14"
          ry="5.5"
          fill="none"
          stroke="#38bdf8"
          strokeWidth="1.3"
          opacity="0.9"
        />
        <ellipse
          cx="16"
          cy="16"
          rx="5.5"
          ry="14"
          fill="none"
          stroke="#38bdf8"
          strokeWidth="1.3"
          opacity="0.5"
          transform="rotate(35 16 16)"
        />
        <circle cx="29.2" cy="16" r="1.5" fill="#e2e8f0" />
      </svg>
    </div>
  );
}

interface TabDef {
  id: AppTab;
  label: string;
  index: string;
}

const TABS: TabDef[] = [
  { id: 'editor', label: 'Сценарный редактор', index: '01' },
  { id: 'simulation', label: 'Симуляция / визуализация', index: '02' },
];

function App() {
  const activeTab = useUiStore((s) => s.activeTab);
  const setActiveTab = useUiStore((s) => s.setActiveTab);
  const scenario = useScenarioStore((s) => s.scenario);

  return (
    <div className="min-h-screen text-slate-100">
      <header className="sticky top-0 z-10 border-b border-sky-500/20 bg-slate-950/70 backdrop-blur-md">
        <div className="flex items-center justify-between gap-6 px-6 py-3">
          <div className="flex items-center gap-3">
            <OrbitMark />
            <div className="leading-tight">
              <h1 className="font-mono text-base font-bold tracking-[0.2em] text-slate-100">
                COSMO<span className="text-sky-400">SATS</span>
              </h1>
              <p className="font-mono text-[11px] tracking-wide text-slate-500">
                {scenario
                  ? `${scenario.meta.id} · ${scenario.meta.title}`
                  : 'нет активного сценария'}
              </p>
            </div>
            {isMockMode && (
              <span
                className="ml-1 border border-amber-400/50 bg-amber-400/10 px-2 py-0.5 font-mono text-[10px] tracking-[0.15em] text-amber-300"
                style={{ clipPath: 'polygon(5px 0, 100% 0, 100% 100%, 0 100%, 0 5px)' }}
              >
                MOCK
              </span>
            )}
          </div>

          <nav className="flex items-end gap-6">
            {TABS.map((tab) => {
              const disabled = tab.id === 'simulation' && !scenario;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  disabled={disabled}
                  className={`group relative flex items-center gap-2 pb-3 font-mono text-xs tracking-[0.1em] uppercase transition disabled:cursor-not-allowed disabled:opacity-30 ${
                    isActive ? 'text-sky-300' : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  <span
                    className={`text-[10px] ${isActive ? 'text-sky-500' : 'text-slate-700 group-hover:text-slate-500'}`}
                  >
                    {tab.index}
                  </span>
                  {tab.label}
                  <span
                    className={`absolute inset-x-0 -bottom-px h-0.5 transition-all ${
                      isActive
                        ? 'bg-sky-400 shadow-[0_0_8px_1px_rgba(56,189,248,0.8)]'
                        : 'bg-transparent'
                    }`}
                  />
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      <main className="p-6">{activeTab === 'editor' ? <EditorPage /> : <SimulationPage />}</main>
    </div>
  );
}

export default App;
