// 地图页签：PixiJS 画网格与刻度、生成的地形层、据点、连线、部队记号。
// 硬要求（设计 §十）：场景只建一次，平移只改容器的变换；
// 只有缩放变化、或据点与连线的几何变了，才重画线与重新补偿每个记号的缩放。
import { Application, Container, Graphics, Text } from 'pixi.js';
import { useEffect, useRef, useState } from 'react';
import { mulberry32 } from '../engine/rng.ts';
import type { Params, Site, Theme, Unit, World } from '../engine/types.ts';
import { placeText, round2 } from './format.ts';

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
  siteStart: number;
  label: number;
  unit: number;
}

const PALETTES: Record<Theme, Palette> = {
  light: {
    grid: 0xe2e6eb, border: 0xc4cad3, sea: 0xd3e5f3, river: 0x9ec6e6, hill: 0xd9d3c7,
    link: 0x8d949d, site: 0x8a5a12, siteStart: 0xd9480f, label: 0x1b2027, unit: 0x1f6feb,
  },
  dark: {
    grid: 0x1c2734, border: 0x2c3a4a, sea: 0x14303f, river: 0x2a5468, hill: 0x2a2f36,
    link: 0x5f6d7b, site: 0xe8c07a, siteStart: 0xff8c42, label: 0xd6e2ee, unit: 0x63a4ff,
  },
};

/** 一条刻度数字：贴在哪条轴上、刻度值是多少。 */
interface GridLabel {
  text: Text;
  axis: 'x' | 'y';
  value: number;
}

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
  unitGfxToUnit: Map<Graphics, number>;
  /** 两条轴上的刻度数字，画在网格上面、连线下面。 */
  gridText: Container;
  gridLabels: GridLabel[];
  palette: Palette;
  zoom: number;
  /** 正在挑的起点据点；没有就是 null。只影响据点圆点画成什么颜色。 */
  start: number | null;
  /** 正在挑目的地的那支部队；没有就是 null。只影响部队记号画成什么颜色。 */
  pickUnit: number | null;
  /** 有没有按画布尺寸摆过一次。地图一开就藏着时画布是 0 尺寸，摆不了。 */
  fitted: boolean;
}

/** 线宽按屏幕像素折算成世界单位，缩放多大看起来都一样粗。 */
function px(scene: Scene, screenPx: number): number {
  return screenPx / scene.zoom;
}

function siteRadius(site: Site): number {
  return 3 + Math.min(5, site.scale) * 0.9;
}

/**
 * 屏幕上这个点落在哪个据点的圆圈里，返回据点 id；没落在任何据点上就返回 0。
 * 记号是按 1/zoom 反向缩放的，所以它在屏幕上量出来的半径就是 siteRadius 那个数。
 */
function siteAt(scene: Scene, world: World, sx: number, sy: number): number {
  let best = 0;
  let bestDistance = Infinity;
  for (const s of world.sites) {
    const cx = scene.root.position.x + s.x * scene.zoom;
    const cy = scene.root.position.y - s.y * scene.zoom;
    const d = Math.hypot(sx - cx, sy - cy);
    if (d <= siteRadius(s) + 3 && d < bestDistance) {
      bestDistance = d;
      best = s.id;
    }
  }
  return best;
}

/** 比例尺取一个整齐的数：让它在屏幕上大约 100 像素宽。 */
function scaleUnits(zoom: number): number {
  const target = 100 / zoom;
  const pow = Math.pow(10, Math.floor(Math.log10(target)));
  for (const m of [1, 2, 5, 10]) {
    if (pow * m >= target) return pow * m;
  }
  return pow * 10;
}

/** 把整张地图摆进画布：一进来的时候、以及按「缩到全图」都走这里。画布还没有尺寸就先不摆。 */
function fitView(scene: Scene, params: Params): void {
  const { width, height } = scene.app.screen;
  if (width < 50 || height < 50) return;
  const margin = 20;
  scene.zoom = Math.min(
    (width - margin * 2) / params.mapWidth,
    (height - margin * 2) / params.mapHeight,
  );
  scene.root.scale.set(scene.zoom, -scene.zoom);
  scene.root.position.set(margin, height - margin);
  scene.fitted = true;
}

/** 边界：地图至少留 60 像素在画面里，别拖成一片空白。 */
function clampPosition(scene: Scene, params: Params): void {
  const keep = 60;
  const { width, height } = scene.app.screen;
  const spanX = params.mapWidth * scene.zoom;
  const spanY = params.mapHeight * scene.zoom;
  const p = scene.root.position;
  p.x = Math.min(width - keep, Math.max(keep - spanX, p.x));
  p.y = Math.min(height - keep + spanY, Math.max(keep, p.y));
}

/** 两条轴上的刻度数字：每 1000 单位一个。参数变了才重建，缩放只改位置。 */
function syncGridLabels(scene: Scene, params: Params): void {
  for (const g of scene.gridLabels) g.text.destroy();
  scene.gridLabels = [];
  const style = { fontSize: 11, fill: scene.palette.label, fontFamily: 'Consolas, ui-monospace, monospace' };
  for (let x = 0; x <= params.mapWidth; x += 1000) {
    const text = new Text({ text: String(x), style });
    text.anchor.set(0.5, 0.5);
    text.alpha = 0.7;
    scene.gridText.addChild(text);
    scene.gridLabels.push({ text, axis: 'x', value: x });
  }
  for (let y = 1000; y <= params.mapHeight; y += 1000) {
    const text = new Text({ text: String(y), style });
    text.anchor.set(0, 0.5);
    text.alpha = 0.7;
    scene.gridText.addChild(text);
    scene.gridLabels.push({ text, axis: 'y', value: y });
  }
}

/** 刻度数字的位置与大小：贴着两条边，屏幕上大小固定；太挤的时候整批不画。 */
function layoutGridLabels(scene: Scene): void {
  const pad = 10;
  const roomy = 1000 * scene.zoom >= 30;
  for (const g of scene.gridLabels) {
    g.text.visible = roomy;
    g.text.scale.set(1 / scene.zoom, -1 / scene.zoom);
    if (g.axis === 'x') g.text.position.set(g.value, pad / scene.zoom);
    else g.text.position.set(pad / scene.zoom, g.value);
  }
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
    // 起点那个据点外面套一圈。两笔都是填充，宽度就是屏幕上固定的几像素，不随缩放变。
    const r = siteRadius(s);
    if (s.id === scene.start) g.circle(0, 0, r + 3.5).fill({ color: palette.siteStart });
    g.circle(0, 0, r).fill({ color: palette.site });
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
/** 部队记号的样子：外面套一圈就是「正在挑它作目的地」。两笔都是填充，宽度不随缩放变。 */
function drawUnitMarker(scene: Scene, u: Unit): void {
  const g = scene.unitGfx.get(u.id);
  if (!g) return;
  const r = 6;
  g.clear();
  if (u.id === scene.pickUnit) {
    g.poly([0, -(r + 3.5), r + 3.5, 0, 0, r + 3.5, -(r + 3.5), 0], true).fill({ color: scene.palette.siteStart });
  }
  g.poly([0, -r, r, 0, 0, r, -r, 0], true).fill({ color: scene.palette.unit });
}

function syncUnits(scene: Scene, world: World): void {
  const { units, unitGfx, unitGfxToUnit } = scene;
  const seen = new Set<number>();

  for (const u of world.units) {
    seen.add(u.id);
    let g = unitGfx.get(u.id);
    if (!g) {
      g = new Graphics();
      // 记号要能命中，浮层才知道指的是哪一支部队。容器是 passive 时，子对象照样可以设成 static。
      g.eventMode = 'static';
      g.cursor = 'pointer';
      units.addChild(g);
      unitGfx.set(u.id, g);
      unitGfxToUnit.set(g, u.id);
      drawUnitMarker(scene, u);
    }
    const p = unitWorldPos(world, u);
    if (p) g.position.set(p.x, p.y);
  }

  for (const [id, g] of unitGfx) {
    if (seen.has(id)) continue;
    unitGfxToUnit.delete(g);
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

  layoutGridLabels(scene);
}

/** 悬停浮层的内容：指到据点就显示据点，指到部队记号就显示那支部队。x／y 是浮层左上角。 */
type Hover =
  | { kind: 'site'; site: Site; x: number; y: number }
  | { kind: 'unit'; unit: Unit; x: number; y: number };

/** 部队记号在世界里的位置：停在据点里就贴在那个据点边上，在路上按行军进度插值。 */
function unitWorldPos(world: World, u: Unit): { x: number; y: number } | null {
  const pl = u.place;
  if (pl.kind === 'site') {
    const s = world.sites.find((x) => x.id === pl.site);
    return s ? { x: s.x + 8, y: s.y + 8 } : null;
  }
  const a = world.sites.find((x) => x.id === pl.from);
  const b = world.sites.find((x) => x.id === pl.to);
  return a && b ? { x: a.x + (b.x - a.x) * pl.t, y: a.y + (b.y - a.y) * pl.t } : null;
}

export interface MapViewProps {
  world: World;
  params: Params;
  theme: Theme;
  /** 正在挑的起点据点；没有就是 null。 */
  startSite: number | null;
  /** 正在挑目的地的那支部队；没有就是 null。 */
  pickUnit: number | null;
  /** 正在挑什么，写在工具行里；没在挑就是 null。 */
  pickHint: string | null;
  /** 这一个页签是不是当前显示的那一个：藏起来的时候跳过节拍里的记号同步。 */
  visible: boolean;
  /** 「定位」请求：n 是次数，同一个目标按两次也要重新定位一次。 */
  focus: { kind: 'site' | 'unit'; id: number; n: number } | null;
  onAddSite: (x: number, y: number) => void;
  onPickSite: (id: number) => void;
  onCancelPick: () => void;
}

/** 工具行上写的几行读数。 */
interface ViewInfo {
  zoom: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export function MapView({
  world,
  params,
  theme,
  visible,
  startSite,
  pickUnit,
  pickHint,
  focus,
  onAddSite,
  onPickSite,
  onCancelPick,
}: MapViewProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<Scene | null>(null);
  const hoverTimer = useRef<number | null>(null);
  const addSiteRef = useRef(onAddSite);
  const pickRef = useRef(onPickSite);
  const cancelRef = useRef(onCancelPick);
  const worldRef = useRef(world);
  const paramsRef = useRef(params);
  const visibleRef = useRef(visible);
  const focusRef = useRef(focus);
  const actionsRef = useRef<{
    zoomBy: (factor: number) => void;
    fit: () => void;
    refresh: () => void;
    focusOn: (kind: 'site' | 'unit', id: number) => void;
  } | null>(null);
  const [showTerrain, setShowTerrain] = useState(true);
  const [view, setView] = useState<ViewInfo>({ zoom: 1, x0: 0, x1: 0, y0: 0, y1: 0 });
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);

  addSiteRef.current = onAddSite;
  pickRef.current = onPickSite;
  cancelRef.current = onCancelPick;
  worldRef.current = world;
  paramsRef.current = params;
  visibleRef.current = visible;
  focusRef.current = focus;

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
      gridText: new Container(),
      links: new Graphics(),
      sites: new Container(),
      units: new Container(),
      siteGfx: new Map(),
      siteLabel: new Map(),
      unitGfx: new Map(),
      gfxToSite: new Map(),
      unitGfxToUnit: new Map(),
      gridLabels: [],
      palette: PALETTES[theme],
      zoom: 1,
      start: startSite,
      pickUnit: pickUnit,
      fitted: false,
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
        scene.root.addChild(scene.terrain, scene.grid, scene.gridText, scene.links, scene.sites, scene.units);
        // PixiJS 只把冒泡事件通知给 eventMode 是 static／dynamic 的对象，容器的默认值是 passive，
        // 于是 notifyTarget 对 passive 的容器第一句就 return。想在这两个容器上听子对象的
        // pointerover／pointerout，它们自己必须是 static。
        scene.sites.eventMode = 'static';
        scene.units.eventMode = 'static';

        fitView(scene, paramsRef.current);
        syncGridLabels(scene, paramsRef.current);
        syncSites(scene, worldRef.current);
        syncUnits(scene, worldRef.current);
        redraw(scene, worldRef.current, paramsRef.current);

        const toWorld = (sx: number, sy: number) => ({
          x: (sx - scene.root.position.x) / scene.zoom,
          y: (scene.root.position.y - sy) / scene.zoom,
        });

        /** 把当前倍数与视口盖住的地图范围写进工具行。 */
        const syncView = () => {
          const { width, height } = scene.app.screen;
          const p = scene.root.position;
          const z = scene.zoom;
          setView({
            zoom: z,
            x0: (0 - p.x) / z,
            x1: (width - p.x) / z,
            y0: (p.y - height) / z,
            y1: p.y / z,
          });
        };

        const zoomAt = (sx: number, sy: number, factor: number) => {
          const before = toWorld(sx, sy);
          // 上下界拦住滚轮与按钮，但不把当前倍数硬拽回来：地图很大时「缩到全图」会落在下界以下。
          const { zoomMin, zoomMax } = paramsRef.current;
          scene.zoom = Math.max(
            Math.min(zoomMin, scene.zoom),
            Math.min(Math.max(zoomMax, scene.zoom), scene.zoom * factor),
          );
          scene.root.scale.set(scene.zoom, -scene.zoom);
          scene.root.position.set(sx - before.x * scene.zoom, sy + before.y * scene.zoom);
          clampPosition(scene, paramsRef.current);
          redraw(scene, worldRef.current, paramsRef.current);
          syncView();
        };

        // 工具行上那三个按钮、据点表与部队表的「定位」都走这里。
        actionsRef.current = {
          zoomBy: (factor: number) => {
            const { width, height } = scene.app.screen;
            zoomAt(width / 2, height / 2, factor);
          },
          fit: () => {
            fitView(scene, paramsRef.current);
            redraw(scene, worldRef.current, paramsRef.current);
            syncView();
          },
          refresh: () => {
            // 藏起来的时候宿主是 0 尺寸，PixiJS 自己不会发现它又有了大小，这里补量一次。
            const host = hostRef.current;
            if (host && host.clientWidth > 0 && host.clientHeight > 0) {
              scene.app.renderer.resize(host.clientWidth, host.clientHeight);
            }
            // 一开就藏在别的页签后面时，画布还没有尺寸，那时摆不了；这里补一次。
            if (!scene.fitted) fitView(scene, paramsRef.current);
            syncSites(scene, worldRef.current);
            syncUnits(scene, worldRef.current);
            redraw(scene, worldRef.current, paramsRef.current);
            syncView();
          },
          focusOn: (kind: 'site' | 'unit', id: number) => {
            const w = worldRef.current;
            const site = kind === 'site' ? w.sites.find((x) => x.id === id) : undefined;
            const unit = kind === 'unit' ? w.units.find((x) => x.id === id) : undefined;
            const at = site ? { x: site.x, y: site.y } : unit ? unitWorldPos(w, unit) : null;
            if (!at) return;
            const { width, height } = scene.app.screen;
            const z = Math.max(scene.zoom, 0.4);
            scene.zoom = z;
            scene.root.scale.set(z, -z);
            scene.root.position.set(width / 2 - at.x * z, height / 2 + at.y * z);
            clampPosition(scene, paramsRef.current);
            redraw(scene, worldRef.current, paramsRef.current);
            syncView();
          },
        };
        // 请求可能比场景先到（挂载的那一瞬间），补跑一次。
        if (focusRef.current !== null) actionsRef.current.focusOn(focusRef.current.kind, focusRef.current.id);
        syncView();

        let dragging = false;
        let moved = false;
        let downX = 0;
        let downY = 0;
        let lastX = 0;
        let lastY = 0;

        const onWheel = (e: WheelEvent) => {
          e.preventDefault();
          const r = canvas.getBoundingClientRect();
          zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0012));
        };
        const onDown = (e: PointerEvent) => {
          dragging = true;
          moved = false;
          downX = e.clientX;
          downY = e.clientY;
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
            clampPosition(scene, paramsRef.current);
            syncView();
          }
          // 按下之后挪过 4 像素就算拖动，松手时不算一次点击。
          if (Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > 4) moved = true;
          const r = canvas.getBoundingClientRect();
          const p = toWorld(e.clientX - r.left, e.clientY - r.top);
          // 读数留到两位小数；取整留给写进世界的坐标，见下面 onDouble。
          setCursor({ x: p.x, y: p.y });
        };
        const onUp = (e: PointerEvent) => {
          dragging = false;
          if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
          if (moved) return;
          // 一次点击：落在据点上就是挑它，落在空白处就是取消起点。
          const r = canvas.getBoundingClientRect();
          const id = siteAt(scene, worldRef.current, e.clientX - r.left, e.clientY - r.top);
          if (id !== 0) pickRef.current(id);
          else cancelRef.current();
        };
        const onDouble = (e: MouseEvent) => {
          const r = canvas.getBoundingClientRect();
          const p = toWorld(e.clientX - r.left, e.clientY - r.top);
          // 新据点的坐标也留两位小数，与表里那一格对得上。
          addSiteRef.current(round2(p.x), round2(p.y));
        };

        canvas.addEventListener('wheel', onWheel, { passive: false });
        canvas.addEventListener('pointerdown', onDown);
        canvas.addEventListener('pointermove', onMove);
        canvas.addEventListener('pointerup', onUp);
        canvas.addEventListener('pointerleave', () => setCursor(null));
        canvas.addEventListener('dblclick', onDouble);

        // 停 200 毫秒再弹浮层：鼠标扫过去不算。据点与部队记号两种浮层共用这一个计时器。
        const armHover = (build: () => Hover | null) => {
          if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
          hoverTimer.current = window.setTimeout(() => {
            const h = build();
            if (h) setHover(h);
          }, 200);
        };
        const dropHover = () => {
          if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
          setHover(null);
        };

        // 浮层的 left／top 是相对 .mapwrap 算的；画布在 .mapwrap 里的位置用 offsetLeft／offsetTop 补上，
        // 不能再减画布相对视口的 rect.left／rect.top。
        const overlayX = (wx: number) => canvas.offsetLeft + scene.root.position.x + wx * scene.zoom;
        const overlayY = (wy: number) => canvas.offsetTop + scene.root.position.y - wy * scene.zoom;

        scene.sites.on('pointerover', (e) => {
          const id = scene.gfxToSite.get(e.target as Graphics);
          if (id === undefined) return;
          armHover(() => {
            const s = worldRef.current.sites.find((x) => x.id === id);
            return s ? { kind: 'site', site: s, x: overlayX(s.x), y: overlayY(s.y) } : null;
          });
        });
        scene.sites.on('pointerout', dropHover);

        scene.units.on('pointerover', (e) => {
          const id = scene.unitGfxToUnit.get(e.target as Graphics);
          if (id === undefined) return;
          armHover(() => {
            const w = worldRef.current;
            const u = w.units.find((x) => x.id === id);
            if (!u) return null;
            const p = unitWorldPos(w, u);
            return p ? { kind: 'unit', unit: u, x: overlayX(p.x), y: overlayY(p.y) } : null;
          });
        });
        scene.units.on('pointerout', dropHover);
      })
      .catch((err: unknown) => {
        console.error('[map] 场景没建起来', err);
      });

    return () => {
      disposed = true;
      if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
      sceneRef.current = null;
      scene.app.destroy(true, { children: true });
    };
    // 只在挂载时建一次；主题、参数、世界的变化由下面几个 effect 处理。
  }, []);

  // 地图的框或主题变了：换色板、重建刻度数字、重画底图。
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.palette = PALETTES[theme];
    syncGridLabels(scene, params);
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
  // 地图藏在别的页签后面时跳过：几千支部队时这一步不便宜，切回来时 refresh 会补一次。
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !visibleRef.current) return;
    syncUnits(scene, world);
  }, [world]);

  // 按「定位」：把那个目标移到画面中央。n 变了就重来一次，同一个目标按两次也生效。
  useEffect(() => {
    if (focus === null) return;
    actionsRef.current?.focusOn(focus.kind, focus.id);
  }, [focus]);

  // 从别的页签切回来：画布在隐藏期间量不到尺寸，回来时重新量一次并补跑一遍同步。
  useEffect(() => {
    if (!visible) return;
    actionsRef.current?.refresh();
  }, [visible]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.terrain.visible = showTerrain;
  }, [showTerrain]);

  // 挑起点或挑目的地都只改记号的颜色：据点那一层整体重画，部队记号只重画换了标记的那两个。
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const before = scene.pickUnit;
    scene.start = startSite;
    scene.pickUnit = pickUnit;
    syncSites(scene, worldRef.current);
    for (const id of [before, pickUnit]) {
      if (id === null) continue;
      const u = worldRef.current.units.find((x) => x.id === id);
      if (u) drawUnitMarker(scene, u);
    }
  }, [startSite, pickUnit]);

  // 坐标落在地图范围外的据点：数据不动，只是画在边框外面，这里把座数写出来。
  const outside = world.sites.filter(
    (s) => s.x < 0 || s.x > params.mapWidth || s.y < 0 || s.y > params.mapHeight,
  ).length;

  // 比例尺：取一个整齐的数，让它在屏幕上大约 100 像素宽。
  const barUnits = scaleUnits(view.zoom);
  const barWidth = Math.max(20, Math.round(barUnits * view.zoom));

  return (
    <div className="mapwrap">
      <div className="mapbox">
        <div className="map" ref={hostRef} />
        <div className="scalebar">
          <span className="line" style={{ width: String(barWidth) + 'px' }} />
          <span className="dim small">{barUnits} 地图单位</span>
        </div>
      </div>
      <div className="mapbar">
        <button onClick={() => actionsRef.current?.zoomBy(1.5)}>放大</button>
        <button onClick={() => actionsRef.current?.zoomBy(1 / 1.5)}>缩小</button>
        <button onClick={() => actionsRef.current?.fit()}>缩到全图</button>
        <span className="dim small">
          缩放 {view.zoom.toFixed(3)} · 1 像素 = {(1 / view.zoom).toFixed(1)} 地图单位
        </span>
        <label className="dim small">
          <input type="checkbox" checked={showTerrain} onChange={(e) => setShowTerrain(e.target.checked)} /> 生成的地形层
        </label>
        <span className="dim small">
          看到 x {Math.round(view.x0)}..{Math.round(view.x1)} · y {Math.round(view.y0)}..{Math.round(view.y1)}
        </span>
        <span className="dim small">地图 {params.mapWidth} × {params.mapHeight}</span>
        {outside > 0 ? <span className="dim small">有 {outside} 座据点的坐标在地图外</span> : null}
        <span className="dim small">{cursor ? '坐标 ' + cursor.x.toFixed(2) + ', ' + cursor.y.toFixed(2) : '坐标 —'}</span>
        <span className="dim small">滚轮缩放 · 拖动平移 · 双击空白处新增据点 · 单击据点挑起点／终点 · 指到据点或部队看它的数</span>
        {pickHint !== null ? <span className="dim small">{pickHint}</span> : null}
      </div>
      {hover ? (
        <div className="maphover" style={{ left: String(hover.x + 12) + 'px', top: String(hover.y + 12) + 'px' }}>
          {hover.kind === 'site' ? (
            <>
              <strong>{hover.site.name}</strong>
              <div>
                规模 {hover.site.scale} · 人口 {hover.site.population}
              </div>
              <div>
                民心 {Math.round(hover.site.morale)} · 稳定 {Math.round(hover.site.stability)}
              </div>
              <div>
                坐标 {hover.site.x.toFixed(2)}, {hover.site.y.toFixed(2)}
              </div>
            </>
          ) : (
            <>
              <strong>{hover.unit.name}</strong>
              <div>
                兵力 {hover.unit.troops} · 训练度 {Math.round(hover.unit.training)}
              </div>
              <div>
                组织度 {Math.round(hover.unit.organization)} · 随身粮草 {Math.round(hover.unit.carriedFood * 10) / 10}
              </div>
              <div>{placeText(world, hover.unit.place)}</div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
