// src/types/network-state.ts
//
// Типы для СОСТОЯНИЯ СЕТИ в конкретный момент времени — то, что бэкенд
// сохраняет по п.3 ТЗ ("Сохранение всех состояний системы на заданном
// временном отрезке") и что фронт запрашивает по timestamp для отрисовки
// на 3D-глобусе и в таймлайне.

export type SatelliteStatus = 'active' | 'failed' | 'unavailable';

/** Положение и статус одного спутника на конкретный момент времени */
export interface SatelliteState {
  satelliteId: string;
  status: SatelliteStatus;
  /** Геодезические координаты подспутниковой точки — удобно для 2D/3D рендера на глобусе */
  latitude: number;
  longitude: number;
  altitudeKm: number;
}

/** Линия связи между двумя спутниками, активная в данный момент (ISL) */
export interface IslLink {
  fromSatelliteId: string;
  toSatelliteId: string;
}

/** Найденный маршрут (п.1 ТЗ) — последовательность узлов от клиента до шлюза */
export interface Route {
  /** Порядок узлов: ground point -> satellite -> ... -> satellite -> ground point */
  path: string[];
  /** Найден ли маршрут в принципе на этот момент времени (п.2.3 ТЗ) */
  exists: boolean;
}

/** Полный снимок состояния сети на момент времени t (то, что отдаёт GET /scenarios/{id}/state?t=) */
export interface NetworkState {
  timestampSeconds: number;
  satellites: SatelliteState[];
  islLinks: IslLink[];
  route: Route;
}
