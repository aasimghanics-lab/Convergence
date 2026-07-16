# CONVERGENCE

A real-time browser aerospace combat simulation backed by the SkyGrid distributed simulation platform.

## Playable combat layer

- chase-camera 3D flight
- pitch, roll, yaw, throttle and gravity
- altitude-dependent aerodynamic authority
- thrust, lift, drag and gravity force integration
- angle-of-attack and G-load telemetry
- cannon fire
- target acquisition
- guided missiles with continuous line-of-sight steering
- enemy lead-fire approximation
- missile warnings and flare countermeasures
- fighter and spacecraft enemies
- procedural terrain
- animated ground mechs
- damage, score and respawning combat waves
- cinematic HUD

Controls:

| Input | Action |
|---|---|
| W / S | Pitch |
| A / D | Roll |
| Q / E | Yaw |
| Left Shift / Left Ctrl | Throttle |
| Space | Cannon |
| R | Fire guided missile |
| F | Deploy flares |

## Distributed systems foundation

The combat renderer sits on the existing SkyGrid foundation:

- C++20 60 Hz simulation workers
- geographic shards
- versioned entity ownership
- acknowledged cross-shard handoff
- Go control plane
- heartbeat failure detection
- automatic entity recovery
- append-only replay events
- WebSocket 10 Hz fanout
- Prometheus metrics
- Docker Compose
- Kubernetes manifests
- Terraform/EKS starter infrastructure
- GitHub Actions end-to-end verification

## Run

```text
docker compose up --build -d
```

Open `http://localhost:5173`.

## Verify

Native end-to-end:

```text
python3 scripts/verify.py
```

Windows Docker Desktop:

```text
powershell -ExecutionPolicy Bypass -File .\scripts\verify-docker.ps1
```

## Verification

The final source state passed the native end-to-end verifier:

- C++ configure/build/CTest
- Go test/vet/build
- load generator build/vet
- TypeScript + Vite production build
- 750 entities across 3 live simulation shards
- 20-client WebSocket fanout
- cross-shard handoff and replay
- worker termination and automatic recovery
- 750-entity invariant after recovery
- atomic snapshot persistence

The verified local run observed 400 messages over 2 seconds across 20 clients (~199.86 aggregate messages/s, 23.02 MiB/s). These are local verification figures, not production-scale claims.

## Procedural CGI layer

The combat renderer now generates its primary visual assets at runtime instead of using cone/box vehicle stand-ins:

- lofted fuselage meshes generated from parametric cross-sections
- swept wing meshes with computed normals
- metallic PBR aerospace materials and transmissive canopy
- deterministic spacecraft hardpoints / RCS geometry
- articulated hierarchical mech limbs with procedural gait motion
- emissive mech optics and weapon geometry
- layered cloud volume field
- missile ribbon trails built from historical guidance positions
- additive impact shockwaves
- velocity/altitude-driven reentry plasma shell
- ACES filmic tone mapping, atmospheric fog, sky and star field

The visual geometry is code-generated and asset-independent. It is not represented as hand-authored AAA studio art.

## Visual scope

The current vehicle/mech geometry is procedural and code-generated. It is intentionally asset-independent and playable without external binary art packs. It is not claimed to be AAA studio-authored CGI. Production-quality authored glTF assets, skeletal rigs, bespoke VFX textures, audio, and a GPU-specific browser QA pass remain separate art-production work.

