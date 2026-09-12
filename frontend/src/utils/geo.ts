// src/utils/geo.ts
//
// Конвертация декартовых координат снапшота (x_km, y_km, z_km) в lat/lon
// и проекция lat/lon на 2D-холст (equirectangular).
//
// Система координат snapshot подтверждена построчным чтением
// backend/geometry.py: ground_position() отдаёт позицию наземной точки БЕЗ
// зависимости от t_s, а координаты спутников уже повёрнуты на
// earth_angle0_deg + OMEGA*t_s перед сравнением с ней. Значит обе стороны
// живут в одной Earth-fixed (вращающейся вместе с Землёй) системе — здесь
// НЕ нужна поправка на звёздное время, достаточно обычной сферической
// формулы.

export const EARTH_RADIUS_KM = 6371.0;

export interface LatLon {
  lat_deg: number;
  lon_deg: number;
}

export interface LatLonAlt extends LatLon {
  /** Высота над поверхностью Земли, км (0 для наземных точек). */
  alt_km: number;
}

export function cartesianToLatLon(x_km: number, y_km: number, z_km: number): LatLon {
  const r = Math.sqrt(x_km * x_km + y_km * y_km + z_km * z_km);
  const lat_deg = (Math.asin(Math.max(-1, Math.min(1, z_km / r))) * 180) / Math.PI;
  const lon_deg = (Math.atan2(y_km, x_km) * 180) / Math.PI;
  return { lat_deg, lon_deg };
}

/** Как cartesianToLatLon(), но также возвращает высоту над поверхностью —
 *  нужна для позиционирования спутников над 3D-глобусом (react-globe.gl). */
export function cartesianToGeo(x_km: number, y_km: number, z_km: number): LatLonAlt {
  const r = Math.sqrt(x_km * x_km + y_km * y_km + z_km * z_km);
  const { lat_deg, lon_deg } = cartesianToLatLon(x_km, y_km, z_km);
  return { lat_deg, lon_deg, alt_km: r - EARTH_RADIUS_KM };
}

/** react-globe.gl измеряет altitude в долях радиуса Земли (0 = поверхность,
 *  1 = ещё один радиус Земли вверх), а не в км. */
export function kmToGlobeAltitude(alt_km: number): number {
  return alt_km / EARTH_RADIUS_KM;
}
