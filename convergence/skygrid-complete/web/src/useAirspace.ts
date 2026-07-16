import { useEffect, useState } from "react";
import type { Snapshot } from "./types";
export function useAirspace() {
 const [snapshot,setSnapshot]=useState<Snapshot>({type:"snapshot",aircraft:[],shards:[],timestamp:""});
 const [connected,setConnected]=useState(false);
 useEffect(()=>{let socket:WebSocket;let timer:number;
  const connect=()=>{const p=location.protocol==="https:"?"wss":"ws";socket=new WebSocket(`${p}://${location.host}/ws`);
   socket.onopen=()=>setConnected(true);socket.onmessage=e=>setSnapshot(JSON.parse(e.data));
   socket.onclose=()=>{setConnected(false);timer=window.setTimeout(connect,1000)}};
  connect();return()=>{clearTimeout(timer);socket?.close()}},[]);
 return {snapshot,connected};
}
