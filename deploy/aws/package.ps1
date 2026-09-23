param(
  [string]$OutputPath = "deploy/aws/out/case-deploy.zip"
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$outputFull = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $OutputPath))
$outRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot 'deploy/aws/out'))
if (-not $outputFull.StartsWith($outRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw 'OutputPath debe quedar dentro de deploy/aws/out'
}

Push-Location $repoRoot
try {
  npm run build --prefix apps/case-web
  if ($LASTEXITCODE -ne 0) { throw 'Falló build de case-web' }

  $relativeFiles = @(
    'apps/case-web/package.json',
    'packages/collaboration-protocol/package.json',
    'packages/collaboration-protocol/package-lock.json',
    'packages/collaboration-protocol/tsconfig.json',
    'services/model-server/package.json',
    'services/model-server/package-lock.json',
    'services/model-server/tsconfig.json',
    'deploy/aws/Dockerfile.model-server',
    'deploy/aws/compose.yaml',
    'deploy/aws/Caddyfile',
    'deploy/aws/bootstrap-ubuntu.sh'
  )
  foreach ($dir in @('apps/case-web/dist', 'packages/collaboration-protocol/src', 'services/model-server/src')) {
    $relativeFiles += Get-ChildItem -LiteralPath $dir -Recurse -File |
      ForEach-Object { [System.IO.Path]::GetRelativePath($repoRoot, $_.FullName).Replace('\', '/') }
  }

  $outputDir = Split-Path -Parent $outputFull
  [System.IO.Directory]::CreateDirectory($outputDir) | Out-Null
  Add-Type -AssemblyName System.IO.Compression
  $stream = [System.IO.File]::Open($outputFull, [System.IO.FileMode]::Create)
  try {
    $zip = [System.IO.Compression.ZipArchive]::new($stream, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
      foreach ($relative in ($relativeFiles | Sort-Object -Unique)) {
        $full = Join-Path $repoRoot $relative
        if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { throw "Falta $relative" }
        $entry = $zip.CreateEntry($relative.Replace('\', '/'), [System.IO.Compression.CompressionLevel]::Optimal)
        $entryStream = $entry.Open()
        try {
          $fileStream = [System.IO.File]::OpenRead($full)
          try { $fileStream.CopyTo($entryStream) } finally { $fileStream.Dispose() }
        } finally { $entryStream.Dispose() }
      }
    } finally { $zip.Dispose() }
  } finally { $stream.Dispose() }
  Write-Output $outputFull
  Get-FileHash -Algorithm SHA256 -LiteralPath $outputFull | Select-Object Hash, Path
} finally {
  Pop-Location
}
