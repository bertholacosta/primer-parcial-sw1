param(
    [string]$Model = "fixtures/models/valid-minimal.json",
    [string]$Config = "fixtures/generator-config-minimal.json"
)

$ErrorActionPreference = 'Stop'

Remove-Item -Recurse -Force out/golden-run1 -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force out/golden-run2 -ErrorAction SilentlyContinue

Write-Host "Running run 1..."
node services/generator-cli/dist/index.js --model $Model --output out/golden-run1 --config $Config

Write-Host "Running run 2..."
node services/generator-cli/dist/index.js --model $Model --output out/golden-run2 --config $Config

if (-not (Test-Path "out/golden-run1/generation-manifest.json")) {
    Write-Error "FAIL: Run 1 did not produce a manifest."
    exit 1
}

$manifest1 = Get-Content out/golden-run1/generation-manifest.json -Raw
$manifest2 = Get-Content out/golden-run2/generation-manifest.json -Raw

if ($manifest1 -eq $manifest2) {
    Write-Host "PASS: manifests are byte-for-byte identical"
    exit 0
} else {
    Write-Error "FAIL: manifests differ"
    exit 1
}
