// src/components/AvailabilityChart.tsx
//
// Графики availability/outage по данным /api/analysis (п.7 ТЗ), ключ —
// client_id. Верхний график — сводная доступность по клиентам относительно
// target_availability; нижний — связность конкретного клиента во времени
// (по global_states), чтобы видеть форму и причину разрывов.

import Plot from 'react-plotly.js';
import type { AnalysisResult } from '../types/analysis';
import { routeStatusLabel } from '../utils/routeStatusLabels';

interface AvailabilityChartProps {
  analysis: AnalysisResult;
  targetAvailability: number;
  selectedClientId: string | null;
}

export function AvailabilityChart({
  analysis,
  targetAvailability,
  selectedClientId,
}: AvailabilityChartProps) {
  const clientIds = Object.keys(analysis.analysis);
  const availabilities = clientIds.map((c) => analysis.analysis[c].availability_pct);
  const colors = clientIds.map((c) => (analysis.analysis[c].target_met ? '#34d399' : '#f87171'));

  const selected = selectedClientId ? analysis.analysis[selectedClientId] : undefined;

  return (
    <div className="flex flex-col gap-4">
      <div className="border-l-2 border-slate-700 bg-slate-900/40 backdrop-blur-sm p-2">
        <Plot
          data={[
            {
              type: 'bar',
              x: clientIds,
              y: availabilities,
              marker: { color: colors },
              name: 'Доступность',
            },
          ]}
          layout={{
            title: { text: 'Доступность по клиентам' },
            shapes: [
              {
                type: 'line',
                x0: -0.5,
                x1: clientIds.length - 0.5,
                y0: targetAvailability * 100,
                y1: targetAvailability * 100,
                line: { color: '#facc15', dash: 'dash' },
              },
            ],
            yaxis: { title: { text: '%' }, range: [0, 100] },
            paper_bgcolor: 'transparent',
            plot_bgcolor: 'transparent',
            font: { color: '#e2e8f0' },
            margin: { t: 40, b: 40, l: 50, r: 20 },
            height: 260,
          }}
          config={{ displayModeBar: false, responsive: true }}
          style={{ width: '100%' }}
        />
      </div>

      {selected && selectedClientId && (
        <div className="border-l-2 border-slate-700 bg-slate-900/40 backdrop-blur-sm p-2">
          <Plot
            data={[
              {
                type: 'scatter',
                mode: 'lines',
                x: selected.global_states.map((g) => g.t_s),
                y: selected.global_states.map((g) => (g.connected ? 1 : 0)),
                line: { shape: 'hv', color: '#38bdf8' },
                text: selected.global_states.map((g) => routeStatusLabel(g.status)),
                hovertemplate: 'Время: %{x} с — %{text}<extra></extra>',
                name: selectedClientId,
              },
            ]}
            layout={{
              title: { text: `Связность во времени — ${selectedClientId}` },
              yaxis: {
                tickvals: [0, 1],
                ticktext: ['нет связи', 'есть связь'],
                range: [-0.1, 1.1],
              },
              xaxis: { title: { text: 'Время, с' } },
              paper_bgcolor: 'transparent',
              plot_bgcolor: 'transparent',
              font: { color: '#e2e8f0' },
              margin: { t: 40, b: 40, l: 90, r: 20 },
              height: 220,
            }}
            config={{ displayModeBar: false, responsive: true }}
            style={{ width: '100%' }}
          />
        </div>
      )}
    </div>
  );
}
