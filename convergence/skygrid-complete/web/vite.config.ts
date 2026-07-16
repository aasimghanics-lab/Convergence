import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
const control = process.env.VITE_CONTROL_TARGET ?? "http://control:8080";
const controlWs = control.replace(/^http/, "ws");
export default defineConfig({plugins:[react()],server:{proxy:{
 "/ws":{target:controlWs,ws:true},
 "/api":{target:control},
 "/metrics":{target:control}
}}});
