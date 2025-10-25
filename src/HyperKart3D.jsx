import React, { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

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
  { id: "sprinter", name: "Sprinter", accel: 9.5, maxSpeed: 28, handling: 1.0 },
  { id: "torque", name: "Torque", accel: 7.5, maxSpeed: 34, handling: 0.8 },
  { id: "glider", name: "Glider", accel: 8.5, maxSpeed: 31, handling: 1.1 },
  { id: "bulldog", name: "Bulldog", accel: 6.5, maxSpeed: 36, handling: 0.7 },
];

const TRACKS = [
  {
    id: "classic",
    name: "Stadium Classic",
    theme: "classic",
    sky: "#87ceeb",
    fog: "#a6d5f7",
    seatColor: "#334155",
    turf: "#2e7d32",
  },
  {
    id: "city",
    name: "Stadium City",
    theme: "city",
    sky: "#cfe3ff",
    fog: "#9bb7e2",
    seatColor: "#1f2937",
    turf: "#1b5e20",
  },
  {
    id: "west",
    name: "Stadium Wild West",
    theme: "west",
    sky: "#ffcc80",
    fog: "#ffc080",
    seatColor: "#5d4037",
    turf: "#8d6e63",
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
function Stadium({ theme, outerR = 22, innerR = 12 }) {
  // Seats: a ring of low-poly modules
  const seats = useMemo(() => {
    const arr = [];
    const rings = 4;
    for (let r = outerR + 1; r < outerR + 1 + rings; r++) {
      const count = Math.floor(2 * Math.PI * r / 2.5);
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2;
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        arr.push({ x, z, a, r });
      }
    }
    return arr;
  }, [outerR]);
  return (
    <group>
      {seats.map((s, i) => (
        <mesh key={i} position={[s.x, 1 + (s.r - outerR) * 0.4, s.z]} rotation={[0, -s.a, 0]}>
          <boxGeometry args={[1.9, 0.8, 1.4]} />
          <meshStandardMaterial color={theme.seatColor} metalness={0.2} roughness={0.8} />
        </mesh>
      ))}
    </group>
  );
}

function CityProps({ radius=30 }) {
  // Simple skyscrapers around outer ring
  const buildings = useMemo(() => {
    const arr = [];
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2;
      const r = radius + 5 + Math.random() * 15;
      arr.push({ a, r, h: 6 + Math.random() * 18 });
    }
    return arr;
  }, [radius]);
  return (
    <group>
      {buildings.map((b, i) => (
        <mesh key={i} position={[Math.cos(b.a)*b.r, b.h/2, Math.sin(b.a)*b.r]}>
          <boxGeometry args={[2 + Math.random()*2, b.h, 2 + Math.random()*2]} />
          <meshStandardMaterial color="#6b7280" metalness={0.4} roughness={0.6} />
        </mesh>
      ))}
    </group>
  );
}

function WestProps({ radius=30 }) {
  // Cacti + windmills beyond stands
  const cactus = (pos, i) => (
    <group key={i} position={pos}>
      <mesh position={[0, 1.2, 0]}>
        <cylinderGeometry args={[0.4, 0.6, 2.4, 8]} />
        <meshStandardMaterial color="#2e7d32" roughness={1} />
      </mesh>
      <mesh position={[0.5, 1.1, 0]} rotation={[0,0,Math.PI/2]}>
        <cylinderGeometry args={[0.15, 0.15, 1.2, 6]} />
        <meshStandardMaterial color="#2e7d32" />
      </mesh>
      <mesh position={[-0.5, 0.9, 0]} rotation={[0,0,Math.PI/2]}>
        <cylinderGeometry args={[0.15, 0.15, 1.0, 6]} />
        <meshStandardMaterial color="#2e7d32" />
      </mesh>
    </group>
  );
  const windmill = (pos, i) => (
    <group key={"w"+i} position={pos}>
      <mesh position={[0, 2.2, 0]}> <cylinderGeometry args={[0.2,0.3,4.4,8]} /> <meshStandardMaterial color="#795548" /></mesh>
      <WindmillBlades />
    </group>
  );
  const objs = useMemo(() => {
    const arr = [];
    for (let i=0;i<30;i++){
      const a = (i/30)*Math.PI*2; const r = radius + 7 + Math.random()*15;
      arr.push(cactus([Math.cos(a)*r,0,Math.sin(a)*r], i));
      if(i%5===0) arr.push(windmill([Math.cos(a)*(r+6),0,Math.sin(a)*(r+6)], i));
    }
    return arr;
  }, [radius]);
  return <group>{objs}</group>;
}

function WindmillBlades(){
  const ref = useRef();
  useFrame((_, dt)=>{ if(ref.current) ref.current.rotation.y += dt * 2; });
  return (
    <group ref={ref} position={[0, 3.5, 0]}>
      {[0,1,2,3].map(i=> (
        <mesh key={i} rotation={[0, i*Math.PI/2, 0]} position={[0,0,0]}>
          <boxGeometry args={[0.2, 0.6, 3]} />
          <meshStandardMaterial color="#efebe9" />
        </mesh>
      ))}
    </group>
  );
}

function RingTrack({ inner=12, outer=22, color="#444" }){
  // Flat ring as the drivable area
  return (
    <group>
      <mesh rotation={[-Math.PI/2,0,0]}>
        <ringGeometry args={[inner, outer, 128, 1]} />
        <meshStandardMaterial color={color} metalness={0.1} roughness={0.9} side={THREE.DoubleSide} />
      </mesh>
      {/* center turf */}
      <mesh rotation={[-Math.PI/2,0,0]}>
        <circleGeometry args={[inner-0.1, 64]} />
        <meshStandardMaterial color="#1b5e20" roughness={1} />
      </mesh>
      {/* outer turf */}
      <mesh rotation={[-Math.PI/2,0,0]}>
        <ringGeometry args={[outer+0.1, outer+12, 64, 1]} />
        <meshStandardMaterial color="#14532d" roughness={1} side={THREE.DoubleSide} />
      </mesh>
      {/* Start/Finish line */}
      <mesh position={[inner+((outer-inner)/2), 0.01, 0]} rotation={[-Math.PI/2,0,0]}>
        <planeGeometry args={[3, (outer-inner)]} />
        <meshBasicMaterial color="white" transparent opacity={0.6} />
      </mesh>
    </group>
  );
}

function BoostArcs({ inner=12, outer=22 }){
  // Three arc pads that give speed boosts
  const pads = [
    { ang: Math.PI/4, len: Math.PI/10 },
    { ang: Math.PI, len: Math.PI/10 },
    { ang: (3*Math.PI)/2, len: Math.PI/10 },
  ];
  return (
    <group>
      {pads.map((p, i)=> (
        <mesh key={i} rotation={[-Math.PI/2,0,0]} position={[0,0.02,0]}>
          <shapeGeometry args={[arcShape(inner+0.2, outer-0.2, p.ang, p.len)]} />
          <meshBasicMaterial color="#00e5ff" transparent opacity={0.45} />
        </mesh>
      ))}
    </group>
  );
}

function arcShape(inner, outer, start, len){
  const shape = new THREE.Shape();
  const pts = [];
  const seg = 24;
  for(let i=0;i<=seg;i++){
    const a = start + (i/seg)*len;
    pts.push(new THREE.Vector2(Math.cos(a)*outer, Math.sin(a)*outer));
  }
  for(let i=seg;i>=0;i--){
    const a = start + (i/seg)*len;
    pts.push(new THREE.Vector2(Math.cos(a)*inner, Math.sin(a)*inner));
  }
  shape.setFromPoints(pts);
  return shape;
}

function StarsField({ count = 800, radius = 120 }) {
  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = Math.random() * radius;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos((Math.random() * 2) - 1);
      const x = r * Math.sin(phi) * Math.cos(theta);
      const y = r * Math.sin(phi) * Math.sin(theta);
      const z = r * Math.cos(phi);
      arr[i * 3] = x;
      arr[i * 3 + 1] = y;
      arr[i * 3 + 2] = z;
    }
    return arr;
  }, [count, radius]);

  return (
    <points>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={positions.length / 3}
          array={positions}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial size={1.4} sizeAttenuation color="#ffffff" depthWrite={false} transparent opacity={0.6} />
    </points>
  );
}

// -----------------------------
// 3D: Kart + camera rig + physics
// -----------------------------
const Kart = React.forwardRef(function Kart({ color="#29b6f6", accent="#ffffff", controlRef, carStats }, ref){
  const group = useRef();
  // allow parent to attach to the visual group
  const attachRef = (node) => {
    group.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref && typeof ref === "object") ref.current = node;
  };

  const vel = useRef(0); // forward speed scalar
  const yaw = useRef(0);
  const pos = useRef(new THREE.Vector3( (12+5), 0.35, 0)); // start on start line
  const lastAngle = useRef(0);
  const checkpoint = useRef(false); // simple half-lap gate
  const setRace = useRaceSetter();
  const lastBoostTime = useRef(0);
  const { innerR, outerR } = useRace((r)=>({ innerR: r.innerR, outerR: r.outerR }));

  useFrame((state, dt)=>{
    if(dt>0.05) dt = 0.05; // clamp
    const controls = controlRef.current || {left:false,right:false,up:false,down:false};

    // acceleration & braking
    const accel = carStats.accel * 0.6; // tune
    const braking = carStats.accel * 0.8;
    const maxSpeed = carStats.maxSpeed;
    const handling = carStats.handling;

    if(controls.up) vel.current = clamp(vel.current + accel*dt, -maxSpeed*0.3, maxSpeed);
    else vel.current = clamp(vel.current - (accel*0.4)*dt, -maxSpeed*0.3, maxSpeed); // coast friction
    if(controls.down) vel.current = clamp(vel.current - braking*dt, -maxSpeed*0.3, maxSpeed);

    // steering (scaled by speed)
    const speedFactor = clamp(Math.abs(vel.current)/maxSpeed, 0, 1);
    const steerStrength = handling * (0.9*speedFactor + 0.1);
    if(controls.left) yaw.current += 1.8 * steerStrength * dt;
    if(controls.right) yaw.current -= 1.8 * steerStrength * dt;

    // integrate position
    pos.current.x += Math.cos(yaw.current) * vel.current * dt;
    pos.current.z += Math.sin(yaw.current) * vel.current * dt;

    // track boundary (ring)
    const r = Math.hypot(pos.current.x, pos.current.z);
    const centerR = (innerR + outerR) / 2;
    if(r < innerR){
      const k = innerR / r;
      pos.current.x *= k; pos.current.z *= k; vel.current *= 0.6;
    }
    if(r > outerR){
      const k = outerR / r;
      pos.current.x *= k; pos.current.z *= k; vel.current *= 0.6;
    }

    // Boost pads detection (simple angle windows)
    const ang = Math.atan2(pos.current.z, pos.current.x); // -pi..pi
    const pads = [Math.PI/4, Math.PI, (3*Math.PI)/2];
    for(const a of pads){
      const diff = Math.abs(normalizeAngle(ang - a));
      const onPad = diff < (Math.PI/12) && Math.abs(r - centerR) < (outerR-innerR)/3;
      if(onPad && state.clock.elapsedTime - lastBoostTime.current > 1.0){
        vel.current = Math.min(maxSpeed * 1.2, vel.current + 8);
        lastBoostTime.current = state.clock.elapsedTime;
      }
    }

    // Lap counting: cross +X axis from below to above
    const angPrev = lastAngle.current;
    const crossedStart = angPrev < 0 && ang >= 0 && Math.abs(r - centerR) < (outerR-innerR)/2;
    const crossedHalf = (angPrev < Math.PI && ang >= Math.PI) || (angPrev > -Math.PI && ang <= -Math.PI);
    if(crossedHalf) checkpoint.current = true;
    if(crossedStart && checkpoint.current){
      setRace((s)=>{
        const newLap = s.currentLap + 1;
        const finished = newLap > s.totalLaps;
        return { ...s, currentLap: newLap, finished };
      });
      checkpoint.current = false;
    }
    lastAngle.current = ang;

    // Write to scene
    if(group.current){
      group.current.position.copy(pos.current);
      group.current.rotation.y = -yaw.current + Math.PI/2; // face forward tangent
    }
  });

  return (
    <group ref={attachRef}>
      {/* chassis */}
      <mesh castShadow position={[0, 0.25, 0]}> <boxGeometry args={[1.6, 0.4, 2.4]} /> <meshStandardMaterial color={color} metalness={0.2} roughness={0.6} /> </mesh>
      {/* bumper */}
      <mesh castShadow position={[0, 0.3, -1.2]}> <boxGeometry args={[1.7, 0.3, 0.3]} /> <meshStandardMaterial color={accent} /> </mesh>
      {/* driver head */}
      <mesh castShadow position={[0, 0.85, 0.2]}> <sphereGeometry args={[0.35, 24, 24]} /> <meshStandardMaterial color={accent} /> </mesh>
      {/* wheels */}
      {[-0.7,0.7].map((x,i)=> [-0.9,0.9].map((z,j)=> (
        <mesh key={`${i}-${j}`} position={[x, 0.18, z]}> <torusGeometry args={[0.28, 0.12, 12, 24]} /> <meshStandardMaterial color="#111" /> </mesh>
      )))}
    </group>
  );
});

function normalizeAngle(a){
  let x = a % (2*Math.PI); if(x < -Math.PI) x += 2*Math.PI; if(x > Math.PI) x -= 2*Math.PI; return x;
}

// Race state kept separate so non-React bits can mutate
const useRace = (sel) => useRaceStore.useHook(sel);
const useRaceSetter = () => useRaceStore.setState;
const useRaceStore = (() => {
  const listeners = new Set();
  const state = { currentLap: 1, totalLaps: DEFAULT_LAPS, finished: false, innerR: 12, outerR: 22 };
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
  const offset = useRef(new THREE.Vector3(0, 5, 8));
  useFrame((state, dt)=>{
    const t = targetRef.current?.position || new THREE.Vector3();
    const behind = new THREE.Vector3(Math.sin(targetRef.current?.rotation?.y || 0), 0, Math.cos(targetRef.current?.rotation?.y || 0));
    const desired = new THREE.Vector3().copy(t).addScaledVector(behind, offset.current.z).add(new THREE.Vector3(0, offset.current.y, 0));
    camera.position.lerp(desired, 1 - Math.pow(0.001, dt));
    camera.lookAt(t.x, t.y + 0.5, t.z);
  });
  return null;
}

// -----------------------------
// Scene wrapper
// -----------------------------
function RaceScene({ theme, character, car, platform, onFinish }){
  const kartRef = useRef();
  const controlRef = useRef({ left:false,right:false,up:false,down:false });
  const kbd = useKeyboardControls(platform === "Laptop");
  const { currentLap, totalLaps, finished } = useRace((r)=>({ currentLap: r.currentLap, totalLaps: r.totalLaps, finished: r.finished }));

  useEffect(()=>{ if(platform === "Laptop") controlRef.current = kbd; }, [kbd, platform]);

  useEffect(()=>{ useRaceSetter()({ currentLap: 1, totalLaps: useStore.get().laps, finished: false }); }, []);

  useEffect(()=>{ if(finished && onFinish) onFinish(); }, [finished, onFinish]);

  const bgColor = new THREE.Color(theme?.sky || "#222");
  const fogColor = new THREE.Color(theme?.fog || "#333");
  const hemiGround = new THREE.Color(theme?.turf || "#1b5e20");

  return (
    <div className="relative h-full w-full">
      <Canvas shadows camera={{ position:[0,8,12], fov:55 }}>
        <color attach="background" args={[bgColor]} />
        <fog attach="fog" args={[fogColor, 30, 120]} />
        <hemisphereLight skyColor={bgColor} groundColor={hemiGround} intensity={0.5} />
        <directionalLight position={[15, 25, 10]} intensity={1.2} castShadow shadow-mapSize-width={2048} shadow-mapSize-height={2048} />

        {/* Ground stadium + track */}
        <Stadium theme={theme} />
        <RingTrack />
        <BoostArcs />

        {/* Theme props */}
        {theme.theme === "city" && <CityProps />}
        {theme.theme === "west" && <WestProps />}

        {/* Kart */}
        <Kart ref={kartRef} color={character.color} accent={"#fff"} controlRef={controlRef} carStats={car} />
        <CameraRig targetRef={kartRef} />

        {/* Sky detail */}
        {theme.theme !== "classic" && <StarsField count={1000} radius={120} />}
      </Canvas>

      <div className="pointer-events-none absolute top-4 left-4 text-sm font-medium bg-black/30 rounded-xl px-4 py-2 backdrop-blur border border-white/10">
        <div className="text-xs uppercase tracking-wider text-white/80">Lap</div>
        <div className="text-lg">{currentLap} / {totalLaps}</div>
      </div>

      {/* Touch controls overlay */}
      {(platform === "iPad" || platform === "iPhone") && (
        <TouchPad onChange={(s)=> (controlRef.current = s)} />
      )}
    </div>
  );
}

// -----------------------------
// UI: Screens & Settings
// -----------------------------
function TopBar(){
  const { showSettings } = useSettings();
  const screen = useScreen();
  return (
    <div className="pointer-events-none absolute top-0 left-0 right-0 flex items-center justify-between p-4">
      <div className="pointer-events-auto select-none text-sm tracking-wide uppercase text-white/70">{screen === "race" ? "HyperKart — Race" : "HyperKart 3D"}</div>
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
      <div className="p-6 text-xl font-bold">Select Character</div>
      <div className="flex-1 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-4 px-6 pb-6">
        {CHARACTERS.map((c)=> (
          <button key={c.id} onClick={()=> setCharacter(c)} className={`rounded-2xl border px-3 py-4 text-left transition ${sel.character.id===c.id?"border-white bg-white/10":"border-white/20 bg-white/5 hover:bg-white/10"}`}>
            <div className="h-16 w-full grid place-items-center"><div className="h-10 w-10 rounded-full" style={{background:c.color}} /></div>
            <div className="font-semibold">{c.name}</div>
          </button>
        ))}
      </div>
      <div className="p-6 border-t border-white/10 flex justify-between">
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
      <div className="p-6 text-xl font-bold">Select Car</div>
      <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 px-6 pb-6">
        {CARS.map((c)=> (
          <button key={c.id} onClick={()=> setCar(c)} className={`rounded-2xl border px-4 py-4 text-left transition ${sel.car.id===c.id?"border-white bg-white/10":"border-white/20 bg-white/5 hover:bg-white/10"}`}>
            <div className="font-semibold text-lg mb-2">{c.name}</div>
            <Stat label="Accel" v={c.accel} max={10} />
            <Stat label="Top" v={c.maxSpeed/4} max={10} />
            <Stat label="Handling" v={c.handling*10} max={12} />
          </button>
        ))}
      </div>
      <div className="p-6 border-t border-white/10 flex justify-between">
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
      <div className="p-6 text-xl font-bold">Select Stadium Theme</div>
      <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-4 px-6 pb-6">
        {TRACKS.map((t)=> (
          <button key={t.id} onClick={()=> setTrack(t)} className={`rounded-2xl border px-4 py-4 text-left transition ${sel.track.id===t.id?"border-white bg-white/10":"border-white/20 bg-white/5 hover:bg-white/10"}`}>
            <div className="font-semibold text-lg mb-2">{t.name}</div>
            <div className="h-20 w-full rounded-xl" style={{ background: `linear-gradient(135deg, ${t.sky}, ${t.turf})` }} />
          </button>
        ))}
      </div>
      <div className="px-6 pb-6">
        <div className="mb-2 text-white/80">Laps: {laps}</div>
        <input type="range" min={1} max={7} value={laps} onChange={(e)=>{ setL(+e.target.value); setLaps(+e.target.value); }} className="w-full" />
      </div>
      <div className="p-6 border-t border-white/10 flex justify-between">
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
            <div className="text-2xl font-bold mb-2">Finish!</div>
            <div className="text-white/80 mb-4">You completed the race.</div>
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
                    <li>S / ↓ — Brake / Reverse</li>
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
    <div className="h-screen w-screen bg-gradient-to-b from-slate-900 to-black text-white relative overflow-hidden">
      <TopBar />
      {screen === "home" && <HomeScreen />}
      {screen === "character" && <CharacterScreen />}
      {screen === "car" && <CarScreen />}
      {screen === "track" && <TrackScreen />}
      {screen === "race" && <RaceScreen />}
      <SettingsModal />
      <DevTestOverlay />

      {/* Footer help */}
      <div id="howto" className="pointer-events-none absolute bottom-3 left-0 right-0 text-center text-white/50 text-xs">HyperKart is a demo. Expect arcade physics, ring tracks, lap counter, and boost pads. Build AI rivals, power-ups, and networked multiplayer as next steps.</div>
    </div>
  );
}
