$adoptionModule = Get-Module OrcaPipeline

function New-OrcaAdoptionFixture {
    param([string]$TaskId = 'LEG-001', [string]$Status = 'active', [switch]$WithDeliverable, [switch]$WithDirectoryDeliverable)
    $root = Join-Path ([IO.Path]::GetTempPath()) ("orca-adoption-$([guid]::NewGuid().ToString('N'))")
    $taskDirectory = Join-Path $root "tasks/$Status"
    [IO.Directory]::CreateDirectory($taskDirectory) | Out-Null
    $taskPath = Join-Path $taskDirectory "$TaskId-legacy-task.yaml"
    $yamlRoot = $root.Replace('\', '/')
    $deliverablesYaml = if ($WithDirectoryDeliverable) { "deliverables:`n  - tests/orca/" } elseif ($WithDeliverable) { "deliverables:`n  - deliverable.txt" } else { 'deliverables: []' }
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
$deliverablesYaml
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
    if ($WithDeliverable) {
        [IO.File]::WriteAllText((Join-Path $root 'deliverable.txt'), 'deliverable', [Text.UTF8Encoding]::new($false))
    }
    if ($WithDirectoryDeliverable) {
        [IO.Directory]::CreateDirectory((Join-Path $root 'tests/orca')) | Out-Null
    }
    return [pscustomobject]@{ Root = $root; TaskPath = $taskPath; TaskId = $TaskId }
}

function Initialize-OrcaAdoptionGit {
    param([string]$Root)
    & git -C $Root init --quiet -b main
    & git -C $Root add --all
    & git -C $Root -c user.name=OrcaTest -c user.email=orca-test@example.invalid commit --quiet -m baseline
}

function Remove-OrcaAdoptionFixture {
    param([string]$Path)
    $resolved = [IO.Path]::GetFullPath($Path)
    $temporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if (-not $resolved.StartsWith($temporaryRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to remove non-temporary test path $resolved."
    }
    if ([IO.Directory]::Exists($resolved)) {
        Get-ChildItem -LiteralPath $resolved -Force -Recurse -File | ForEach-Object { $_.IsReadOnly = $false }
        [IO.Directory]::Delete($resolved, $true)
    }
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
    $fixture = New-OrcaAdoptionFixture -WithDeliverable
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
    $fixture = New-OrcaAdoptionFixture -TaskId 'LEG-004' -WithDeliverable
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
    $fixture = New-OrcaAdoptionFixture -TaskId 'LEG-005' -WithDeliverable
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

It 'starts an adopted task at executing when no deliverable or changes exist' {
    $fixture = New-OrcaAdoptionFixture -TaskId 'LEG-006'
    try {
        $task = Read-OrcaTask -RepoRoot $fixture.Root -TaskId $fixture.TaskId
        $context = New-OrcaAdoptionTestContext $fixture.Root $fixture.TaskId
        $state = & $adoptionModule {
            param($root, $id, $assignedTask, $roles, $adoptionContext)
            New-OrcaAdoptedState -RepoRoot $root -TaskId $id -Task $assignedTask -Roles $roles -Context $adoptionContext
        } $fixture.Root $fixture.TaskId $task @{ writer = 'codex'; reviewer = 'antigravity'; integrator = 'codex' } $context
        Assert-Equal 'executing' $state.state
        Assert-Equal 0 ([int]$state.correctionCount)
        Assert-False $state.adoptionEvidence.hasImplementation
    }
    finally { Remove-OrcaAdoptionFixture $fixture.Root }
}

It 'starts an adopted task at validating when a deliverable exists' {
    $fixture = New-OrcaAdoptionFixture -TaskId 'LEG-007' -WithDeliverable
    try {
        $task = Read-OrcaTask -RepoRoot $fixture.Root -TaskId $fixture.TaskId
        $context = New-OrcaAdoptionTestContext $fixture.Root $fixture.TaskId
        $state = & $adoptionModule {
            param($root, $id, $assignedTask, $roles, $adoptionContext)
            New-OrcaAdoptedState -RepoRoot $root -TaskId $id -Task $assignedTask -Roles $roles -Context $adoptionContext
        } $fixture.Root $fixture.TaskId $task @{ writer = 'codex'; reviewer = 'antigravity'; integrator = 'codex' } $context
        Assert-Equal 'validating' $state.state
        Assert-True $state.adoptionEvidence.hasImplementation
    }
    finally { Remove-OrcaAdoptionFixture $fixture.Root }
}

It 'starts an adopted task at validating when a directory deliverable exists' {
    $fixture = New-OrcaAdoptionFixture -TaskId 'LEG-010' -WithDirectoryDeliverable
    try {
        $task = Read-OrcaTask -RepoRoot $fixture.Root -TaskId $fixture.TaskId
        $context = New-OrcaAdoptionTestContext $fixture.Root $fixture.TaskId
        $state = & $adoptionModule {
            param($root, $id, $assignedTask, $roles, $adoptionContext)
            New-OrcaAdoptedState -RepoRoot $root -TaskId $id -Task $assignedTask -Roles $roles -Context $adoptionContext
        } $fixture.Root $fixture.TaskId $task @{ writer = 'codex'; reviewer = 'antigravity'; integrator = 'codex' } $context
        Assert-Equal 'validating' $state.state
        Assert-True $state.adoptionEvidence.hasImplementation
        Assert-True ($state.adoptionEvidence.deliverablesPresent -contains 'tests/orca/')
    }
    finally { Remove-OrcaAdoptionFixture $fixture.Root }
}

It 'does not count moving the task file to active as implementation' {
    $fixture = New-OrcaAdoptionFixture -TaskId 'LEG-008' -Status 'ready'
    try {
        Initialize-OrcaAdoptionGit $fixture.Root
        $activeDirectory = Join-Path $fixture.Root 'tasks/active'
        [IO.Directory]::CreateDirectory($activeDirectory) | Out-Null
        Move-Item -LiteralPath $fixture.TaskPath -Destination (Join-Path $activeDirectory ([IO.Path]::GetFileName($fixture.TaskPath)))
        $task = Read-OrcaTask -RepoRoot $fixture.Root -TaskId $fixture.TaskId
        $context = New-OrcaAdoptionTestContext $fixture.Root $fixture.TaskId
        $evidence = & $adoptionModule {
            param($assignedTask, $worktree)
            Get-OrcaImplementationEvidence -Task $assignedTask -Worktree $worktree
        } $task $fixture.Root
        Assert-False $evidence.hasImplementation
        Assert-Equal 0 $evidence.implementationPaths.Count
        $state = & $adoptionModule {
            param($root, $id, $assignedTask, $roles, $adoptionContext)
            New-OrcaAdoptedState -RepoRoot $root -TaskId $id -Task $assignedTask -Roles $roles -Context $adoptionContext
        } $fixture.Root $fixture.TaskId $task @{ writer = 'codex'; reviewer = 'antigravity'; integrator = 'codex' } $context
        Assert-Equal 'executing' $state.state
    }
    finally { Remove-OrcaAdoptionFixture $fixture.Root }
}

It 'starts an adopted task at validating when implementation changes exist' {
    $fixture = New-OrcaAdoptionFixture -TaskId 'LEG-009' -Status 'ready'
    try {
        Initialize-OrcaAdoptionGit $fixture.Root
        [IO.File]::WriteAllText((Join-Path $fixture.Root 'implementation.txt'), 'change', [Text.UTF8Encoding]::new($false))
        $task = Read-OrcaTask -RepoRoot $fixture.Root -TaskId $fixture.TaskId
        $context = New-OrcaAdoptionTestContext $fixture.Root $fixture.TaskId
        $state = & $adoptionModule {
            param($root, $id, $assignedTask, $roles, $adoptionContext)
            New-OrcaAdoptedState -RepoRoot $root -TaskId $id -Task $assignedTask -Roles $roles -Context $adoptionContext
        } $fixture.Root $fixture.TaskId $task @{ writer = 'codex'; reviewer = 'antigravity'; integrator = 'codex' } $context
        Assert-Equal 'validating' $state.state
        Assert-True $state.adoptionEvidence.hasImplementation
        Assert-True ($state.adoptionEvidence.implementationPaths -contains 'implementation.txt')
    }
    finally { Remove-OrcaAdoptionFixture $fixture.Root }
}
