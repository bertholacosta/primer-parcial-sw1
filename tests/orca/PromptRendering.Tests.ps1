It 'parses P1-001 without an external YAML package' {
    $task = Read-OrcaTask -RepoRoot $repoRoot -TaskId 'P1-001'
    Assert-Equal 'P1-001' $task.Id
    Assert-Equal 'done' $task.Status
    Assert-Equal 'Kiro' $task.OwnerRole
    Assert-Equal 3 $task.ValidationCommands.Count
    Assert-True ($task.ValidationCommands[1] -match 'Test-Path')
}

It 'selects the declared writer and independent roles' {
    $task = Read-OrcaTask -RepoRoot $repoRoot -TaskId 'P1-001'
    $roles = Get-OrcaRoles $task
    Assert-Equal 'kiro' $roles.writer
    Assert-Equal 'antigravity' $roles.reviewer
    Assert-Equal 'antigravity' $roles.integrator
}

It 'renders a complete dry-run with every adapter and no mutations' {
    $plan = New-OrcaDryRun -RepoRoot $repoRoot -TaskId 'P1-001'
    Assert-True $plan.success
    Assert-False $plan.mutationsPerformed
    Assert-Equal 4 $plan.adapters.Count
    Assert-Equal 10 $plan.stateTransitions.Count
    Assert-Equal 2 $plan.correctionPolicy.maximumCycles
    foreach ($prompt in $plan.prompts.Values) {
        Assert-False ($prompt -match '\{\{[A-Z0-9_]+\}\}') 'Prompt contains an unresolved token.'
        Assert-True ($prompt -match 'P1-001') 'Prompt does not identify the task.'
    }
}

It 'keeps dry-run agent invocations aligned with verified executables' {
    $plan = New-OrcaDryRun -RepoRoot $repoRoot -TaskId 'P1-001'
    $expected = @('agy', 'codex', 'devin', 'kiro-cli')
    $actual = @($plan.adapters.executable | Sort-Object)
    Assert-Equal ($expected -join ',') ($actual -join ',')
    Assert-True (@($plan.adapters | Where-Object { $_.available }).Count -eq 4)

    $antigravity = $plan.adapters | Where-Object { $_.id -eq 'antigravity' }
    Assert-True ($antigravity.arguments -contains '--add-dir')
    Assert-True ($antigravity.arguments -contains '--mode')
    Assert-True ($antigravity.arguments -contains 'plan')
    Assert-True ($antigravity.arguments -contains '--dangerously-skip-permissions')
    Assert-Equal '--print' $antigravity.arguments[-2]
    Assert-Equal '<PROMPT>' $antigravity.arguments[-1]
}
