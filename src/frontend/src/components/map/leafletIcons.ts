import L from 'leaflet';

/**
 * User location marker — blue/cyan dot with white center and subtle ring.
 * Used on public safety map for display-only geolocation (not submitted).
 */
export const userLocationIcon = L.divIcon({
  className: 'leaflet-user-location',
  html: `<div style="
    width: 14px; height: 14px;
    background: #3b82f6;
    border: 2.5px solid #fff;
    border-radius: 50%;
    box-shadow: 0 0 0 2px #3b82f6, 0 0 10px rgba(59,130,246,0.45);
  "></div>`,
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

/**
 * Incident/fire pin marker — BFP maroon/red for selection contexts.
 * Uses a local div since remote Leaflet default URLs may not render.
 */
export const firePinIcon = L.divIcon({
  className: 'leaflet-fire-pin',
  html: `<svg width="25" height="41" viewBox="0 0 25 41" xmlns="http://www.w3.org/2000/svg">
    <path d="M12.5 0C5.6 0 0 5.6 0 12.5C0 21.9 12.5 41 12.5 41S25 21.9 25 12.5C25 5.6 19.4 0 12.5 0z" fill="#1A3263"/>
    <circle cx="12.5" cy="12.5" r="5" fill="#fff"/>
  </svg>`,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
});
