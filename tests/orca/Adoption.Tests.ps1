$adoptionModule = Get-Module OrcaPipeline

function New-OrcaAdoptionFixture {
    param([string]$TaskId = 'LEG-001', [string]$Status = 'active')
    $root = Join-Path ([IO.Path]::GetTempPath()) ("orca-adoption-$([guid]::NewGuid().ToString('N'))")
    $taskDirectory = Join-Path $root "tasks/$Status"
    [IO.Directory]::CreateDirectory($taskDirectory) | Out-Null
    $taskPath = Join-Path $taskDirectory "$TaskId-legacy-task.yaml"
    $yamlRoot = $root.Replace('\', '/')
    $yaml = @"
id: $TaskId
title: "Legacy task"
phase: 0
status: $Status
kind: implementation
owner_role: Codex
objective: >-
  Verify legacy adoption.
dependencies: []
inputs:
  files: []
  docs: []
scope:
  allowed_paths:
    - tests/orca/
  forbidden_paths: []
constraints: []
acceptance_criteria: []
validation_commands:
  - "Write-Output validated"
deliverables: []
links: []
orca:
  issue: null
  branch: "task/$($TaskId.ToLowerInvariant())-legacy-task"
  worktree: "repo-test::$yamlRoot"
  writer: Codex
  reviewer: Antigravity
evidence: []
"@
    [IO.File]::WriteAllText($taskPath, $yaml, [Text.UTF8Encoding]::new($false))
    return [pscustomobject]@{ Root = $root; TaskPath = $taskPath; TaskId = $TaskId }
}

function Remove-OrcaAdoptionFixture {
    param([string]$Path)
    $resolved = [IO.Path]::GetFullPath($Path)
    $temporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if (-not $resolved.StartsWith($temporaryRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to remove non-temporary test path $resolved."
    }
    if ([IO.Directory]::Exists($resolved)) { [IO.Directory]::Delete($resolved, $true) }
}

function New-OrcaAdoptionTestContext {
    param([string]$Root, [string]$TaskId = 'LEG-001')
    [pscustomobject]@{
        branch = "task/$($TaskId.ToLowerInvariant())-legacy-task"
        integrationRoot = $Root
        integrationMode = 'update-ref'
        worktree = [pscustomobject]@{
            id = "repo-test::$Root"
            repoId = 'repo-test'
            path = $Root
        }
    }
}

It 'reports an existing task without state as unmanaged and adoptable' {
    foreach ($status in @('ready', 'active', 'done')) {
        $fixture = New-OrcaAdoptionFixture -TaskId "LEG-$status" -Status $status
        try {
            $result = Invoke-OrcaPipelineCommand -Command status -TaskId $fixture.TaskId -RepoRoot $fixture.Root
            Assert-True $result.success
            Assert-Equal 'unmanaged' $result.state
            Assert-True $result.adoptable
        }
        finally { Remove-OrcaAdoptionFixture $fixture.Root }
    }
}

It 'creates adopted state at validation while preserving the current worktree' {
    $fixture = New-OrcaAdoptionFixture
    try {
        $task = Read-OrcaTask -RepoRoot $fixture.Root -TaskId $fixture.TaskId
        $context = New-OrcaAdoptionTestContext $fixture.Root $fixture.TaskId
        $state = & $adoptionModule {
            param($root, $id, $assignedTask, $roles, $adoptionContext)
            New-OrcaAdoptedState -RepoRoot $root -TaskId $id -Task $assignedTask -Roles $roles -Context $adoptionContext
        } $fixture.Root $fixture.TaskId $task @{ writer = 'codex'; reviewer = 'antigravity'; integrator = 'codex' } $context
        Assert-Equal 'validating' $state.state
        Assert-True $state.adopted
        Assert-Equal $context.worktree.id $state.worktree.id
        Assert-Equal $context.worktree.path $state.worktree.path
    }
    finally { Remove-OrcaAdoptionFixture $fixture.Root }
}

It 'rejects adoption when the task already has managed state' {
    $fixture = New-OrcaAdoptionFixture -TaskId 'LEG-002'
    try {
        $runRoot = Join-Path (Join-Path (Join-Path $fixture.Root '.orca') 'runs') $fixture.TaskId
        [IO.Directory]::CreateDirectory($runRoot) | Out-Null
        [IO.File]::WriteAllText((Join-Path $runRoot 'state.json'), '{"taskId":"LEG-002","state":"validating"}')
        $message = $null
        try {
            Invoke-OrcaPipelineCommand -Command adopt -TaskId $fixture.TaskId -Autonomous -RepoRoot $fixture.Root | Out-Null
        }
        catch { $message = $_.Exception.Message }
        Assert-True ([bool]$message) 'Expected adoption to be rejected.'
        Assert-True ($message -match 'already managed') "Unexpected error: $message"
    }
    finally { Remove-OrcaAdoptionFixture $fixture.Root }
}

It 'rejects adoption when branch or worktree does not correspond to the task' {
    $fixture = New-OrcaAdoptionFixture -TaskId 'LEG-003'
    try {
        $task = Read-OrcaTask -RepoRoot $fixture.Root -TaskId $fixture.TaskId
        $correctBranch = "task/$($fixture.TaskId.ToLowerInvariant())-legacy-task"
        $correctWorktree = [pscustomobject]@{
            id = "repo-test::$($fixture.Root)"
            repoId = 'repo-test'
            path = $fixture.Root
            branch = "refs/heads/$correctBranch"
        }
        $branchMessage = $null
        try {
            & $adoptionModule {
                param($assignedTask, $root, $worktree)
                Assert-OrcaAdoptionMatches -Task $assignedTask -RepoRoot $root -CurrentBranch 'task/another-task' -CurrentWorktree $worktree
            } $task $fixture.Root $correctWorktree
        }
        catch { $branchMessage = $_.Exception.Message }
        Assert-True ([bool]$branchMessage) 'Expected branch mismatch to be rejected.'
        Assert-True ($branchMessage -match 'branch') "Unexpected error: $branchMessage"

        $wrongWorktree = [pscustomobject]@{
            id = "other-repo::$($fixture.Root)"
            repoId = 'other-repo'
            path = $fixture.Root
            branch = "refs/heads/$correctBranch"
        }
        $worktreeMessage = $null
        try {
            & $adoptionModule {
                param($assignedTask, $root, $branch, $worktree)
                Assert-OrcaAdoptionMatches -Task $assignedTask -RepoRoot $root -CurrentBranch $branch -CurrentWorktree $worktree
            } $task $fixture.Root $correctBranch $wrongWorktree
        }
        catch { $worktreeMessage = $_.Exception.Message }
        Assert-True ([bool]$worktreeMessage) 'Expected worktree mismatch to be rejected.'
        Assert-True ($worktreeMessage -match 'worktree') "Unexpected error: $worktreeMessage"
    }
    finally { Remove-OrcaAdoptionFixture $fixture.Root }
}

It 'continues an adopted task from validation through done' {
    $fixture = New-OrcaAdoptionFixture -TaskId 'LEG-004'
    try {
        $task = Read-OrcaTask -RepoRoot $fixture.Root -TaskId $fixture.TaskId
        $context = New-OrcaAdoptionTestContext $fixture.Root $fixture.TaskId
        $state = & $adoptionModule {
            param($root, $id, $assignedTask, $roles, $adoptionContext)
            New-OrcaAdoptedState -RepoRoot $root -TaskId $id -Task $assignedTask -Roles $roles -Context $adoptionContext
        } $fixture.Root $fixture.TaskId $task @{ writer = 'codex'; reviewer = 'antigravity'; integrator = 'codex' } $context
        $runRoot = Join-Path $fixture.Root '.orca/runs/LEG-004'
        foreach ($next in @('reviewing', 'approved', 'committing', 'merging', 'done')) {
            & $adoptionModule { param($root, $runState, $target) Set-OrcaRunTransition $root $runState $target } $runRoot $state $next
        }
        Assert-Equal 'done' $state.state
        Assert-Equal 5 $state.history.Count
    }
    finally { Remove-OrcaAdoptionFixture $fixture.Root }
}

It 'does not schedule or create a duplicate worktree for adoption' {
    $fixture = New-OrcaAdoptionFixture -TaskId 'LEG-005'
    try {
        $task = Read-OrcaTask -RepoRoot $fixture.Root -TaskId $fixture.TaskId
        $context = New-OrcaAdoptionTestContext $fixture.Root $fixture.TaskId
        $state = & $adoptionModule {
            param($root, $id, $assignedTask, $roles, $adoptionContext)
            New-OrcaAdoptedState -RepoRoot $root -TaskId $id -Task $assignedTask -Roles $roles -Context $adoptionContext
        } $fixture.Root $fixture.TaskId $task @{ writer = 'codex'; reviewer = 'antigravity'; integrator = 'codex' } $context
        Assert-Equal 'validating' $state.state
        Assert-False $state.ContainsKey('preparation')
        Assert-Equal $context.worktree.id $state.worktree.id
    }
    finally { Remove-OrcaAdoptionFixture $fixture.Root }
}
