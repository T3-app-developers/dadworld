import React, { useEffect, useMemo, useRef, useState, useCallback, Suspense } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { Environment as DreiEnvironment, Sky, Cloud, Sparkles } from "@react-three/drei";

function SafeEnvironment(props) {
  return <Suspense fallback={null}><DreiEnvironment {...props} /></Suspense>;
}

/*****************************
 * HyperKart 3D — single-file demo (patched)
 * - React + @react-three/fiber (WebGL)
 * - Mario Kart–style vibe: characters, cars, tracks
 * - Stadium tracks with themes (Classic / City / Wild West)
 * - Top-right Settings button with platform + controls + end/resume
 * - Laptop (WASD/Arrows) or Touch controls (iPad/iPhone)
 * - Simple arcade physics, lap counter, boost pads
 *
 * Patch notes:
 * - Hardened selection state: useSafeSelection() + makeSafeSelection() to avoid undefined destructuring.
 * - Converted <Kart> to forwardRef so CameraRig can track it correctly.
 * - RaceScreen now uses safe selection (fixes TypeError on destructuring).
 * - Minor cleanups; added self-tests overlay (non-intrusive) to ensure store shape & fallbacks.
 *****************************/

// -----------------------------
// Data: characters, cars, tracks
// -----------------------------
const CHARACTERS = [
  { id: "rex", name: "Rex", color: "#29b6f6" },
  { id: "luna", name: "Luna", color: "#ef5da8" },
  { id: "bolt", name: "Bolt", color: "#ffe082" },
  { id: "ember", name: "Ember", color: "#ff7043" },
  { id: "oak", name: "Oak", color: "#8bc34a" },
  { id: "ghost", name: "Ghost", color: "#cfd8dc" },
];

const CARS = [
  { id: "sprinter", name: "Sprinter", accel: 9.5, maxSpeed: 28, handling: 1.0, desc: "Balanced all-rounder" },
  { id: "torque", name: "Torque", accel: 7.5, maxSpeed: 34, handling: 0.8, desc: "Raw power, slides in turns" },
  { id: "glider", name: "Glider", accel: 8.5, maxSpeed: 31, handling: 1.1, desc: "Nimble and precise" },
  { id: "bulldog", name: "Bulldog", accel: 6.5, maxSpeed: 36, handling: 0.7, desc: "Heavy hitter, top speed king" },
];

const TRACKS = [
  {
    id: "classic",
    name: "Speedway",
    theme: "classic",
    sky: "#87ceeb",
    fog: "#a6d5f7",
    seatColor: "#334155",
    turf: "#2e7d32",
    roadColor: "#555555",
    trackWidth: 16,
    envPreset: "park",
    waypoints: [
      [-32,-58],[-58,-32],[-68,0],[-50,14],[-36,25],[-43,40],[-25,54],
      [0,61],[32,54],[58,32],[68,0],[58,-36],[32,-58],[0,-63],
    ],
    boostTs: [0.15, 0.5, 0.8],
  },
  {
    id: "city",
    name: "Street Circuit",
    theme: "city",
    sky: "#1a1a2e",
    fog: "#16213e",
    seatColor: "#1f2937",
    turf: "#1a1a2e",
    roadColor: "#222233",
    trackWidth: 14,
    envPreset: "night",
    waypoints: [
      [27,18],[54,18],[54,-18],[27,-18],[27,-45],[-27,-45],
      [-27,-18],[-54,-18],[-54,18],[-27,18],[-27,45],[27,45],
    ],
    boostTs: [0.12, 0.45, 0.78],
  },
  {
    id: "west",
    name: "Canyon Run",
    theme: "west",
    sky: "#ffcc80",
    fog: "#ffc080",
    seatColor: "#5d4037",
    turf: "#c2956a",
    roadColor: "#8B5A2B",
    trackWidth: 16,
    envPreset: "sunset",
    waypoints: [
      [0,72],[40,65],[72,40],[79,0],[72,-36],[45,-65],
      [0,-72],[-40,-61],[-72,-32],[-76,9],[-54,43],[-22,68],
    ],
    boostTs: [0.1, 0.4, 0.7],
  },
];

const DEFAULT_LAPS = 3;

// -----------------------------
// Procedural textures (CanvasTexture)
// -----------------------------
function createRoadTexture(baseColor = "#444") {
  const canvas = document.createElement("canvas");
  canvas.width = 256; canvas.height = 256;
  const ctx = canvas.getContext("2d");
  // Asphalt base
  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, 256, 256);
  // Grain noise
  const bc = parseInt(baseColor.replace("#",""), 16);
  const br = (bc >> 16) & 0xff, bg = (bc >> 8) & 0xff, bb = bc & 0xff;
  for (let i = 0; i < 3000; i++) {
    const v = (Math.random() - 0.5) * 30;
    ctx.fillStyle = `rgba(${clamp(br+v,0,255)|0},${clamp(bg+v,0,255)|0},${clamp(bb+v,0,255)|0},0.4)`;
    ctx.fillRect(Math.random()*256, Math.random()*256, 1+Math.random()*2, 1+Math.random()*2);
  }
  // Dashed center line
  ctx.strokeStyle = "rgba(255,255,255,0.6)";
  ctx.lineWidth = 3;
  ctx.setLineDash([20, 18]);
  ctx.beginPath(); ctx.moveTo(128, 0); ctx.lineTo(128, 256); ctx.stroke();
  // Edge lines (solid)
  ctx.strokeStyle = "rgba(255,255,255,0.3)";
  ctx.lineWidth = 2;
  ctx.setLineDash([]);
  ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(8, 256); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(248, 0); ctx.lineTo(248, 256); ctx.stroke();
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function createGroundTexture(baseColor = "#2e7d32") {
  const canvas = document.createElement("canvas");
  canvas.width = 128; canvas.height = 128;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, 128, 128);
  const bc = parseInt(baseColor.replace("#",""), 16);
  const br = (bc >> 16) & 0xff, bg = (bc >> 8) & 0xff, bb = bc & 0xff;
  for (let i = 0; i < 2000; i++) {
    const v = (Math.random() - 0.5) * 40;
    ctx.fillStyle = `rgba(${clamp(br+v,0,255)|0},${clamp(bg+v,0,255)|0},${clamp(bb+v,0,255)|0},0.5)`;
    const s = 1 + Math.random() * 3;
    ctx.fillRect(Math.random()*128, Math.random()*128, s, s);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(30, 30);
  return tex;
}

// -----------------------------
// Utilities
// -----------------------------
function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function angleLerp(a, b, t) {
  let diff = ((b - a + Math.PI) % (2 * Math.PI)) - Math.PI;
  return a + diff * t;
}
function radToDeg(rad){ return (rad * 180) / Math.PI; }

// -----------------------------
// Track curve utilities
// -----------------------------
function createTrackCurve(waypoints) {
  const pts = waypoints.map(([x, z]) => new THREE.Vector3(x, 0, z));
  return new THREE.CatmullRomCurve3(pts, true, "catmullrom", 0.5);
}

function createRoadGeometry(curve, width, segments = 200) {
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const p = curve.getPointAt(t);
    const tang = curve.getTangentAt(t);
    const nx = -tang.z, nz = tang.x;
    const len = Math.hypot(nx, nz) || 1;
    const hw = width / 2;
    positions.push(p.x - (nx / len) * hw, 0.01, p.z - (nz / len) * hw);
    positions.push(p.x + (nx / len) * hw, 0.01, p.z + (nz / len) * hw);
    uvs.push(0, t * 10, 1, t * 10);
  }
  for (let i = 0; i < segments; i++) {
    const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
    indices.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function createCurbGeometry(curve, width, side, segments = 200) {
  const positions = [];
  const colors = [];
  const indices = [];
  const curbW = 0.6;
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const p = curve.getPointAt(t);
    const tang = curve.getTangentAt(t);
    const nx = -tang.z, nz = tang.x;
    const len = Math.hypot(nx, nz) || 1;
    const nnx = nx / len, nnz = nz / len;
    const hw = width / 2;
    const base = side === "outer" ? hw : -hw;
    const edge = side === "outer" ? hw + curbW : -hw - curbW;
    positions.push(p.x + nnx * base, 0.02, p.z + nnz * base);
    positions.push(p.x + nnx * edge, 0.02, p.z + nnz * edge);
    const stripe = Math.floor(t * segments / 4) % 2 === 0;
    const r1 = stripe ? 1 : 1, g1 = stripe ? 0.2 : 1, b1 = stripe ? 0.2 : 1;
    colors.push(r1, g1, b1, r1, g1, b1);
  }
  for (let i = 0; i < segments; i++) {
    const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
    indices.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function findNearestT(curve, pos, lastT, searchRadius = 0.15, steps = 60) {
  let bestT = lastT;
  let bestDist = Infinity;
  for (let i = -steps; i <= steps; i++) {
    let t = lastT + (i / steps) * searchRadius;
    t = ((t % 1) + 1) % 1;
    const p = curve.getPointAt(t);
    const d = (pos.x - p.x) ** 2 + (pos.z - p.z) ** 2;
    if (d < bestDist) { bestDist = d; bestT = t; }
  }
  return bestT;
}

function getCrossTrackOffset(curve, pos, t) {
  const center = curve.getPointAt(t);
  const tang = curve.getTangentAt(t);
  const nx = -tang.z, nz = tang.x;
  const len = Math.hypot(nx, nz) || 1;
  const dx = pos.x - center.x, dz = pos.z - center.z;
  return (dx * (nx / len) + dz * (nz / len));
}

// -----------------------------
// Items & Power-ups
// -----------------------------
const ITEMS = [
  { id: "mushroom", name: "Mushroom", display: "BOOST" },
  { id: "banana", name: "Banana", display: "BANANA" },
  { id: "missile", name: "Missile", display: "MISSILE" },
  { id: "shield", name: "Shield", display: "SHIELD" },
  { id: "lightning", name: "Lightning", display: "ZAP" },
];

const ITEM_WEIGHTS = {
  1: [30, 20, 10, 40, 0],
  2: [30, 20, 25, 20, 5],
  3: [25, 15, 30, 10, 20],
  4: [15, 10, 30, 5, 40],
  5: [15, 10, 30, 5, 40],
};

function getRandomItem(position) {
  const weights = ITEM_WEIGHTS[clamp(position, 1, 5)];
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) return ITEMS[i].id;
  }
  return ITEMS[0].id;
}

// Module-level shared race data (written by physics loop, read by HUD)
const liveRace = {
  playerT: 0, playerPos: [0, 0], playerLap: 1, playerYaw: 0,
  ai: [], position: 1, drifting: false, totalLaps: DEFAULT_LAPS,
  // Item system
  playerItem: null,
  playerShield: false,
  playerSpinout: 0,
  lightningTimer: 0,
  activeBananas: [],
  activeMissiles: [],
  itemBoxCooldowns: {},
};

// -----------------------------
// Global-ish game state (simple hooks)
// -----------------------------
const useStore = (() => {
  const listeners = new Set();
  const state = {
    screen: "home", // home → character → car → track → race (or paused)
    selectedCharacter: CHARACTERS[0],
    selectedCar: CARS[0],
    selectedTrack: TRACKS[0],
    laps: DEFAULT_LAPS,
    platform: "Laptop", // Laptop | iPad | iPhone
    // runtime
    paused: false,
    showSettings: false,
    musicEnabled: true,
  };
  const setState = (partial) => {
    Object.assign(state, typeof partial === "function" ? partial(state) : partial);
    listeners.forEach((l) => l());
  };
  const useHook = (sel) => {
    const [, force] = React.useReducer((x) => x + 1, 0);
    const selRef = useRef(sel);
    selRef.current = sel;
    useEffect(() => {
      const cb = () => force();
      listeners.add(cb);
      return () => listeners.delete(cb);
    }, []);
    return selRef.current(state);
  };
  return { useHook, setState, get: () => state };
})();

// Convenience wrappers
const useScreen = () => useStore.useHook((s) => s.screen);
const setScreen = (v) => useStore.setState({ screen: v });
const useSelection = () => useStore.useHook((s) => ({
  character: s.selectedCharacter,
  car: s.selectedCar,
  track: s.selectedTrack,
  laps: s.laps,
}));
const setCharacter = (c) => useStore.setState({ selectedCharacter: c });
const setCar = (c) => useStore.setState({ selectedCar: c });
const setTrack = (t) => useStore.setState({ selectedTrack: t });
const setLaps = (n) => useStore.setState({ laps: n });
const usePlatform = () => useStore.useHook((s) => s.platform);
const setPlatform = (p) => useStore.setState({ platform: p });
const useSettings = () => useStore.useHook((s) => ({ showSettings: s.showSettings, paused: s.paused }));
const setShowSettings = (v) => useStore.setState({ showSettings: v });
const setPaused = (v) => useStore.setState({ paused: v });
const useMusicEnabled = () => useStore.useHook((s) => s.musicEnabled);
const setMusicEnabled = (v) => {
  useStore.setState({ musicEnabled: v });
  if (v) racingMusic.start(); else racingMusic.stop();
};

// --- Safe selection helpers (fix for undefined destructuring) ---
function makeSafeSelection(sel){
  if (sel && sel.character && sel.car && sel.track) return sel;
  return { character: CHARACTERS[0], car: CARS[0], track: TRACKS[0], laps: DEFAULT_LAPS };
}
function useSafeSelection(){
  const sel = useSelection();
  return makeSafeSelection(sel);
}

// -----------------------------
// Keyboard & Touch controls
// -----------------------------
function useKeyboardControls(enabled) {
  const [keys, setKeys] = useState({ left: false, right: false, up: false, down: false, useItem: false });
  useEffect(() => {
    if (!enabled) return;
    const down = (e) => {
      if (["ArrowLeft", "a", "A"].includes(e.key)) setKeys((k) => ({ ...k, left: true }));
      if (["ArrowRight", "d", "D"].includes(e.key)) setKeys((k) => ({ ...k, right: true }));
      if (["ArrowUp", "w", "W"].includes(e.key)) setKeys((k) => ({ ...k, up: true }));
      if (["ArrowDown", "s", "S"].includes(e.key)) setKeys((k) => ({ ...k, down: true }));
      if (e.key === " ") { e.preventDefault(); setKeys((k) => ({ ...k, useItem: true })); }
      if (e.key === "Escape" || e.key === "p" || e.key === "P") setShowSettings(true);
    };
    const up = (e) => {
      if (["ArrowLeft", "a", "A"].includes(e.key)) setKeys((k) => ({ ...k, left: false }));
      if (["ArrowRight", "d", "D"].includes(e.key)) setKeys((k) => ({ ...k, right: false }));
      if (["ArrowUp", "w", "W"].includes(e.key)) setKeys((k) => ({ ...k, up: false }));
      if (["ArrowDown", "s", "S"].includes(e.key)) setKeys((k) => ({ ...k, down: false }));
      if (e.key === " ") setKeys((k) => ({ ...k, useItem: false }));
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, [enabled]);
  return keys;
}

function TouchPad({ onChange }) {
  const [state, setState] = useState({ left: false, right: false, up: false, down: false, useItem: false });
  useEffect(() => { onChange && onChange(state); }, [state, onChange]);
  const mkHandlers = (key) => ({
    onPointerDown: (e) => { e.preventDefault(); setState((s) => ({ ...s, [key]: true })); },
    onPointerUp: (e) => { e.preventDefault(); setState((s) => ({ ...s, [key]: false })); },
    onPointerLeave: (e) => { e.preventDefault(); setState((s) => ({ ...s, [key]: false })); },
  });
  return (
    <div className="pointer-events-auto fixed bottom-4 left-0 right-0 flex items-center justify-between px-6 select-none">
      <div className="flex gap-3">
        <button {...mkHandlers("left")} className={`h-16 w-16 rounded-full bg-white/10 backdrop-blur border border-white/20 ${state.left ? "ring-4 ring-white/60" : ""}`}>◀</button>
        <button {...mkHandlers("right")} className={`h-16 w-16 rounded-full bg-white/10 backdrop-blur border border-white/20 ${state.right ? "ring-4 ring-white/60" : ""}`}>▶</button>
      </div>
      <button {...mkHandlers("useItem")} className={`h-14 w-14 rounded-full bg-yellow-500/30 backdrop-blur border-2 border-yellow-400/50 text-xs font-bold ${state.useItem ? "ring-4 ring-yellow-400/60" : ""}`}>USE</button>
      <div className="flex gap-3">
        <button {...mkHandlers("up")} className={`h-16 w-16 rounded-full bg-white/10 backdrop-blur border border-white/20 ${state.up ? "ring-4 ring-white/60" : ""}`}>▲</button>
        <button {...mkHandlers("down")} className={`h-16 w-16 rounded-full bg-white/10 backdrop-blur border border-white/20 ${state.down ? "ring-4 ring-white/60" : ""}`}>▼</button>
      </div>
    </div>
  );
}

// -----------------------------
// 3D: Track + Stadium + Props
// -----------------------------
// Old Stadium/CityProps/WestProps removed — replaced by ClassicProps, CityNeonProps, WestRockProps

function TrackRoad({ curve, trackWidth, roadColor = "#555" }) {
  const geo = useMemo(() => createRoadGeometry(curve, trackWidth), [curve, trackWidth]);
  const roadTex = useMemo(() => createRoadTexture(roadColor), [roadColor]);
  return (
    <mesh geometry={geo}>
      <meshStandardMaterial map={roadTex} metalness={0.1} roughness={0.85} side={THREE.DoubleSide} />
    </mesh>
  );
}

function TrackCurbs({ curve, trackWidth }) {
  const innerGeo = useMemo(() => createCurbGeometry(curve, trackWidth, "inner"), [curve, trackWidth]);
  const outerGeo = useMemo(() => createCurbGeometry(curve, trackWidth, "outer"), [curve, trackWidth]);
  return (
    <group>
      <mesh geometry={innerGeo}><meshStandardMaterial vertexColors side={THREE.DoubleSide} /></mesh>
      <mesh geometry={outerGeo}><meshStandardMaterial vertexColors side={THREE.DoubleSide} /></mesh>
    </group>
  );
}

function TrackStartLine({ curve, trackWidth }) {
  const startP = curve.getPointAt(0);
  const tang = curve.getTangentAt(0);
  const angle = Math.atan2(tang.x, tang.z);
  return (
    <group position={[startP.x, 0.03, startP.z]} rotation={[0, angle, 0]}>
      {/* Checkered pattern */}
      {[...Array(8)].map((_, i) => [...Array(2)].map((_, j) => (
        <mesh key={`${i}-${j}`} position={[(i - 3.5) * (trackWidth / 8), 0, (j - 0.5) * 0.8]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[trackWidth / 8 - 0.05, 0.75]} />
          <meshBasicMaterial color={(i + j) % 2 === 0 ? "#fff" : "#111"} />
        </mesh>
      )))}
    </group>
  );
}

function BoostPads({ curve, boostTs }) {
  return (
    <group>
      {boostTs.map((t, i) => {
        const p = curve.getPointAt(t);
        const tang = curve.getTangentAt(t);
        const angle = Math.atan2(tang.x, tang.z);
        return (
          <group key={i} position={[p.x, 0.03, p.z]} rotation={[0, angle, 0]}>
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[10, 5]} />
              <meshBasicMaterial color="#00e5ff" transparent opacity={0.5} />
            </mesh>
            {/* Arrow markers */}
            <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[2.5, 3.5]} />
              <meshBasicMaterial color="#00ffff" transparent opacity={0.7} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

function GroundPlane({ color = "#1b5e20", size = 400 }) {
  const groundTex = useMemo(() => createGroundTexture(color), [color]);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
      <planeGeometry args={[size, size]} />
      <meshStandardMaterial map={groundTex} roughness={1} />
    </mesh>
  );
}

function ClassicProps({ curve }) {
  const trees = useMemo(() => {
    const arr = [];
    for (let i = 0; i < 40; i++) {
      const t = i / 40;
      const p = curve.getPointAt(t);
      const tang = curve.getTangentAt(t);
      const nx = -tang.z, nz = tang.x;
      const len = Math.hypot(nx, nz) || 1;
      const side = i % 2 === 0 ? 1 : -1;
      const dist = 20 + Math.random() * 15;
      arr.push({ x: p.x + (nx / len) * side * dist, z: p.z + (nz / len) * side * dist, h: 2 + Math.random() * 3 });
    }
    return arr;
  }, [curve]);
  return (
    <group>
      {trees.map((t, i) => (
        <group key={i} position={[t.x, 0, t.z]}>
          <mesh position={[0, t.h / 2, 0]}><cylinderGeometry args={[0.2, 0.3, t.h, 6]} /><meshStandardMaterial color="#5d4037" /></mesh>
          <mesh position={[0, t.h + 0.8, 0]}><coneGeometry args={[1.2, 2.5, 8]} /><meshStandardMaterial color="#2e7d32" /></mesh>
        </group>
      ))}
    </group>
  );
}

function CityNeonProps({ curve }) {
  const signs = useMemo(() => {
    const arr = [];
    for (let i = 0; i < 20; i++) {
      const t = i / 20;
      const p = curve.getPointAt(t);
      const tang = curve.getTangentAt(t);
      const nx = -tang.z, nz = tang.x;
      const len = Math.hypot(nx, nz) || 1;
      const side = i % 2 === 0 ? 1 : -1;
      const dist = 18 + Math.random() * 10;
      const colors = ["#ff00ff", "#00ffff", "#ff6600", "#ffff00", "#ff0066"];
      arr.push({ x: p.x + (nx / len) * side * dist, z: p.z + (nz / len) * side * dist, h: 3 + Math.random() * 5, c: colors[i % colors.length] });
    }
    return arr;
  }, [curve]);
  return (
    <group>
      {signs.map((s, i) => (
        <group key={i} position={[s.x, 0, s.z]}>
          <mesh position={[0, s.h / 2, 0]}><boxGeometry args={[0.15, s.h, 0.15]} /><meshStandardMaterial color="#333" /></mesh>
          <mesh position={[0, s.h, 0]}><boxGeometry args={[2.5, 1.2, 0.2]} /><meshStandardMaterial color={s.c} emissive={s.c} emissiveIntensity={0.8} /></mesh>
        </group>
      ))}
    </group>
  );
}

function WestRockProps({ curve }) {
  const rocks = useMemo(() => {
    const arr = [];
    for (let i = 0; i < 30; i++) {
      const t = i / 30;
      const p = curve.getPointAt(t);
      const tang = curve.getTangentAt(t);
      const nx = -tang.z, nz = tang.x;
      const len = Math.hypot(nx, nz) || 1;
      const side = i % 2 === 0 ? 1 : -1;
      const dist = 20 + Math.random() * 15;
      arr.push({ x: p.x + (nx / len) * side * dist, z: p.z + (nz / len) * side * dist, s: 0.8 + Math.random() * 2.5 });
    }
    return arr;
  }, [curve]);
  return (
    <group>
      {rocks.map((r, i) => (
        <mesh key={i} position={[r.x, r.s * 0.4, r.z]} scale={[r.s, r.s * 0.7, r.s]}>
          <dodecahedronGeometry args={[1, 0]} />
          <meshStandardMaterial color="#8d6e63" roughness={1} />
        </mesh>
      ))}
    </group>
  );
}

function StarsField({ count = 800, radius = 120 }) {
  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = Math.random() * radius;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos((Math.random() * 2) - 1);
      arr[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      arr[i * 3 + 1] = Math.abs(r * Math.sin(phi) * Math.sin(theta));
      arr[i * 3 + 2] = r * Math.cos(phi);
    }
    return arr;
  }, [count, radius]);
  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={positions.length / 3} array={positions} itemSize={3} />
      </bufferGeometry>
      <pointsMaterial size={1.4} sizeAttenuation color="#ffffff" depthWrite={false} transparent opacity={0.6} />
    </points>
  );
}

// -----------------------------
// 3D: Kart + camera rig + physics
// -----------------------------
const Kart = React.forwardRef(function Kart({ color="#29b6f6", accent="#ffffff", controlRef, carStats, curve, trackWidth, boostTs=[] }, ref){
  const group = useRef();
  const attachRef = (node) => {
    group.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref && typeof ref === "object") ref.current = node;
  };

  const vel = useRef(0);
  const yaw = useRef(0);
  const pos = useRef(new THREE.Vector3(0, 0.35, 0));
  const trackT = useRef(0);
  const checkpoint = useRef(false);
  const prevT = useRef(0);
  const setRace = useRaceSetter();
  const lastBoostTime = useRef(0);
  // Drift state
  const drifting = useRef(false);
  const driftTime = useRef(0);
  const driftDir = useRef(0);
  // Init flag
  const inited = useRef(false);
  // Item state
  const itemUsed = useRef(false);
  const spinoutTimer = useRef(0);
  const spinoutYawRate = useRef(0);

  useFrame((state, dt) => {
    if (dt > 0.05) dt = 0.05;
    if (!curve) return;
    const controls = controlRef.current || { left: false, right: false, up: false, down: false, useItem: false };
    const maxSpeed = carStats.maxSpeed;
    const handling = carStats.handling;
    const hw = (trackWidth || 10) / 2;

    // --- Check if AI lightning hit us ---
    if (liveRace.playerSpinout > 0 && spinoutTimer.current <= 0) {
      if (liveRace.playerShield) { liveRace.playerShield = false; }
      else {
        spinoutTimer.current = liveRace.playerSpinout;
        spinoutYawRate.current = (Math.random() > 0.5 ? 1 : -1) * 8;
        vel.current = 0;
      }
      liveRace.playerSpinout = 0;
    }

    // --- Spin-out (from item hit) ---
    if (spinoutTimer.current > 0) {
      spinoutTimer.current -= dt;
      vel.current *= 0.9;
      yaw.current += spinoutYawRate.current * dt;
      pos.current.x += Math.cos(yaw.current) * vel.current * dt;
      pos.current.z += Math.sin(yaw.current) * vel.current * dt;
      liveRace.playerT = findNearestT(curve, pos.current, trackT.current);
      liveRace.playerPos = [pos.current.x, pos.current.z];
      liveRace.playerSpinout = spinoutTimer.current;
      if (group.current) {
        group.current.position.copy(pos.current);
        group.current.rotation.y = -yaw.current - Math.PI / 2;
      }
      return; // skip normal controls during spin-out
    }
    liveRace.playerSpinout = 0;

    // --- Lightning slowdown ---
    const lightningMul = liveRace.lightningTimer > 0 ? 0.5 : 1.0;

    // Init start position from curve
    if (!inited.current) {
      const startP = curve.getPointAt(0);
      const startTang = curve.getTangentAt(0);
      pos.current.set(startP.x, 0.35, startP.z);
      yaw.current = Math.atan2(startTang.z, startTang.x);
      trackT.current = 0;
      prevT.current = 0;
      inited.current = true;
    }

    // --- Steering (classic kart: responsive at low speed, tighter at high speed) ---
    const speedRatio = clamp(Math.abs(vel.current) / maxSpeed, 0, 1);
    const steerRate = handling * 2.5 * (1.0 - 0.4 * speedRatio);

    const turning = controls.left || controls.right;
    const canDrift = controls.down && turning && speedRatio > 0.3;

    if (canDrift) {
      // Enter or continue drift
      if (!drifting.current) {
        drifting.current = true;
        driftDir.current = controls.left ? -1 : 1;
        driftTime.current = 0;
      }
      const driftSteer = steerRate * 1.4;
      yaw.current += driftDir.current * driftSteer * dt;
      driftTime.current += dt;
      vel.current *= (1 - 0.2 * dt); // slight speed loss during drift
    } else {
      // Drift boost on release
      if (drifting.current && driftTime.current > 0.3) {
        const boostAmt = Math.min(driftTime.current / 1.5, 1.0) * 10;
        vel.current = Math.min(maxSpeed * 1.3, vel.current + boostAmt);
      }
      drifting.current = false;
      driftTime.current = 0;

      // Normal steering
      if (controls.left) yaw.current -= steerRate * dt;
      if (controls.right) yaw.current += steerRate * dt;
    }

    // --- Acceleration (ease-in: stronger at low speed) ---
    const accelRate = carStats.accel * 0.7 * (1.0 - 0.3 * speedRatio);
    if (controls.up && !drifting.current) {
      vel.current += accelRate * dt;
    }
    if (!controls.up && !drifting.current) {
      vel.current *= (1 - 1.5 * dt); // natural deceleration
    }
    if (controls.down && !drifting.current) {
      vel.current -= carStats.accel * 0.9 * dt; // brake
    }
    vel.current = clamp(vel.current, -maxSpeed * 0.3, maxSpeed * lightningMul);

    // --- Integrate position ---
    pos.current.x += Math.cos(yaw.current) * vel.current * dt;
    pos.current.z += Math.sin(yaw.current) * vel.current * dt;

    // --- Track boundary collision ---
    prevT.current = trackT.current;
    trackT.current = findNearestT(curve, pos.current, trackT.current);
    const crossOff = getCrossTrackOffset(curve, pos.current, trackT.current);
    if (Math.abs(crossOff) > hw) {
      const sign = crossOff > 0 ? 1 : -1;
      const center = curve.getPointAt(trackT.current);
      const tang = curve.getTangentAt(trackT.current);
      const nx = -tang.z, nz = tang.x;
      const len = Math.hypot(nx, nz) || 1;
      pos.current.x = center.x + (nx / len) * sign * hw;
      pos.current.z = center.z + (nz / len) * sign * hw;
      vel.current *= 0.7;
    }

    // --- Kart-to-kart collision with AI ---
    for (const ai of liveRace.ai) {
      if (!ai.pos) continue;
      const dx = pos.current.x - ai.pos[0];
      const dz = pos.current.z - ai.pos[1];
      const dist = Math.hypot(dx, dz);
      if (dist < 2.0 && dist > 0.01) {
        const pushX = (dx / dist) * (2.0 - dist) * 0.5;
        const pushZ = (dz / dist) * (2.0 - dist) * 0.5;
        pos.current.x += pushX;
        pos.current.z += pushZ;
        vel.current *= 0.85;
      }
    }

    // --- Boost pad detection ---
    for (const bt of boostTs) {
      const padCenter = curve.getPointAt(bt);
      const dx = pos.current.x - padCenter.x;
      const dz = pos.current.z - padCenter.z;
      if (Math.hypot(dx, dz) < 6 && state.clock.elapsedTime - lastBoostTime.current > 1.0) {
        vel.current = Math.min(maxSpeed * 1.3, vel.current + 10);
        lastBoostTime.current = state.clock.elapsedTime;
      }
    }

    // --- Item box pickup ---
    if (!liveRace.playerItem) {
      const numBoxes = 8;
      for (let bi = 0; bi < numBoxes; bi++) {
        const boxT = (bi + 0.5) / numBoxes;
        const cd = liveRace.itemBoxCooldowns[bi];
        if (cd && state.clock.elapsedTime < cd) continue;
        const bp = curve.getPointAt(boxT);
        if (Math.hypot(pos.current.x - bp.x, pos.current.z - bp.z) < 3) {
          liveRace.playerItem = getRandomItem(liveRace.position);
          liveRace.itemBoxCooldowns[bi] = state.clock.elapsedTime + 5;
        }
      }
    }

    // --- Use item ---
    if (controls.useItem && liveRace.playerItem && !itemUsed.current) {
      itemUsed.current = true;
      const item = liveRace.playerItem;
      liveRace.playerItem = null;
      if (item === "mushroom") {
        vel.current = Math.min(maxSpeed * 1.4, vel.current + maxSpeed * 0.5);
      } else if (item === "banana") {
        liveRace.activeBananas.push({ x: pos.current.x, z: pos.current.z, owner: "player", spawnTime: state.clock.elapsedTime });
      } else if (item === "missile") {
        liveRace.activeMissiles.push({ t: trackT.current, speed: maxSpeed * 2, owner: "player", spawnTime: state.clock.elapsedTime, hitIdx: -1 });
      } else if (item === "shield") {
        liveRace.playerShield = true;
        setTimeout(() => { liveRace.playerShield = false; }, 10000);
      } else if (item === "lightning") {
        liveRace.lightningTimer = 2.0;
        for (const ai of liveRace.ai) { ai.spinout = 1.0; }
      }
    }
    if (!controls.useItem) itemUsed.current = false;

    // --- Check banana collision (player hits bananas placed by AI) ---
    for (let bi = liveRace.activeBananas.length - 1; bi >= 0; bi--) {
      const b = liveRace.activeBananas[bi];
      if (b.owner === "player") continue;
      if (Math.hypot(pos.current.x - b.x, pos.current.z - b.z) < 2) {
        liveRace.activeBananas.splice(bi, 1);
        if (liveRace.playerShield) { liveRace.playerShield = false; continue; }
        vel.current = 0;
        spinoutTimer.current = 1.0;
        spinoutYawRate.current = (Math.random() > 0.5 ? 1 : -1) * 8;
      }
    }

    // --- Check missile collision (missiles targeting player) ---
    for (let mi = liveRace.activeMissiles.length - 1; mi >= 0; mi--) {
      const m = liveRace.activeMissiles[mi];
      if (m.owner === "player") continue;
      const mp = curve.getPointAt(m.t);
      if (Math.hypot(pos.current.x - mp.x, pos.current.z - mp.z) < 3) {
        liveRace.activeMissiles.splice(mi, 1);
        if (liveRace.playerShield) { liveRace.playerShield = false; continue; }
        vel.current = 0;
        spinoutTimer.current = 1.2;
        spinoutYawRate.current = (Math.random() > 0.5 ? 1 : -1) * 10;
      }
    }

    // --- Decrement lightning timer ---
    if (liveRace.lightningTimer > 0) liveRace.lightningTimer -= dt;

    // --- Lap counting ---
    // Set checkpoint when crossing the halfway point (t ≈ 0.5)
    if (prevT.current < 0.5 && trackT.current >= 0.5) {
      checkpoint.current = true;
    }
    // Lap complete when crossing start (t wraps from >0.9 to <0.1) after checkpoint
    if (prevT.current > 0.9 && trackT.current < 0.1 && checkpoint.current) {
      liveRace.playerLap += 1;
      setRace((s) => {
        const newLap = s.currentLap + 1;
        const finished = newLap > s.totalLaps;
        return { ...s, currentLap: newLap, finished };
      });
      checkpoint.current = false;
    }

    // --- Position tracking ---
    const playerTotal = (useRaceStore.useHook ? 0 : 0) + trackT.current;
    let pos1 = 1;
    for (const ai of liveRace.ai) {
      const aiTotal = (ai.lap - 1) + ai.t;
      const myTotal = (liveRace.playerLap - 1) + trackT.current;
      if (aiTotal > myTotal) pos1++;
    }
    liveRace.position = pos1;

    // --- Update shared race data ---
    liveRace.playerT = trackT.current;
    liveRace.playerPos = [pos.current.x, pos.current.z];
    liveRace.playerYaw = yaw.current;
    liveRace.drifting = drifting.current;

    // --- Write to scene ---
    if (group.current) {
      group.current.position.copy(pos.current);
      group.current.rotation.y = -yaw.current - Math.PI / 2;
      // Drift visual tilt
      group.current.rotation.z = drifting.current ? driftDir.current * -0.15 : 0;
    }
  });

  return (
    <group ref={attachRef}>
      <KartBody bodyType={carStats.id} color={color} accent={accent} />
      <ShieldBubble owner="player" />
    </group>
  );
});

// -----------------------------
// 4 distinct car body designs
// -----------------------------
const paintMat = (color) => ({ color, metalness: 0.6, roughness: 0.3 });
const darkGlass = { color: "#111", metalness: 0.8, roughness: 0.1 };
const wheelMat = { color: "#222", metalness: 0.1, roughness: 0.9 };
const accentMat = (c) => ({ color: c, metalness: 0.3, roughness: 0.5 });

function Wheel({ x, z, r = 0.22, w = 0.18 }) {
  return (
    <mesh position={[x, r, z]} rotation={[0, 0, Math.PI / 2]} castShadow>
      <cylinderGeometry args={[r, r, w, 16]} />
      <meshStandardMaterial {...wheelMat} />
    </mesh>
  );
}

function KartBody({ bodyType, color = "#29b6f6", accent = "#fff" }) {
  switch (bodyType) {
    case "torque": return <TorqueBody color={color} accent={accent} />;
    case "glider": return <GliderBody color={color} accent={accent} />;
    case "bulldog": return <BulldogBody color={color} accent={accent} />;
    default: return <SprinterBody color={color} accent={accent} />;
  }
}

function SprinterBody({ color, accent }) {
  // LOW SLEEK RACER — very flat, long, streamlined wedge shape
  return (
    <group>
      {/* Ultra-low flat chassis — long and narrow */}
      <mesh castShadow position={[0, 0.12, 0]}><boxGeometry args={[1.2, 0.12, 3.0]} /><meshStandardMaterial {...paintMat(color)} /></mesh>
      {/* Tapered nose cone — pointed front */}
      <mesh castShadow position={[0, 0.12, -1.7]}><boxGeometry args={[0.6, 0.1, 0.6]} /><meshStandardMaterial {...paintMat(color)} /></mesh>
      <mesh castShadow position={[0, 0.12, -2.1]}><boxGeometry args={[0.3, 0.08, 0.4]} /><meshStandardMaterial {...paintMat(color)} /></mesh>
      {/* Racing stripe down center */}
      <mesh castShadow position={[0, 0.19, -0.3]}><boxGeometry args={[0.2, 0.02, 2.8]} /><meshStandardMaterial {...accentMat(accent)} /></mesh>
      {/* Low bubble cockpit */}
      <mesh castShadow position={[0, 0.28, 0.2]}><sphereGeometry args={[0.4, 16, 10]} /><meshStandardMaterial {...darkGlass} /></mesh>
      {/* Driver head inside cockpit */}
      <mesh castShadow position={[0, 0.45, 0.3]}><sphereGeometry args={[0.18, 12, 12]} /><meshStandardMaterial color={accent} /></mesh>
      {/* Small rear lip spoiler */}
      <mesh castShadow position={[0, 0.22, 1.4]}><boxGeometry args={[1.0, 0.1, 0.15]} /><meshStandardMaterial {...accentMat(accent)} /></mesh>
      {/* Rear diffuser */}
      <mesh castShadow position={[0, 0.06, 1.5]}><boxGeometry args={[1.0, 0.06, 0.3]} /><meshStandardMaterial color="#222" /></mesh>
      {/* Tiny low-profile wheels — barely visible */}
      <Wheel x={-0.55} z={-1.0} r={0.12} w={0.14} />
      <Wheel x={0.55} z={-1.0} r={0.12} w={0.14} />
      <Wheel x={-0.55} z={1.0} r={0.12} w={0.14} />
      <Wheel x={0.55} z={1.0} r={0.12} w={0.14} />
    </group>
  );
}

function TorqueBody({ color, accent }) {
  // MUSCLE CAR — wide, aggressive, massive engine + huge rear spoiler
  return (
    <group>
      {/* Wide heavy chassis */}
      <mesh castShadow position={[0, 0.3, 0]}><boxGeometry args={[2.2, 0.4, 2.8]} /><meshStandardMaterial {...paintMat(color)} /></mesh>
      {/* Huge raised hood with scoop */}
      <mesh castShadow position={[0, 0.5, -0.8]}><boxGeometry args={[1.8, 0.3, 1.2]} /><meshStandardMaterial {...paintMat(color)} /></mesh>
      {/* Hood scoop / supercharger */}
      <mesh castShadow position={[0, 0.72, -0.6]}><boxGeometry args={[0.5, 0.25, 0.5]} /><meshStandardMaterial color="#222" metalness={0.7} roughness={0.2} /></mesh>
      <mesh castShadow position={[0, 0.88, -0.6]}><cylinderGeometry args={[0.15, 0.2, 0.12, 8]} /><meshStandardMaterial color="#444" metalness={0.8} roughness={0.2} /></mesh>
      {/* Cab set back */}
      <mesh castShadow position={[0, 0.6, 0.4]}><boxGeometry args={[1.4, 0.3, 0.8]} /><meshStandardMaterial {...darkGlass} /></mesh>
      {/* Driver head */}
      <mesh castShadow position={[0, 0.9, 0.45]}><sphereGeometry args={[0.25, 14, 14]} /><meshStandardMaterial color={accent} /></mesh>
      {/* MASSIVE rear spoiler — towering above car */}
      <mesh castShadow position={[0, 1.1, 1.3]}><boxGeometry args={[2.4, 0.08, 0.5]} /><meshStandardMaterial {...accentMat(accent)} /></mesh>
      {/* Spoiler posts — tall and thick */}
      <mesh castShadow position={[-0.7, 0.65, 1.3]}><boxGeometry args={[0.1, 0.8, 0.1]} /><meshStandardMaterial {...accentMat(accent)} /></mesh>
      <mesh castShadow position={[0.7, 0.65, 1.3]}><boxGeometry args={[0.1, 0.8, 0.1]} /><meshStandardMaterial {...accentMat(accent)} /></mesh>
      {/* Dual exhaust pipes — thick and prominent */}
      <mesh castShadow position={[-0.6, 0.2, 1.5]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.12, 0.12, 0.4, 8]} /><meshStandardMaterial color="#444" metalness={0.8} roughness={0.2} /></mesh>
      <mesh castShadow position={[0.6, 0.2, 1.5]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.12, 0.12, 0.4, 8]} /><meshStandardMaterial color="#444" metalness={0.8} roughness={0.2} /></mesh>
      {/* Side exhausts */}
      <mesh castShadow position={[-1.15, 0.25, 0.5]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.08, 0.08, 0.5, 8]} /><meshStandardMaterial color="#555" metalness={0.7} roughness={0.3} /></mesh>
      <mesh castShadow position={[1.15, 0.25, 0.5]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.08, 0.08, 0.5, 8]} /><meshStandardMaterial color="#555" metalness={0.7} roughness={0.3} /></mesh>
      {/* Fat rear wheels, smaller front */}
      <Wheel x={-1.05} z={-1.0} r={0.22} w={0.18} />
      <Wheel x={1.05} z={-1.0} r={0.22} w={0.18} />
      <Wheel x={-1.05} z={1.0} r={0.35} w={0.28} />
      <Wheel x={1.05} z={1.0} r={0.35} w={0.28} />
    </group>
  );
}

function GliderBody({ color, accent }) {
  // FORMULA / OPEN-WHEEL — ultra-wide wings, narrow body, exposed wheels far out
  return (
    <group>
      {/* Narrow pointed nose cone */}
      <mesh castShadow position={[0, 0.18, -0.5]}><boxGeometry args={[0.5, 0.16, 2.4]} /><meshStandardMaterial {...paintMat(color)} /></mesh>
      <mesh castShadow position={[0, 0.18, -1.9]}><boxGeometry args={[0.3, 0.1, 0.5]} /><meshStandardMaterial {...paintMat(color)} /></mesh>
      {/* HUGE front wing — very wide */}
      <mesh castShadow position={[0, 0.08, -2.0]}><boxGeometry args={[3.0, 0.05, 0.4]} /><meshStandardMaterial {...accentMat(accent)} /></mesh>
      {/* Front wing endplates */}
      <mesh castShadow position={[-1.5, 0.12, -2.0]}><boxGeometry args={[0.04, 0.2, 0.5]} /><meshStandardMaterial {...accentMat(accent)} /></mesh>
      <mesh castShadow position={[1.5, 0.12, -2.0]}><boxGeometry args={[0.04, 0.2, 0.5]} /><meshStandardMaterial {...accentMat(accent)} /></mesh>
      {/* HUGE rear wing — elevated */}
      <mesh castShadow position={[0, 0.7, 1.3]}><boxGeometry args={[2.6, 0.06, 0.4]} /><meshStandardMaterial {...accentMat(accent)} /></mesh>
      {/* Rear wing endplates */}
      <mesh castShadow position={[-1.3, 0.6, 1.3]}><boxGeometry args={[0.04, 0.3, 0.5]} /><meshStandardMaterial {...accentMat(accent)} /></mesh>
      <mesh castShadow position={[1.3, 0.6, 1.3]}><boxGeometry args={[0.04, 0.3, 0.5]} /><meshStandardMaterial {...accentMat(accent)} /></mesh>
      {/* Rear wing posts */}
      <mesh castShadow position={[-0.3, 0.42, 1.2]}><boxGeometry args={[0.06, 0.4, 0.06]} /><meshStandardMaterial {...accentMat(accent)} /></mesh>
      <mesh castShadow position={[0.3, 0.42, 1.2]}><boxGeometry args={[0.06, 0.4, 0.06]} /><meshStandardMaterial {...accentMat(accent)} /></mesh>
      {/* Side pods — aerodynamic */}
      <mesh castShadow position={[-0.6, 0.18, 0.2]}><boxGeometry args={[0.45, 0.18, 1.2]} /><meshStandardMaterial {...paintMat(color)} /></mesh>
      <mesh castShadow position={[0.6, 0.18, 0.2]}><boxGeometry args={[0.45, 0.18, 1.2]} /><meshStandardMaterial {...paintMat(color)} /></mesh>
      {/* Air intake above driver */}
      <mesh castShadow position={[0, 0.5, 0.1]}><boxGeometry args={[0.25, 0.15, 0.2]} /><meshStandardMaterial color={color} metalness={0.7} roughness={0.2} /></mesh>
      {/* Open cockpit */}
      <mesh castShadow position={[0, 0.32, 0.0]}><boxGeometry args={[0.4, 0.14, 0.6]} /><meshStandardMaterial {...darkGlass} /></mesh>
      {/* Driver head — visible in open cockpit */}
      <mesh castShadow position={[0, 0.5, 0.15]}><sphereGeometry args={[0.18, 12, 12]} /><meshStandardMaterial color={accent} /></mesh>
      {/* Helmet visor */}
      <mesh castShadow position={[0, 0.5, -0.02]}><sphereGeometry args={[0.13, 8, 6, 0, Math.PI]} /><meshStandardMaterial {...darkGlass} /></mesh>
      {/* Exposed wheels — far out from body */}
      <Wheel x={-1.4} z={-1.2} r={0.28} w={0.22} />
      <Wheel x={1.4} z={-1.2} r={0.28} w={0.22} />
      <Wheel x={-1.4} z={1.0} r={0.3} w={0.24} />
      <Wheel x={1.4} z={1.0} r={0.3} w={0.24} />
    </group>
  );
}

function BulldogBody({ color, accent }) {
  // MONSTER TRUCK — very tall, lifted, massive wheels, imposing
  return (
    <group>
      {/* Lifted chassis — raised high off ground */}
      <mesh castShadow position={[0, 0.65, 0]}><boxGeometry args={[2.4, 0.5, 2.2]} /><meshStandardMaterial {...paintMat(color)} /></mesh>
      {/* Tall cab with large windows */}
      <mesh castShadow position={[0, 1.1, 0.1]}><boxGeometry args={[2.0, 0.5, 1.6]} /><meshStandardMaterial {...darkGlass} /></mesh>
      {/* Roof */}
      <mesh castShadow position={[0, 1.38, 0.1]}><boxGeometry args={[2.1, 0.06, 1.7]} /><meshStandardMaterial {...paintMat(color)} /></mesh>
      {/* Heavy chrome bull bar + push bumper */}
      <mesh castShadow position={[0, 0.55, -1.25]}><boxGeometry args={[2.6, 0.4, 0.15]} /><meshStandardMaterial color="#aaa" metalness={0.8} roughness={0.15} /></mesh>
      <mesh castShadow position={[0, 0.85, -1.25]}><boxGeometry args={[1.8, 0.2, 0.12]} /><meshStandardMaterial color="#999" metalness={0.8} roughness={0.15} /></mesh>
      {/* Bull bar verticals */}
      <mesh castShadow position={[-0.6, 0.7, -1.25]}><boxGeometry args={[0.1, 0.5, 0.1]} /><meshStandardMaterial color="#999" metalness={0.8} roughness={0.15} /></mesh>
      <mesh castShadow position={[0.6, 0.7, -1.25]}><boxGeometry args={[0.1, 0.5, 0.1]} /><meshStandardMaterial color="#999" metalness={0.8} roughness={0.15} /></mesh>
      {/* Roof rack with lights */}
      <mesh castShadow position={[0, 1.45, 0.1]}><boxGeometry args={[1.8, 0.05, 1.2]} /><meshStandardMaterial color="#555" metalness={0.6} roughness={0.3} /></mesh>
      {/* Roof rack rail sides */}
      <mesh castShadow position={[-0.85, 1.44, 0.1]}><boxGeometry args={[0.06, 0.08, 1.2]} /><meshStandardMaterial color="#555" /></mesh>
      <mesh castShadow position={[0.85, 1.44, 0.1]}><boxGeometry args={[0.06, 0.08, 1.2]} /><meshStandardMaterial color="#555" /></mesh>
      {/* Roof lights (4x) */}
      <mesh position={[-0.5, 1.5, -0.2]}><sphereGeometry args={[0.1, 8, 8]} /><meshStandardMaterial color="#ffee00" emissive="#ffee00" emissiveIntensity={0.6} /></mesh>
      <mesh position={[-0.17, 1.5, -0.2]}><sphereGeometry args={[0.1, 8, 8]} /><meshStandardMaterial color="#ffee00" emissive="#ffee00" emissiveIntensity={0.6} /></mesh>
      <mesh position={[0.17, 1.5, -0.2]}><sphereGeometry args={[0.1, 8, 8]} /><meshStandardMaterial color="#ffee00" emissive="#ffee00" emissiveIntensity={0.6} /></mesh>
      <mesh position={[0.5, 1.5, -0.2]}><sphereGeometry args={[0.1, 8, 8]} /><meshStandardMaterial color="#ffee00" emissive="#ffee00" emissiveIntensity={0.6} /></mesh>
      {/* Driver head — high up */}
      <mesh castShadow position={[0, 1.55, 0.15]}><sphereGeometry args={[0.25, 14, 14]} /><meshStandardMaterial color={accent} /></mesh>
      {/* Big red taillights */}
      <mesh position={[-0.85, 0.7, 1.12]}><boxGeometry args={[0.35, 0.15, 0.05]} /><meshStandardMaterial color="#ff2222" emissive="#ff0000" emissiveIntensity={0.7} /></mesh>
      <mesh position={[0.85, 0.7, 1.12]}><boxGeometry args={[0.35, 0.15, 0.05]} /><meshStandardMaterial color="#ff2222" emissive="#ff0000" emissiveIntensity={0.7} /></mesh>
      {/* Fender flares */}
      <mesh castShadow position={[-1.15, 0.5, -0.7]}><boxGeometry args={[0.25, 0.3, 0.9]} /><meshStandardMaterial {...paintMat(color)} /></mesh>
      <mesh castShadow position={[1.15, 0.5, -0.7]}><boxGeometry args={[0.25, 0.3, 0.9]} /><meshStandardMaterial {...paintMat(color)} /></mesh>
      <mesh castShadow position={[-1.15, 0.5, 0.7]}><boxGeometry args={[0.25, 0.3, 0.9]} /><meshStandardMaterial {...paintMat(color)} /></mesh>
      <mesh castShadow position={[1.15, 0.5, 0.7]}><boxGeometry args={[0.25, 0.3, 0.9]} /><meshStandardMaterial {...paintMat(color)} /></mesh>
      {/* MASSIVE wheels — monster truck size */}
      <Wheel x={-1.15} z={-0.8} r={0.45} w={0.3} />
      <Wheel x={1.15} z={-0.8} r={0.45} w={0.3} />
      <Wheel x={-1.15} z={0.8} r={0.45} w={0.3} />
      <Wheel x={1.15} z={0.8} r={0.45} w={0.3} />
    </group>
  );
}


// Race state kept separate so non-React bits can mutate
const useRace = (sel) => useRaceStore.useHook(sel);
const useRaceSetter = () => useRaceStore.setState;
const useRaceStore = (() => {
  const listeners = new Set();
  const state = { currentLap: 1, totalLaps: DEFAULT_LAPS, finished: false, position: 1 };
  const setState = (fnOrObj) => {
    const p = typeof fnOrObj === "function" ? fnOrObj(state) : fnOrObj;
    Object.assign(state, p);
    listeners.forEach((l)=>l());
  };
  const useHook = (sel) => {
    const [, force] = React.useReducer((x)=>x+1, 0);
    const selRef = useRef(sel); selRef.current = sel;
    useEffect(()=>{ const cb = ()=>force(); listeners.add(cb); return ()=>listeners.delete(cb); },[]);
    return selRef.current(state);
  };
  return { useHook, setState };
})();

function CameraRig({ targetRef }){
  const { camera } = useThree();
  const ready = useRef(false);
  const shakeRef = useRef(0);
  useFrame((state, dt) => {
    const t = targetRef.current?.position || new THREE.Vector3();
    const rotY = targetRef.current?.rotation?.y || 0;
    const behind = new THREE.Vector3(Math.sin(rotY), 0, Math.cos(rotY));
    const desired = new THREE.Vector3().copy(t).addScaledVector(behind, 10).add(new THREE.Vector3(0, 7, 0));

    // Look-ahead when drifting
    if (liveRace.drifting) {
      shakeRef.current = 0.15;
    } else {
      shakeRef.current *= 0.9;
    }
    desired.x += (Math.random() - 0.5) * shakeRef.current;
    desired.z += (Math.random() - 0.5) * shakeRef.current;

    if (!ready.current) {
      camera.position.copy(desired);
      ready.current = true;
    } else {
      camera.position.lerp(desired, 1 - Math.pow(0.01, dt)); // much snappier
    }
    camera.lookAt(t.x, t.y + 0.5, t.z);
  });
  return null;
}

// -----------------------------
// AI opponents
// -----------------------------
const AI_RACERS = [
  { color: "#ef5da8", accent: "#fff", startT: 0.08, speedMul: 0.90, bodyType: "glider", offset: -2.5, tier: "challenger" },
  { color: "#ffe082", accent: "#fff", startT: 0.16, speedMul: 0.97, bodyType: "torque", offset: 2.5, tier: "threat" },
  { color: "#ff7043", accent: "#fff", startT: 0.24, speedMul: 0.78, bodyType: "bulldog", offset: -1.0, tier: "rookie" },
  { color: "#8bc34a", accent: "#fff", startT: 0.32, speedMul: 0.85, bodyType: "sprinter", offset: 1.0, tier: "competitive" },
];

function AIKart({ color, accent="#fff", startT, speedMul=0.85, bodyType, offset=0, tier="competitive", curve, trackWidth, playerMaxSpeed=30 }) {
  const ref = useRef();
  const progress = useRef(startT);
  const lap = useRef(1);
  const prevT = useRef(startT);
  const wobble = useRef(Math.random() * Math.PI * 2);
  const aiIndex = useRef(-1);
  const aiItem = useRef(null);
  const aiItemDelay = useRef(0);
  const aiShield = useRef(false);
  const aiSpinout = useRef(0);
  const aiSpinYaw = useRef(0);
  const aiYaw = useRef(0);

  useEffect(() => {
    const idx = liveRace.ai.length;
    aiIndex.current = idx;
    liveRace.ai.push({ t: startT, lap: 1, pos: [0, 0], color, spinout: 0 });
  }, []);

  useFrame((state, dt) => {
    if (dt > 0.05) dt = 0.05;
    if (!curve) return;
    const idx = aiIndex.current;
    const curveLen = curve.getLength();
    const baseSpeed = speedMul * playerMaxSpeed;
    const posX = ref.current?.position.x || 0;
    const posZ = ref.current?.position.z || 0;

    // Check for lightning hit from player
    if (idx >= 0 && idx < liveRace.ai.length && liveRace.ai[idx].spinout > 0) {
      aiSpinout.current = liveRace.ai[idx].spinout;
      aiSpinYaw.current = (Math.random() > 0.5 ? 1 : -1) * 6;
      liveRace.ai[idx].spinout = 0;
    }

    // Spin-out state
    if (aiSpinout.current > 0) {
      aiSpinout.current -= dt;
      aiYaw.current += aiSpinYaw.current * dt;
      if (ref.current) ref.current.rotation.y = aiYaw.current;
      return;
    }

    // Lightning slowdown
    const lightningMul = liveRace.lightningTimer > 0 ? 0.5 : 1.0;

    // Smooth rubber banding
    const playerProgress = (liveRace.playerLap - 1) + liveRace.playerT;
    const aiProgress = (lap.current - 1) + progress.current;
    const gap = aiProgress - playerProgress;
    const rubberBand = clamp(1.0 - gap * 0.5, 0.6, 1.4);

    // Curvature-based speed
    const t1 = progress.current;
    const t2 = (t1 + 0.01) % 1;
    const tang1 = curve.getTangentAt(t1);
    const tang2 = curve.getTangentAt(t2);
    const curvature = tang1.distanceTo(tang2) * 100;
    const curveMul = tier === "threat" ? 1.8 : tier === "rookie" ? 3.5 : 2.5;
    const cornerFactor = 1.0 / (1 + curvature * curveMul);

    const wobbleSpeed = 1 + Math.sin(state.clock.elapsedTime * 0.7 + wobble.current) * 0.06;
    const mistakeCycle = 8 + wobble.current * 1.3;
    const timeMod = state.clock.elapsedTime % mistakeCycle;
    const mistakeFactor = (timeMod < 0.2) ? 0.8 : 1.0;

    const actualSpeed = baseSpeed * rubberBand * cornerFactor * wobbleSpeed * mistakeFactor * lightningMul;
    const tDelta = (actualSpeed * dt) / curveLen;

    prevT.current = progress.current;
    progress.current = (progress.current + tDelta) % 1;

    if (prevT.current > 0.9 && progress.current < 0.1) {
      lap.current += 1;
    }

    // Position on track with offset
    const p = curve.getPointAt(progress.current);
    const tang = curve.getTangentAt(progress.current);
    const nx = -tang.z, nz = tang.x;
    const len = Math.hypot(nx, nz) || 1;
    const overtakeOff = Math.sin(state.clock.elapsedTime * 0.5 + wobble.current * 2) * 2.5;
    const sideOff = offset + Math.sin(state.clock.elapsedTime * 0.3 + wobble.current) * 1.5 + overtakeOff * 0.5;
    const clampedOff = clamp(sideOff, -trackWidth / 2 + 1.5, trackWidth / 2 - 1.5);

    if (ref.current) {
      ref.current.position.set(p.x + (nx / len) * clampedOff, 0.35, p.z + (nz / len) * clampedOff);
      ref.current.rotation.y = Math.atan2(-tang.x, -tang.z);
      aiYaw.current = ref.current.rotation.y;
    }

    // --- AI Item pickup ---
    if (!aiItem.current) {
      const numBoxes = 8;
      for (let bi = 0; bi < numBoxes; bi++) {
        const boxT = (bi + 0.5) / numBoxes;
        const cd = liveRace.itemBoxCooldowns[bi];
        if (cd && state.clock.elapsedTime < cd) continue;
        const bp = curve.getPointAt(boxT);
        if (Math.hypot(posX - bp.x, posZ - bp.z) < 3) {
          const aiPos = 1 + liveRace.ai.filter((a, ai2) => ai2 !== idx && ((a.lap - 1) + a.t) > aiProgress).length;
          aiItem.current = getRandomItem(aiPos);
          aiItemDelay.current = 1 + Math.random() * 2;
          liveRace.itemBoxCooldowns[bi] = state.clock.elapsedTime + 5;
        }
      }
    }

    // --- AI Item usage ---
    if (aiItem.current) {
      aiItemDelay.current -= dt;
      if (aiItemDelay.current <= 0) {
        const item = aiItem.current;
        aiItem.current = null;
        if (item === "mushroom") {
          // Boost: advance progress
          progress.current = (progress.current + 0.02) % 1;
        } else if (item === "banana") {
          liveRace.activeBananas.push({ x: posX, z: posZ, owner: "ai", spawnTime: state.clock.elapsedTime });
        } else if (item === "missile") {
          liveRace.activeMissiles.push({ t: progress.current, speed: playerMaxSpeed * 2, owner: "ai", spawnTime: state.clock.elapsedTime, hitIdx: -1 });
        } else if (item === "shield") {
          aiShield.current = true;
          setTimeout(() => { aiShield.current = false; }, 10000);
        } else if (item === "lightning") {
          // AI lightning: spin out player + other AIs
          if (liveRace.playerShield) { liveRace.playerShield = false; }
          else {
            liveRace.playerSpinout = 1.0;
            // Set spinout on player kart via liveRace flag (handled in next frame)
          }
        }
      }
    }

    // --- AI banana collision (hits player-dropped bananas) ---
    for (let bi = liveRace.activeBananas.length - 1; bi >= 0; bi--) {
      const b = liveRace.activeBananas[bi];
      if (b.owner === "ai") continue;
      if (Math.hypot(posX - b.x, posZ - b.z) < 2) {
        liveRace.activeBananas.splice(bi, 1);
        if (aiShield.current) { aiShield.current = false; continue; }
        aiSpinout.current = 1.0;
        aiSpinYaw.current = (Math.random() > 0.5 ? 1 : -1) * 8;
      }
    }

    // --- AI missile collision (player missiles hitting this AI) ---
    for (let mi = liveRace.activeMissiles.length - 1; mi >= 0; mi--) {
      const m = liveRace.activeMissiles[mi];
      if (m.owner === "ai") continue;
      const mp = curve.getPointAt(m.t);
      if (Math.hypot(posX - mp.x, posZ - mp.z) < 3) {
        liveRace.activeMissiles.splice(mi, 1);
        if (aiShield.current) { aiShield.current = false; continue; }
        aiSpinout.current = 1.2;
        aiSpinYaw.current = (Math.random() > 0.5 ? 1 : -1) * 10;
      }
    }

    // Update shared race data
    if (idx >= 0 && idx < liveRace.ai.length) {
      liveRace.ai[idx] = { t: progress.current, lap: lap.current, pos: [posX, posZ], color, spinout: 0 };
    }
  });

  return (
    <group ref={ref}>
      <KartModel color={color} accent={accent} bodyType={bodyType} />
    </group>
  );
}

// -----------------------------
// Racing music (Web Audio procedural beat)
// -----------------------------
const racingMusic = {
  ctx: null, interval: null, playing: false,
  start() {
    if (this.playing) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch { return; }
    this.playing = true;
    const bpm = 140;
    const beat = 60 / bpm;
    const schedule = () => {
      if (!this.playing || !this.ctx) return;
      const now = this.ctx.currentTime;
      for (let i = 0; i < 4; i++) {
        const t = now + i * beat;
        if (i === 0 || i === 2) this._kick(t);
        if (i === 1 || i === 3) this._snare(t);
        this._hihat(t);
        this._hihat(t + beat * 0.5);
      }
      this._bass(now, beat * 2, 80);
      this._bass(now + beat * 2, beat * 2, 100);
    };
    schedule();
    this.interval = setInterval(schedule, (4 * beat * 1000) - 50);
  },
  stop() {
    this.playing = false;
    if (this.interval) { clearInterval(this.interval); this.interval = null; }
    if (this.ctx) { this.ctx.close().catch(() => {}); this.ctx = null; }
  },
  _kick(t) {
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = "sine"; o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(30, t + 0.12);
    g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.01, t + 0.15);
    o.connect(g).connect(this.ctx.destination); o.start(t); o.stop(t + 0.15);
  },
  _snare(t) {
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.06, this.ctx.sampleRate);
    const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const n = this.ctx.createBufferSource(); n.buffer = buf;
    const f = this.ctx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 3000;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.01, t + 0.06);
    n.connect(f).connect(g).connect(this.ctx.destination); n.start(t); n.stop(t + 0.06);
  },
  _hihat(t) {
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.03, this.ctx.sampleRate);
    const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const n = this.ctx.createBufferSource(); n.buffer = buf;
    const f = this.ctx.createBiquadFilter(); f.type = "highpass"; f.frequency.value = 8000;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0.07, t); g.gain.exponentialRampToValueAtTime(0.01, t + 0.03);
    n.connect(f).connect(g).connect(this.ctx.destination); n.start(t); n.stop(t + 0.03);
  },
  _bass(t, dur, freq) {
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    const f = this.ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 200;
    o.type = "sawtooth"; o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.01, t + dur * 0.9);
    o.connect(f).connect(g).connect(this.ctx.destination); o.start(t); o.stop(t + dur);
  },
};

// -----------------------------
// Item 3D entities
// -----------------------------
function ItemBoxes({ curve }) {
  const numBoxes = 8;
  const groupRef = useRef();
  const boxRefs = useRef([]);

  const boxPositions = useMemo(() => {
    if (!curve) return [];
    return Array.from({ length: numBoxes }, (_, i) => {
      const t = (i + 0.5) / numBoxes;
      const p = curve.getPointAt(t);
      return [p.x, 1.2, p.z];
    });
  }, [curve]);

  useFrame((state) => {
    const time = state.clock.elapsedTime;
    for (let i = 0; i < boxRefs.current.length; i++) {
      const m = boxRefs.current[i];
      if (!m) continue;
      const cd = liveRace.itemBoxCooldowns[i];
      const active = !cd || time >= cd;
      m.visible = active;
      if (active) {
        m.rotation.y = time * 1.5 + i;
        m.rotation.x = time * 0.8 + i * 0.5;
        m.position.y = 1.2 + Math.sin(time * 2 + i) * 0.3;
      }
    }
  });

  return (
    <group ref={groupRef}>
      {boxPositions.map((pos, i) => (
        <mesh key={i} ref={(el) => (boxRefs.current[i] = el)} position={pos}>
          <boxGeometry args={[1.5, 1.5, 1.5]} />
          <meshStandardMaterial color="#ffaa00" emissive="#ff6600" emissiveIntensity={0.6} transparent opacity={0.8} />
        </mesh>
      ))}
    </group>
  );
}

function BananaHazards() {
  const [, forceUpdate] = useState(0);
  useFrame((state) => {
    // Expire old bananas
    for (let i = liveRace.activeBananas.length - 1; i >= 0; i--) {
      if (state.clock.elapsedTime - liveRace.activeBananas[i].spawnTime > 15) {
        liveRace.activeBananas.splice(i, 1);
      }
    }
    forceUpdate((v) => v + 1);
  });

  return (
    <group>
      {liveRace.activeBananas.map((b, i) => (
        <mesh key={`${i}-${b.spawnTime}`} position={[b.x, 0.4, b.z]}>
          <sphereGeometry args={[0.5, 8, 8]} />
          <meshStandardMaterial color="#ffd700" emissive="#ffaa00" emissiveIntensity={0.3} />
        </mesh>
      ))}
    </group>
  );
}

function MissileEntities({ curve }) {
  const [, forceUpdate] = useState(0);

  useFrame((state, dt) => {
    if (!curve) return;
    const curveLen = curve.getLength();
    for (let i = liveRace.activeMissiles.length - 1; i >= 0; i--) {
      const m = liveRace.activeMissiles[i];
      const tDelta = (m.speed * dt) / curveLen;
      m.t = (m.t + tDelta) % 1;
      // Expire after 6 seconds
      if (state.clock.elapsedTime - m.spawnTime > 6) {
        liveRace.activeMissiles.splice(i, 1);
      }
    }
    forceUpdate((v) => v + 1);
  });

  if (!curve) return null;
  return (
    <group>
      {liveRace.activeMissiles.map((m, i) => {
        const p = curve.getPointAt(m.t);
        const tang = curve.getTangentAt(m.t);
        return (
          <mesh key={`${i}-${m.spawnTime}`} position={[p.x, 0.8, p.z]} rotation={[0, Math.atan2(-tang.x, -tang.z), 0]}>
            <boxGeometry args={[0.4, 0.4, 1.5]} />
            <meshStandardMaterial color="#ff2222" emissive="#ff0000" emissiveIntensity={0.8} />
          </mesh>
        );
      })}
    </group>
  );
}

function ShieldBubble({ owner }) {
  const ref = useRef();
  useFrame(() => {
    if (!ref.current) return;
    const active = owner === "player" ? liveRace.playerShield : false;
    ref.current.visible = active;
  });
  return (
    <mesh ref={ref}>
      <sphereGeometry args={[2, 16, 12]} />
      <meshStandardMaterial color="#00ccff" transparent opacity={0.15} wireframe />
    </mesh>
  );
}

// -----------------------------
// HUD: Position display + Mini-map
// -----------------------------
function PositionHUD() {
  const [pos, setPos] = useState(1);
  useEffect(() => {
    const id = setInterval(() => setPos(liveRace.position), 200);
    return () => clearInterval(id);
  }, []);
  const suffix = pos === 1 ? "st" : pos === 2 ? "nd" : pos === 3 ? "rd" : "th";
  return (
    <div className="pointer-events-none absolute top-20 left-1/2 -translate-x-1/2 text-center">
      <div className="text-4xl font-black drop-shadow-lg">{pos}<span className="text-xl">{suffix}</span></div>
    </div>
  );
}

function MiniMap({ curve }) {
  const [dots, setDots] = useState({ player: [0, 0], ai: [] });
  const outline = useMemo(() => {
    if (!curve) return "";
    const pts = [];
    for (let i = 0; i < 80; i++) {
      const p = curve.getPointAt(i / 80);
      pts.push([p.x, p.z]);
    }
    // Compute bounds
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [x, z] of pts) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
    const scale = 80 / Math.max(maxX - minX, maxZ - minZ);
    return { pts: pts.map(([x, z]) => [(x - cx) * scale + 45, (z - cz) * scale + 45]), cx, cz, scale };
  }, [curve]);

  useEffect(() => {
    const id = setInterval(() => {
      if (!outline.scale) return;
      setDots({
        player: [(liveRace.playerPos[0] - outline.cx) * outline.scale + 45, (liveRace.playerPos[1] - outline.cz) * outline.scale + 45],
        ai: liveRace.ai.map(a => ({
          x: (a.pos[0] - outline.cx) * outline.scale + 45,
          z: (a.pos[1] - outline.cz) * outline.scale + 45,
          color: a.color,
        })),
      });
    }, 100);
    return () => clearInterval(id);
  }, [outline]);

  if (!outline.pts) return null;
  const pathD = outline.pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ") + " Z";

  return (
    <div className="pointer-events-none absolute bottom-20 right-4 w-[90px] h-[90px] opacity-80">
      <svg viewBox="0 0 90 90" className="w-full h-full">
        <path d={pathD} fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth={3} />
        {dots.ai.map((a, i) => <circle key={i} cx={a.x} cy={a.z} r={3} fill={a.color} />)}
        <circle cx={dots.player[0]} cy={dots.player[1]} r={4} fill="#fff" stroke="#000" strokeWidth={1} />
      </svg>
    </div>
  );
}

// -----------------------------
// Race scene
// -----------------------------
function RaceScene({ theme, character, car, platform, onFinish }){
  const kartRef = useRef();
  const controlRef = useRef({ left:false,right:false,up:false,down:false });
  const kbd = useKeyboardControls(platform === "Laptop");
  const { currentLap, totalLaps, finished } = useRace((r)=>({ currentLap: r.currentLap, totalLaps: r.totalLaps, finished: r.finished }));

  // Create track curve from waypoints
  const curve = useMemo(() => theme?.waypoints ? createTrackCurve(theme.waypoints) : null, [theme]);
  const trackWidth = theme?.trackWidth || 10;
  const boostTs = theme?.boostTs || [];

  useEffect(() => { if(platform === "Laptop") controlRef.current = kbd; }, [kbd, platform]);

  useEffect(() => {
    liveRace.ai = [];
    liveRace.playerT = 0;
    liveRace.playerLap = 1;
    liveRace.position = 1;
    liveRace.playerItem = null;
    liveRace.playerShield = false;
    liveRace.playerSpinout = 0;
    liveRace.lightningTimer = 0;
    liveRace.activeBananas = [];
    liveRace.activeMissiles = [];
    liveRace.itemBoxCooldowns = {};
    useRaceSetter()({ currentLap: 1, totalLaps: useStore.get().laps, finished: false, position: 1 });
  }, []);

  useEffect(() => { if(finished && onFinish) onFinish(); }, [finished, onFinish]);

  useEffect(() => {
    if (useStore.get().musicEnabled) racingMusic.start();
    return () => racingMusic.stop();
  }, []);

  const bgColor = new THREE.Color(theme?.sky || "#222");
  const fogColor = new THREE.Color(theme?.fog || "#333");
  const hemiGround = new THREE.Color(theme?.turf || "#1b5e20");
  const aiRacers = AI_RACERS.filter(a => a.color !== character.color);

  return (
    <div className="relative h-full w-full">
      <Canvas shadows camera={{ position:[0,10,15], fov:55 }}>
        <color attach="background" args={[bgColor]} />
        <fog attach="fog" args={[fogColor, 60, 300]} />
        <hemisphereLight skyColor={bgColor} groundColor={hemiGround} intensity={0.6} />
        <directionalLight position={[20, 30, 15]} intensity={1.2} castShadow shadow-mapSize-width={2048} shadow-mapSize-height={2048} />
        <directionalLight position={[-15, 20, -10]} intensity={0.4} />
        <SafeEnvironment preset={theme?.envPreset || "sunset"} background={false} />

        {/* Sky — physically-based for day/sunset tracks */}
        {theme.theme === "classic" && <Sky sunPosition={[100, 20, 100]} turbidity={8} rayleigh={2} />}
        {theme.theme === "west" && <Sky sunPosition={[0, 5, -100]} turbidity={10} rayleigh={0.5} mieCoefficient={0.1} />}

        {/* Clouds — atmosphere for outdoor tracks */}
        {theme.theme === "classic" && (
          <Suspense fallback={null}>
            <Cloud position={[50, 40, -40]} speed={0.2} opacity={0.4} />
            <Cloud position={[-60, 50, 30]} speed={0.15} opacity={0.35} />
            <Cloud position={[20, 35, 60]} speed={0.25} opacity={0.3} />
          </Suspense>
        )}
        {theme.theme === "west" && (
          <Suspense fallback={null}>
            <Cloud position={[40, 35, -50]} speed={0.1} opacity={0.3} color="#ffcc80" />
            <Cloud position={[-50, 45, 20]} speed={0.12} opacity={0.25} color="#ffa060" />
          </Suspense>
        )}

        {/* Ground + Track */}
        <GroundPlane color={theme?.turf || "#1b5e20"} />
        {curve && <TrackRoad curve={curve} trackWidth={trackWidth} roadColor={theme?.roadColor || "#555"} />}
        {curve && <TrackCurbs curve={curve} trackWidth={trackWidth} />}
        {curve && <TrackStartLine curve={curve} trackWidth={trackWidth} />}
        {curve && <BoostPads curve={curve} boostTs={boostTs} />}

        {/* Theme props */}
        {theme.theme === "classic" && curve && <ClassicProps curve={curve} />}
        {theme.theme === "city" && curve && <CityNeonProps curve={curve} />}
        {theme.theme === "west" && curve && <WestRockProps curve={curve} />}

        {/* Player Kart */}
        <Kart ref={kartRef} color={character.color} accent={"#fff"} controlRef={controlRef} carStats={car} curve={curve} trackWidth={trackWidth} boostTs={boostTs} />
        <CameraRig targetRef={kartRef} />

        {/* AI opponents */}
        {aiRacers.map((ai, i) => (
          <AIKart key={i} color={ai.color} accent={ai.accent} startT={ai.startT} speedMul={ai.speedMul} bodyType={ai.bodyType} offset={ai.offset} tier={ai.tier} curve={curve} trackWidth={trackWidth} playerMaxSpeed={car?.maxSpeed || 30} />
        ))}

        {/* Item entities */}
        {curve && <ItemBoxes curve={curve} />}
        <BananaHazards />
        {curve && <MissileEntities curve={curve} />}

        {theme.theme !== "classic" && <StarsField count={1000} radius={250} />}
      </Canvas>

      {/* HUD: Lap counter + Position */}
      <div className="pointer-events-none absolute top-4 left-1/2 -translate-x-1/2 text-center bg-black/50 rounded-2xl px-6 py-3 backdrop-blur-md border border-white/20">
        <div className="text-xs uppercase tracking-widest text-white/70 mb-1">Lap</div>
        <div className="text-2xl font-bold tabular-nums">{Math.min(currentLap, totalLaps)} <span className="text-white/50">/</span> {totalLaps}</div>
      </div>
      <PositionHUD />
      {curve && <MiniMap curve={curve} />}

      {/* Drift indicator + Item HUD + Effects */}
      <DriftIndicator />
      <ItemHUD />
      <SpinOutIndicator />
      <LightningFlash />

      {/* Touch controls overlay */}
      {(platform === "iPad" || platform === "iPhone") && (
        <TouchPad onChange={(s)=> (controlRef.current = s)} />
      )}
    </div>
  );
}

function DriftIndicator() {
  const [drift, setDrift] = useState(false);
  useEffect(() => {
    const id = setInterval(() => setDrift(liveRace.drifting), 100);
    return () => clearInterval(id);
  }, []);
  if (!drift) return null;
  return (
    <div className="pointer-events-none absolute bottom-32 left-1/2 -translate-x-1/2 text-center">
      <div className="text-lg font-bold text-cyan-400 animate-pulse">DRIFT</div>
    </div>
  );
}

function ItemHUD() {
  const [item, setItem] = useState(null);
  useEffect(() => {
    const id = setInterval(() => setItem(liveRace.playerItem), 100);
    return () => clearInterval(id);
  }, []);
  if (!item) return null;
  const info = ITEMS.find((i) => i.id === item);
  const colors = { mushroom: "bg-green-500/80", banana: "bg-yellow-500/80", missile: "bg-red-500/80", shield: "bg-cyan-500/80", lightning: "bg-purple-500/80" };
  return (
    <div className="pointer-events-none absolute top-20 left-4">
      <div className={`${colors[item] || "bg-white/20"} rounded-xl px-4 py-2 text-center border border-white/30`}>
        <div className="text-xs uppercase tracking-wider text-white/70">Item</div>
        <div className="text-lg font-bold">{info?.display || item}</div>
        <div className="text-xs text-white/50 mt-0.5">Space to use</div>
      </div>
    </div>
  );
}

function SpinOutIndicator() {
  const [active, setActive] = useState(false);
  useEffect(() => {
    const id = setInterval(() => setActive(liveRace.playerSpinout > 0), 50);
    return () => clearInterval(id);
  }, []);
  if (!active) return null;
  return (
    <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
      <div className="text-3xl font-black text-red-400 animate-pulse">SPIN OUT!</div>
    </div>
  );
}

function LightningFlash() {
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    const id = setInterval(() => setFlash(liveRace.lightningTimer > 1.5), 50);
    return () => clearInterval(id);
  }, []);
  if (!flash) return null;
  return (
    <div className="pointer-events-none absolute inset-0 bg-white/30 z-10" style={{ animation: "fadeOut 0.5s ease-out forwards" }}>
      <style>{`@keyframes fadeOut { 0% { opacity: 1; } 100% { opacity: 0; } }`}</style>
    </div>
  );
}

// -----------------------------
// 3D: Kart preview for selection screens
// -----------------------------
function KartModel({ color = "#29b6f6", accent = "#ffffff", bodyType = "sprinter" }) {
  return (
    <group>
      <KartBody bodyType={bodyType} color={color} accent={accent} />
    </group>
  );
}

function AutoRotate({ children }) {
  const ref = useRef();
  useFrame((_, dt) => { if (ref.current) ref.current.rotation.y += dt * 0.5; });
  return <group ref={ref}>{children}</group>;
}

function KartShowcase({ color = "#29b6f6", accent = "#ffffff", bodyType = "sprinter", className = "" }) {
  return (
    <div key={bodyType + color} className={`rounded-2xl overflow-hidden bg-white/5 border border-white/10 ${className}`}>
      <Canvas camera={{ position: [3, 2, 4], fov: 40 }} dpr={[1, 1.5]}>
        <color attach="background" args={["#0f172a"]} />
        <ambientLight intensity={0.5} />
        <directionalLight position={[5, 8, 5]} intensity={1} />
        <SafeEnvironment preset="sunset" background={false} />
        <AutoRotate>
          <KartModel color={color} accent={accent} bodyType={bodyType} />
        </AutoRotate>
      </Canvas>
    </div>
  );
}

function TrackPreviewMesh({ track }) {
  const curve = useMemo(() => track?.waypoints ? createTrackCurve(track.waypoints) : null, [track]);
  if (!curve) return null;
  return (
    <group>
      <TrackRoad curve={curve} trackWidth={track.trackWidth || 10} roadColor={track.roadColor || "#555"} />
      <TrackCurbs curve={curve} trackWidth={track.trackWidth || 10} />
      <BoostPads curve={curve} boostTs={track.boostTs || []} />
      <GroundPlane color={track.turf} size={120} />
    </group>
  );
}

function TrackPreview({ track }) {
  // Calculate camera height to fit the track in view
  const camHeight = useMemo(() => {
    if (!track.waypoints) return 80;
    let maxR = 0;
    for (const [x, z] of track.waypoints) {
      maxR = Math.max(maxR, Math.hypot(x, z));
    }
    return maxR * 2.2; // enough height to see entire track
  }, [track]);
  return (
    <div key={track.id} className="h-28 rounded-xl overflow-hidden">
      <Canvas camera={{ position: [0, camHeight, camHeight * 0.05], fov: 45 }} dpr={[1, 1.5]}>
        <color attach="background" args={[track.sky]} />
        <ambientLight intensity={0.8} />
        <directionalLight position={[10, 30, 10]} intensity={0.8} />
        <TrackPreviewMesh track={track} />
      </Canvas>
    </div>
  );
}

function StepIndicator({ step }) {
  const steps = ["Character", "Car", "Track"];
  return (
    <div className="shrink-0 flex items-center justify-center gap-1 py-3 px-4">
      {steps.map((s, i) => (
        <React.Fragment key={s}>
          {i > 0 && <div className={`h-px w-4 sm:w-8 ${i + 1 <= step ? "bg-white/40" : "bg-white/10"}`} />}
          <div className={`text-xs font-medium px-2 py-1 rounded-full whitespace-nowrap ${i + 1 === step ? "bg-white/20 text-white" : i + 1 < step ? "text-white/50" : "text-white/30"}`}>
            {s}
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}

// -----------------------------
// UI: Screens & Settings
// -----------------------------
function TopBar(){
  const screen = useScreen();
  const musicEnabled = useMusicEnabled();
  // Only show on home and race screens to avoid overlapping step indicators
  if (screen !== "home" && screen !== "race") return null;
  return (
    <div className="pointer-events-none absolute top-0 left-0 right-0 flex items-center justify-between p-4 z-10">
      <div className="pointer-events-auto select-none text-sm tracking-wide uppercase text-white/70">{screen === "race" ? "" : "HyperKart 3D"}</div>
      <div className="flex items-center gap-2">
        {screen === "race" && (
          <button onClick={()=> setMusicEnabled(!musicEnabled)} className="pointer-events-auto rounded-xl bg-white/10 border border-white/20 px-3 py-2 text-sm hover:bg-white/20 transition" title={musicEnabled ? "Mute music" : "Unmute music"}>
            {musicEnabled ? "\u{1F50A}" : "\u{1F507}"}
          </button>
        )}
        <button onClick={()=> setShowSettings(true)} className="pointer-events-auto rounded-xl bg-white/10 border border-white/20 px-4 py-2 text-sm hover:bg-white/20 transition">Settings</button>
      </div>
    </div>
  );
}

function HomeScreen(){
  return (
    <div className="h-full w-full grid place-items-center">
      <div className="text-center max-w-xl px-6">
        <h1 className="text-4xl font-extrabold mb-4">HyperKart 3D</h1>
        <p className="text-white/80 mb-6">Arcade racing in a roaring stadium. Pick your racer, tune your kart, choose a vibe, and punch the gas. Built for Laptop, iPad, and iPhone—controls adapt on the fly.</p>
        <div className="flex items-center justify-center gap-3">
          <button onClick={()=> setScreen("character")} className="rounded-2xl bg-indigo-500 hover:bg-indigo-400 px-6 py-3 font-semibold">Start</button>
          <button onClick={()=> setScreen("howto")} className="rounded-2xl bg-white/10 border border-white/20 px-6 py-3">How to Play</button>
        </div>
      </div>
    </div>
  );
}

function HowToPlayScreen(){
  return (
    <div className="h-full w-full flex flex-col">
      <div className="flex-1 overflow-y-auto min-h-0 px-4 sm:px-6 pb-4 pt-12">
        <h2 className="text-3xl font-extrabold text-center mb-6">How to Play</h2>
        <div className="max-w-lg mx-auto space-y-6">
          <div>
            <h3 className="text-lg font-bold mb-2 text-indigo-300">Objective</h3>
            <p className="text-white/80">Complete all laps and finish in 1st place! Race against 4 AI opponents across unique tracks.</p>
          </div>
          <div>
            <h3 className="text-lg font-bold mb-2 text-indigo-300">Keyboard Controls</h3>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="bg-white/5 rounded-xl p-3 border border-white/10">
                <div className="font-semibold text-white mb-1">W / Arrow Up</div>
                <div className="text-white/60">Accelerate</div>
              </div>
              <div className="bg-white/5 rounded-xl p-3 border border-white/10">
                <div className="font-semibold text-white mb-1">S / Arrow Down</div>
                <div className="text-white/60">Brake / Reverse</div>
              </div>
              <div className="bg-white/5 rounded-xl p-3 border border-white/10">
                <div className="font-semibold text-white mb-1">A / Arrow Left</div>
                <div className="text-white/60">Steer Left</div>
              </div>
              <div className="bg-white/5 rounded-xl p-3 border border-white/10">
                <div className="font-semibold text-white mb-1">D / Arrow Right</div>
                <div className="text-white/60">Steer Right</div>
              </div>
            </div>
          </div>
          <div>
            <h3 className="text-lg font-bold mb-2 text-indigo-300">Drift Boost</h3>
            <p className="text-white/80">Hold <span className="font-semibold text-white">Brake + Steer</span> while moving fast to enter a drift. Release to get a speed boost! The longer you drift, the bigger the boost.</p>
          </div>
          <div>
            <h3 className="text-lg font-bold mb-2 text-indigo-300">Items</h3>
            <p className="text-white/80 mb-2">Drive through <span className="font-semibold text-yellow-300">glowing item boxes</span> on the track to pick up a random item. Press <span className="font-semibold text-white">Spacebar</span> to use it!</p>
            <ul className="list-disc list-inside text-white/80 space-y-1">
              <li><span className="text-green-300 font-semibold">Mushroom</span> — Instant speed boost</li>
              <li><span className="text-yellow-300 font-semibold">Banana</span> — Drop behind you; spins out anyone who hits it</li>
              <li><span className="text-red-300 font-semibold">Missile</span> — Fires forward along the track, hits the first kart ahead</li>
              <li><span className="text-cyan-300 font-semibold">Shield</span> — Blocks one incoming hit for 10 seconds</li>
              <li><span className="text-purple-300 font-semibold">Lightning</span> — Zaps ALL opponents, slowing them down</li>
            </ul>
            <p className="text-white/60 text-sm mt-1">Trailing racers get stronger items — comebacks are always possible!</p>
          </div>
          <div>
            <h3 className="text-lg font-bold mb-2 text-indigo-300">Tips</h3>
            <ul className="list-disc list-inside text-white/80 space-y-1">
              <li>Stay on the track — going off-road pushes you back and slows you down</li>
              <li>Use drifts on corners for massive speed boosts</li>
              <li>Hit boost pads on the track for extra speed</li>
              <li>Pick up items to gain an edge or defend yourself</li>
              <li>Each car has different stats — experiment to find your favorite</li>
            </ul>
          </div>
          <div>
            <h3 className="text-lg font-bold mb-2 text-indigo-300">Touch Controls</h3>
            <p className="text-white/80">On iPad/iPhone, on-screen buttons appear for steering, acceleration, and braking.</p>
          </div>
        </div>
      </div>
      <div className="shrink-0 p-4 border-t border-white/10 flex justify-center">
        <button onClick={()=> setScreen("home")} className="rounded-xl bg-indigo-500 px-6 py-2 font-semibold">Back to Menu</button>
      </div>
    </div>
  );
}

function CharacterScreen(){
  const sel = useSafeSelection();
  return (
    <div className="h-full w-full flex flex-col">
      <StepIndicator step={1} />
      <div className="flex-1 overflow-y-auto min-h-0 px-4 sm:px-6 pb-4">
        <KartShowcase color={sel.character.color} bodyType={sel.car.id} className="h-40 sm:h-48 mb-4" />
        <div className="text-center text-lg font-semibold mb-3">{sel.character.name}</div>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
          {CHARACTERS.map((c)=> (
            <button key={c.id} onClick={()=> setCharacter(c)} className={`rounded-2xl border px-2 py-3 text-center transition ${sel.character.id===c.id?"border-white bg-white/10":"border-white/20 bg-white/5 hover:bg-white/10"}`}>
              <div className="mx-auto h-8 w-8 rounded-full mb-1" style={{background:c.color}} />
              <div className="text-sm font-medium">{c.name}</div>
            </button>
          ))}
        </div>
      </div>
      <div className="shrink-0 p-4 border-t border-white/10 flex justify-between">
        <button onClick={()=> setScreen("home")} className="rounded-xl bg-white/10 px-4 py-2">Back</button>
        <button onClick={()=> setScreen("car")} className="rounded-xl bg-indigo-500 px-6 py-2 font-semibold">Next: Car</button>
      </div>
    </div>
  );
}

function CarScreen(){
  const sel = useSafeSelection();
  return (
    <div className="h-full w-full flex flex-col">
      <StepIndicator step={2} />
      <div className="flex-1 overflow-y-auto min-h-0 px-4 sm:px-6 pb-4">
        <KartShowcase color={sel.character.color} bodyType={sel.car.id} className="h-40 sm:h-48 mb-4" />
        <div className="text-center text-lg font-semibold mb-0">{sel.car.name}</div>
        {sel.car.desc && <div className="text-center text-sm text-white/60 mb-1">{sel.car.desc}</div>}
        <div className="max-w-xs mx-auto mb-4">
          <Stat label="Accel" v={sel.car.accel} max={10} />
          <Stat label="Top Speed" v={sel.car.maxSpeed/4} max={10} />
          <Stat label="Handling" v={sel.car.handling*10} max={12} />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {CARS.map((c)=> (
            <button key={c.id} onClick={()=> setCar(c)} className={`rounded-2xl border px-3 py-3 text-center transition ${sel.car.id===c.id?"border-white bg-white/10":"border-white/20 bg-white/5 hover:bg-white/10"}`}>
              <div className="font-semibold">{c.name}</div>
            </button>
          ))}
        </div>
      </div>
      <div className="shrink-0 p-4 border-t border-white/10 flex justify-between">
        <button onClick={()=> setScreen("character")} className="rounded-xl bg-white/10 px-4 py-2">Back</button>
        <button onClick={()=> setScreen("track")} className="rounded-xl bg-indigo-500 px-6 py-2 font-semibold">Next: Track</button>
      </div>
    </div>
  );
}

function Stat({ label, v, max }){
  const p = clamp(v/max, 0, 1);
  return (
    <div className="mb-2">
      <div className="text-xs uppercase tracking-wider text-white/70">{label}</div>
      <div className="h-2 w-full bg-white/10 rounded-full overflow-hidden">
        <div className="h-2 bg-white/70" style={{ width: `${p*100}%` }} />
      </div>
    </div>
  );
}

function TrackScreen(){
  const sel = useSafeSelection();
  const [laps, setL] = useState(sel.laps);
  useEffect(()=> setL(sel.laps), [sel.laps]);
  return (
    <div className="h-full w-full flex flex-col">
      <StepIndicator step={3} />
      <div className="flex-1 overflow-y-auto min-h-0 px-4 sm:px-6 pb-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
          {TRACKS.map((t)=> (
            <button key={t.id} onClick={()=> setTrack(t)} className={`rounded-2xl border px-4 py-4 text-left transition ${sel.track.id===t.id?"border-white bg-white/10":"border-white/20 bg-white/5 hover:bg-white/10"}`}>
              <div className="font-semibold text-lg mb-2">{t.name}</div>
              <TrackPreview track={t} />
            </button>
          ))}
        </div>
        <div className="mb-2">
          <div className="mb-2 text-white/80">Laps: {laps}</div>
          <input type="range" min={1} max={7} value={laps} onChange={(e)=>{ setL(+e.target.value); setLaps(+e.target.value); }} className="w-full" />
        </div>
      </div>
      <div className="shrink-0 p-4 border-t border-white/10 flex justify-between">
        <button onClick={()=> setScreen("car")} className="rounded-xl bg-white/10 px-4 py-2">Back</button>
        <button onClick={()=> setScreen("race")} className="rounded-xl bg-green-500 px-6 py-2 font-semibold">Start Race</button>
      </div>
    </div>
  );
}

// Confetti particle component for win screen
function Confetti() {
  const pieces = useRef(
    Array.from({ length: 50 }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      delay: Math.random() * 2,
      duration: 2 + Math.random() * 2,
      color: ["#ffd700", "#ff6b6b", "#4ecdc4", "#45b7d1", "#f9ca24", "#ff9ff3", "#54a0ff"][i % 7],
      size: 6 + Math.random() * 8,
      drift: -20 + Math.random() * 40,
    }))
  ).current;
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {pieces.map((p) => (
        <div
          key={p.id}
          className="absolute"
          style={{
            left: `${p.x}%`,
            top: "-20px",
            width: `${p.size}px`,
            height: `${p.size}px`,
            background: p.color,
            borderRadius: p.size > 10 ? "50%" : "2px",
            animation: `confettiFall ${p.duration}s ${p.delay}s ease-in infinite`,
            transform: `rotate(${Math.random() * 360}deg)`,
          }}
        />
      ))}
      <style>{`
        @keyframes confettiFall {
          0% { transform: translateY(0) translateX(0) rotate(0deg); opacity: 1; }
          100% { transform: translateY(100vh) translateX(40px) rotate(720deg); opacity: 0; }
        }
        @keyframes pulseGlow {
          0%, 100% { text-shadow: 0 0 20px rgba(255,215,0,0.8), 0 0 40px rgba(255,215,0,0.4); }
          50% { text-shadow: 0 0 40px rgba(255,215,0,1), 0 0 80px rgba(255,215,0,0.6), 0 0 120px rgba(255,215,0,0.3); }
        }
        @keyframes slideUp {
          0% { transform: translateY(40px); opacity: 0; }
          100% { transform: translateY(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

function FinishScreen({ position }) {
  const isWinner = position === 1;
  const isPodium = position <= 3;
  const posText = position === 1 ? "1st" : position === 2 ? "2nd" : position === 3 ? "3rd" : `${position}th`;
  const borderColor = isWinner ? "border-yellow-400/60" : isPodium ? "border-white/30" : "border-white/20";
  const bgGrad = isWinner
    ? "bg-gradient-to-b from-yellow-900/70 via-black/70 to-black/80"
    : isPodium
    ? "bg-gradient-to-b from-slate-700/70 via-black/70 to-black/80"
    : "bg-black/70";

  return (
    <div className="absolute inset-0 grid place-items-center pointer-events-none z-10">
      {isWinner && <Confetti />}
      <div
        className={`pointer-events-auto ${bgGrad} border ${borderColor} rounded-2xl p-8 text-center max-w-sm mx-4`}
        style={{ animation: "slideUp 0.5s ease-out" }}
      >
        {isWinner && <div className="text-6xl mb-2">🏆</div>}
        {position === 2 && <div className="text-5xl mb-2">🥈</div>}
        {position === 3 && <div className="text-5xl mb-2">🥉</div>}
        {position > 3 && <div className="text-5xl mb-2">🏁</div>}
        <div
          className={`text-5xl font-black mb-1 ${isWinner ? "text-yellow-300" : isPodium ? "text-white" : "text-white/90"}`}
          style={isWinner ? { animation: "pulseGlow 2s ease-in-out infinite" } : {}}
        >
          {posText} Place!
        </div>
        <div className={`text-lg mb-6 ${isWinner ? "text-yellow-100/90" : "text-white/70"}`}>
          {isWinner ? "You won the race!" : isPodium ? "Great race! So close!" : "Better luck next time!"}
        </div>
        <div className="flex gap-3 justify-center flex-wrap">
          <button onClick={() => setScreen("track")} className="rounded-xl bg-white/10 border border-white/20 px-4 py-2 hover:bg-white/20 transition">Change Track</button>
          <button onClick={() => setScreen("race")} className={`rounded-xl px-5 py-2 font-semibold transition ${isWinner ? "bg-yellow-500 hover:bg-yellow-400 text-black" : "bg-indigo-500 hover:bg-indigo-400"}`}>Race Again</button>
          <button onClick={() => setScreen("home")} className="rounded-xl bg-white/10 border border-white/20 px-4 py-2 hover:bg-white/20 transition">Main Menu</button>
        </div>
      </div>
    </div>
  );
}

function RaceScreen(){
  const { character, car, track, laps } = useSafeSelection();
  const platform = usePlatform();
  const [finished, setFinished] = useState(false);
  useEffect(()=>{ setFinished(false); }, [character, car, track]);
  return (
    <div className="h-full w-full">
      <RaceScene theme={track || TRACKS[0]} character={character || CHARACTERS[0]} car={car || CARS[0]} platform={platform} onFinish={()=> setFinished(true)} />
      {finished && <FinishScreen position={liveRace.position} />}
    </div>
  );
}

function SettingsModal(){
  const { showSettings } = useSettings();
  const platform = usePlatform();
  const screen = useScreen();
  if(!showSettings) return null;
  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm grid place-items-center z-20">
      <div className="w-[min(92vw,680px)] rounded-2xl border border-white/20 bg-zinc-900/90 p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="text-xl font-bold">Settings</div>
          <button onClick={()=> setShowSettings(false)} className="rounded-xl bg-white/10 px-3 py-1">✕</button>
        </div>
        <div className="grid md:grid-cols-2 gap-6">
          <div>
            <div className="text-sm uppercase tracking-wider text-white/70 mb-2">Platform</div>
            <div className="flex gap-2 flex-wrap">
              {["Laptop","iPad","iPhone"].map(p=> (
                <button key={p} onClick={()=> setPlatform(p)} className={`rounded-xl border px-3 py-1 ${platform===p?"bg-white/20 border-white/50":"bg-white/5 border-white/20"}`}>{p}</button>
              ))}
            </div>
            <div className="mt-4 text-sm text-white/80">
              {platform === "Laptop" ? (
                <div>
                  <div className="font-semibold mb-1">Controls</div>
                  <ul className="list-disc list-inside text-white/70">
                    <li>W / ↑ — Accelerate</li>
                    <li>S / ↓ — Brake / Reverse (+ A/D to drift)</li>
                    <li>A / ← — Steer Left</li>
                    <li>D / → — Steer Right</li>
                    <li>Esc / P — Pause</li>
                  </ul>
                </div>
              ) : (
                <div>
                  <div className="font-semibold mb-1">Touch Controls</div>
                  <ul className="list-disc list-inside text-white/70">
                    <li>Left / Right — Steering</li>
                    <li>▲ — Accelerate</li>
                    <li>▼ — Brake</li>
                  </ul>
                </div>
              )}
            </div>
          </div>
          <div>
            <div className="text-sm uppercase tracking-wider text-white/70 mb-2">Game</div>
            <div className="flex gap-2 flex-wrap">
              {screen === "race" && (
                <button onClick={()=> { setShowSettings(false); }} className="rounded-xl bg-green-500 px-3 py-2">Resume</button>
              )}
              <button onClick={()=> { setShowSettings(false); setScreen("home"); }} className="rounded-xl bg-red-500/80 px-3 py-2">End Game</button>
            </div>
            <div className="mt-4 text-sm text-white/70">HyperKart 3D demo — made with WebGL and a lot of enthusiasm. 🏁</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// -----------------------------
// Self-tests (lightweight, runtime) — ALWAYS-ON test cases
// -----------------------------
const TEST_RESULTS = [];
function test(name, fn){
  try { fn(); TEST_RESULTS.push({ name, ok: true }); }
  catch (e){ console.error(`[TEST FAIL] ${name}:`, e); TEST_RESULTS.push({ name, ok: false, error: String(e) }); }
}

// Test: store initialized with defaults
test("store has default selection", ()=>{
  const s = useStore.get();
  if(!s) throw new Error("store is undefined");
  if(!s.selectedCharacter || !s.selectedCar || !s.selectedTrack) throw new Error("default selection missing");
});

// Test: safe selection falls back when given invalid input
test("makeSafeSelection() returns defaults for bad input", ()=>{
  const sel = makeSafeSelection(undefined);
  if(!sel.character || !sel.car || !sel.track) throw new Error("safe selection did not provide defaults");
});

// Test: tracks array has required themes
test("TRACKS has classic/city/west", ()=>{
  const ids = new Set(TRACKS.map(t=>t.id));
  ["classic","city","west"].forEach(id=>{ if(!ids.has(id)) throw new Error(`missing track ${id}`); });
});

test("ITEMS has 5 items with ids", ()=>{
  if(ITEMS.length !== 5) throw new Error(`expected 5 items, got ${ITEMS.length}`);
  ["mushroom","banana","missile","shield","lightning"].forEach(id=>{
    if(!ITEMS.find(i=>i.id===id)) throw new Error(`missing item ${id}`);
  });
});

test("getRandomItem returns valid item id", ()=>{
  for(let pos=1; pos<=5; pos++){
    const id = getRandomItem(pos);
    if(!ITEMS.find(i=>i.id===id)) throw new Error(`invalid item id "${id}" for position ${pos}`);
  }
});

test("liveRace has item system fields", ()=>{
  if(!Array.isArray(liveRace.activeBananas)) throw new Error("activeBananas not array");
  if(!Array.isArray(liveRace.activeMissiles)) throw new Error("activeMissiles not array");
  if(typeof liveRace.itemBoxCooldowns !== "object") throw new Error("itemBoxCooldowns not object");
});

function DevTestOverlay(){
  const [open, setOpen] = useState(false);
  const pass = TEST_RESULTS.filter(t=>t.ok).length;
  const fail = TEST_RESULTS.length - pass;
  return (
    <div className="fixed bottom-3 left-3 z-30">
      <button onClick={()=> setOpen(o=>!o)} className={`rounded-xl px-3 py-1 text-xs ${fail?"bg-red-600":"bg-white/10"} border border-white/20`}>Tests {pass}/{TEST_RESULTS.length}{fail?` – ${fail} fail`:""}</button>
      {open && (
        <div className="mt-2 w-72 max-h-56 overflow-auto rounded-xl bg-black/70 border border-white/20 p-2 text-xs">
          {TEST_RESULTS.map((t,i)=> (
            <div key={i} className={t.ok?"text-green-300":"text-red-300"}>
              {t.ok?"✔":"✖"} {t.name}{!t.ok?` — ${t.error}`:""}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// -----------------------------
// Root component
// -----------------------------
export default function HyperKart3D(){
  const screen = useScreen();
  useEffect(()=>{
    // sensible default platform guess
    const ua = (typeof navigator !== "undefined" ? navigator.userAgent : "").toLowerCase();
    if(/iphone/.test(ua)) setPlatform("iPhone");
    else if(/ipad|tablet/.test(ua)) setPlatform("iPad");
    else setPlatform("Laptop");
  }, []);
  return (
    <div
      className="h-screen w-screen bg-gradient-to-b from-slate-900 to-black text-white relative overflow-hidden"
      style={{
        background:
          "radial-gradient(circle at 20% 20%, rgba(79,70,229,0.12), transparent 35%), radial-gradient(circle at 80% 10%, rgba(14,165,233,0.12), transparent 30%), radial-gradient(circle at 50% 80%, rgba(16,185,129,0.08), transparent 35%), #020617",
      }}
    >
      <TopBar />
      {screen === "home" && <HomeScreen />}
      {screen === "howto" && <HowToPlayScreen />}
      {screen === "character" && <CharacterScreen />}
      {screen === "car" && <CarScreen />}
      {screen === "track" && <TrackScreen />}
      {screen === "race" && <RaceScreen />}
      <SettingsModal />
    </div>
  );
}
