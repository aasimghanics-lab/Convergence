# SkyGrid Verification Report

## Final audited state

The repository was re-audited after Docker ABI and Windows PowerShell verifier failures were discovered on a real Windows/Docker Desktop environment.

### Fixed defects

1. **Simulator runtime ABI mismatch**
   - Previous image compiled with GCC 14 and ran on an older Debian runtime.
   - Result: missing `GLIBC_2.38`, `GLIBCXX_3.4.31`, and `GLIBCXX_3.4.32`.
   - Fix: simulator runtime now uses the compatible `gcc:14` image.

2. **Windows PowerShell false failure on Docker progress**
   - Docker Compose writes normal progress messages to stderr.
   - `$ErrorActionPreference = "Stop"` caused PowerShell to abort on normal `Stopping` output.
   - Fix: Compose lifecycle commands capture `$LASTEXITCODE`; only nonzero Docker exit codes fail verification.

3. **Nondeterministic handoff verification**
   - The verifier previously waited for random traffic to naturally cross a shard boundary.
   - Result: a valid stack could appear stuck at step 4.
   - Fix: each shard seeds one deterministic boundary-crossing aircraft. The real ownership protocol is still exercised; the test no longer depends on random initial placement.

4. **Verifier startup hang**
   - Shard startup failures could leave the verifier waiting for 750 aircraft.
   - Fix: the Docker verifier checks shard container state and prints shard logs immediately on startup failure.

## End-to-end verifier result

Command:

```text
python3 scripts/verify.py
```

Final result:

```text
C++ configure                         PASS
C++ build                             PASS
C++ CTest                             PASS
Go control tests                      PASS
Go control vet                        PASS
Go control build                      PASS
Go load generator build/vet           PASS
React + TypeScript production build   PASS
750-aircraft / 3-shard startup        PASS
20-client WebSocket fanout             PASS
Cross-shard handoff                    PASS
Per-aircraft replay                    PASS
Central-shard termination              PASS
Automatic aircraft recovery            PASS
750-aircraft invariant after recovery PASS
Atomic snapshot persistence            PASS

SKYGRID VERIFICATION PASSED
```

Observed verifier run:

```text
initial status passed: [('central', 251), ('east', 250), ('west', 249)]
clients=20 duration=2.00s messages=400 messages_per_sec=199.92 bytes=48313440 MiB_per_sec=23.03
replay passed: 7 ['handoff_commit', 'handoff_prepare', 'telemetry']
failure recovery passed: central offline / 251 recovery events
snapshot persistence passed: 120792 bytes
SKYGRID VERIFICATION PASSED
```

These numbers describe this exact local verification run and are not generalized production performance claims.

## CI

GitHub Actions now runs `python3 scripts/verify.py` as the primary CI job. This means the hosted CI path exercises builds plus the native multi-process distributed integration flow rather than only compiling each language independently.

## Docker Desktop validation

The Windows/Docker Desktop environment already demonstrated that, after the ABI fix, all three simulator shards registered and the live control plane reached 750 aircraft across three healthy shards. The remaining Docker verification script was made deterministic and PowerShell-safe after that run.

## Remaining environment-specific check

Visible Three.js/WebGL rendering should still be visually confirmed in the user's browser at `http://localhost:5173`. The production frontend build passes, but a GPU/browser rendering claim should not be made without observing the rendered scene.

## Resume claim policy

Do not claim AWS production deployment. Terraform/EKS files are infrastructure source only unless deployed to an actual AWS account.

Do not convert the 20-client local fanout result into a larger throughput claim. Preserve benchmark environment and methodology for any resume metric.


## Convergence combat layer

The final frontend production build includes the playable aerospace combat layer. TypeScript compilation and Vite production bundling passed in the same end-to-end verifier run. Visual WebGL/GPU rendering still requires browser-side inspection.


## Procedural CGI overhaul verification

The primitive fighter/mech layer was replaced by runtime-generated lofted aerospace geometry, swept wings, articulated mech hierarchies, cloud volumes, missile ribbon trails, impact shockwaves, and an altitude/velocity-driven plasma shell. The exact final source passed TypeScript compilation, Vite production bundling, and the complete native distributed verifier. Browser/GPU visual inspection remains environment-specific.
