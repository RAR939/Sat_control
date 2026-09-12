// src/types/scenario.ts
//
// Типы, описывающие СЦЕНАРИЙ — исходные данные для симуляции, которые
// пользователь загружает/редактирует в Сценарном редакторе (п.7 ТЗ).
// ВАЖНО: эта структура — предположение по описанию задачи. Как только
// бэкенд пришлёт реальную Pydantic-схему (или OpenAPI), эти типы нужно
// свести к ней 1-в-1, иначе будут расхождения между фронтом и бэком.

/** Один этап развёртывания группировки (спутники выводятся не все сразу) */
export interface DeploymentStage {
  /** Порядковый номер этапа */
  stageNumber: number;
  /** Время начала этапа (секунды от начала сценария) */
  startTime: number;
  /** ID спутников, которые становятся активны на этом этапе */
  satelliteIds: string[];
}

/** Параметры одной орбитальной плоскости группировки */
export interface OrbitalPlane {
  planeId: string;
  /** Долгота восходящего узла, градусы */
  raan: number;
  /** Фазовый сдвиг внутри плоскости, градусы */
  phase: number;
  /** Количество спутников в этой плоскости */
  satelliteCount: number;
}

/** Смоделированный отказ спутника на заданном интервале времени */
export interface SatelliteFailure {
  satelliteId: string;
  /** Время начала отказа, секунды от начала сценария */
  startTime: number;
  /** Время окончания отказа; null = отказ до конца сценария */
  endTime: number | null;
}

/** Наземная точка — клиент или шлюз */
export interface GroundPoint {
  id: string;
  type: 'client' | 'gateway';
  name: string;
  latitude: number;
  longitude: number;
}

/** Полный сценарий — то, что хранится/загружается/сохраняется целиком */
export interface Scenario {
  id: string;
  name: string;
  /** Длительность моделируемого отрезка времени, секунды */
  durationSeconds: number;
  /** Частота сохранения состояний системы (п.3.1 ТЗ), секунды между снимками */
  stateStepSeconds: number;
  /** Максимальная дальность связи между спутниками (ISL), км */
  islRangeKm: number;
  orbitalPlanes: OrbitalPlane[];
  deploymentStages: DeploymentStage[];
  failures: SatelliteFailure[];
  groundPoints: GroundPoint[];
}