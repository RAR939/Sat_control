// src/components/ObjectDetailsPanel.tsx
//
// Карточка с подробной информацией по клику на спутник или наземную точку
// на глобусе (Globe3D) — состав данных под требование ТЗ "Подписи позволяют
// определить аппарат и его состояние" / "определить спутники, обслуживающие
// наземный пункт".

import type { Scenario } from '../types/scenario';
import type { RoutesMap, Snapshot } from '../types/network-state';
import { cartesianToGeo } from '../utils/geo';
import { pluralize } from '../utils/pluralize';

export type ObjectSelection = { type: 'satellite'; id: string } | { type: 'ground'; id: string };

interface ObjectDetailsPanelProps {
  selection: ObjectSelection;
  scenario: Scenario;
  snapshot: Snapshot | undefined;
  routes: RoutesMap | undefined;
  onClose: () => void;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="text-slate-500">{label}</span>
      <span className="text-right text-slate-200">{value}</span>
    </div>
  );
}

export function ObjectDetailsPanel({
  selection,
  scenario,
  snapshot,
  routes,
  onClose,
}: ObjectDetailsPanelProps) {
  const content = (() => {
    if (selection.type === 'satellite') {
      const design = scenario.design.satellites.find((s) => s.id === selection.id);
      const snap = snapshot?.satellites.find((s) => s.id === selection.id);
      const geo = snap ? cartesianToGeo(snap.x_km, snap.y_km, snap.z_km) : null;
      const servingClients = routes
        ? Object.entries(routes)
            .filter(([, path]) => path.includes(selection.id))
            .map(([clientId]) => clientId)
        : [];

      return (
        <>
          <p className="mb-2 font-mono text-sm font-semibold text-sky-300">
            Спутник {selection.id}
          </p>
          <Row label="Плоскость" value={design?.plane_id ?? '—'} />
          <Row label="Очередь запуска" value={design ? String(design.launch_batch) : '—'} />
          <Row label="Слот в плоскости" value={design ? `${design.slot_deg}°` : '—'} />
          <Row label="Состояние" value={snap?.active ? 'активен' : 'неактивен / отказал'} />
          {geo && (
            <>
              <Row label="Широта" value={`${geo.lat_deg.toFixed(2)}°`} />
              <Row label="Долгота" value={`${geo.lon_deg.toFixed(2)}°`} />
              <Row label="Высота" value={`${geo.alt_km.toFixed(0)} км`} />
            </>
          )}
          <p className="mt-2 text-slate-500">
            {servingClients.length > 0
              ? `Сейчас передаёт данные для: ${servingClients.join(', ')}`
              : 'Сейчас не участвует ни в одном рабочем маршруте'}
          </p>
        </>
      );
    }

    const site = scenario.ground_sites.find((g) => g.id === selection.id);
    if (!site) return null;

    if (site.role === 'client') {
      const path = routes?.[selection.id] ?? [];
      const connected = path.length > 0;
      const visible = snapshot?.visible_sats[selection.id] ?? [];
      return (
        <>
          <p className="mb-2 font-mono text-sm font-semibold text-emerald-300">
            Терминал {site.name} ({site.id})
          </p>
          <Row
            label="Координаты"
            value={`${site.lat_deg.toFixed(2)}°, ${site.lon_deg.toFixed(2)}°`}
          />
          <Row label="Связь сейчас" value={connected ? 'есть' : 'нет'} />
          {connected && (
            <Row
              label="Переходов до шлюза"
              value={`${path.length - 1} ${pluralize(path.length - 1, ['переход', 'перехода', 'переходов'])}`}
            />
          )}
          <Row label="Видимых спутников" value={String(visible.length)} />
          {connected && (
            <p className="mt-2 break-words text-slate-500">Маршрут: {path.join(' → ')}</p>
          )}
        </>
      );
    }

    const status = snapshot?.gateway_status[selection.id];
    return (
      <>
        <p className="mb-2 font-mono text-sm font-semibold text-rose-300">
          Шлюз {site.name} ({site.id})
        </p>
        <Row
          label="Координаты"
          value={`${site.lat_deg.toFixed(2)}°, ${site.lon_deg.toFixed(2)}°`}
        />
        <Row label="В отказе" value={status?.outage ? 'да' : 'нет'} />
        <Row
          label="Геометрически достижим"
          value={status?.geometrically_reachable ? 'да' : 'нет'}
        />
      </>
    );
  })();

  return (
    <div className="w-full shrink-0 border-l-2 border-sky-500/50 bg-slate-900/60 p-4 font-mono text-xs backdrop-blur-sm md:w-64">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10px] tracking-[0.1em] text-slate-500 uppercase">Подробности</span>
        <button
          type="button"
          onClick={onClose}
          className="text-slate-500 transition hover:text-slate-200"
        >
          ✕
        </button>
      </div>
      {content ?? <p className="text-slate-500">Нет данных</p>}
    </div>
  );
}
