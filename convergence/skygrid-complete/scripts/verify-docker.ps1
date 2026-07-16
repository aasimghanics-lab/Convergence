$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}

Write-Host "[1/6] Checking Docker Desktop..."
docker version | Out-Null
docker compose version | Out-Null

Write-Host "[2/6] Building and launching SkyGrid..."
$previousErrorActionPreference = $ErrorActionPreference
$ErrorActionPreference = "Continue"
docker compose down -v --remove-orphans 2>$null
$downExitCode = $LASTEXITCODE
docker compose up --build -d
$upExitCode = $LASTEXITCODE
$ErrorActionPreference = $previousErrorActionPreference
if ($downExitCode -ne 0) { throw "docker compose down failed with exit code $downExitCode" }
if ($upExitCode -ne 0) { throw "docker compose up failed with exit code $upExitCode" }

try {
    Write-Host "[3/6] Waiting for control plane and 750 aircraft..."
    $deadline = (Get-Date).AddMinutes(3)
    $status = $null
    do {
        Start-Sleep -Seconds 2
        try { $status = Invoke-RestMethod -Uri "http://127.0.0.1:8080/api/status" -TimeoutSec 5 } catch { $status = $null }

        $deadShards = @(docker compose ps --all --format json | ConvertFrom-Json | Where-Object {
            $_.Service -in @("shard-west", "shard-central", "shard-east") -and $_.State -ne "running"
        })
        if ($deadShards.Count -gt 0) {
            Write-Host "One or more simulator shards exited before registration." -ForegroundColor Red
            docker compose logs --tail=50 shard-west shard-central shard-east
            throw "Simulator shard startup failure."
        }

        if ((Get-Date) -gt $deadline) {
            docker compose ps
            docker compose logs --tail=50 control shard-west shard-central shard-east
            throw "SkyGrid did not reach healthy 750-aircraft state in time."
        }
    } until ($status -and $status.aircraft.Count -eq 750 -and $status.shards.Count -eq 3 -and @($status.shards | Where-Object { -not $_.healthy }).Count -eq 0)
    Write-Host "Initial state passed: 750 aircraft / 3 healthy shards"

    Write-Host "[4/6] Verifying deterministic cross-shard handoff and replay..."
    $deadline = (Get-Date).AddSeconds(30)
    $handoffId = $null
    do {
        Start-Sleep -Seconds 1
        $status = Invoke-RestMethod -Uri "http://127.0.0.1:8080/api/status" -TimeoutSec 5
        $handoffAircraft = @($status.aircraft | Where-Object { $_.version -gt 1 } | Select-Object -First 1)
        if ($handoffAircraft.Count -gt 0) {
            $handoffId = $handoffAircraft[0].id
        }
        if ((Get-Date) -gt $deadline) {
            docker compose logs --tail=100 control shard-west shard-central shard-east
            throw "No versioned cross-shard aircraft was observed within 30 seconds."
        }
    } until ($handoffId)

    $replay = Invoke-RestMethod -Uri "http://127.0.0.1:8080/api/aircraft/$handoffId/replay" -TimeoutSec 10
    $types = @($replay | ForEach-Object { $_.type })
    Assert-True ($types -contains "handoff_prepare") "Replay missing handoff_prepare for aircraft $handoffId."
    Assert-True ($types -contains "handoff_commit") "Replay missing handoff_commit for aircraft $handoffId."
    Write-Host "Replay passed for aircraft $handoffId"

    Write-Host "[5/6] Terminating central shard and verifying automatic recovery..."
    Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8080/api/shards/central/terminate" -TimeoutSec 10 | Out-Null
    Start-Sleep -Seconds 5
    $status = Invoke-RestMethod -Uri "http://127.0.0.1:8080/api/status" -TimeoutSec 10
    $central = $status.shards | Where-Object { $_.id -eq "central" }
    Assert-True ($status.aircraft.Count -eq 750) "Aircraft total changed after recovery: $($status.aircraft.Count)"
    Assert-True (-not $central.healthy) "Central shard unexpectedly healthy after termination."
    Assert-True ($central.aircraft -eq 0) "Central shard still owns aircraft after recovery: $($central.aircraft)"
    $metrics = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:8080/metrics" -TimeoutSec 10
    $recoveryLine = ($metrics.Content -split "`n" | Where-Object { $_ -match '^skygrid_recoveries_total ' } | Select-Object -First 1)
    Assert-True ([bool]$recoveryLine) "Recovery metric missing."
    $recoveryCount = [int](($recoveryLine -split ' ')[1])
    Assert-True ($recoveryCount -gt 0) "Recovery metric did not increase."
    Write-Host "Recovery passed: $recoveryCount aircraft recovery events"

    Write-Host "[6/6] Verifying UI and Prometheus endpoints..."
    $ui = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:5173" -TimeoutSec 10
    Assert-True ($ui.StatusCode -eq 200) "UI endpoint failed."
    $prom = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:9090/-/ready" -TimeoutSec 10
    Assert-True ($prom.StatusCode -eq 200) "Prometheus readiness failed."

    Write-Host ""
    Write-Host "SKYGRID DOCKER VERIFICATION PASSED" -ForegroundColor Green
    Write-Host "Open http://localhost:5173 and visually confirm aircraft render and move." -ForegroundColor Cyan
}
finally {
    Write-Host "Leaving the verified stack running for visual inspection."
    Write-Host "Stop it later with: docker compose down -v"
}
