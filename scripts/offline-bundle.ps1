param(
  [string]$Stage = (Join-Path $env:RUNNER_TEMP "PixelWorkshopOfflineWin64")
)
$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if (-not $env:RUNNER_TEMP) { throw "This pilot packager requires a Windows GitHub Actions runner." }
if (Test-Path $Stage) { Remove-Item -LiteralPath $Stage -Recurse -Force }
Push-Location $repo
try {
  # pnpm deploy isolates production dependencies so the bundle needs no Node/pnpm install.
  & pnpm --filter pixel-workshop deploy $Stage --prod --legacy
  if ($LASTEXITCODE -ne 0) { throw "pnpm production deploy failed: $LASTEXITCODE" }
  $site = Join-Path $repo "dist-node"
  if (-not (Test-Path (Join-Path $site "index.html"))) { throw "dist-node was not built" }
  Copy-Item -LiteralPath $site -Destination (Join-Path $Stage "dist-node") -Recurse -Force
  foreach ($required in @("server/node.ts", "lib/workspace-http.ts", "node_modules", "package.json")) {
    if (-not (Test-Path (Join-Path $Stage $required))) { throw "Bundled runtime missing $required" }
  }
  $nodePath = (Get-Command node -ErrorAction Stop).Source
  $version = & $nodePath --version
  if (-not $version.StartsWith("v24.")) { throw "Expected pinned Node 24, got $version" }
  Copy-Item -LiteralPath $nodePath -Destination (Join-Path $Stage "node.exe")
  $nodeLicense = Join-Path (Split-Path $nodePath -Parent) "LICENSE"
  if (-not (Test-Path $nodeLicense)) { throw "Node redistribution LICENSE not present at $nodeLicense" }
  Copy-Item -LiteralPath $nodeLicense -Destination (Join-Path $Stage "NODE-LICENSE.txt")
  Copy-Item -LiteralPath (Join-Path $repo "offline/PixelWorkshop.cmd") -Destination $Stage
  Copy-Item -LiteralPath (Join-Path $repo "offline/README-FIRST.txt") -Destination $Stage
  # Retain dependency license files in node_modules; record an inventory for human release review.
  & pnpm licenses list --prod --json | Out-File -LiteralPath (Join-Path $Stage "DEPENDENCY-LICENSES.json") -Encoding utf8
  if ($LASTEXITCODE -ne 0) { throw "Dependency license inventory failed" }
  $unsafe = @(".env", ".env.local", ".env.production", ".git")
  foreach ($name in $unsafe) {
    if (Test-Path (Join-Path $Stage $name)) { throw "Refusing to archive sensitive/unwanted $name" }
  }
  $out = Join-Path $env:RUNNER_TEMP "PixelWorkshop-Offline-windows-x64.zip"
  if (Test-Path $out) { Remove-Item -LiteralPath $out -Force }
  # Windows includes bsdtar, which supports ZIP and long dependency-tree paths.
  & tar.exe -a -cf $out -C $Stage .
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $out)) { throw "Archive creation failed" }
  (Get-FileHash -Algorithm SHA256 -LiteralPath $out).Hash.ToLowerInvariant() |
    Set-Content -LiteralPath (Join-Path $env:RUNNER_TEMP "PixelWorkshop-Offline-windows-x64.sha256")
  Write-Output "Internal bundle staged at $Stage; SHA-256 manifest generated; not a public release."
} finally {
  Pop-Location
}
