import { useEffect } from "react";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
import type { Pin } from "../lib/types";

L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

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
      {pins.map((p) => (
        <Marker key={p.id} position={[p.lat, p.lng]}>
          <Popup>
            <div className="text-xs">
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
      ))}
      <FitBounds pins={pins} />
    </MapContainer>
  );
}
