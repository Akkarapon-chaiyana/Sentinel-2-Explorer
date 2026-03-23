# Sentinel-2 Explorer

A browser-based tool for exploring, searching, and downloading **Sentinel-2 L2A** satellite imagery via the [Element84 STAC API](https://earth-search.aws.element84.com/v1). Supports MGRS tile selection, a global 50 km grid, yearly median mosaic script generation (local stackstac + Google Earth Engine), and multiple basemap options.

---

## Features

- **STAC Scene Search** — Search Sentinel-2 L2A scenes by bounding box, date range, and cloud cover. Unlimited pagination (250 scenes/page).
- **MGRS Tile View** — Scenes aggregated by MGRS tile. Click tiles on the map or in the list to select them.
- **Global 50 km Grid** — A 0.5° × 0.5° grid (~50 km × 50 km at equator) visible at zoom ≥ 5. Search a country to auto-select all cells covering it.
- **Country Boundary Filter** — Grid cell selection respects the true country boundary (excludes ocean/sea cells).
- **Mosaic Script Generation** — Generate ready-to-run Python scripts for yearly median mosaics using:
  - `stackstac` (local processing from AWS S3 COGs)
  - Google Earth Engine (`COPERNICUS/S2_SR_HARMONIZED`)
- **Individual Scene Download** — Export STAC item metadata and COG download links as JSON or CSV.
- **Multiple Basemaps** — Satellite (ESRI), Light, Dark, Streets (Carto).
- **Area Selection** — Click map, draw polygon, upload GeoJSON, or search by place name.
- **Share URL** — Copy a shareable link that restores the current bounding box and date range.

---

## Installation

### Prerequisites

- [Node.js](https://nodejs.org/) v18 or later
- npm v9 or later

### Steps

```bash
# 1. Clone the repository
git clone https://github.com/Akkarapon-chaiyana/Sentinel-2-Explorer.git
cd Sentinel-2-Explorer

# 2. Install dependencies
npm install

# 3. Start the development server
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

### Build for Production

```bash
npm run build
# Output is written to the dist/ folder

npm run preview   # preview the production build locally
```

---

## How to Use

### 1. Select an Area of Interest

In the **Tools** tab, choose one of four methods:

| Method | Description |
|--------|-------------|
| **Click Map** | Click anywhere on the map to set a 1° × 1° bounding box |
| **Draw Polygon** | Click to add points, double-click to close the polygon |
| **Upload GeoJSON** | Upload a `.geojson` or `.json` file (max 25 MB) |
| **Search Place** | Type a country or place name (e.g. `Ethiopia`) and press Enter |

### 2. Set Filters

- **Date Range** — From / To dates (default: last 12 months)
- **Max Cloud Cover** — Slider from 0–100% (default: 30%)

### 3. Search Scenes

Click **Search Scenes**. Results appear in the **Tiles** and **Scenes** tabs.

### 4. MGRS Tiles Tab

- Lists all unique MGRS tiles found in the search results.
- Click a tile in the list or on the map to select/deselect it.
- Use **All / None** to select or clear all tiles.
- Click **Yearly Median Mosaic Script** to generate a Python download script.
- Click **Download Individual Scenes** to export scene metadata.

### 5. Global 50 km Grid Tab

Useful for large-area coverage planning (e.g. national datasets):

1. Zoom in to level 5+ to see the grid overlay.
2. Click individual cells on the map, **or** type a country name (e.g. `Thailand`) and press Enter to auto-select all cells within the country boundary.
3. Click **Yearly Median Mosaic Script** to generate a mosaic script for the selected cells.

### 6. Mosaic Script Generator

After selecting tiles or grid cells, the modal lets you configure:

| Option | Description |
|--------|-------------|
| **Engine** | `stackstac` (local) or Google Earth Engine |
| **Year From / To** | Temporal range for the composite |
| **Max Cloud %** | Cloud cover filter per scene |
| **Resolution** | 10 m / 20 m / 60 m |
| **Bands** | Choose from B02–B12 + SCL |
| **GEE Project ID** | Required for Earth Engine scripts |
| **Download Mode** | High Volume API (local disk) or Google Drive |

Click **Copy Script** or **Download .py** to get the script.

### 7. Basemap

In the **Tools** tab under **Basemap**, switch between:

| Option | Description |
|--------|-------------|
| **Satellite** | ESRI World Imagery (default) |
| **Light** | Carto Positron |
| **Dark** | Carto Dark Matter |
| **Streets** | Carto Voyager |

---

## Project Structure

```
src/
├── App.jsx               # Main application component
├── index.css             # Global styles (light/gold theme)
├── main.jsx              # React entry point
├── api/
│   └── stac.js           # Element84 STAC API client + Python script generators
├── components/
│   ├── DownloadModal.jsx  # Scene download modal (JSON / CSV)
│   ├── MosaicModal.jsx    # Mosaic script generator modal
│   ├── SceneChart.jsx     # Scene count bar chart by date
│   └── Toast.jsx          # Toast notification component
├── hooks/
│   └── useToast.js        # Toast state hook
└── utils/
    └── gridTiles.js       # 50 km grid cell generation utilities
```

---

## Data Sources

| Source | URL |
|--------|-----|
| Sentinel-2 L2A STAC | https://earth-search.aws.element84.com/v1 |
| Sentinel-2 COGs | `s3://sentinel-cogs/` (AWS Open Data) |
| Place Geocoding | [Nominatim / OpenStreetMap](https://nominatim.openstreetmap.org) |
| Satellite Basemap | ESRI World Imagery |
| Vector Basemaps | [Carto Basemaps](https://carto.com/basemaps/) |

---

## Tech Stack

| Library | Purpose |
|---------|---------|
| [React 19](https://react.dev) | UI framework |
| [MapLibre GL JS 4](https://maplibre.org) | Interactive map rendering |
| [Turf.js](https://turfjs.org) | Geospatial operations (boundary intersection, simplify) |
| [Recharts](https://recharts.org) | Scene date distribution chart |
| [Lucide React](https://lucide.dev) | Icons |
| [Vite 8](https://vitejs.dev) | Build tool |

---

## License

MIT
