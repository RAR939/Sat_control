// src/api/mock/fixtures.ts
//
// Демо-сценарии — реальные примеры из репозитория бэкенда (data/*.json),
// скопированные в public/sample-scenarios/, чтобы их можно было и просто
// загрузить в редакторе (Load Scenario), и использовать в мок-режиме.

export interface SampleScenarioMeta {
  id: string;
  title: string;
  file: string;
}

export const SAMPLE_SCENARIOS: SampleScenarioMeta[] = [
  {
    id: '01_full_constellation',
    title: 'Полная группировка',
    file: '/sample-scenarios/01_full_constellation.json',
  },
  {
    id: '02_first_launch',
    title: 'Первая очередь запуска',
    file: '/sample-scenarios/02_first_launch.json',
  },
  {
    id: '03_satellite_outages',
    title: 'Недоступность десяти аппаратов',
    file: '/sample-scenarios/03_satellite_outages.json',
  },
  {
    id: '04_link_range',
    title: 'Дальность межспутниковой связи 2000 км',
    file: '/sample-scenarios/04_link_range.json',
  },
];

export const DEFAULT_SAMPLE_SCENARIO = SAMPLE_SCENARIOS[0];
