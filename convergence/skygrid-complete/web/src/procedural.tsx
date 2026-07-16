import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useMemo, useRef } from "react";

type V3=[number,number,number];

function loft(length:number, rings:number, sides:number, ry:(u:number)=>number, rz:(u:number)=>number){
 const pos:number[]=[], idx:number[]=[];
 for(let i=0;i<=rings;i++){const u=i/rings,x=(u-.5)*length;for(let j=0;j<sides;j++){const a=j/sides*Math.PI*2;pos.push(x,Math.cos(a)*ry(u),Math.sin(a)*rz(u));}}
 for(let i=0;i<rings;i++)for(let j=0;j<sides;j++){const a=i*sides+j,b=i*sides+(j+1)%sides,c=(i+1)*sides+j,d=(i+1)*sides+(j+1)%sides;idx.push(a,c,b,b,c,d)}
 const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));g.setIndex(idx);g.computeVertexNormals();return g;
}
function wing(span:number,chord:number,sweep:number,side:number){
 const z0=.18*side,z1=span*side;const v=[-.9,0,z0, chord*.45,0,z0, -sweep,0,z1, -sweep-chord*.18,0,z1, -.9,.08,z0,chord*.45,.08,z0,-sweep,.04,z1,-sweep-chord*.18,.04,z1];
 const f=[0,1,2,0,2,3,4,6,5,4,7,6,0,4,1,1,4,5,1,5,2,2,5,6,2,6,3,3,6,7,3,7,0,0,7,4];const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.Float32BufferAttribute(v,3));g.setIndex(f);g.computeVertexNormals();return g;
}
const metal=(enemy=false)=>new THREE.MeshStandardMaterial({color:enemy?0x3a080b:0x58666f,metalness:.94,roughness:.2});
const dark=new THREE.MeshStandardMaterial({color:0x11171b,metalness:.92,roughness:.3});

export function ProceduralFighter({enemy=false,space=false}:{enemy?:boolean;space?:boolean}){
 const hull=useMemo(()=>loft(space?9:7,30,18,u=>Math.pow(Math.sin(Math.PI*u),.55)*(space?.82:.58)+.025,u=>Math.pow(Math.sin(Math.PI*u),.62)*(space?.68:.48)+.018),[space]);
 const wings=useMemo(()=>[wing(space?5.5:4.3,2.8,space?1.7:1.2,1),wing(space?5.5:4.3,2.8,space?1.7:1.2,-1)],[space]);
 const mat=useMemo(()=>metal(enemy),[enemy]);
 return <group>
  <mesh geometry={hull} material={mat} castShadow/>
  {wings.map((g,i)=><mesh key={i} geometry={g} material={mat} castShadow/> )}
  <mesh position={[1.05,.38,0]} scale={[1.35,.5,.68]}><sphereGeometry args={[.62,24,12]}/><meshPhysicalMaterial color="#071824" metalness={.55} roughness={.08} transmission={.28} thickness={.4} clearcoat={1}/></mesh>
  <mesh position={[-2.35,.48,0]} rotation={[0,0,.15]}><boxGeometry args={[1.7,.09,.85]}/><primitive object={dark}/></mesh>
  <mesh position={[-3.25,0,.25]} rotation={[0,Math.PI/2,0]}><cylinderGeometry args={[.23,.34,.55,18]}/><meshStandardMaterial color="#101820" metalness={1}/></mesh>
  <mesh position={[-3.56,0,.25]} rotation={[0,Math.PI/2,0]}><circleGeometry args={[.23,20]}/><meshBasicMaterial color={enemy?"#ff321f":"#6eeaff"} toneMapped={false}/></mesh>
  <pointLight position={[-3.8,0,.25]} color={enemy?"#ff321f":"#57dfff"} intensity={8} distance={12}/>
  {space&&Array.from({length:6},(_,i)=><mesh key={i} position={[-1.8+i*.72,-.48,(i%2?1:-1)*.48]} rotation={[0,0,Math.PI/2]}><cylinderGeometry args={[.055,.08,.3,8]}/><meshStandardMaterial color="#222c32" metalness={1}/></mesh>)}
 </group>
}
function Limb({a,b,r=.22}:{a:V3;b:V3;r?:number}){const mid=new THREE.Vector3(...a).add(new THREE.Vector3(...b)).multiplyScalar(.5),d=new THREE.Vector3(...b).sub(new THREE.Vector3(...a));const q=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),d.clone().normalize());return <mesh position={mid} quaternion={q}><cylinderGeometry args={[r,r*1.12,d.length(),8]}/><meshStandardMaterial color="#303b3d" metalness={.9} roughness={.28}/></mesh>}
export function ProceduralMech({p,i}:{p:V3;i:number}){
 const g=useRef<THREE.Group>(null!);const left=useRef<THREE.Group>(null!);const right=useRef<THREE.Group>(null!);
 useFrame(({clock})=>{const t=clock.elapsedTime*1.55+i;if(left.current&&right.current){left.current.rotation.z=Math.sin(t)*.38;right.current.rotation.z=-Math.sin(t)*.38}if(g.current)g.current.rotation.y=Math.sin(t*.22)*.16});
 return <group ref={g} position={p} scale={2.2}>
  <mesh position={[0,3.4,0]}><dodecahedronGeometry args={[.9,0]}/><meshStandardMaterial color="#424b48" metalness={.92} roughness={.25}/></mesh>
  <mesh position={[0,4.22,.18]}><octahedronGeometry args={[.42,0]}/><meshStandardMaterial color="#151b1d" metalness={1}/></mesh>
  <mesh position={[0,4.24,.54]}><boxGeometry args={[.35,.08,.08]}/><meshBasicMaterial color="#ff4b24" toneMapped={false}/></mesh>
  <group ref={left} position={[-.48,2.75,0]}><Limb a={[0,0,0]} b={[-.18,-1.15,.15]}/><Limb a={[-.18,-1.15,.15]} b={[.05,-2.25,.42]}/><mesh position={[.05,-2.3,.65]}><boxGeometry args={[.65,.28,1.15]}/><meshStandardMaterial color="#222b2c" metalness={.9}/></mesh></group>
  <group ref={right} position={[(.48),2.75,0]}><Limb a={[0,0,0]} b={[.18,-1.15,-.15]}/><Limb a={[(.18),-1.15,-.15]} b={[-.05,-2.25,.42]}/><mesh position={[-.05,-2.3,.65]}><boxGeometry args={[.65,.28,1.15]}/><meshStandardMaterial color="#222b2c" metalness={.9}/></mesh></group>
  <Limb a={[-.7,3.7,0]} b={[-1.25,3,.15]} r={.18}/><Limb a={[-1.25,3,.15]} b={[-1.7,2.6,.65]} r={.15}/>
  <Limb a={[(.7),3.7,0]} b={[1.25,3,.15]} r={.18}/><Limb a={[1.25,3,.15]} b={[1.8,2.9,.8]} r={.15}/>
  <mesh position={[2.35,2.9,.8]} rotation={[0,0,Math.PI/2]}><cylinderGeometry args={[.12,.22,1.6,10]}/><meshStandardMaterial color="#171e20" metalness={1}/></mesh>
 </group>
}
export function VolumetricCloudField(){
 const cloudRef=useRef<THREE.InstancedMesh>(null!);
 const cloudGeo=useMemo(()=>new THREE.IcosahedronGeometry(1,1),[]);
 const cloudMat=useMemo(()=>new THREE.MeshBasicMaterial({color:0xd9e6ed,transparent:true,opacity:.09,depthWrite:false}),[]);
 const clouds=useMemo(()=>Array.from({length:90},(_,i)=>({p:[(i*97)%1400-700,-30+(i%8)*6,(i*173)%1400-700] as V3,s:20+(i%11)*5})),[]);
 useMemo(()=>setTimeout(()=>{if(!cloudRef.current)return;const m=new THREE.Matrix4(),q=new THREE.Quaternion(),s=new THREE.Vector3();clouds.forEach((c,i)=>{s.set(c.s,c.s*.25,c.s*.7);m.compose(new THREE.Vector3(...c.p),q,s);cloudRef.current.setMatrixAt(i,m)});cloudRef.current.instanceMatrix.needsUpdate=true},0),[clouds]);
 return <instancedMesh ref={cloudRef} args={[cloudGeo,cloudMat,clouds.length]} frustumCulled/>;
}
export function MassiveBattlefield(){
 const fighters=useRef<THREE.InstancedMesh>(null!);const mechs=useRef<THREE.InstancedMesh>(null!);const ships=useRef<THREE.InstancedMesh>(null!);
 const fighterGeo=useMemo(()=>loft(4.5,12,8,u=>Math.pow(Math.sin(Math.PI*u),.55)*.35+.02,u=>Math.pow(Math.sin(Math.PI*u),.6)*.28+.02),[]);
 const mechGeo=useMemo(()=>new THREE.DodecahedronGeometry(1,0),[]);
 const shipGeo=useMemo(()=>loft(22,18,10,u=>Math.pow(Math.sin(Math.PI*u),.4)*2.2+.08,u=>Math.pow(Math.sin(Math.PI*u),.55)*1.2+.05),[]);
 const red=useMemo(()=>new THREE.MeshStandardMaterial({color:0x541016,metalness:.88,roughness:.28}),[]);
 const mechMat=useMemo(()=>new THREE.MeshStandardMaterial({color:0x303a38,metalness:.9,roughness:.32}),[]);
 const shipMat=useMemo(()=>new THREE.MeshStandardMaterial({color:0x202b35,metalness:.95,roughness:.18}),[]);
 useFrame(({clock})=>{
  const t=clock.elapsedTime,m=new THREE.Matrix4(),q=new THREE.Quaternion(),s=new THREE.Vector3();
  if(fighters.current){for(let i=0;i<180;i++){const ring=90+(i%15)*22,a=i*.71+t*(.08+(i%7)*.008),p=new THREE.Vector3(Math.cos(a)*ring,20+(i%13)*8+Math.sin(t+i)*12,Math.sin(a)*ring);q.setFromEuler(new THREE.Euler(0,-a,Math.sin(t*.7+i)*.25));s.setScalar(.7+(i%4)*.12);m.compose(p,q,s);fighters.current.setMatrixAt(i,m)}fighters.current.instanceMatrix.needsUpdate=true}
  if(mechs.current){for(let i=0;i<96;i++){const x=(i%16)*28-210,z=Math.floor(i/16)*34-180,p=new THREE.Vector3(x,-64+Math.sin(i)*3,z);q.setFromEuler(new THREE.Euler(0,Math.sin(t*.25+i)*.4,Math.sin(t*1.8+i)*.08));s.set(1.8,3.8,1.5);m.compose(p,q,s);mechs.current.setMatrixAt(i,m)}mechs.current.instanceMatrix.needsUpdate=true}
  if(ships.current){for(let i=0;i<14;i++){const a=i/14*Math.PI*2+t*.012,r=380+(i%4)*90,p=new THREE.Vector3(Math.cos(a)*r,180+(i%5)*70,Math.sin(a)*r);q.setFromEuler(new THREE.Euler(0,-a,0));s.setScalar(1.4+(i%3)*.55);m.compose(p,q,s);ships.current.setMatrixAt(i,m)}ships.current.instanceMatrix.needsUpdate=true}
 });
 return <group>
   <instancedMesh ref={fighters} args={[fighterGeo,red,180]} frustumCulled/>
   <instancedMesh ref={mechs} args={[mechGeo,mechMat,96]} frustumCulled/>
   <instancedMesh ref={ships} args={[shipGeo,shipMat,14]} frustumCulled/>
 </group>
}
export function PlasmaShell({velocity,altitude}:{velocity:number;altitude:number}){
 const m=useRef<THREE.MeshBasicMaterial>(null!);const intensity=Math.max(0,Math.min(1,(velocity-180)/220))*Math.max(0,Math.min(1,(500-altitude)/350));
 useFrame(({clock})=>{if(m.current)m.current.opacity=intensity*(.18+Math.sin(clock.elapsedTime*21)*.05)});
 if(intensity<.02)return null;return <mesh scale={[4.5,1.1,1.1]}><sphereGeometry args={[1,24,12]}/><meshBasicMaterial ref={m} color="#ff6b1a" transparent opacity={.2} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false}/></mesh>
}
export function RibbonTrail({points,color}:{points:V3[];color:string}){
 const geo=useMemo(()=>{const ps=points.slice(-30);if(ps.length<2)return new THREE.BufferGeometry();const pos:number[]=[];ps.forEach((p,i)=>{const w=.04+(i/ps.length)*.22;pos.push(p[0],p[1]+w,p[2],p[0],p[1]-w,p[2])});const idx:number[]=[];for(let i=0;i<ps.length-1;i++){const a=i*2;idx.push(a,a+1,a+2,a+1,a+3,a+2)}const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));g.setIndex(idx);return g},[points]);
 return <mesh geometry={geo}><meshBasicMaterial color={color} transparent opacity={.72} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false}/></mesh>
}
export function Shockwave({p,born}:{p:V3;born:number}){const r=useRef<THREE.Mesh>(null!);const mat=useRef<THREE.MeshBasicMaterial>(null!);useFrame(()=>{const t=(performance.now()-born)/1000;if(r.current)r.current.scale.setScalar(1+t*22);if(mat.current)mat.current.opacity=Math.max(0,.65-t*.8)});return <mesh ref={r} position={p}><sphereGeometry args={[1,18,12]}/><meshBasicMaterial ref={mat} color="#ff9d38" transparent wireframe blending={THREE.AdditiveBlending} toneMapped={false}/></mesh>}
