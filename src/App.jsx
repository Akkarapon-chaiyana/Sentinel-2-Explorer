import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import maplibregl from 'maplibre-gl';
import * as turf from '@turf/turf';
import {
  ChevronLeft, ChevronRight, MousePointer, PenLine, Globe, Upload,
  Search, Download, Share2, Trash2, Layers, Calendar, BarChart2,
  SatelliteDish, Grid3x3, Terminal, Map as MapIcon
} from 'lucide-react';
import { searchScenes } from './api/stac';
import { generateVisibleGrid, cellBbox, generateCellsForBbox } from './utils/gridTiles';
import { useToast } from './hooks/useToast';
import Toast from './components/Toast';
import DownloadModal from './components/DownloadModal';
import MosaicModal from './components/MosaicModal';
import SceneChart from './components/SceneChart';
import GEEOverlayPanel from './components/GEEOverlayPanel';

// ── GEE REST API helpers ─────────────────────────────────────────────────────
function buildGEEExpression(assetPath) {
  // ee.Image(assetPath).selfMask()
  // Visualization (palette, min/max) is passed separately in visualizationOptions.
  // selfMask() makes 0-valued pixels transparent; only value=1 pixels are shown.
  return {
    result: '0',
    values: {
      '0': {
        functionInvocationValue: {
          functionName: 'Image.selfMask',
          arguments: {
            image: {
              functionInvocationValue: {
                functionName: 'Image.load',
                arguments: { id: { constantValue: assetPath } },
              },
            },
          },
        },
      },
    },
  };
}

const GEE_TILE_BASE = 'https://earthengine.googleapis.com/v1';

const BASEMAPS = [
  {
    id: 'satellite',
    label: 'Satellite',
    style: {
      version: 8,
      sources: {
        'esri-sat': {
          type: 'raster',
          tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
          tileSize: 256,
          maxzoom: 19,
          attribution: '© Esri, DigitalGlobe, GeoEye, USDA',
        },
      },
      layers: [{ id: 'satellite-bg', type: 'raster', source: 'esri-sat' }],
    },
  },
  { id: 'light',   label: 'Light',   url: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json' },
  { id: 'dark',    label: 'Dark',    url: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json' },
  { id: 'streets', label: 'Streets', url: 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json' },
];

function defaultDates() {
  const end = new Date();
  const start = new Date();
  start.setFullYear(start.getFullYear() - 1);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

export default function App() {
  const mapRef       = useRef(null);
  const mapEl        = useRef(null);
  const fileInputRef = useRef(null);
  const geeTokenRef   = useRef('');  // readable inside transformRequest closure
  const geeProjectRef = useRef('');  // needed for x-goog-user-project quota header
  const geeOverlayRef = useRef({});  // readable inside setupSources after style reload

  const [collapsed,   setCollapsed]   = useState(false);
  const [activeTab,   setActiveTab]   = useState('tools');
  const [activeTool,  setActiveTool]  = useState(null);
  const [drawPoints,  setDrawPoints]  = useState([]);

  const { toasts, toast } = useToast();
  const dates = defaultDates();
  const [dateStart,  setDateStart]  = useState(dates.start);
  const [dateEnd,    setDateEnd]    = useState(dates.end);
  const [maxCloud,   setMaxCloud]   = useState(30);
  const [countryQuery, setCountryQuery] = useState('');

  const [scenes,         setScenes]         = useState([]);
  const [selectedScenes, setSelectedScenes] = useState(new Set());
  const [selectedTiles,  setSelectedTiles]  = useState(new Set()); // MGRS tile IDs
  const [loading,        setLoading]        = useState(false);
  const [bbox,           setBbox]           = useState(null);
  const [showDownload,      setShowDownload]      = useState(false);
  const [showMosaic,        setShowMosaic]        = useState(false);
  const [showGridMosaic,    setShowGridMosaic]    = useState(false);
  const [selectedGridCells,  setSelectedGridCells]  = useState(new Map());
  const [gridCountryQuery,   setGridCountryQuery]   = useState('');
  const [gridBoundary,       setGridBoundary]       = useState(null); // GeoJSON feature
  const [basemap,            setBasemap]            = useState('satellite');
  const [geeOverlay,         setGeeOverlay]         = useState({
    mapName: null, tileUrl: null, enabled: false,
    opacity: 0.75, loading: false, error: null,
  });

  // Refs for re-syncing map sources after basemap style switch
  const aoiFeatureRef         = useRef(null);
  const tileIndexRef          = useRef({});
  const selectedTilesRef      = useRef(new Set());
  const selectedGridCellsRef  = useRef(new Map());
  const gridBoundaryRef       = useRef(null);
  const activeTabRef          = useRef('tools');
  const currentBasemapRef     = useRef('satellite'); // tracks which style is currently loaded

  // Build MGRS tile index from scenes: { mgrsId -> { feature, scenes, years } }
  // grid:code returns e.g. "MGRS-37NCJ" — strip prefix to get "37NCJ"
  const tileIndex = useMemo(() => {
    const idx = {};
    for (const scene of scenes) {
      const raw = scene.properties?.['grid:code'];
      const mgrs = raw?.replace(/^MGRS-/, '') ||
        [scene.properties?.['mgrs:utm_zone'], scene.properties?.['mgrs:latitude_band'], scene.properties?.['mgrs:grid_square']].join('');
      if (!mgrs) continue;
      if (!idx[mgrs]) idx[mgrs] = { mgrsId: mgrs, feature: scene, scenes: [], years: new Set() };
      idx[mgrs].scenes.push(scene);
      const yr = scene.properties?.datetime?.slice(0, 4);
      if (yr) idx[mgrs].years.add(yr);
    }
    return idx;
  }, [scenes]);

  // ── Map init ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const initialBm = BASEMAPS.find(b => b.id === 'satellite');
    const map = new maplibregl.Map({
      container: mapEl.current,
      style: initialBm.style,
      center: [0, 20],
      zoom: 2,
      attributionControl: false,
      // Auth + quota headers for GEE tile requests — reads from refs, no re-init needed
      transformRequest: (url) => {
        if (url.startsWith(GEE_TILE_BASE) && geeTokenRef.current) {
          return {
            url,
            headers: {
              Authorization: `Bearer ${geeTokenRef.current}`,
              'x-goog-user-project': geeProjectRef.current,
            },
          };
        }
      },
    });
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
    mapRef.current = map;
    window.__map = map;

    // Stable handler references so map.off() works correctly across style reloads
    const onTileEnter  = () => { map.getCanvas().style.cursor = 'pointer'; };
    const onTileLeave  = () => { map.getCanvas().style.cursor = ''; };
    const onTileClick  = (e) => {
      if (!e.features?.length) return;
      const mgrsId = e.features[0].properties.mgrsId;
      if (!mgrsId) return;
      setSelectedTiles(prev => { const n = new Set(prev); n.has(mgrsId) ? n.delete(mgrsId) : n.add(mgrsId); return n; });
      e.originalEvent._handledByTile = true;
    };
    const onGridEnter  = () => { map.getCanvas().style.cursor = 'pointer'; };
    const onGridLeave  = () => { map.getCanvas().style.cursor = ''; };
    const onGridClick  = (e) => {
      if (!e.features?.length) return;
      const { id, lon, lat } = e.features[0].properties;
      if (!id) return;
      const bbox = cellBbox(Number(lon), Number(lat));
      setSelectedGridCells(prev => { const n = new Map(prev); n.has(id) ? n.delete(id) : n.set(id, { id, bbox }); return n; });
      e.originalEvent._handledByTile = true;
    };

    // Called on initial style.load AND after every setStyle() call
    const setupSources = () => {
      // Unregister layer-specific handlers before re-adding (prevents duplicates)
      map.off('mouseenter', 'tiles-grid-fill', onTileEnter);
      map.off('mouseleave', 'tiles-grid-fill', onTileLeave);
      map.off('click',      'tiles-grid-fill', onTileClick);
      map.off('mouseenter', 'grid-50km-fill',  onGridEnter);
      map.off('mouseleave', 'grid-50km-fill',  onGridLeave);
      map.off('click',      'grid-50km-fill',  onGridClick);

      // AOI outline
      map.addSource('aoi', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: 'aoi-fill', type: 'fill', source: 'aoi', paint: { 'fill-color': '#10b981', 'fill-opacity': 0.08 } });
      map.addLayer({ id: 'aoi-line', type: 'line', source: 'aoi', paint: { 'line-color': '#10b981', 'line-width': 1.5, 'line-dasharray': [3, 2] } });

      // Drawing temp layer
      map.addSource('drawing', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: 'drawing-fill', type: 'fill', source: 'drawing', paint: { 'fill-color': '#f59e0b', 'fill-opacity': 0.08 } });
      map.addLayer({ id: 'drawing-line', type: 'line', source: 'drawing', paint: { 'line-color': '#f59e0b', 'line-width': 2 } });

      // MGRS tile grid
      map.addSource('tiles-grid', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: 'tiles-grid-fill', type: 'fill', source: 'tiles-grid',
        paint: {
          'fill-color': ['case', ['==', ['get', 'selected'], true], '#06b6d4', '#10b981'],
          'fill-opacity': ['case', ['==', ['get', 'selected'], true], 0.18, 0.04],
        },
      });
      map.addLayer({
        id: 'tiles-grid-line', type: 'line', source: 'tiles-grid',
        paint: {
          'line-color': ['case', ['==', ['get', 'selected'], true], '#06b6d4', '#10b981'],
          'line-width': ['case', ['==', ['get', 'selected'], true], 1.5, 0.7],
        },
      });

      // Country boundary overlay
      map.addSource('country-boundary', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: 'country-boundary-line', type: 'line', source: 'country-boundary', paint: { 'line-color': '#a78bfa', 'line-width': 1.5, 'line-dasharray': [4, 3] } });

      // 50km global grid
      map.addSource('grid-50km', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: 'grid-50km-fill', type: 'fill', source: 'grid-50km',
        paint: { 'fill-color': '#f59e0b', 'fill-opacity': ['case', ['==', ['get', 'selected'], true], 0.22, 0.03] },
      });
      map.addLayer({
        id: 'grid-50km-line', type: 'line', source: 'grid-50km',
        paint: {
          'line-color': ['case', ['==', ['get', 'selected'], true], '#f59e0b', '#94a3b8'],
          'line-width': ['case', ['==', ['get', 'selected'], true], 1.5, 0.4],
          'line-opacity': 0.55,
        },
      });

      // Re-register layer-specific handlers
      map.on('mouseenter', 'tiles-grid-fill', onTileEnter);
      map.on('mouseleave', 'tiles-grid-fill', onTileLeave);
      map.on('click',      'tiles-grid-fill', onTileClick);
      map.on('mouseenter', 'grid-50km-fill',  onGridEnter);
      map.on('mouseleave', 'grid-50km-fill',  onGridLeave);
      map.on('click',      'grid-50km-fill',  onGridClick);

      // Re-sync current state to newly-created sources (for basemap switches)
      if (aoiFeatureRef.current) {
        map.getSource('aoi').setData({ type: 'FeatureCollection', features: [aoiFeatureRef.current] });
      }
      const boundary = gridBoundaryRef.current;
      map.getSource('country-boundary').setData(
        boundary ? { type: 'FeatureCollection', features: [boundary] } : { type: 'FeatureCollection', features: [] }
      );
      const tileFeatures = Object.values(tileIndexRef.current).map(({ mgrsId, feature }) => ({
        ...feature, id: mgrsId,
        properties: { ...feature.properties, mgrsId, selected: selectedTilesRef.current.has(mgrsId) },
      }));
      map.getSource('tiles-grid').setData({ type: 'FeatureCollection', features: tileFeatures });
      const selCells = selectedGridCellsRef.current;
      const selIds   = new Set(selCells.keys());
      const selFeatures = [...selCells.values()].map(({ id, bbox }) => ({
        type: 'Feature',
        properties: { id, lon: bbox[0], lat: bbox[1], selected: true },
        geometry: { type: 'Polygon', coordinates: [[[bbox[0],bbox[1]],[bbox[2],bbox[1]],[bbox[2],bbox[3]],[bbox[0],bbox[3]],[bbox[0],bbox[1]]]] },
      }));
      const visFeatures = generateVisibleGrid(map, selIds);
      map.getSource('grid-50km').setData({
        type: 'FeatureCollection',
        features: [...selFeatures, ...visFeatures.filter(f => !selIds.has(f.properties.id))],
      });
      // Restore MGRS tile visibility based on active tab
      const visibility = activeTabRef.current === 'grid' ? 'none' : 'visible';
      ['tiles-grid-fill', 'tiles-grid-line'].forEach(lid => {
        if (map.getLayer(lid)) map.setLayoutProperty(lid, 'visibility', visibility);
      });

      // Re-add GEE overlay layer after style reload (basemap switch removes all layers)
      const ov = geeOverlayRef.current;
      if (ov.tileUrl && !map.getSource('gee-overlay')) {
        map.addSource('gee-overlay', { type: 'raster', tiles: [ov.tileUrl], tileSize: 256 });
        map.addLayer({
          id: 'gee-overlay-layer', type: 'raster', source: 'gee-overlay',
          paint: { 'raster-opacity': ov.opacity },
          layout: { visibility: ov.enabled ? 'visible' : 'none' },
        });
      }
    };

    map.on('style.load', setupSources);

    return () => map.remove();
  }, []);

  // ── Keep geeOverlayRef in sync (readable inside setupSources closure) ───────
  useEffect(() => { geeOverlayRef.current = geeOverlay; }, [geeOverlay]);

  // ── GEE overlay handlers ─────────────────────────────────────────────────────
  const loadGEEOverlay = useCallback(async (assetPath, project, token, paletteHex) => {
    geeTokenRef.current   = token;
    geeProjectRef.current = project;
    setGeeOverlay(prev => ({ ...prev, loading: true, error: null }));
    try {
      const res = await fetch(`${GEE_TILE_BASE}/projects/${project}/maps`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'x-goog-user-project': project,
        },
        body: JSON.stringify({
          expression: buildGEEExpression(assetPath),
          fileFormat: 'AUTO_JPEG_PNG',
          visualizationOptions: {
            ranges:        [{ min: 1, max: 1 }],
            paletteColors: [paletteHex],
          },
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error?.message || `HTTP ${res.status}`);
      }
      const { name } = await res.json();
      const tileUrl = `${GEE_TILE_BASE}/${name}/tiles/{z}/{x}/{y}`;
      const map = mapRef.current;
      if (map.getSource('gee-overlay')) {
        map.removeLayer('gee-overlay-layer');
        map.removeSource('gee-overlay');
      }
      map.addSource('gee-overlay', { type: 'raster', tiles: [tileUrl], tileSize: 256 });
      map.addLayer({ id: 'gee-overlay-layer', type: 'raster', source: 'gee-overlay',
        paint: { 'raster-opacity': 0.75 } });
      setGeeOverlay(prev => ({ ...prev, mapName: name, tileUrl, enabled: true, loading: false }));
    } catch (err) {
      setGeeOverlay(prev => ({ ...prev, loading: false, error: err.message }));
    }
  }, []);

  const toggleGEEOverlay = useCallback((enabled) => {
    const map = mapRef.current;
    if (map.getLayer('gee-overlay-layer'))
      map.setLayoutProperty('gee-overlay-layer', 'visibility', enabled ? 'visible' : 'none');
    setGeeOverlay(prev => ({ ...prev, enabled }));
  }, []);

  const setGEEOverlayOpacity = useCallback((opacity) => {
    const map = mapRef.current;
    if (map.getLayer('gee-overlay-layer'))
      map.setPaintProperty('gee-overlay-layer', 'raster-opacity', opacity);
    setGeeOverlay(prev => ({ ...prev, opacity }));
  }, []);

  const removeGEEOverlay = useCallback(() => {
    const map = mapRef.current;
    if (map.getSource('gee-overlay')) {
      map.removeLayer('gee-overlay-layer');
      map.removeSource('gee-overlay');
    }
    geeTokenRef.current = '';
    setGeeOverlay({ mapName: null, tileUrl: null, enabled: false, opacity: 0.75, loading: false, error: null });
  }, []);

  // ── Basemap switching ───────────────────────────────────────────────────────
  useEffect(() => {
    // Skip if this basemap is already loaded (prevents duplicate setStyle on StrictMode double-invoke)
    if (basemap === currentBasemapRef.current) return;
    currentBasemapRef.current = basemap;
    const map = mapRef.current;
    if (!map) return;
    const bm = BASEMAPS.find(b => b.id === basemap);
    if (bm) map.setStyle(bm.style || bm.url, { diff: false });
  }, [basemap]);

  // ── Keep refs in sync with state (for re-sync after style switch) ───────────
  useEffect(() => { tileIndexRef.current = tileIndex; }, [tileIndex]);
  useEffect(() => { selectedTilesRef.current = selectedTiles; }, [selectedTiles]);
  useEffect(() => { selectedGridCellsRef.current = selectedGridCells; }, [selectedGridCells]);
  useEffect(() => { gridBoundaryRef.current = gridBoundary; }, [gridBoundary]);
  useEffect(() => { activeTabRef.current = activeTab; }, [activeTab]);

  // ── 50km grid: regenerate on map move ──────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let timer;
    const update = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!map.getSource('grid-50km')) return;
        const selectedIds = new Set(selectedGridCells.keys());
        // Always render selected cells regardless of zoom
        const selectedFeatures = [...selectedGridCells.values()].map(({ id, bbox }) => ({
          type: 'Feature',
          properties: { id, lon: bbox[0], lat: bbox[1], selected: true },
          geometry: { type: 'Polygon', coordinates: [[[bbox[0],bbox[1]],[bbox[2],bbox[1]],[bbox[2],bbox[3]],[bbox[0],bbox[3]],[bbox[0],bbox[1]]]] },
        }));
        // Add unselected visible cells only at zoom >= 5
        const visibleFeatures = generateVisibleGrid(map, selectedIds);
        const features = [...selectedFeatures, ...visibleFeatures.filter(f => !selectedIds.has(f.properties.id))];
        map.getSource('grid-50km').setData({ type: 'FeatureCollection', features });
      }, 200);
    };
    map.on('moveend', update);
    map.on('zoomend', update);
    if (map.isStyleLoaded()) update();
    return () => { map.off('moveend', update); map.off('zoomend', update); clearTimeout(timer); };
  }, [selectedGridCells]);

  // ── Sync country boundary overlay ──────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const src = map.getSource('country-boundary');
    if (!src) return;
    src.setData(gridBoundary
      ? { type: 'FeatureCollection', features: [gridBoundary] }
      : { type: 'FeatureCollection', features: [] });
  }, [gridBoundary]);

  // ── Hide MGRS tiles when Grid tab is active ────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const visibility = activeTab === 'grid' ? 'none' : 'visible';
      ['tiles-grid-fill', 'tiles-grid-line'].forEach(id => {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visibility);
      });
    };
    if (map.isStyleLoaded()) apply();
    else map.once('load', apply);
  }, [activeTab]);

  // ── Sync tile grid to map ───────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map?.getSource('tiles-grid')) return;
    const features = Object.values(tileIndex).map(({ mgrsId, feature }) => ({
      ...feature,
      id: mgrsId,
      properties: { ...feature.properties, mgrsId, selected: selectedTiles.has(mgrsId) },
    }));
    map.getSource('tiles-grid').setData({ type: 'FeatureCollection', features });
  }, [tileIndex, selectedTiles]);

  // ── AOI / drawing helpers ───────────────────────────────────────────────────
  const updateAoiLayer = useCallback((feature) => {
    aoiFeatureRef.current = feature;
    const map = mapRef.current;
    if (!map?.getSource('aoi')) return;
    map.getSource('aoi').setData({ type: 'FeatureCollection', features: [feature] });
  }, []);

  const updateDrawingLayer = useCallback((points) => {
    const map = mapRef.current;
    if (!map?.getSource('drawing')) return;
    if (points.length < 2) { map.getSource('drawing').setData({ type: 'FeatureCollection', features: [] }); return; }
    const coords = [...points, points[0]];
    map.getSource('drawing').setData({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] } }] });
  }, []);

  // ── Map click/dblclick for AOI tools ───────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const handleClick = (e) => {
      if (e.originalEvent?._handledByTile) return; // tile click handled above
      if (activeTool === 'click') {
        const { lng, lat } = e.lngLat;
        const bb = [lng - 0.5, lat - 0.5, lng + 0.5, lat + 0.5];
        setBbox(bb);
        updateAoiLayer(turf.bboxPolygon(bb));
        toast('Area set — click Search in Tools tab', 'info');
      } else if (activeTool === 'polygon') {
        const { lng, lat } = e.lngLat;
        setDrawPoints(prev => { const next = [...prev, [lng, lat]]; updateDrawingLayer(next); return next; });
      }
    };

    const handleDblClick = (e) => {
      if (activeTool === 'polygon') {
        e.preventDefault();
        setDrawPoints(prev => {
          if (prev.length < 3) { toast('Draw at least 3 points', 'error'); return prev; }
          const poly = turf.polygon([[...prev, prev[0]]]);
          setBbox(turf.bbox(poly));
          updateAoiLayer(poly);
          map.getSource('drawing')?.setData({ type: 'FeatureCollection', features: [] });
          setActiveTool(null);
          toast('Polygon drawn — click Search', 'success');
          return [];
        });
      }
    };

    map.getCanvas().style.cursor = (activeTool === 'click' || activeTool === 'polygon') ? 'crosshair' : '';
    map.on('click', handleClick);
    map.on('dblclick', handleDblClick);
    return () => {
      map.off('click', handleClick);
      map.off('dblclick', handleDblClick);
      map.getCanvas().style.cursor = '';
    };
  }, [activeTool, toast, updateAoiLayer, updateDrawingLayer]);

  // ── Search ──────────────────────────────────────────────────────────────────
  const handleSearch = useCallback(async () => {
    if (!bbox) { toast('Select an area first', 'error'); return; }
    setLoading(true);
    setActiveTab('tiles');
    setSelectedTiles(new Set());
    setSelectedScenes(new Set());
    try {
      const results = await searchScenes({ bbox, dateStart, dateEnd, maxCloud });
      setScenes(results);
      if (!results.length) toast('No scenes found — try wider range or higher cloud cover', 'info');
      else toast(`Found ${results.length} scenes across ${new Set(results.map(s => s.properties?.['s2:mgrs_tile'])).size} MGRS tiles`, 'success');
    } catch (err) {
      toast(`Search failed: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [bbox, dateStart, dateEnd, maxCloud, toast]);

  // ── Country geocode ─────────────────────────────────────────────────────────
  const handleCountrySearch = async () => {
    if (!countryQuery.trim()) return;
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(countryQuery)}&format=json&limit=1`, { headers: { 'Accept-Language': 'en' } });
      const data = await res.json();
      if (!data.length) { toast('Location not found', 'error'); return; }
      const { boundingbox, display_name } = data[0];
      const bb = [parseFloat(boundingbox[2]), parseFloat(boundingbox[0]), parseFloat(boundingbox[3]), parseFloat(boundingbox[1])];
      setBbox(bb);
      updateAoiLayer(turf.bboxPolygon(bb));
      mapRef.current.fitBounds([[bb[0], bb[1]], [bb[2], bb[3]]], { padding: 60, duration: 1000 });
      toast(`Zoomed to ${display_name.split(',')[0]}`, 'success');
    } catch { toast('Geocoding failed', 'error'); }
  };

  // ── Grid country selection ───────────────────────────────────────────────────
  const handleGridCountrySearch = async () => {
    if (!gridCountryQuery.trim()) return;
    try {
      // Step 1: Nominatim for geocoding — bounding box + country code
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(gridCountryQuery)}&format=json&limit=5&polygon_geojson=1`,
        { headers: { 'Accept-Language': 'en' } }
      );
      const data = await res.json();
      if (!data.length) { toast('Location not found', 'error'); return; }
      const result =
        data.find(r => r.class === 'boundary' && r.type === 'administrative' && parseFloat(r.importance || 0) > 0.7) ||
        data.find(r => r.class === 'boundary' && r.type === 'administrative') ||
        data[0];
      const { boundingbox, display_name, geojson } = result;
      const bb = [parseFloat(boundingbox[2]), parseFloat(boundingbox[0]), parseFloat(boundingbox[3]), parseFloat(boundingbox[1])];

      const boundary = geojson ? { type: 'Feature', geometry: geojson } : turf.bboxPolygon(bb);
      const candidates = generateCellsForBbox(bb);
      const simpleBoundary = turf.simplify(boundary, { tolerance: 0.01, highQuality: true });
      const cells = candidates.filter(c => {
        const cellPoly = turf.bboxPolygon(c.bbox);
        try { return turf.booleanIntersects(cellPoly, simpleBoundary); }
        catch { return false; }
      });

      if (!cells.length) { toast('No grid cells found for this location', 'error'); return; }
      setGridBoundary(boundary);
      setSelectedGridCells(prev => {
        const n = new Map(prev);
        cells.forEach(c => n.set(c.id, c));
        return n;
      });
      mapRef.current?.fitBounds([[bb[0], bb[1]], [bb[2], bb[3]]], { padding: 60, duration: 1000 });
      const name = display_name.split(',')[0];
      toast(`Added ${cells.length} grid cells for ${name}`, 'success');
      setActiveTab('grid');
    } catch (err) { toast(`Search failed: ${err.message}`, 'error'); }
  };

  // ── GeoJSON upload ──────────────────────────────────────────────────────────
  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) { toast('File too large (max 25 MB)', 'error'); return; }
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const geojson = JSON.parse(ev.target.result);
        const feature = geojson.type === 'FeatureCollection' ? geojson.features[0] : geojson.type === 'Feature' ? geojson : { type: 'Feature', geometry: geojson };
        const bb = turf.bbox(feature);
        setBbox(bb);
        updateAoiLayer(feature);
        mapRef.current.fitBounds([[bb[0], bb[1]], [bb[2], bb[3]]], { padding: 60, duration: 1000 });
        toast('GeoJSON loaded', 'success');
      } catch { toast('Invalid GeoJSON file', 'error'); }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // ── Clear ───────────────────────────────────────────────────────────────────
  const clearAll = () => {
    setScenes([]); setSelectedScenes(new Set()); setSelectedTiles(new Set());
    setSelectedGridCells(new Map()); setGridBoundary(null);
    setBbox(null); setDrawPoints([]); setActiveTool(null);
    aoiFeatureRef.current = null;
    const map = mapRef.current;
    ['aoi', 'drawing', 'tiles-grid'].forEach(src => {
      if (map?.getSource(src)) map.getSource(src).setData({ type: 'FeatureCollection', features: [] });
    });
    toast('Cleared', 'info');
  };

  // ── Share URL ───────────────────────────────────────────────────────────────
  const handleShare = () => {
    if (!bbox) { toast('No area selected', 'error'); return; }
    const url = new URL(window.location.href);
    url.searchParams.set('bbox', bbox.join(','));
    url.searchParams.set('ds', dateStart);
    url.searchParams.set('de', dateEnd);
    navigator.clipboard.writeText(url.toString()).then(() => toast('Share URL copied', 'success'));
  };

  // ── Restore from URL ────────────────────────────────────────────────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const bboxParam = params.get('bbox');
    if (bboxParam) {
      const bb = bboxParam.split(',').map(Number);
      if (bb.length === 4) {
        setBbox(bb);
        setTimeout(() => {
          const map = mapRef.current;
          if (map?.isStyleLoaded()) { updateAoiLayer(turf.bboxPolygon(bb)); map.fitBounds([[bb[0], bb[1]], [bb[2], bb[3]]], { padding: 60 }); }
        }, 1200);
      }
    }
    if (params.get('ds')) setDateStart(params.get('ds'));
    if (params.get('de')) setDateEnd(params.get('de'));
  }, [updateAoiLayer]);

  // ── Derived ─────────────────────────────────────────────────────────────────
  const uniqueTiles = Object.values(tileIndex);
  const selectedTileIds = [...selectedTiles];
  const scenesForSelectedTiles = scenes.filter(s => selectedTiles.has(s.properties?.['s2:mgrs_tile']));
  const selectedSceneObjects = scenes.filter(s => selectedScenes.has(s.id));

  const toggleSceneSelection = (id) => setSelectedScenes(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <>
      <div ref={mapEl} className="map-container" aria-label="Map" />

      <div className={`panel ${collapsed ? 'collapsed' : ''}`} role="complementary" aria-label="Control panel">
        <button className="panel-toggle" onClick={() => setCollapsed(c => !c)} aria-label={collapsed ? 'Expand panel' : 'Collapse panel'}>
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>

        {/* Header */}
        <div className="panel-header">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div className="wordmark">Sentinel<span>-2</span> Explorer</div>
              <div className="subtitle">L2A · Element84 STAC · Global</div>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span className="live-dot">Live</span>
              <button className="btn-icon" onClick={handleShare} aria-label="Share URL" title="Share URL"><Share2 size={13} /></button>
              <button className="btn-icon" onClick={clearAll} aria-label="Clear all" title="Clear all" style={{ color: 'var(--red)' }}><Trash2 size={13} /></button>
            </div>
          </div>
          <div className="stats-row">
            <div className="stat-bubble"><strong>{scenes.length}</strong>Scenes</div>
            <div className="stat-bubble"><strong>{uniqueTiles.length}</strong>MGRS Tiles</div>
            <div className="stat-bubble"><strong>{selectedTiles.size}</strong>Selected</div>
          </div>
        </div>

        {/* Tabs */}
        <div className="tabs" role="tablist">
          <button className={`tab ${activeTab === 'tools' ? 'active' : ''}`} onClick={() => setActiveTab('tools')} role="tab" aria-selected={activeTab === 'tools'}>
            <Layers size={13} /> Tools
          </button>
          <button className={`tab ${activeTab === 'tiles' ? 'active' : ''}`} onClick={() => setActiveTab('tiles')} role="tab" aria-selected={activeTab === 'tiles'}>
            <Grid3x3 size={13} /> Tiles
            {uniqueTiles.length > 0 && (
              <span style={{ background: 'rgba(16,185,129,0.2)', color: '#10b981', borderRadius: 10, padding: '0 5px', fontSize: 10, fontFamily: 'JetBrains Mono' }}>{uniqueTiles.length}</span>
            )}
          </button>
          <button className={`tab ${activeTab === 'scenes' ? 'active' : ''}`} onClick={() => setActiveTab('scenes')} role="tab" aria-selected={activeTab === 'scenes'}>
            <SatelliteDish size={13} /> Scenes
            {scenes.length > 0 && (
              <span style={{ background: 'rgba(6,182,212,0.2)', color: '#06b6d4', borderRadius: 10, padding: '0 5px', fontSize: 10, fontFamily: 'JetBrains Mono' }}>{scenes.length}</span>
            )}
          </button>
          <button className={`tab ${activeTab === 'chart' ? 'active' : ''}`} onClick={() => setActiveTab('chart')} role="tab" aria-selected={activeTab === 'chart'}>
            <BarChart2 size={13} />
          </button>
          <button className={`tab ${activeTab === 'grid' ? 'active' : ''}`} onClick={() => setActiveTab('grid')} role="tab" aria-selected={activeTab === 'grid'}>
            <MapIcon size={13} /> Grid
            {selectedGridCells.size > 0 && (
              <span style={{ background: 'rgba(245,158,11,0.2)', color: '#f59e0b', borderRadius: 10, padding: '0 5px', fontSize: 10, fontFamily: 'JetBrains Mono' }}>{selectedGridCells.size}</span>
            )}
          </button>
        </div>

        {/* ── Tools tab ── */}
        {activeTab === 'tools' && (
          <div className="tab-content">
            <div className="instruction-card">
              <strong>How to use</strong>
              Select an area, set filters, then Search. MGRS tiles will appear on the map — click tiles to select them for mosaic download.
            </div>

            <div className="section">
              <div className="section-title"><MapIcon size={12} /> Basemap</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 5 }}>
                {BASEMAPS.map(b => (
                  <button
                    key={b.id}
                    onClick={() => setBasemap(b.id)}
                    style={{
                      padding: '6px 4px', borderRadius: 7, fontSize: 11, fontWeight: 600,
                      cursor: 'pointer', border: '1px solid',
                      borderColor: basemap === b.id ? 'var(--gold)' : 'var(--border)',
                      background: basemap === b.id ? 'var(--gold-pale)' : '#fff',
                      color: basemap === b.id ? 'var(--gold)' : 'var(--muted)',
                      transition: 'all 0.15s',
                    }}
                  >{b.label}</button>
                ))}
              </div>
            </div>

            <GEEOverlayPanel
              overlay={geeOverlay}
              onLoad={loadGEEOverlay}
              onToggle={toggleGEEOverlay}
              onOpacityChange={setGEEOverlayOpacity}
              onRemove={removeGEEOverlay}
            />

            <div className="section">
              <div className="section-title"><MousePointer size={12} /> Area Selection</div>
              <div className="tool-grid">
                <button className={`tool-btn ${activeTool === 'click' ? 'active' : ''}`} onClick={() => setActiveTool(t => t === 'click' ? null : 'click')} aria-pressed={activeTool === 'click'}>
                  <MousePointer size={16} /> Click Map
                </button>
                <button className={`tool-btn ${activeTool === 'polygon' ? 'active' : ''}`} onClick={() => { setActiveTool(t => t === 'polygon' ? null : 'polygon'); setDrawPoints([]); }} aria-pressed={activeTool === 'polygon'}>
                  <PenLine size={16} /> Draw Polygon
                </button>
                <button className="tool-btn" onClick={() => fileInputRef.current?.click()}>
                  <Upload size={16} /> Upload GeoJSON
                </button>
                <button className="tool-btn" onClick={() => document.getElementById('country-input')?.focus()}>
                  <Globe size={16} /> Search Place
                </button>
              </div>
              <input ref={fileInputRef} type="file" accept=".geojson,.json" onChange={handleFileUpload} style={{ display: 'none' }} />
              {activeTool === 'polygon' && <p style={{ fontSize: 11, color: 'var(--amber)', marginTop: 8 }}>Click to add points · Double-click to close polygon</p>}
            </div>

            <div className="section">
              <div className="section-title"><Search size={12} /> Search Place or Country</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input id="country-input" className="input" placeholder="e.g. Ethiopia, Nepal, Amazon…" value={countryQuery} onChange={e => setCountryQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleCountrySearch()} aria-label="Search place" />
                <button className="btn btn-secondary btn-sm" onClick={handleCountrySearch}><Search size={13} /></button>
              </div>
            </div>

            <div className="section">
              <div className="section-title"><Calendar size={12} /> Date Range</div>
              <div className="date-row">
                <div><div className="label">From</div><input className="input" type="date" value={dateStart} max={dateEnd} onChange={e => setDateStart(e.target.value)} /></div>
                <div><div className="label">To</div><input className="input" type="date" value={dateEnd} min={dateStart} onChange={e => setDateEnd(e.target.value)} /></div>
              </div>
            </div>

            <div className="section">
              <div className="section-title">
                Max Cloud Cover
                <span style={{ marginLeft: 'auto', color: 'var(--emerald)', fontFamily: 'JetBrains Mono', fontSize: 12 }}>{maxCloud}%</span>
              </div>
              <input className="slider" type="range" min={0} max={100} step={5} value={maxCloud} onChange={e => setMaxCloud(Number(e.target.value))} />
            </div>

            <button className="btn btn-primary" onClick={handleSearch} disabled={loading} style={{ width: '100%' }}>
              {loading ? <><div className="spinner" /> Searching…</> : <><Search size={14} /> Search Scenes</>}
            </button>
          </div>
        )}

        {/* ── Tiles tab ── */}
        {activeTab === 'tiles' && (
          <div className="tab-content">
            {uniqueTiles.length > 0 ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>{selectedTiles.size} / {uniqueTiles.length} tiles selected</span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => setSelectedTiles(new Set(uniqueTiles.map(t => t.mgrsId)))}>All</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => setSelectedTiles(new Set())}>None</button>
                  </div>
                </div>

                {/* Mosaic download button */}
                <button
                  className="btn btn-primary"
                  style={{ width: '100%' }}
                  disabled={selectedTiles.size === 0}
                  onClick={() => { if (!selectedTiles.size) { toast('Select tiles first', 'error'); return; } setShowMosaic(true); }}
                >
                  <Terminal size={14} /> Yearly Median Mosaic Script ({selectedTiles.size} tile{selectedTiles.size !== 1 ? 's' : ''})
                </button>

                {/* Scene download for selected tiles */}
                <button
                  className="btn btn-secondary"
                  style={{ width: '100%' }}
                  disabled={selectedTiles.size === 0}
                  onClick={() => { if (!selectedTiles.size) { toast('Select tiles first', 'error'); return; } setSelectedScenes(new Set(scenesForSelectedTiles.map(s => s.id))); setShowDownload(true); }}
                >
                  <Download size={14} /> Download Individual Scenes ({scenesForSelectedTiles.length})
                </button>

                <div className="instruction-card" style={{ marginTop: 0 }}>
                  <strong>Tip</strong>
                  Click tiles on the map or from the list below to select them.
                </div>

                {/* Tile cards */}
                {uniqueTiles.sort((a, b) => a.mgrsId.localeCompare(b.mgrsId)).map(({ mgrsId, scenes: tileScenes, years }) => {
                  const isSelected = selectedTiles.has(mgrsId);
                  const avgCloud = tileScenes.reduce((s, sc) => s + (sc.properties?.['eo:cloud_cover'] ?? 0), 0) / tileScenes.length;
                  return (
                    <div
                      key={mgrsId}
                      className={`scene-item ${isSelected ? 'selected' : ''}`}
                      onClick={() => setSelectedTiles(prev => { const n = new Set(prev); n.has(mgrsId) ? n.delete(mgrsId) : n.add(mgrsId); return n; })}
                      role="checkbox"
                      aria-checked={isSelected}
                      tabIndex={0}
                      onKeyDown={e => e.key === ' ' && setSelectedTiles(prev => { const n = new Set(prev); n.has(mgrsId) ? n.delete(mgrsId) : n.add(mgrsId); return n; })}
                      style={{ cursor: 'pointer' }}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => setSelectedTiles(prev => { const n = new Set(prev); n.has(mgrsId) ? n.delete(mgrsId) : n.add(mgrsId); return n; })}
                        onClick={e => e.stopPropagation()}
                        style={{ accentColor: 'var(--emerald)', marginTop: 2, flexShrink: 0 }}
                      />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div className="scene-id" style={{ color: 'var(--emerald)', fontSize: 13, fontWeight: 600 }}>{mgrsId}</div>
                        <div className="scene-meta">
                          <span className="scene-badge badge-date">{tileScenes.length} scene{tileScenes.length !== 1 ? 's' : ''}</span>
                          <span className="scene-badge badge-cloud">☁ avg {Math.round(avgCloud)}%</span>
                          <span style={{ fontSize: 10, color: 'var(--muted)' }}>{[...years].sort().join(', ')}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </>
            ) : (
              <div className="empty-state">
                <Grid3x3 size={36} />
                <p>No tiles yet.</p>
                <p style={{ marginTop: 6, fontSize: 12 }}>Select an area and search in the Tools tab. MGRS tiles will appear here and on the map.</p>
              </div>
            )}
          </div>
        )}

        {/* ── Scenes tab ── */}
        {activeTab === 'scenes' && (
          <div className="tab-content">
            {scenes.length > 0 ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>{selectedScenes.size} / {scenes.length} selected</span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => setSelectedScenes(new Set(scenes.map(s => s.id)))}>All</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => setSelectedScenes(new Set())}>None</button>
                    <button className="btn btn-primary btn-sm" disabled={!selectedScenes.size} onClick={() => { if (!selectedScenes.size) { toast('Select scenes first', 'error'); return; } setShowDownload(true); }}>
                      <Download size={13} /> Download
                    </button>
                  </div>
                </div>

                {scenes.map(scene => {
                  const cloud = scene.properties?.['eo:cloud_cover'];
                  const dt    = scene.properties?.datetime?.slice(0, 10);
                  const tile  = scene.properties?.['grid:code']?.replace(/^MGRS-/, '') || '';
                  const isSelected = selectedScenes.has(scene.id);
                  return (
                    <div
                      key={scene.id}
                      className={`scene-item ${isSelected ? 'selected' : ''}`}
                      onClick={() => toggleSceneSelection(scene.id)}
                      role="checkbox"
                      aria-checked={isSelected}
                      tabIndex={0}
                      onKeyDown={e => e.key === ' ' && toggleSceneSelection(scene.id)}
                      style={{ cursor: 'pointer', userSelect: 'none' }}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSceneSelection(scene.id)}
                        onClick={e => e.stopPropagation()}
                        style={{ accentColor: 'var(--cyan)', marginTop: 2, flexShrink: 0 }}
                      />
                      <div style={{ minWidth: 0 }}>
                        <div className="scene-id">{scene.id}</div>
                        <div className="scene-meta">
                          {dt   && <span className="scene-badge badge-date">{dt}</span>}
                          {cloud != null && <span className="scene-badge badge-cloud">☁ {Math.round(cloud)}%</span>}
                          {tile && <span style={{ fontSize: 10, color: 'var(--muted)' }}>MGRS {tile}</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </>
            ) : (
              <div className="empty-state">
                <SatelliteDish size={36} />
                <p>No scenes loaded yet.</p>
                <p style={{ marginTop: 6, fontSize: 12 }}>Search in the Tools tab first.</p>
              </div>
            )}
          </div>
        )}

        {/* ── Chart tab ── */}
        {activeTab === 'chart' && (
          <div className="tab-content">
            {scenes.length > 0
              ? <SceneChart scenes={scenes} />
              : <div className="empty-state"><BarChart2 size={36} /><p>Search scenes to see date distribution.</p></div>}
          </div>
        )}

        {/* ── Grid tab ── */}
        {activeTab === 'grid' && (
          <div className="tab-content">
            <div className="instruction-card">
              <strong>50 km × 50 km Global Grid</strong>
              Zoom in to level 5+ to see the grid. Click cells on the map, or search a country to select all cells covering it.
            </div>

            {/* Country search */}
            <div className="section">
              <div className="section-title"><Globe size={12} /> Select by Country / Place</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  className="input"
                  placeholder="e.g. Thailand, Cambodia…"
                  value={gridCountryQuery}
                  onChange={e => setGridCountryQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleGridCountrySearch()}
                />
                <button className="btn btn-secondary btn-sm" onClick={handleGridCountrySearch}><Search size={13} /></button>
              </div>
            </div>
            {selectedGridCells.size > 0 ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>{selectedGridCells.size} cell{selectedGridCells.size !== 1 ? 's' : ''} selected</span>
                  <button className="btn btn-secondary btn-sm" onClick={() => { setSelectedGridCells(new Map()); setGridBoundary(null); }}>Clear</button>
                </div>
                <button
                  className="btn btn-primary"
                  style={{ width: '100%' }}
                  onClick={() => setShowGridMosaic(true)}
                >
                  <Terminal size={14} /> Yearly Median Mosaic Script ({selectedGridCells.size} cell{selectedGridCells.size !== 1 ? 's' : ''})
                </button>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, maxHeight: 200, overflowY: 'auto' }}>
                  {[...selectedGridCells.values()].map(({ id }) => (
                    <span
                      key={id}
                      onClick={() => setSelectedGridCells(prev => { const n = new Map(prev); n.delete(id); return n; })}
                      title="Click to deselect"
                      style={{
                        fontFamily: 'JetBrains Mono', fontSize: 11,
                        background: 'rgba(245,158,11,0.1)',
                        border: '1px solid rgba(245,158,11,0.3)',
                        borderRadius: 5, padding: '2px 8px',
                        color: 'var(--amber)', cursor: 'pointer',
                      }}
                    >{id}</span>
                  ))}
                </div>
              </>
            ) : (
              <div className="empty-state">
                <MapIcon size={36} />
                <p>No grid cells selected.</p>
                <p style={{ marginTop: 6, fontSize: 12 }}>Zoom in to level 5+ to see the global 50 km grid, then click cells on the map to select them.</p>
              </div>
            )}
          </div>
        )}

        <div className="attribution">
          Data: <a href="https://earth-search.aws.element84.com/v1" target="_blank" rel="noreferrer">Element84 STAC</a>
          {' · '}
          <a href="https://registry.opendata.aws/sentinel-2-l2a-cogs/" target="_blank" rel="noreferrer">Sentinel-2 L2A COGs</a>
          {' · '} ESA Copernicus
        </div>
      </div>

      {showDownload    && <DownloadModal scenes={selectedSceneObjects.length ? selectedSceneObjects : scenesForSelectedTiles} onClose={() => setShowDownload(false)} toast={toast} />}
      {showMosaic      && <MosaicModal mode="mgrs" tileIds={selectedTileIds} onClose={() => setShowMosaic(false)} toast={toast} />}
      {showGridMosaic  && <MosaicModal mode="grid" gridCells={[...selectedGridCells.values()]} onClose={() => setShowGridMosaic(false)} toast={toast} />}
      <Toast toasts={toasts} />
    </>
  );
}
