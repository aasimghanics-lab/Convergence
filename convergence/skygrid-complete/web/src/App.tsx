import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, Sky, Stars } from "@react-three/drei";
import * as THREE from "three";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useAirspace } from "./useAirspace";
import { MassiveBattlefield, PlasmaShell, ProceduralFighter, ProceduralMech, RibbonTrail, Shockwave, VolumetricCloudField } from "./procedural";

type V3=[number,number,number];
type Enemy={id:number;kind:"fighter"|"spacecraft";p:V3;v:V3;hp:number};
type Shot={id:number;p:V3;v:V3;enemy:boolean;life:number};
type Missile={id:number;p:V3;v:V3;target:number;enemy:boolean;life:number;trail?:V3[]};
type Blast={id:number;p:V3;born:number};
type GameState={
 p:THREE.Vector3; v:THREE.Vector3; q:THREE.Quaternion; throttle:number; hp:number;
 score:number; kills:number; g:number; aoa:number; lock:number|null; flares:number; missiles:number;
 enemies:Enemy[]; shots:Shot[]; missilesLive:Missile[]; blasts:Blast[]; warning:boolean; tick:number;
};
const clamp=(x:number,a:number,b:number)=>Math.max(a,Math.min(b,x));
const vv=(a:V3)=>new THREE.Vector3(...a);
const arr=(v:THREE.Vector3):V3=>[v.x,v.y,v.z];
const keys=new Set<string>();

function Terrain(){
 const geo=useMemo(()=>{const g=new THREE.PlaneGeometry(1800,1800,120,120);const p=g.attributes.position as THREE.BufferAttribute;for(let i=0;i<p.count;i++){const x=p.getX(i),y=p.getY(i);p.setZ(i,Math.sin(x*.018)*9+Math.cos(y*.014)*7+Math.sin((x+y)*.008)*15)}g.computeVertexNormals();return g},[]);
 return <><mesh geometry={geo} rotation={[-Math.PI/2,0,0]} position={[0,-80,0]} receiveShadow><meshStandardMaterial color="#17201d" roughness={1}/></mesh>
 {Array.from({length:10},(_,i)=><ProceduralMech key={i} i={i} p={[-90+i*22,-65,-80+(i%3)*28]}/>)}</>
}
function Projectile({s}:{s:Shot}){return <mesh position={s.p}><sphereGeometry args={[.16,6,6]}/><meshBasicMaterial color={s.enemy?"#ff381f":"#8df6ff"} toneMapped={false}/><pointLight color={s.enemy?"#ff381f":"#8df6ff"} intensity={3} distance={5}/></mesh>}
function MissileMesh({m}:{m:Missile}){return <><group position={m.p}><mesh rotation={[0,0,-Math.PI/2]}><cylinderGeometry args={[.08,.12,1.1,8]}/><meshStandardMaterial color="#ddd" metalness={.8}/></mesh><pointLight color="#ff8c32" intensity={8} distance={10}/></group><RibbonTrail points={m.trail??[]} color={m.enemy?"#ff542e":"#8eeaff"}/></>}
function EnemyMesh({e,locked}:{e:Enemy;locked:boolean}){return <group position={e.p}><ProceduralFighter enemy space={e.kind==="spacecraft"}/>{locked&&<mesh rotation={[Math.PI/2,0,0]}><torusGeometry args={[4,.07,8,48]}/><meshBasicMaterial color="#ffcf45" toneMapped={false}/></mesh>}</group>}

function CombatWorld({g,setG}:{g:React.MutableRefObject<GameState>;setG:(s:GameState)=>void}){
 const player=useRef<THREE.Group>(null!);const {camera}=useThree();const acc=useRef(0);const fire=useRef(0);const missileCd=useRef(0);
 useEffect(()=>{const d=(e:KeyboardEvent)=>keys.add(e.code),u=(e:KeyboardEvent)=>keys.delete(e.code);addEventListener("keydown",d);addEventListener("keyup",u);return()=>{removeEventListener("keydown",d);removeEventListener("keyup",u)}},[]);
 useFrame((_,raw)=>{
  const dt=Math.min(raw,.033),s=g.current; acc.current+=dt;fire.current-=dt;missileCd.current-=dt;
  const pitch=(keys.has("KeyW")?1:0)-(keys.has("KeyS")?1:0), roll=(keys.has("KeyD")?1:0)-(keys.has("KeyA")?1:0), yaw=(keys.has("KeyE")?1:0)-(keys.has("KeyQ")?1:0);
  s.throttle=clamp(s.throttle+((keys.has("ShiftLeft")?1:0)-(keys.has("ControlLeft")?1:0))*dt*.5,.15,1);
  const localV=s.v.clone().applyQuaternion(s.q.clone().invert()); const speed=s.v.length();
  const density=Math.exp(-Math.max(0,s.p.y+80)/120); const authority=.35+density*.65;
  const dq=new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch*dt*1.25*authority,yaw*dt*.65*authority,-roll*dt*1.8*authority,"XYZ"));s.q.multiply(dq).normalize();
  const forward=new THREE.Vector3(1,0,0).applyQuaternion(s.q),up=new THREE.Vector3(0,1,0).applyQuaternion(s.q);
  const thrust=forward.multiplyScalar(90*s.throttle); const gravity=new THREE.Vector3(0,-18,0); const drag=s.v.clone().multiplyScalar(-.0025*density*speed);const lift=up.multiplyScalar(density*speed*speed*.0022*clamp(1+pitch*.4,.3,1.4));
  const old=s.v.clone();s.v.addScaledVector(thrust.add(gravity).add(drag).add(lift),dt);s.p.addScaledVector(s.v,dt);if(s.p.y<-58){s.p.y=-58;s.v.y=Math.abs(s.v.y)*.3;s.hp-=12*dt}
  s.g=clamp(s.v.clone().sub(old).length()/dt/9.81,0,12);s.aoa=Math.abs(Math.atan2(localV.y,Math.abs(localV.x)))*57.3;
  if(keys.has("Space")&&fire.current<=0){fire.current=.08;const v=new THREE.Vector3(420,0,0).applyQuaternion(s.q).add(s.v);s.shots.push({id:Date.now()+Math.random(),p:arr(s.p.clone().add(new THREE.Vector3(2,0,0).applyQuaternion(s.q))),v:arr(v),enemy:false,life:2})}
  if(keys.has("KeyR")&&missileCd.current<=0&&s.lock&&s.missiles>0){missileCd.current=.6;s.missiles--;s.missilesLive.push({id:Date.now(),p:arr(s.p),v:arr(s.v),target:s.lock,enemy:false,life:12,trail:[]})}
  if(keys.has("KeyF")&&s.flares>0){keys.delete("KeyF");s.flares-=2;s.missilesLive=s.missilesLive.filter(m=>!m.enemy||Math.random()>.65)}
  s.enemies.forEach(e=>{
    const ep=vv(e.p),ev=vv(e.v),to=s.p.clone().sub(ep),dist=to.length();const desired=to.normalize().multiplyScalar(e.kind==="spacecraft"?125:95);ev.lerp(desired,.35*dt);ep.addScaledVector(ev,dt);e.p=arr(ep);e.v=arr(ev);
    if(dist<130&&Math.random()<dt*.8){const lead=s.p.clone().addScaledVector(s.v,dist/260);const bv=lead.sub(ep).normalize().multiplyScalar(260);s.shots.push({id:Math.random(),p:arr(ep),v:arr(bv),enemy:true,life:2})}
    if(dist<300&&Math.random()<dt*.045)s.missilesLive.push({id:Math.random(),p:arr(ep),v:arr(ev),target:-1,enemy:true,life:10,trail:[]});
  });
  s.shots.forEach(b=>{const p=vv(b.p);p.addScaledVector(vv(b.v),dt);b.p=arr(p);b.life-=dt;if(b.enemy&&p.distanceTo(s.p)<2){s.hp-=8;b.life=0}if(!b.enemy)s.enemies.forEach(e=>{if(p.distanceTo(vv(e.p))<2){e.hp-=18;b.life=0}})});s.shots=s.shots.filter(b=>b.life>0);
  s.missilesLive.forEach(m=>{const p=vv(m.p),v=vv(m.v);const target=m.enemy?s.p:vv(s.enemies.find(e=>e.id===m.target)?.p??[9999,9999,9999]);const los=target.clone().sub(p);v.lerp(los.normalize().multiplyScalar(190),dt*2.8);p.addScaledVector(v,dt);m.p=arr(p);m.v=arr(v);m.trail=[...(m.trail??[]).slice(-28),arr(p)];m.life-=dt;if(p.distanceTo(target)<3){if(m.enemy)s.hp-=45;else{const e=s.enemies.find(e=>e.id===m.target);if(e)e.hp-=80}s.blasts.push({id:Math.random(),p:arr(p),born:performance.now()});m.life=0}});s.missilesLive=s.missilesLive.filter(m=>m.life>0);
  const dead=s.enemies.filter(e=>e.hp<=0);if(dead.length){dead.forEach(e=>s.blasts.push({id:Math.random(),p:e.p,born:performance.now()}));s.score+=dead.length*1000;s.kills+=dead.length;s.enemies=s.enemies.filter(e=>e.hp>0)}s.blasts=s.blasts.filter(b=>performance.now()-b.born<900)
  while(s.enemies.length<16){const id=Math.floor(Math.random()*1e8),ang=Math.random()*Math.PI*2,r=180+Math.random()*350;s.enemies.push({id,kind:Math.random()>.72?"spacecraft":"fighter",p:[s.p.x+Math.cos(ang)*r,s.p.y-20+Math.random()*100,s.p.z+Math.sin(ang)*r],v:[0,0,0],hp:100})}
  let best:number|null=null,bd=Infinity;s.enemies.forEach(e=>{const d=vv(e.p).distanceTo(s.p);if(d<bd){bd=d;best=e.id}});s.lock=best;s.warning=s.missilesLive.some(m=>m.enemy&&vv(m.p).distanceTo(s.p)<180);
  if(player.current){player.current.position.copy(s.p);player.current.quaternion.copy(s.q)}
  const camTarget=s.p.clone().add(new THREE.Vector3(-14,5,0).applyQuaternion(s.q));camera.position.lerp(camTarget,1-Math.exp(-5*dt));camera.lookAt(s.p.clone().add(new THREE.Vector3(35,0,0).applyQuaternion(s.q)));
  if(acc.current>.08){acc.current=0;s.tick++;setG({...s,enemies:[...s.enemies],shots:[...s.shots],missilesLive:[...s.missilesLive]})}
 });
 return <><Sky sunPosition={[100,50,100]} turbidity={8}/><Stars radius={900} depth={100} count={3000} factor={3}/><fog attach="fog" args={["#6686a1",180,900]}/><ambientLight intensity={.65}/><directionalLight position={[100,150,80]} intensity={4} castShadow/><Environment preset="city"/>
  <Terrain/><VolumetricCloudField/><MassiveBattlefield/><group ref={player}><ProceduralFighter/><PlasmaShell velocity={g.current.v.length()} altitude={g.current.p.y+80}/></group>{g.current.enemies.map(e=><EnemyMesh key={e.id} e={e} locked={g.current.lock===e.id}/>)}{g.current.shots.map(s=><Projectile key={s.id} s={s}/>)}{g.current.missilesLive.map(m=><MissileMesh key={m.id} m={m}/>)}{g.current.blasts.map(b=><Shockwave key={b.id} p={b.p} born={b.born}/>)}
 </>;
}
function HUD({s,connected,aircraft}:{s:GameState;connected:boolean;aircraft:number}){
 const speed=Math.round(s.v.length()*1.94),alt=Math.max(0,Math.round((s.p.y+80)*3.281));
 return <div className="combatHud">
  <div className="topbar"><div><b>CONVERGENCE</b><span> DISTRIBUTED COMBAT SIM</span></div><div className={connected?"net on":"net"}>{connected?"● CONTROL FABRIC ONLINE":"○ OFFLINE"} · {aircraft} ENTITIES</div></div>
  <div className="reticle"><i/><i/><div>{s.lock?"TARGET LOCK":"SEARCH"}</div></div>
  <div className="leftTelemetry"><label>SPD</label><strong>{speed}</strong><small>KTS</small><label>ALT</label><strong>{alt}</strong><small>FT</small><label>G</label><strong>{s.g.toFixed(1)}</strong><small>LOAD</small></div>
  <div className="rightTelemetry"><div>THR <b>{Math.round(s.throttle*100)}%</b></div><div>AOA <b>{s.aoa.toFixed(1)}°</b></div><div>MSL <b>{s.missiles}</b></div><div>FLR <b>{s.flares}</b></div><div>HULL <b>{Math.max(0,Math.round(s.hp))}%</b></div></div>
  <div className="score">KILLS {s.kills.toString().padStart(2,"0")}<b>{s.score.toString().padStart(6,"0")}</b></div>
  {s.warning&&<div className="warning">MISSILE WARNING<br/><small>F // DEPLOY FLARES</small></div>}
  {s.aoa>18&&<div className="stall">STALL // HIGH AOA</div>}
  <div className="controls">W/S PITCH · A/D ROLL · Q/E YAW · SHIFT/CTRL THROTTLE · SPACE CANNON · R MISSILE · F FLARES</div>
 </div>
}
export function App(){
 const {snapshot,connected}=useAirspace();
 const initial=useMemo<GameState>(()=>({p:new THREE.Vector3(0,20,80),v:new THREE.Vector3(110,0,0),q:new THREE.Quaternion(),throttle:.72,hp:100,score:0,kills:0,g:1,aoa:0,lock:null,flares:24,missiles:8,enemies:[],shots:[],missilesLive:[],blasts:[],warning:false,tick:0}),[]);
 const ref=useRef(initial);const [state,setState]=useState(initial);const update=(s:GameState)=>{ref.current=s;setState(s)};
 return <main><section className="scene"><Canvas dpr={[1,1.35]} camera={{position:[-14,25,80],fov:78}} gl={{antialias:false,powerPreference:"high-performance",toneMapping:THREE.ACESFilmicToneMapping,toneMappingExposure:1.15}}><Suspense fallback={null}><CombatWorld g={ref} setG={update}/></Suspense></Canvas></section><HUD s={state} connected={connected} aircraft={snapshot.aircraft.length}/></main>
}
