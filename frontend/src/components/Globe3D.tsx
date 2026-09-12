// src/components/Globe3D.tsx
//
// 3D-глобус (react-globe.gl/three.js) — визуализация состояния сети на
// момент времени t_s. Заменяет более раннюю 2D-карту по прямому запросу
// пользователя (см. CLAUDE.md, раздел "Решение: 3D-глобус вместо 2D-карты").
//
// Спутники переводятся из декартовых координат снапшота в lat/lon/высоту
// через cartesianToGeo (Earth-fixed система — см. src/utils/geo.ts), высота
// пересчитывается в доли радиуса Земли через kmToGlobeAltitude, как того
// требует react-globe.gl.

import { useEffect, useMemo, useRef, useState } from 'react';
import Globe, { type GlobeMethods } from 'react-globe.gl';
import type { GroundSite } from '../types/scenario';
import type { RoutesMap, Snapshot } from '../types/network-state';
import { cartesianToGeo, kmToGlobeAltitude } from '../utils/geo';

interface Globe3DProps {
  snapshot: Snapshot | undefined;
  groundSites: GroundSite[];
  routes: RoutesMap | undefined;
  selectedClientId: string | null;
}

interface PositionedNode {
  id: string;
  lat: number;
  lng: number;
  alt: number;
}

interface SatellitePoint extends PositionedNode {
  active: boolean;
}

interface GroundMarker extends PositionedNode {
  kind: 'ground';
  name: string;
  role: GroundSite['role'];
}

/** Спутник-релей выбранного клиента — первый спутник на пути к шлюзу, если
 *  связь есть, либо ближайший видимый спутник, если связи нет. Показывается
 *  подписью, цвет которой меняется в зависимости от того, есть ли реально
 *  доставленный маршрут через него. */
interface RelaySatelliteMarker extends PositionedNode {
  kind: 'relay-satellite';
  connected: boolean;
}

type HtmlMarker = GroundMarker | RelaySatelliteMarker;

interface EdgeArc {
  startLat: number;
  startLng: number;
  startAlt: number;
  endLat: number;
  endLng: number;
  endAlt: number;
  kind: 'isl' | 'ground-link' | 'route';
}

const ISL_COLOR = 'rgba(148, 163, 184, 0.55)';
const GROUND_LINK_COLOR = 'rgba(56, 189, 248, 0.25)';
const ROUTE_COLOR = '#facc15';

function useContainerSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 900, height: 520 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry)
        setSize({
          width: entry.contentRect.width,
          height: Math.max(420, entry.contentRect.width * 0.55),
        });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return { ref, size };
}

export function Globe3D({ snapshot, groundSites, routes, selectedClientId }: Globe3DProps) {
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const { ref: containerRef, size } = useContainerSize<HTMLDivElement>();

  useEffect(() => {
    globeRef.current?.pointOfView({ lat: 65, lng: 60, altitude: 2.2 }, 0);
    const controls = globeRef.current?.controls();
    if (controls) {
      controls.autoRotate = true;
      controls.autoRotateSpeed = 0.25;
    }
  }, []);

  const groundLabels: GroundMarker[] = useMemo(
    () =>
      groundSites.map((g) => ({
        kind: 'ground' as const,
        id: g.id,
        name: g.name,
        role: g.role,
        lat: g.lat_deg,
        lng: g.lon_deg,
        alt: 0.01,
      })),
    [groundSites],
  );

  const satellites: SatellitePoint[] = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.satellites.map((sat) => {
      const geo = cartesianToGeo(sat.x_km, sat.y_km, sat.z_km);
      return {
        id: sat.id,
        lat: geo.lat_deg,
        lng: geo.lon_deg,
        alt: kmToGlobeAltitude(geo.alt_km),
        active: sat.active,
      };
    });
  }, [snapshot]);

  const positionById = useMemo(() => {
    const map = new Map<string, PositionedNode>();
    for (const g of groundLabels) map.set(g.id, g);
    for (const s of satellites) map.set(s.id, s);
    return map;
  }, [groundLabels, satellites]);

  const groundIds = useMemo(() => new Set(groundSites.map((g) => g.id)), [groundSites]);

  const edgeArcs: EdgeArc[] = useMemo(() => {
    if (!snapshot) return [];
    const arcs: EdgeArc[] = [];
    for (const [a, b] of snapshot.edges) {
      const pa = positionById.get(a);
      const pb = positionById.get(b);
      if (!pa || !pb) continue;
      const isGroundLink = groundIds.has(a) || groundIds.has(b);
      arcs.push({
        startLat: pa.lat,
        startLng: pa.lng,
        startAlt: pa.alt,
        endLat: pb.lat,
        endLng: pb.lng,
        endAlt: pb.alt,
        kind: isGroundLink ? 'ground-link' : 'isl',
      });
    }
    return arcs;
  }, [snapshot, positionById, groundIds]);

  const routeArcs: EdgeArc[] = useMemo(() => {
    const path = selectedClientId ? routes?.[selectedClientId] : undefined;
    if (!path || path.length < 2) return [];
    const arcs: EdgeArc[] = [];
    for (let i = 0; i < path.length - 1; i++) {
      const pa = positionById.get(path[i]);
      const pb = positionById.get(path[i + 1]);
      if (!pa || !pb) continue;
      arcs.push({
        startLat: pa.lat,
        startLng: pa.lng,
        startAlt: pa.alt,
        endLat: pb.lat,
        endLng: pb.lng,
        endAlt: pb.alt,
        kind: 'route',
      });
    }
    return arcs;
  }, [selectedClientId, routes, positionById]);

  const allArcs = useMemo(() => [...edgeArcs, ...routeArcs], [edgeArcs, routeArcs]);

  // "Главный" спутник выбранного клиента: если связь есть — первый спутник
  // на маршруте до шлюза (path[0] — сам клиент, path[1] — уже спутник);
  // если связи нет — ближайший геометрически видимый спутник (клиент его
  // "видит", но маршрута до шлюза через него нет).
  const relayMarker: RelaySatelliteMarker | null = useMemo(() => {
    if (!selectedClientId || !snapshot) return null;
    const path = routes?.[selectedClientId];
    const connected = !!path && path.length > 1;
    const relaySatId = connected ? path![1] : snapshot.visible_sats[selectedClientId]?.[0];
    if (!relaySatId) return null;
    const pos = positionById.get(relaySatId);
    if (!pos) return null;
    return {
      kind: 'relay-satellite',
      id: relaySatId,
      lat: pos.lat,
      lng: pos.lng,
      alt: pos.alt,
      connected,
    };
  }, [selectedClientId, snapshot, routes, positionById]);

  const htmlMarkers: HtmlMarker[] = useMemo(
    () => [...groundLabels, ...(relayMarker ? [relayMarker] : [])],
    [groundLabels, relayMarker],
  );

  return (
    <div
      ref={containerRef}
      className="relative w-full overflow-hidden rounded-lg border border-slate-800 bg-slate-950"
    >
      <Globe
        ref={globeRef}
        width={size.width}
        height={size.height}
        globeImageUrl="/globe/earth-day.jpg"
        backgroundImageUrl="/globe/night-sky.png"
        backgroundColor="#020617"
        showAtmosphere
        atmosphereColor="#38bdf8"
        atmosphereAltitude={0.18}
        pointsData={satellites}
        pointLat="lat"
        pointLng="lng"
        pointAltitude="alt"
        pointRadius={(d: object) => ((d as SatellitePoint).id === relayMarker?.id ? 0.6 : 0.35)}
        pointColor={(d: object) => {
          const sat = d as SatellitePoint;
          if (sat.id === relayMarker?.id) return relayMarker!.connected ? '#34d399' : '#f87171';
          return sat.active ? '#38bdf8' : '#475569';
        }}
        pointLabel={(d) =>
          `${(d as SatellitePoint).id}${(d as SatellitePoint).active ? '' : ' (не активен)'}`
        }
        htmlElementsData={htmlMarkers}
        htmlLat="lat"
        htmlLng="lng"
        htmlAltitude="alt"
        htmlElement={(d: object) => {
          const marker = d as HtmlMarker;
          const el = document.createElement('div');
          if (marker.kind === 'relay-satellite') {
            // Цвет и подпись меняются в зависимости от того, есть ли реально
            // рабочая связь через этот спутник, а не просто его видимость.
            const accent = marker.connected ? '#34d399' : '#f87171';
            const statusText = marker.connected ? 'связь есть' : 'виден, связи нет';
            el.style.cssText =
              'display:flex;align-items:center;gap:6px;padding:3px 9px;border-radius:9999px;' +
              'background:rgba(2,6,23,0.88);border:1.5px solid ' +
              accent +
              `;box-shadow:0 0 10px 0 ${accent}55, 0 1px 4px rgba(0,0,0,0.6);` +
              'font:600 11px/1.4 system-ui,sans-serif;color:' +
              accent +
              ';white-space:nowrap;pointer-events:none;transform:translate(-10px,-28px);';
            el.innerHTML = `<span style="width:7px;height:7px;border-radius:9999px;background:${accent};flex-shrink:0;box-shadow:0 0 6px 1px ${accent}"></span><span>${marker.id} · ${statusText}</span>`;
            return el;
          }
          const accent = marker.role === 'gateway' ? '#f87171' : '#34d399';
          el.style.cssText =
            'display:flex;align-items:center;gap:5px;padding:2px 8px;border-radius:9999px;' +
            'background:rgba(2,6,23,0.82);border:1px solid ' +
            accent +
            '66;box-shadow:0 1px 4px rgba(0,0,0,0.5);font:500 11px/1.4 system-ui,sans-serif;' +
            'color:#e2e8f0;white-space:nowrap;pointer-events:none;transform:translate(-8px,-8px);';
          el.innerHTML = `<span style="width:6px;height:6px;border-radius:9999px;background:${accent};flex-shrink:0"></span><span>${marker.name}</span>`;
          return el;
        }}
        arcsData={allArcs}
        arcStartLat="startLat"
        arcStartLng="startLng"
        arcStartAltitude="startAlt"
        arcEndLat="endLat"
        arcEndLng="endLng"
        arcEndAltitude="endAlt"
        arcColor={(d: object) => {
          const kind = (d as EdgeArc).kind;
          return kind === 'route'
            ? ROUTE_COLOR
            : kind === 'ground-link'
              ? GROUND_LINK_COLOR
              : ISL_COLOR;
        }}
        arcStroke={(d: object) => ((d as EdgeArc).kind === 'route' ? 1.2 : 0.35)}
        arcAltitudeAutoScale={0.35}
        arcsTransitionDuration={0}
      />

      <div className="pointer-events-none absolute bottom-3 left-3 flex flex-col gap-1 rounded-md bg-slate-950/80 px-3 py-2 text-xs text-slate-300 backdrop-blur">
        <p className="mb-1 font-semibold text-slate-400">Легенда</p>
        <p>
          <span className="inline-block h-2 w-2 rounded-full bg-sky-400 align-middle" /> активный
          спутник
        </p>
        <p>
          <span className="inline-block h-2 w-2 rounded-full bg-slate-600 align-middle" />{' '}
          неактивный/отказал
        </p>
        <p>
          <span className="inline-block h-2 w-2 rounded-full bg-rose-400 align-middle" /> шлюз
        </p>
        <p>
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-400 align-middle" />{' '}
          клиентский терминал
        </p>
        <p>
          <span className="inline-block h-0.5 w-4 bg-amber-400 align-middle" /> маршрут выбранного
          клиента
        </p>
        <p className="mt-1 border-t border-slate-700/60 pt-1 text-slate-400">
          Подпись спутника у выбранного клиента:
        </p>
        <p>
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-400 align-middle" /> связь
          есть
        </p>
        <p>
          <span className="inline-block h-2 w-2 rounded-full bg-rose-400 align-middle" /> виден, но
          связи нет
        </p>
      </div>
      <p className="pointer-events-none absolute right-3 top-3 rounded-md bg-slate-950/80 px-2 py-1 text-[11px] text-slate-400">
        Тяни мышью, чтобы вращать · колесо — зум
      </p>
    </div>
  );
}
