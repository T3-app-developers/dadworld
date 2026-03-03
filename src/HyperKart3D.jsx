import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { Environment } from "@react-three/drei";

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
    trackWidth: 10,
    envPreset: "park",
    waypoints: [
      [0,-35],[18,-32],[32,-20],[38,0],[32,18],[18,30],[0,34],
      [-14,30],[-24,22],[-20,14],[-28,8],[-38,0],[-32,-18],[-18,-32],
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
    turf: "#1b5e20",
    trackWidth: 9,
    envPreset: "night",
    waypoints: [
      [15,25],[-15,25],[-15,10],[-30,10],[-30,-10],
      [-15,-10],[-15,-25],[15,-25],[15,-10],[30,-10],[30,10],[15,10],
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
    turf: "#8d6e63",
    trackWidth: 11,
    envPreset: "sunset",
    waypoints: [
      [0,40],[22,36],[40,22],[44,0],[40,-20],[25,-36],
      [0,-40],[-22,-34],[-40,-18],[-42,5],[-30,24],[-12,38],
    ],
    boostTs: [0.1, 0.4, 0.7],
  },
];

const DEFAULT_LAPS = 3;

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

// Module-level shared race data (written by physics loop, read by HUD)
const liveRace = {
  playerT: 0, playerPos: [0, 0], playerLap: 1, playerYaw: 0,
  ai: [], position: 1, drifting: false, totalLaps: DEFAULT_LAPS,
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
  const [keys, setKeys] = useState({ left: false, right: false, up: false, down: false });
  useEffect(() => {
    if (!enabled) return;
    const down = (e) => {
      if (["ArrowLeft", "a", "A"].includes(e.key)) setKeys((k) => ({ ...k, left: true }));
      if (["ArrowRight", "d", "D"].includes(e.key)) setKeys((k) => ({ ...k, right: true }));
      if (["ArrowUp", "w", "W"].includes(e.key)) setKeys((k) => ({ ...k, up: true }));
      if (["ArrowDown", "s", "S"].includes(e.key)) setKeys((k) => ({ ...k, down: true }));
      if (e.key === "Escape" || e.key === "p" || e.key === "P") setShowSettings(true);
    };
    const up = (e) => {
      if (["ArrowLeft", "a", "A"].includes(e.key)) setKeys((k) => ({ ...k, left: false }));
      if (["ArrowRight", "d", "D"].includes(e.key)) setKeys((k) => ({ ...k, right: false }));
      if (["ArrowUp", "w", "W"].includes(e.key)) setKeys((k) => ({ ...k, up: false }));
      if (["ArrowDown", "s", "S"].includes(e.key)) setKeys((k) => ({ ...k, down: false }));
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, [enabled]);
  return keys;
}

function TouchPad({ onChange }) {
  const [state, setState] = useState({ left: false, right: false, up: false, down: false });
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

function TrackRoad({ curve, trackWidth }) {
  const geo = useMemo(() => createRoadGeometry(curve, trackWidth), [curve, trackWidth]);
  return (
    <mesh geometry={geo}>
      <meshStandardMaterial color="#444" metalness={0.1} roughness={0.85} side={THREE.DoubleSide} />
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
              <planeGeometry args={[6, 3]} />
              <meshBasicMaterial color="#00e5ff" transparent opacity={0.5} />
            </mesh>
            {/* Arrow markers */}
            <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[1.5, 2]} />
              <meshBasicMaterial color="#00ffff" transparent opacity={0.7} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

function GroundPlane({ color = "#1b5e20", size = 200 }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
      <planeGeometry args={[size, size]} />
      <meshStandardMaterial color={color} roughness={1} />
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
      const dist = 12 + Math.random() * 8;
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
      const dist = 10 + Math.random() * 5;
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
      const dist = 11 + Math.random() * 10;
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

  useFrame((state, dt) => {
    if (dt > 0.05) dt = 0.05;
    if (!curve) return;
    const controls = controlRef.current || { left: false, right: false, up: false, down: false };
    const maxSpeed = carStats.maxSpeed;
    const handling = carStats.handling;
    const hw = (trackWidth || 10) / 2;

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
        driftDir.current = controls.left ? 1 : -1;
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
      if (controls.left) yaw.current += steerRate * dt;
      if (controls.right) yaw.current -= steerRate * dt;
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
    vel.current = clamp(vel.current, -maxSpeed * 0.3, maxSpeed);

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
      if (Math.hypot(dx, dz) < 4 && state.clock.elapsedTime - lastBoostTime.current > 1.0) {
        vel.current = Math.min(maxSpeed * 1.3, vel.current + 10);
        lastBoostTime.current = state.clock.elapsedTime;
      }
    }

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
  return (
    <group>
      {/* Low wedge chassis */}
      <mesh castShadow position={[0, 0.2, 0]}><boxGeometry args={[1.4, 0.25, 2.4]} /><meshStandardMaterial {...paintMat(color)} /></mesh>
      {/* Tapered nose */}
      <mesh castShadow position={[0, 0.2, -1.3]}><boxGeometry args={[0.9, 0.15, 0.5]} /><meshStandardMaterial {...paintMat(color)} /></mesh>
      {/* Cockpit windshield */}
      <mesh castShadow position={[0, 0.4, 0.1]}><boxGeometry args={[0.8, 0.2, 0.6]} /><meshStandardMaterial {...darkGlass} /></mesh>
      {/* Driver head */}
      <mesh castShadow position={[0, 0.65, 0.3]}><sphereGeometry args={[0.25, 16, 16]} /><meshStandardMaterial color={accent} /></mesh>
      {/* Rear fin */}
      <mesh castShadow position={[0, 0.45, 1.1]}><boxGeometry args={[0.05, 0.35, 0.5]} /><meshStandardMaterial {...accentMat(accent)} /></mesh>
      {/* Wheels — low profile */}
      <Wheel x={-0.65} z={-0.85} r={0.18} w={0.16} />
      <Wheel x={0.65} z={-0.85} r={0.18} w={0.16} />
      <Wheel x={-0.65} z={0.85} r={0.18} w={0.16} />
      <Wheel x={0.65} z={0.85} r={0.18} w={0.16} />
    </group>
  );
}

function TorqueBody({ color, accent }) {
  return (
    <group>
      {/* Wide chassis */}
      <mesh castShadow position={[0, 0.28, 0]}><boxGeometry args={[1.8, 0.35, 2.6]} /><meshStandardMaterial {...paintMat(color)} /></mesh>
      {/* Long hood */}
      <mesh castShadow position={[0, 0.38, -0.9]}><boxGeometry args={[1.5, 0.18, 1.0]} /><meshStandardMaterial {...paintMat(color)} /></mesh>
      {/* Engine intake */}
      <mesh castShadow position={[0, 0.52, -0.7]}><boxGeometry args={[0.5, 0.2, 0.4]} /><meshStandardMaterial color="#333" metalness={0.5} roughness={0.4} /></mesh>
      {/* Cabin */}
      <mesh castShadow position={[0, 0.5, 0.3]}><boxGeometry args={[1.0, 0.25, 0.7]} /><meshStandardMaterial {...darkGlass} /></mesh>
      {/* Driver head */}
      <mesh castShadow position={[0, 0.78, 0.35]}><sphereGeometry args={[0.28, 16, 16]} /><meshStandardMaterial color={accent} /></mesh>
      {/* Spoiler wing */}
      <mesh castShadow position={[0, 0.7, 1.2]}><boxGeometry args={[1.8, 0.06, 0.4]} /><meshStandardMaterial {...accentMat(accent)} /></mesh>
      {/* Spoiler posts */}
      <mesh castShadow position={[-0.5, 0.5, 1.2]}><boxGeometry args={[0.08, 0.4, 0.08]} /><meshStandardMaterial {...accentMat(accent)} /></mesh>
      <mesh castShadow position={[0.5, 0.5, 1.2]}><boxGeometry args={[0.08, 0.4, 0.08]} /><meshStandardMaterial {...accentMat(accent)} /></mesh>
      {/* Side exhausts */}
      <mesh castShadow position={[-0.95, 0.25, 0.7]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.08, 0.08, 0.4, 8]} /><meshStandardMaterial color="#555" metalness={0.7} roughness={0.3} /></mesh>
      <mesh castShadow position={[0.95, 0.25, 0.7]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.08, 0.08, 0.4, 8]} /><meshStandardMaterial color="#555" metalness={0.7} roughness={0.3} /></mesh>
      {/* Big rear wheels, smaller front */}
      <Wheel x={-0.85} z={-0.95} r={0.2} w={0.16} />
      <Wheel x={0.85} z={-0.95} r={0.2} w={0.16} />
      <Wheel x={-0.85} z={0.95} r={0.28} w={0.22} />
      <Wheel x={0.85} z={0.95} r={0.28} w={0.22} />
    </group>
  );
}

function GliderBody({ color, accent }) {
  return (
    <group>
      {/* Narrow central nose */}
      <mesh castShadow position={[0, 0.22, -0.2]}><boxGeometry args={[0.7, 0.22, 2.8]} /><meshStandardMaterial {...paintMat(color)} /></mesh>
      {/* Front wing */}
      <mesh castShadow position={[0, 0.12, -1.5]}><boxGeometry args={[2.2, 0.04, 0.3]} /><meshStandardMaterial {...accentMat(accent)} /></mesh>
      {/* Rear wing */}
      <mesh castShadow position={[0, 0.55, 1.2]}><boxGeometry args={[1.8, 0.04, 0.3]} /><meshStandardMaterial {...accentMat(accent)} /></mesh>
      {/* Rear wing endplates */}
      <mesh castShadow position={[-0.9, 0.5, 1.2]}><boxGeometry args={[0.04, 0.15, 0.35]} /><meshStandardMaterial {...accentMat(accent)} /></mesh>
      <mesh castShadow position={[0.9, 0.5, 1.2]}><boxGeometry args={[0.04, 0.15, 0.35]} /><meshStandardMaterial {...accentMat(accent)} /></mesh>
      {/* Rear wing posts */}
      <mesh castShadow position={[-0.3, 0.38, 1.1]}><boxGeometry args={[0.06, 0.25, 0.06]} /><meshStandardMaterial {...accentMat(accent)} /></mesh>
      <mesh castShadow position={[0.3, 0.38, 1.1]}><boxGeometry args={[0.06, 0.25, 0.06]} /><meshStandardMaterial {...accentMat(accent)} /></mesh>
      {/* Side pods */}
      <mesh castShadow position={[-0.7, 0.2, 0.2]}><boxGeometry args={[0.5, 0.2, 1.0]} /><meshStandardMaterial {...paintMat(color)} /></mesh>
      <mesh castShadow position={[0.7, 0.2, 0.2]}><boxGeometry args={[0.5, 0.2, 1.0]} /><meshStandardMaterial {...paintMat(color)} /></mesh>
      {/* Cockpit */}
      <mesh castShadow position={[0, 0.4, 0.1]}><boxGeometry args={[0.5, 0.18, 0.5]} /><meshStandardMaterial {...darkGlass} /></mesh>
      {/* Driver head */}
      <mesh castShadow position={[0, 0.6, 0.2]}><sphereGeometry args={[0.22, 16, 16]} /><meshStandardMaterial color={accent} /></mesh>
      {/* Large exposed wheels */}
      <Wheel x={-1.05} z={-1.0} r={0.25} w={0.2} />
      <Wheel x={1.05} z={-1.0} r={0.25} w={0.2} />
      <Wheel x={-1.05} z={0.9} r={0.25} w={0.2} />
      <Wheel x={1.05} z={0.9} r={0.25} w={0.2} />
    </group>
  );
}

function BulldogBody({ color, accent }) {
  return (
    <group>
      {/* Tall wide chassis */}
      <mesh castShadow position={[0, 0.4, 0]}><boxGeometry args={[2.0, 0.5, 2.0]} /><meshStandardMaterial {...paintMat(color)} /></mesh>
      {/* Cab */}
      <mesh castShadow position={[0, 0.8, 0.15]}><boxGeometry args={[1.5, 0.35, 1.2]} /><meshStandardMaterial {...darkGlass} /></mesh>
      {/* Bull bar */}
      <mesh castShadow position={[0, 0.35, -1.15]}><boxGeometry args={[2.2, 0.3, 0.2]} /><meshStandardMaterial color="#888" metalness={0.6} roughness={0.3} /></mesh>
      {/* Roof rack */}
      <mesh castShadow position={[0, 1.0, 0.15]}><boxGeometry args={[1.3, 0.04, 1.0]} /><meshStandardMaterial color="#666" metalness={0.5} roughness={0.4} /></mesh>
      {/* Roof rack rails */}
      <mesh castShadow position={[-0.6, 0.97, 0.15]}><boxGeometry args={[0.06, 0.06, 1.0]} /><meshStandardMaterial color="#666" /></mesh>
      <mesh castShadow position={[0.6, 0.97, 0.15]}><boxGeometry args={[0.06, 0.06, 1.0]} /><meshStandardMaterial color="#666" /></mesh>
      {/* Driver head */}
      <mesh castShadow position={[0, 1.15, 0.2]}><sphereGeometry args={[0.28, 16, 16]} /><meshStandardMaterial color={accent} /></mesh>
      {/* Taillights */}
      <mesh position={[-0.7, 0.5, 1.02]}><boxGeometry args={[0.3, 0.12, 0.05]} /><meshStandardMaterial color="#ff3333" emissive="#ff0000" emissiveIntensity={0.5} /></mesh>
      <mesh position={[0.7, 0.5, 1.02]}><boxGeometry args={[0.3, 0.12, 0.05]} /><meshStandardMaterial color="#ff3333" emissive="#ff0000" emissiveIntensity={0.5} /></mesh>
      {/* Oversized wheels with high ride */}
      <Wheel x={-0.9} z={-0.8} r={0.3} w={0.22} />
      <Wheel x={0.9} z={-0.8} r={0.3} w={0.22} />
      <Wheel x={-0.9} z={0.8} r={0.3} w={0.22} />
      <Wheel x={0.9} z={0.8} r={0.3} w={0.22} />
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
    const desired = new THREE.Vector3().copy(t).addScaledVector(behind, 8).add(new THREE.Vector3(0, 5, 0));

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
  { color: "#ef5da8", accent: "#fff", startT: 0.08, speed: 24, bodyType: "glider", offset: -1.5 },
  { color: "#ffe082", accent: "#fff", startT: 0.16, speed: 26, bodyType: "torque", offset: 1.5 },
  { color: "#ff7043", accent: "#fff", startT: 0.24, speed: 22, bodyType: "bulldog", offset: -0.5 },
  { color: "#8bc34a", accent: "#fff", startT: 0.32, speed: 25, bodyType: "sprinter", offset: 0.5 },
];

function AIKart({ color, accent="#fff", startT, speed, bodyType, offset=0, curve, trackWidth, playerProgressRef }) {
  const ref = useRef();
  const progress = useRef(startT);
  const lap = useRef(1);
  const prevT = useRef(startT);
  const wobble = useRef(Math.random() * Math.PI * 2);
  const aiIndex = useRef(-1);

  useEffect(() => {
    const idx = liveRace.ai.length;
    aiIndex.current = idx;
    liveRace.ai.push({ t: startT, lap: 1, pos: [0, 0], color });
  }, []);

  useFrame((state, dt) => {
    if (dt > 0.05) dt = 0.05;
    if (!curve) return;
    const curveLen = curve.getLength();

    // Rubber banding: slow down when ahead, speed up when behind
    const playerProgress = (liveRace.playerLap - 1) + liveRace.playerT;
    const aiProgress = (lap.current - 1) + progress.current;
    const gap = aiProgress - playerProgress;
    let rubberBand = 1.0;
    if (gap > 0.3) rubberBand = 0.85;
    else if (gap < -0.3) rubberBand = 1.15;

    // Curvature-based speed: slow in corners
    const t1 = progress.current;
    const t2 = (t1 + 0.01) % 1;
    const tang1 = curve.getTangentAt(t1);
    const tang2 = curve.getTangentAt(t2);
    const curvature = tang1.distanceTo(tang2) * 100;
    const cornerFactor = 1.0 / (1 + curvature * 2);

    // Speed with wobble
    const wobbleSpeed = 1 + Math.sin(state.clock.elapsedTime * 0.7 + wobble.current) * 0.06;
    const actualSpeed = speed * rubberBand * cornerFactor * wobbleSpeed;
    const tDelta = (actualSpeed * dt) / curveLen;

    prevT.current = progress.current;
    progress.current = (progress.current + tDelta) % 1;

    // Lap detection: wrapped past 0
    if (prevT.current > 0.9 && progress.current < 0.1) {
      lap.current += 1;
    }

    // Position on track with offset
    const p = curve.getPointAt(progress.current);
    const tang = curve.getTangentAt(progress.current);
    const nx = -tang.z, nz = tang.x;
    const len = Math.hypot(nx, nz) || 1;
    const sideOff = offset + Math.sin(state.clock.elapsedTime * 0.3 + wobble.current) * 1.0;
    const clampedOff = clamp(sideOff, -trackWidth / 2 + 1, trackWidth / 2 - 1);

    if (ref.current) {
      ref.current.position.set(p.x + (nx / len) * clampedOff, 0.35, p.z + (nz / len) * clampedOff);
      ref.current.rotation.y = Math.atan2(-tang.x, -tang.z);
    }

    // Update shared race data
    if (aiIndex.current >= 0 && aiIndex.current < liveRace.ai.length) {
      liveRace.ai[aiIndex.current] = { t: progress.current, lap: lap.current, pos: [ref.current?.position.x || 0, ref.current?.position.z || 0], color };
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
// Scene wrapper
// -----------------------------
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
    useRaceSetter()({ currentLap: 1, totalLaps: useStore.get().laps, finished: false, position: 1 });
  }, []);

  useEffect(() => { if(finished && onFinish) onFinish(); }, [finished, onFinish]);

  useEffect(() => {
    racingMusic.start();
    return () => racingMusic.stop();
  }, []);

  const bgColor = new THREE.Color(theme?.sky || "#222");
  const fogColor = new THREE.Color(theme?.fog || "#333");
  const hemiGround = new THREE.Color(theme?.turf || "#1b5e20");
  const aiRacers = AI_RACERS.filter(a => a.color !== character.color);

  return (
    <div className="relative h-full w-full">
      <Canvas shadows camera={{ position:[0,8,12], fov:55 }}>
        <color attach="background" args={[bgColor]} />
        <fog attach="fog" args={[fogColor, 40, 150]} />
        <hemisphereLight skyColor={bgColor} groundColor={hemiGround} intensity={0.6} />
        <directionalLight position={[20, 30, 15]} intensity={1.2} castShadow shadow-mapSize-width={2048} shadow-mapSize-height={2048} />
        <directionalLight position={[-15, 20, -10]} intensity={0.4} />
        <Environment preset={theme?.envPreset || "sunset"} background={false} />

        {/* Ground + Track */}
        <GroundPlane color={theme?.turf || "#1b5e20"} />
        {curve && <TrackRoad curve={curve} trackWidth={trackWidth} />}
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
          <AIKart key={i} color={ai.color} accent={ai.accent} startT={ai.startT} speed={ai.speed} bodyType={ai.bodyType} offset={ai.offset} curve={curve} trackWidth={trackWidth} />
        ))}

        {theme.theme !== "classic" && <StarsField count={1000} radius={120} />}
      </Canvas>

      {/* HUD: Lap counter + Position */}
      <div className="pointer-events-none absolute top-4 left-1/2 -translate-x-1/2 text-center bg-black/50 rounded-2xl px-6 py-3 backdrop-blur-md border border-white/20">
        <div className="text-xs uppercase tracking-widest text-white/70 mb-1">Lap</div>
        <div className="text-2xl font-bold tabular-nums">{Math.min(currentLap, totalLaps)} <span className="text-white/50">/</span> {totalLaps}</div>
      </div>
      <PositionHUD />
      {curve && <MiniMap curve={curve} />}

      {/* Drift indicator */}
      <DriftIndicator />

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
    <div className={`rounded-2xl overflow-hidden bg-white/5 border border-white/10 ${className}`}>
      <Canvas camera={{ position: [3, 2, 4], fov: 40 }} dpr={[1, 1.5]}>
        <color attach="background" args={["#0f172a"]} />
        <ambientLight intensity={0.5} />
        <directionalLight position={[5, 8, 5]} intensity={1} />
        <Environment preset="sunset" background={false} />
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
      <TrackRoad curve={curve} trackWidth={track.trackWidth || 10} />
      <TrackCurbs curve={curve} trackWidth={track.trackWidth || 10} />
      <BoostPads curve={curve} boostTs={track.boostTs || []} />
      <GroundPlane color={track.turf} size={120} />
    </group>
  );
}

function TrackPreview({ track }) {
  return (
    <div className="h-28 rounded-xl overflow-hidden">
      <Canvas camera={{ position: [0, 60, 30], fov: 40 }} dpr={[1, 1.5]}>
        <color attach="background" args={[track.sky]} />
        <ambientLight intensity={0.6} />
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
  // Only show on home and race screens to avoid overlapping step indicators
  if (screen !== "home" && screen !== "race") return null;
  return (
    <div className="pointer-events-none absolute top-0 left-0 right-0 flex items-center justify-between p-4 z-10">
      <div className="pointer-events-auto select-none text-sm tracking-wide uppercase text-white/70">{screen === "race" ? "" : "HyperKart 3D"}</div>
      <button onClick={()=> setShowSettings(true)} className="pointer-events-auto rounded-xl bg-white/10 border border-white/20 px-4 py-2 text-sm hover:bg-white/20 transition">Settings</button>
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
          <a href="#howto" className="rounded-2xl bg-white/10 border border-white/20 px-6 py-3">How to Play</a>
        </div>
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
        <div className="text-center text-lg font-semibold mb-1">{sel.car.name}</div>
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

function RaceScreen(){
  const { character, car, track, laps } = useSafeSelection();
  const platform = usePlatform();
  const [finished, setFinished] = useState(false);
  useEffect(()=>{ setFinished(false); }, [character, car, track]);
  return (
    <div className="h-full w-full">
      <RaceScene theme={track || TRACKS[0]} character={character || CHARACTERS[0]} car={car || CARS[0]} platform={platform} onFinish={()=> setFinished(true)} />
      {finished && (
        <div className="absolute inset-0 grid place-items-center pointer-events-none">
          <div className="pointer-events-auto bg-black/60 border border-white/20 rounded-2xl p-8 text-center">
            <div className="text-4xl font-black mb-2">{liveRace.position === 1 ? "1st Place!" : liveRace.position === 2 ? "2nd Place!" : liveRace.position === 3 ? "3rd Place!" : `${liveRace.position}th Place`}</div>
            <div className="text-white/80 mb-4">{liveRace.position === 1 ? "You won the race!" : "Better luck next time!"}</div>
            <div className="flex gap-3 justify-center">
              <button onClick={()=> setScreen("track")} className="rounded-xl bg-white/10 px-4 py-2">Change Track</button>
              <button onClick={()=> setScreen("race")} className="rounded-xl bg-indigo-500 px-4 py-2">Race Again</button>
              <button onClick={()=> setScreen("home")} className="rounded-xl bg-white/10 px-4 py-2">Main Menu</button>
            </div>
          </div>
        </div>
      )}
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
      {screen === "character" && <CharacterScreen />}
      {screen === "car" && <CarScreen />}
      {screen === "track" && <TrackScreen />}
      {screen === "race" && <RaceScreen />}
      <SettingsModal />
    </div>
  );
}
