import { useEffect } from "react";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import type { Pin, PlaceCategory } from "../lib/types";
import { CATEGORY_CONFIG } from "../lib/categories";

function makeCategoryIcon(category: PlaceCategory): L.DivIcon {
  const { emoji, bg } = CATEGORY_CONFIG[category] ?? CATEGORY_CONFIG.other;
  return L.divIcon({
    className: "",
    html: `<div style="background:${bg};width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:15px;border:2.5px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.35);line-height:1">${emoji}</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    popupAnchor: [0, -16],
  });
}

const CATEGORY_ICONS: Record<PlaceCategory, L.DivIcon> = {
  food:       makeCategoryIcon("food"),
  hotel:      makeCategoryIcon("hotel"),
  attraction: makeCategoryIcon("attraction"),
  other:      makeCategoryIcon("other"),
};

function FitBounds({ pins }: { pins: Pin[] }) {
  const map = useMap();
  useEffect(() => {
    if (pins.length === 0) return;
    if (pins.length === 1) {
      map.setView([pins[0].lat, pins[0].lng], 13);
      return;
    }
    const bounds = L.latLngBounds(pins.map((p) => [p.lat, p.lng] as [number, number]));
    map.fitBounds(bounds, { padding: [24, 24], maxZoom: 14 });
  }, [pins, map]);
  return null;
}

export default function MapView({ pins }: { pins: Pin[] }) {
  const center: [number, number] = pins[0]
    ? [pins[0].lat, pins[0].lng]
    : [20, 0];

  return (
    <MapContainer
      center={center}
      zoom={pins.length ? 12 : 2}
      scrollWheelZoom
      style={{ width: "100%", height: "100%" }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {pins.map((p) => {
        const cat: PlaceCategory = p.category ?? "other";
        const { emoji, bg } = CATEGORY_CONFIG[cat];
        return (
          <Marker key={p.id} position={[p.lat, p.lng]} icon={CATEGORY_ICONS[cat]}>
            <Popup>
              <div className="text-xs">
                <div className="flex items-center gap-1.5 mb-1">
                  <span
                    style={{ background: bg }}
                    className="inline-flex items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] text-white font-medium"
                  >
                    {emoji} {cat}
                  </span>
                </div>
                <div className="font-semibold text-sm">{p.name}</div>
                {p.address && <div className="text-zinc-500">{p.address}</div>}
                {p.contextSnippet && (
                  <div className="mt-1 italic text-zinc-600">"{p.contextSnippet}"</div>
                )}
                <a
                  href={p.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 block text-blue-600 hover:underline"
                >
                  source ↗
                </a>
              </div>
            </Popup>
          </Marker>
        );
      })}
      <FitBounds pins={pins} />
    </MapContainer>
  );
}
