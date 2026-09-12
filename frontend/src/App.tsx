import { useScenarioStore } from './stores/scenarioStore';
import { useUiStore } from './stores/uiStore';
import { isMockMode } from './api/client';
import { EditorPage } from './pages/EditorPage';
import { SimulationPage } from './pages/SimulationPage';

function OrbitLogo() {
  return (
    <svg viewBox="0 0 32 32" className="h-7 w-7 shrink-0" aria-hidden="true">
      <circle cx="16" cy="16" r="4" fill="#38bdf8" />
      <ellipse
        cx="16"
        cy="16"
        rx="14"
        ry="6"
        fill="none"
        stroke="url(#orbit-gradient)"
        strokeWidth="1.4"
      />
      <ellipse
        cx="16"
        cy="16"
        rx="6"
        ry="14"
        fill="none"
        stroke="url(#orbit-gradient)"
        strokeWidth="1.4"
        transform="rotate(35 16 16)"
      />
      <circle cx="29" cy="16" r="1.6" fill="#818cf8" />
      <defs>
        <linearGradient id="orbit-gradient" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#38bdf8" />
          <stop offset="100%" stopColor="#818cf8" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function App() {
  const activeTab = useUiStore((s) => s.activeTab);
  const setActiveTab = useUiStore((s) => s.setActiveTab);
  const scenario = useScenarioStore((s) => s.scenario);

  return (
    <div className="min-h-screen text-slate-100">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-800/60 bg-slate-950/60 px-6 py-3 backdrop-blur-md">
        <div className="flex items-center gap-2.5">
          <OrbitLogo />
          <div>
            <h1 className="bg-gradient-to-r from-sky-300 to-indigo-300 bg-clip-text text-lg font-semibold tracking-tight text-transparent">
              CosmoSats
            </h1>
            <p className="text-xs text-slate-400">
              {scenario ? scenario.meta.title : 'Сценарий не загружен'}
              {isMockMode && (
                <span className="ml-2 rounded bg-amber-500/20 px-1.5 py-0.5 text-amber-400">
                  MOCK
                </span>
              )}
            </p>
          </div>
        </div>
        <nav className="flex gap-1 rounded-lg border border-slate-800/60 bg-slate-900/60 p-1">
          <button
            type="button"
            onClick={() => setActiveTab('editor')}
            className={`rounded-md px-3 py-1.5 text-sm transition ${
              activeTab === 'editor'
                ? 'bg-gradient-to-r from-sky-500 to-indigo-500 text-white shadow shadow-sky-500/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Сценарный редактор
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('simulation')}
            disabled={!scenario}
            className={`rounded-md px-3 py-1.5 text-sm transition disabled:cursor-not-allowed disabled:opacity-40 ${
              activeTab === 'simulation'
                ? 'bg-gradient-to-r from-sky-500 to-indigo-500 text-white shadow shadow-sky-500/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Симуляция / визуализация
          </button>
        </nav>
      </header>

      <main className="p-6">{activeTab === 'editor' ? <EditorPage /> : <SimulationPage />}</main>
    </div>
  );
}

export default App;
