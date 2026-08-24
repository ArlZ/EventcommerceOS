param(
  [string]$LanAddress = "",
  [int]$HttpsPort = 8443
)

$ErrorActionPreference = "Stop"

$pilotDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$envPath = Join-Path $pilotDir ".env"
$composePath = Join-Path $pilotDir "compose.yml"
$rootCertificatePath = Join-Path $pilotDir "event-edge-root-ca.crt"

if (-not (Test-Path $envPath)) {
  throw "Missing $envPath. Prepare the Edge pilot .env before enabling LAN HTTPS."
}
if ($HttpsPort -lt 1 -or $HttpsPort -gt 65535) {
  throw "HttpsPort must be between 1 and 65535."
}

function Test-Ipv4Address([string]$Value) {
  $parsed = $null
  if (-not [System.Net.IPAddress]::TryParse($Value, [ref]$parsed)) { return $false }
  return $parsed.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork
}

if (-not $LanAddress) {
  $LanAddress = @(
    Get-NetIPConfiguration |
      Where-Object { $_.NetAdapter.Status -eq "Up" -and $_.IPv4DefaultGateway } |
      ForEach-Object { $_.IPv4Address.IPAddress } |
      Where-Object { $_ -and $_ -notlike "127.*" -and $_ -notlike "169.254.*" } |
      Select-Object -Unique
  ) | Select-Object -First 1
}

if (-not $LanAddress -or -not (Test-Ipv4Address $LanAddress)) {
  throw "Could not determine a usable venue LAN IPv4 address. Re-run with -LanAddress <stable-lan-ip>."
}

function Set-DotEnvValue([string]$Name, [string]$Value) {
  $lines = @(Get-Content $envPath)
  $pattern = "^$([regex]::Escape($Name))="
  $found = $false
  $updated = foreach ($line in $lines) {
    if ($line -match $pattern) {
      $found = $true
      "$Name=$Value"
    } else {
      $line
    }
  }
  if (-not $found) { $updated += "$Name=$Value" }
  [System.IO.File]::WriteAllLines(
    $envPath,
    $updated,
    [System.Text.UTF8Encoding]::new($false)
  )
}

Set-DotEnvValue "EDGE_LAN_HOST" $LanAddress
Set-DotEnvValue "EDGE_HTTPS_BIND_ADDRESS" "0.0.0.0"
Set-DotEnvValue "EDGE_HTTPS_PORT" "$HttpsPort"

Write-Host "Starting the venue-local HTTPS boundary on ${LanAddress}:$HttpsPort ..."
docker compose --env-file $envPath -f $composePath up -d --build
if ($LASTEXITCODE -ne 0) { throw "Docker Compose failed while enabling LAN HTTPS." }

$rootReady = $false
for ($attempt = 0; $attempt -lt 30; $attempt += 1) {
  docker compose --env-file $envPath -f $composePath exec -T edge-https test -f /data/caddy/pki/authorities/local/root.crt 2>$null
  if ($LASTEXITCODE -eq 0) {
    $rootReady = $true
    break
  }
  Start-Sleep -Seconds 1
}
if (-not $rootReady) {
  throw "Caddy did not create its local root certificate. Inspect: docker compose --env-file `"$envPath`" -f `"$composePath`" logs edge-https"
}

if (Test-Path $rootCertificatePath) { Remove-Item $rootCertificatePath -Force }
docker compose --env-file $envPath -f $composePath cp edge-https:/data/caddy/pki/authorities/local/root.crt $rootCertificatePath
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $rootCertificatePath)) {
  throw "Could not export the public Event Edge root CA certificate."
}

$endpoint = "https://${LanAddress}:$HttpsPort/sync/device-events"
$healthUrl = "https://${LanAddress}:$HttpsPort/health"
$hostTrustVerified = $false

# Windows curl commonly uses Schannel. Some Windows configurations return
# SEC_E_INTERNAL_ERROR before Schannel can consume an explicit --cacert file.
# Attempt full CA validation first, then retry with revocation checks disabled.
# The final --insecure request is reachability-only and never changes POS trust policy.
& curl.exe --fail --silent --show-error --connect-timeout 5 --max-time 10 --cacert $rootCertificatePath $healthUrl 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) {
  $hostTrustVerified = $true
} else {
  & curl.exe --fail --silent --show-error --connect-timeout 5 --max-time 10 --ssl-no-revoke --cacert $rootCertificatePath $healthUrl 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) { $hostTrustVerified = $true }
}

if (-not $hostTrustVerified) {
  Write-Warning "Windows Schannel could not validate the exported Event Edge CA directly. Running a reachability-only HTTPS health check; Android CA trust is still mandatory."
  & curl.exe --fail --silent --show-error --connect-timeout 5 --max-time 10 --insecure $healthUrl | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "HTTPS was created, but the host could not reach the Event Edge health endpoint at $healthUrl."
  }
}

$fingerprint = (Get-FileHash -Algorithm SHA256 $rootCertificatePath).Hash
$hostVerification = if ($hostTrustVerified) {
  "CA verified by Windows host"
} else {
  "HTTPS reachability verified; Windows Schannel CA verification unavailable"
}

Write-Host ""
Write-Host "RESULT: LAN_HTTPS_READY"
Write-Host "Event Edge sync endpoint:" $endpoint
Write-Host "Public root CA certificate:" $rootCertificatePath
Write-Host "Root CA SHA-256:" $fingerprint
Write-Host "Host TLS check:" $hostVerification
Write-Host ""
Write-Host "Install ONLY this public root CA certificate on dedicated pilot POS devices, then provision each register with its own Event Edge credential."
Write-Host "Keep the Edge PC on this LAN address (use a DHCP reservation or static lease) for the pilot."
