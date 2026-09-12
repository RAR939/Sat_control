// src/utils/routeStatusLabels.ts
//
// Человекочитаемые подписи для RouteStatus (см. types/analysis.ts) — сырые
// значения вроде NO_VISIBLE_SATELLITE предназначены для логики, не для
// показа пользователю напрямую.

import type { RouteStatus } from '../types/analysis';

const LABELS: Record<RouteStatus, string> = {
  OK: 'связь устойчива',
  REBUILT: 'маршрут перестроен',
  NO_VISIBLE_SATELLITE: 'нет видимого спутника',
  GATEWAY_UNAVAILABLE: 'шлюз недоступен',
  NO_GATEWAY_CONNECTION: 'нет связи со шлюзом',
  BROKEN_ISL_NETWORK: 'разрыв межспутниковой сети',
};

export function routeStatusLabel(status: RouteStatus): string {
  return LABELS[status];
}
