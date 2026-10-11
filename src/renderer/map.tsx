// 地图页签：PixiJS 画网格与刻度、生成的地形层、据点、连线、部队记号。
// 硬要求（设计 §十）：场景只建一次，平移只改容器的变换；
// 只有缩放变化、或据点与连线的几何变了，才重画线与重新补偿每个记号的缩放。
import { Application, Container, Graphics, Text } from 'pixi.js';
import { useEffect, useRef, useState } from 'react';
import { mulberry32 } from '../engine/rng.ts';
import type { Params, Site, Theme, World } from '../engine/types.ts';

/** 生成地形用的固定种子：同一份参数每次生成出同一张图。 */
const TERRAIN_SEED = 20261011;

/** 低于这个缩放只画点与线；高于它才出名字与部队记号（设计 §十 的分级显示）。 */
const DETAIL_ZOOM = 0.09;

interface Palette {
  grid: number;
  border: number;
  sea: number;
  river: number;
  hill: number;
  link: number;
  site: number;
  label: number;
  unit: number;
}

const PALETTES: Record<Theme, Palette> = {
  light: {
    grid: 0xe2e6eb, border: 0xc4cad3, sea: 0xd3e5f3, river: 0x9ec6e6, hill: 0xd9d3c7,
    link: 0x8d949d, site: 0x8a5a12, label: 0x1b2027, unit: 0x1f6feb,
  },
  dark: {
    grid: 0x1c2734, border: 0x2c3a4a, sea: 0x14303f, river: 0x2a5468, hill: 0x2a2f36,
    link: 0x5f6d7b, site: 0xe8c07a, label: 0xd6e2ee, unit: 0x63a4ff,
  },
};

interface Scene {
  app: Application;
  root: Container;
  terrain: Graphics;
  grid: Graphics;
  links: Graphics;
  sites: Container;
  units: Container;
  siteGfx: Map<number, Graphics>;
  siteLabel: Map<number, Text>;
  unitGfx: Map<number, Graphics>;
  gfxToSite: Map<Graphics, number>;
  palette: Palette;
  zoom: number;
}

/** 线宽按屏幕像素折算成世界单位，缩放多大看起来都一样粗。 */
function px(scene: Scene, screenPx: number): number {
  return screenPx / scene.zoom;
}

function siteRadius(site: Site): number {
  return 3 + Math.min(5, site.scale) * 0.9;
}

/** 网格、边框、海、两条大河、几片山地。种子固定，重画多少次都是同一张。 */
function drawTerrain(scene: Scene, params: Params): void {
  const { terrain, grid, palette } = scene;
  const W = params.mapWidth;
  const H = params.mapHeight;
  const rnd = mulberry32(TERRAIN_SEED);

  terrain.clear();

  // 海：右下角一块。海岸线从下边 x=0.45W 起伏到右边 y=0.55H。
  const coast: number[] = [];
  const steps = 24;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const x = W * (0.45 + 0.55 * t);
    const y = H * (0.55 * t) + (rnd() - 0.5) * H * 0.05;
    coast.push(x, Math.max(0, Math.min(H, y)));
  }
  terrain.poly([...coast, W, 0], true);
  terrain.fill({ color: palette.sea, alpha: 0.6 });

  // 两条大河：从左边缘蜿蜒向东，到海岸附近收住。
  for (const base of [0.38, 0.68]) {
    const river: number[] = [];
    for (let i = 0; i <= 30; i += 1) {
      const t = i / 30;
      const x = W * (0.03 + 0.62 * t);
      const y = H * base + Math.sin(t * 5.5 + base * 12) * H * 0.045 + (rnd() - 0.5) * H * 0.015;
      river.push(x, Math.max(0, Math.min(H, y)));
    }
    terrain.poly(river, false);
    terrain.stroke({ color: palette.river, width: px(scene, 2.4), alpha: 0.9 });
  }

  // 几片山地：左上那一半，每片一簇小三角。
  for (let c = 0; c < 5; c += 1) {
    const cx = W * (0.06 + rnd() * 0.5);
    const cy = H * (0.45 + rnd() * 0.45);
    const r = W * (0.02 + rnd() * 0.02);
    for (let k = 0; k < 7; k += 1) {
      const x = cx + (rnd() - 0.5) * r * 2;
      const y = cy + (rnd() - 0.5) * r;
      const h = r * (0.16 + rnd() * 0.2);
      terrain.poly([x - h, y, x, y + h * 1.6, x + h, y], true);
      terrain.fill({ color: palette.hill, alpha: 0.8 });
    }
  }

  // 地图边框
  terrain.rect(0, 0, W, H);
  terrain.stroke({ color: palette.border, width: px(scene, 1.2) });

  // 网格：每 1000 单位一条
  grid.clear();
  for (let x = 0; x <= W; x += 1000) grid.moveTo(x, 0).lineTo(x, H);
  for (let y = 0; y <= H; y += 1000) grid.moveTo(0, y).lineTo(W, y);
  grid.stroke({ color: palette.grid, width: px(scene, 1) });
}

function drawLinks(scene: Scene, world: World): void {
  const { links, palette } = scene;
  links.clear();
  for (const l of world.links) {
    const a = world.sites.find((s) => s.id === l.a);
    const b = world.sites.find((s) => s.id === l.b);
    if (!a || !b) continue;
    links.moveTo(a.x, a.y).lineTo(b.x, b.y);
  }
  links.stroke({ color: palette.link, width: px(scene, 1.6), alpha: 0.85 });
}

/** 据点与它的名字。只在据点集合或坐标变了时调用。 */
function syncSites(scene: Scene, world: World): void {
  const { sites, siteGfx, siteLabel, gfxToSite, palette } = scene;
  const seen = new Set<number>();

  for (const s of world.sites) {
    seen.add(s.id);
    let g = siteGfx.get(s.id);
    if (!g) {
      g = new Graphics();
      g.eventMode = 'static';
      g.cursor = 'pointer';
      sites.addChild(g);
      siteGfx.set(s.id, g);
      gfxToSite.set(g, s.id);
      const label = new Text({
        text: s.name,
        style: { fontSize: 12, fill: palette.label, fontFamily: 'Consolas, ui-monospace, monospace' },
      });
      label.anchor.set(0.5, 0.5);
      sites.addChild(label);
      siteLabel.set(s.id, label);
    }
    g.clear();
    g.circle(0, 0, siteRadius(s)).fill({ color: palette.site });
    g.position.set(s.x, s.y);
    const label = siteLabel.get(s.id);
    if (label) {
      label.text = s.name;
      label.style.fill = palette.label;
    }
  }

  for (const [id, g] of siteGfx) {
    if (seen.has(id)) continue;
    gfxToSite.delete(g);
    g.destroy();
    siteGfx.delete(id);
    siteLabel.get(id)?.destroy();
    siteLabel.delete(id);
  }
}

/** 部队记号：在据点里贴在据点边上，在路上按进度插值。每推进一天都会调一次，很便宜。 */
function syncUnits(scene: Scene, world: World): void {
  const { units, unitGfx, palette } = scene;
  const seen = new Set<number>();

  for (const u of world.units) {
    seen.add(u.id);
    let g = unitGfx.get(u.id);
    if (!g) {
      g = new Graphics();
      g.poly([0, -6, 6, 0, 0, 6, -6, 0], true);
      g.fill({ color: palette.unit });
      units.addChild(g);
      unitGfx.set(u.id, g);
    }
    const pl = u.place;
    if (pl.kind === 'site') {
      const s = world.sites.find((x) => x.id === pl.site);
      if (s) g.position.set(s.x + 8, s.y + 8);
    } else {
      const a = world.sites.find((x) => x.id === pl.from);
      const b = world.sites.find((x) => x.id === pl.to);
      if (a && b) g.position.set(a.x + (b.x - a.x) * pl.t, a.y + (b.y - a.y) * pl.t);
    }
  }

  for (const [id, g] of unitGfx) {
    if (seen.has(id)) continue;
    g.destroy();
    unitGfx.delete(id);
  }
}

/**
 * 缩放或几何变了之后调一次：重画线与底图，并让每个记号与标签在屏幕上保持固定大小。
 * 平移不会走到这里——平移只改 root 的变换。
 */
function redraw(scene: Scene, world: World, params: Params): void {
  const { zoom } = scene;
  drawTerrain(scene, params);
  drawLinks(scene, world);

  for (const g of scene.siteGfx.values()) g.scale.set(1 / zoom);
  for (const g of scene.unitGfx.values()) {
    g.scale.set(1 / zoom);
    g.visible = zoom >= DETAIL_ZOOM;
  }
  for (const [id, label] of scene.siteLabel) {
    const s = world.sites.find((x) => x.id === id);
    if (!s) continue;
    // y 取负：抵消根容器的 y 翻转，字才是正的。
    label.scale.set(1 / zoom, -1 / zoom);
    label.position.set(s.x, s.y - (siteRadius(s) + 11) / zoom);
    label.visible = zoom >= DETAIL_ZOOM;
  }
}

export interface MapViewProps {
  world: World;
  params: Params;
  theme: Theme;
  onAddSite: (x: number, y: number) => void;
}

export function MapView({ world, params, theme, onAddSite }: MapViewProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<Scene | null>(null);
  const hoverTimer = useRef<number | null>(null);
  const addSiteRef = useRef(onAddSite);
  const worldRef = useRef(world);
  const paramsRef = useRef(params);
  const [showTerrain, setShowTerrain] = useState(true);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [hover, setHover] = useState<{ site: Site; x: number; y: number } | null>(null);

  addSiteRef.current = onAddSite;
  worldRef.current = world;
  paramsRef.current = params;

  // 建场景。依赖为空：只建一次。
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    const scene: Scene = {
      app: new Application(),
      root: new Container(),
      terrain: new Graphics(),
      grid: new Graphics(),
      links: new Graphics(),
      sites: new Container(),
      units: new Container(),
      siteGfx: new Map(),
      siteLabel: new Map(),
      unitGfx: new Map(),
      gfxToSite: new Map(),
      palette: PALETTES[theme],
      zoom: 1,
    };
    sceneRef.current = scene;

    void scene.app
      .init({ backgroundAlpha: 0, antialias: true, resizeTo: host })
      .then(() => {
        if (disposed) return;
        const canvas = scene.app.canvas;
        host.appendChild(canvas);
        scene.app.stage.eventMode = 'static';
        scene.app.stage.hitArea = scene.app.screen;
        scene.app.stage.addChild(scene.root);
        scene.root.addChild(scene.terrain, scene.grid, scene.links, scene.sites, scene.units);

        const width = scene.app.screen.width;
        const height = scene.app.screen.height;
        const margin = 20;
        scene.zoom = Math.min(
          (width - margin * 2) / paramsRef.current.mapWidth,
          (height - margin * 2) / paramsRef.current.mapHeight,
        );
        scene.root.scale.set(scene.zoom, -scene.zoom);
        scene.root.position.set(margin, height - margin);

        syncSites(scene, worldRef.current);
        syncUnits(scene, worldRef.current);
        redraw(scene, worldRef.current, paramsRef.current);

        const toWorld = (sx: number, sy: number) => ({
          x: (sx - scene.root.position.x) / scene.zoom,
          y: (scene.root.position.y - sy) / scene.zoom,
        });
        const zoomAt = (sx: number, sy: number, factor: number) => {
          const before = toWorld(sx, sy);
          scene.zoom = Math.max(0.02, Math.min(6, scene.zoom * factor));
          scene.root.scale.set(scene.zoom, -scene.zoom);
          scene.root.position.set(sx - before.x * scene.zoom, sy + before.y * scene.zoom);
          redraw(scene, worldRef.current, paramsRef.current);
        };

        let dragging = false;
        let lastX = 0;
        let lastY = 0;

        const onWheel = (e: WheelEvent) => {
          e.preventDefault();
          const r = canvas.getBoundingClientRect();
          zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0012));
        };
        const onDown = (e: PointerEvent) => {
          dragging = true;
          lastX = e.clientX;
          lastY = e.clientY;
          canvas.setPointerCapture(e.pointerId);
        };
        const onMove = (e: PointerEvent) => {
          if (dragging) {
            scene.root.position.x += e.clientX - lastX;
            scene.root.position.y += e.clientY - lastY;
            lastX = e.clientX;
            lastY = e.clientY;
          }
          const r = canvas.getBoundingClientRect();
          const p = toWorld(e.clientX - r.left, e.clientY - r.top);
          setCursor({ x: Math.round(p.x), y: Math.round(p.y) });
        };
        const onUp = (e: PointerEvent) => {
          dragging = false;
          if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
        };
        const onDouble = (e: MouseEvent) => {
          const r = canvas.getBoundingClientRect();
          const p = toWorld(e.clientX - r.left, e.clientY - r.top);
          addSiteRef.current(Math.round(p.x), Math.round(p.y));
        };

        canvas.addEventListener('wheel', onWheel, { passive: false });
        canvas.addEventListener('pointerdown', onDown);
        canvas.addEventListener('pointermove', onMove);
        canvas.addEventListener('pointerup', onUp);
        canvas.addEventListener('pointerleave', () => setCursor(null));
        canvas.addEventListener('dblclick', onDouble);

        scene.sites.on('pointerover', (e) => {
          const id = scene.gfxToSite.get(e.target as Graphics);
          if (id === undefined) return;
          if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
          hoverTimer.current = window.setTimeout(() => {
            const s = worldRef.current.sites.find((x) => x.id === id);
            if (!s) return;
            const rect = canvas.getBoundingClientRect();
            setHover({
              site: s,
              x: scene.root.position.x + s.x * scene.zoom - rect.left,
              y: scene.root.position.y - s.y * scene.zoom - rect.top,
            });
          }, 200);
        });
        scene.sites.on('pointerout', () => {
          if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
          setHover(null);
        });
      });

    return () => {
      disposed = true;
      if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
      sceneRef.current = null;
      scene.app.destroy(true, { children: true });
    };
    // 只在挂载时建一次；主题、参数、世界的变化由下面几个 effect 处理。
  }, []);

  // 地图的框或主题变了：换色板、重画底图。
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.palette = PALETTES[theme];
    redraw(scene, worldRef.current, params);
  }, [theme, params]);

  // 据点或连线的几何变了（新增、删掉、改坐标、改规模）：重建据点那一层。
  const siteKey = world.sites.map((s) => s.id + ':' + s.x + ',' + s.y + ',' + s.scale).join('|');
  const linkKey = world.links.map((l) => l.id + ':' + l.a + '-' + l.b).join('|');
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    syncSites(scene, worldRef.current);
    redraw(scene, worldRef.current, paramsRef.current);
  }, [siteKey, linkKey]);

  // 世界每变一次（推进一天、改一个数）都走这里：只更新部队记号的位置。
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    syncUnits(scene, world);
  }, [world]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.terrain.visible = showTerrain;
  }, [showTerrain]);

  return (
    <div className="mapwrap">
      <div className="map" ref={hostRef} />
      <div className="mapbar">
        <label className="dim small">
          <input type="checkbox" checked={showTerrain} onChange={(e) => setShowTerrain(e.target.checked)} /> 生成的地形层
        </label>
        <span className="dim small">滚轮缩放 · 拖动平移 · 双击新增据点</span>
        <span className="dim small">{cursor ? '坐标 ' + String(cursor.x) + ', ' + String(cursor.y) : '坐标 —'}</span>
      </div>
      {hover ? (
        <div className="maphover" style={{ left: String(hover.x + 12) + 'px', top: String(hover.y + 12) + 'px' }}>
          <strong>{hover.site.name}</strong>
          <div>
            规模 {hover.site.scale} · 人口 {hover.site.population}
          </div>
          <div>
            民心 {Math.round(hover.site.morale)} · 稳定 {Math.round(hover.site.stability)}
          </div>
          <div>
            坐标 {hover.site.x}, {hover.site.y}
          </div>
        </div>
      ) : null}
    </div>
  );
}
