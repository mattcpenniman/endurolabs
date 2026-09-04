"use client";

// ============================================================
// EnduroLab - Garmin Activity Leaflet Map
// ============================================================
// Client-only OpenStreetMap rendering for a Garmin GPS trace.

import { useEffect, useRef } from "react";
import type { CircleMarker, Map as LeafletMap } from "leaflet";
import type { ActivityChartSample } from "@/lib/activities/models";

interface GarminActivityLeafletMapProps {
  samples: ActivityChartSample[];
  selectedIndex: number | null;
  onPointSelect: (index: number) => void;
}

interface RoutePoint {
  index: number;
  latitude: number;
  longitude: number;
  color: string;
}

function elevationColor(value: number | null | undefined, min: number, max: number): string {
  if (typeof value !== "number") return "#64748b";
  const t = max === min ? 0.5 : Math.min(1, Math.max(0, (value - min) / (max - min)));
  const hue = Math.round(145 - t * 110);
  return `hsl(${hue} 72% 40%)`;
}

function routePoints(samples: ActivityChartSample[]): RoutePoint[] {
  const elevations = samples
    .map((sample) => sample.elevationMeters)
    .filter((value): value is number => typeof value === "number");
  const min = elevations.length > 0 ? Math.min(...elevations) : 0;
  const max = elevations.length > 0 ? Math.max(...elevations) : 0;

  return samples.flatMap((sample, index) => {
    if (
      typeof sample.latitude !== "number"
      || typeof sample.longitude !== "number"
      || !Number.isFinite(sample.latitude)
      || !Number.isFinite(sample.longitude)
    ) {
      return [];
    }
    return [{
      index,
      latitude: sample.latitude,
      longitude: sample.longitude,
      color: elevationColor(sample.elevationMeters, min, max),
    }];
  });
}

export default function GarminActivityLeafletMap({
  samples,
  selectedIndex,
  onPointSelect,
}: GarminActivityLeafletMapProps): React.ReactNode {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const markerRefs = useRef<Map<number, { marker: CircleMarker; color: string }>>(new Map());
  const onPointSelectRef = useRef(onPointSelect);

  useEffect(() => {
    onPointSelectRef.current = onPointSelect;
  }, [onPointSelect]);

  useEffect(() => {
    const container = containerRef.current;
    const points = routePoints(samples);
    if (!container || points.length < 2) return;

    let cancelled = false;
    let map: LeafletMap | null = null;

    void import("leaflet").then((L) => {
      if (cancelled || !containerRef.current) return;

      map = L.map(containerRef.current, {
        attributionControl: true,
        preferCanvas: true,
        scrollWheelZoom: true,
        zoomControl: true,
      });

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);

      const renderer = L.canvas({ padding: 0.5 });
      const latLngs = points.map((point) => L.latLng(point.latitude, point.longitude));

      L.polyline(latLngs, {
        color: "#ffffff",
        opacity: 0.92,
        renderer,
        weight: 8,
      }).addTo(map);
      L.polyline(latLngs, {
        color: "#1f3529",
        opacity: 0.9,
        renderer,
        weight: 3.5,
      }).addTo(map);

      markerRefs.current.clear();
      for (const point of points) {
        const marker = L.circleMarker([point.latitude, point.longitude], {
          color: "#173326",
          fillColor: point.color,
          fillOpacity: 0.96,
          opacity: 0.55,
          radius: 5.5,
          renderer,
          weight: 1,
        }).addTo(map);
        marker.on("click", () => onPointSelectRef.current(point.index));
        marker.bindTooltip(`Sample ${point.index + 1}`, { direction: "top", opacity: 0.9 });
        markerRefs.current.set(point.index, { marker, color: point.color });
      }

      const start = points[0];
      const finish = points[points.length - 1];
      L.circleMarker([start.latitude, start.longitude], {
        color: "#ffffff",
        fillColor: "#16a34a",
        fillOpacity: 1,
        opacity: 0.95,
        radius: 8,
        renderer,
        weight: 2,
      }).addTo(map).bindTooltip("Start", { direction: "top" });
      L.circleMarker([finish.latitude, finish.longitude], {
        color: "#ffffff",
        fillColor: "#dc2626",
        fillOpacity: 1,
        opacity: 0.95,
        radius: 8,
        renderer,
        weight: 2,
      }).addTo(map).bindTooltip("Finish", { direction: "top" });

      map.fitBounds(L.latLngBounds(latLngs), { padding: [28, 28], maxZoom: 16 });
    });

    return () => {
      cancelled = true;
      markerRefs.current.clear();
      map?.remove();
    };
  }, [samples]);

  useEffect(() => {
    for (const [index, { marker, color }] of markerRefs.current) {
      const selected = index === selectedIndex;
      marker.setRadius(selected ? 9 : 5.5);
      marker.setStyle({
        color: selected ? "#f59e0b" : "#173326",
        fillColor: color,
        opacity: selected ? 1 : 0.55,
        weight: selected ? 3 : 1,
      });
      if (selected) marker.bringToFront();
    }
  }, [selectedIndex]);

  return (
    <div
      ref={containerRef}
      className="h-72 w-full bg-slate-100 sm:h-[400px]"
      role="region"
      aria-label="Interactive OpenStreetMap of the run route. Scroll to zoom, drag to pan, and select a colored point for details."
    />
  );
}
