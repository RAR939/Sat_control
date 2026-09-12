import { useScenarioStore } from './stores/scenarioStore';
import { useUiStore } from './stores/uiStore';
import { isMockMode } from './api/client';
import { EditorPage } from './pages/EditorPage';
import { SimulationPage } from './pages/SimulationPage';
import type { AppTab } from './stores/uiStore';

/** Пульсирующая точка-маяк — минималистичный логотип вместо иконки в рамке. */
function BeaconDot() {
  return (
    <span className="relative flex h-2 w-2 shrink-0">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-70" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-sky-400" />
    </span>
  );
}

interface TabDef {
  id: AppTab;
  label: string;
}

const TABS: TabDef[] = [
  { id: 'editor', label: 'Редактор' },
  { id: 'simulation', label: 'Симуляция' },
];

function App() {
  const activeTab = useUiStore((s) => s.activeTab);
  const setActiveTab = useUiStore((s) => s.setActiveTab);
  const scenario = useScenarioStore((s) => s.scenario);

  return (
    <div className="min-h-screen text-slate-100">
      <header className="sticky top-0 z-20 bg-slate-950/30 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <div className="flex items-baseline gap-2.5">
            <BeaconDot />
            <span className="text-[15px] font-medium tracking-tight text-slate-100">Маяк</span>
            {scenario && (
              <span className="hidden max-w-[16rem] truncate text-xs text-slate-500 sm:inline">
                {scenario.meta.title}
              </span>
            )}
            {isMockMode && <span className="text-xs text-amber-400/70">мок-режим</span>}
          </div>

          <nav className="flex items-center gap-6 text-[13px]">
            {TABS.map((tab) => {
              const disabled = tab.id === 'simulation' && !scenario;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  disabled={disabled}
                  className={`relative pb-0.5 transition disabled:cursor-not-allowed disabled:opacity-30 ${
                    isActive ? 'text-slate-100' : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  {tab.label}
                  <span
                    className={`absolute inset-x-0 -bottom-1 h-px transition-opacity ${
                      isActive ? 'bg-sky-400 opacity-100' : 'opacity-0'
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
