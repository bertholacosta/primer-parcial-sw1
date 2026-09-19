It 'rejects an out-of-scope path even when the writer staged it' {
    $temporaryRepo = Join-Path ([IO.Path]::GetTempPath()) ("orca-scope-$([guid]::NewGuid().ToString('N'))")
    [IO.Directory]::CreateDirectory($temporaryRepo) | Out-Null
    try {
        & git -C $temporaryRepo init --quiet
        [IO.File]::WriteAllText((Join-Path $temporaryRepo 'allowed.txt'), 'base')
        [IO.File]::WriteAllText((Join-Path $temporaryRepo 'outside.txt'), 'base')
        & git -C $temporaryRepo add --all
        & git -C $temporaryRepo -c user.name=OrcaTest -c user.email=orca-test@example.invalid commit --quiet -m baseline
        [IO.File]::WriteAllText((Join-Path $temporaryRepo 'outside.txt'), 'staged change')
        & git -C $temporaryRepo add outside.txt

        $task = [pscustomobject]@{
            FilePath = 'P0-TEST.yaml'
            AllowedPaths = @('allowed.txt')
            ForbiddenPaths = @()
        }
        $module = Get-Module OrcaPipeline
        $violations = @(& $module { param($assignedTask, $path) Get-OrcaScopeViolations $assignedTask $path } $task $temporaryRepo)
        Assert-Equal 1 $violations.Count
        Assert-Equal 'outside.txt' $violations[0]
    }
    finally {
        if ([IO.Directory]::Exists($temporaryRepo)) {
            Get-ChildItem -LiteralPath $temporaryRepo -Force -Recurse -File | ForEach-Object { $_.IsReadOnly = $false }
            [IO.Directory]::Delete($temporaryRepo, $true)
        }
    }
}
