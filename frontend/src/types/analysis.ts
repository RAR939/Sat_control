// src/types/analysis.ts
//
// Типы для АНАЛИЗА сценария на всём временном отрезке — выпадения из
// покрытия (п.4 ТЗ) и анализ устойчивости (п.5 ТЗ, доп. задача).

export type OutageReason = 'no_client' | 'no_gateway' | 'isl_break';

/** Один интервал "выпадения" из зоны покрытия */
export interface OutageEvent {
  startTimeSeconds: number;
  endTimeSeconds: number;
  reason: OutageReason;
  /** Узлы, из-за которых произошло выпадение (например, конкретный спутник ISL-разрыва) */
  affectedIds: string[];
}

/** Сводная аналитика по сценарию — используется для сравнения конфигураций (п.4.4) */
export interface AnalysisSummary {
  scenarioId: string;
  totalOutages: number;
  totalOutageDurationSeconds: number;
  outages: OutageEvent[];
  /** Разбивка длительности выпадений по причинам — для графиков/сравнения сценариев */
  outageDurationByReason: Record<OutageReason, number>;
}

/** Рейтинг устойчивости спутников (п.5.2 ТЗ, доп. задача) */
export interface RobustnessRankingEntry {
  satelliteId: string;
  /** Чем выше — тем критичнее отказ этого спутника для сети (метрику определит бэкенд) */
  vulnerabilityScore: number;
}
