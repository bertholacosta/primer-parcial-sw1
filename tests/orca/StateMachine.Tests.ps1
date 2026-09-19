It 'exposes the complete ordered state machine' {
    $states = @(Get-OrcaStateOrder)
    Assert-Equal 10 $states.Count
    Assert-Equal 'ready' $states[0]
    Assert-Equal 'done' $states[-1]
}

It 'accepts every forward transition in the primary path' {
    $primaryPath = @('ready', 'preparing', 'executing', 'validating', 'reviewing', 'approved', 'committing', 'merging', 'done')
    for ($index = 0; $index -lt $primaryPath.Count - 1; $index++) {
        Assert-True (Test-OrcaStateTransition -From $primaryPath[$index] -To $primaryPath[$index + 1]) "$($primaryPath[$index]) -> $($primaryPath[$index + 1]) should be valid."
    }
}

It 'accepts the correction loop and rejects unsafe jumps' {
    Assert-True (Test-OrcaStateTransition -From 'reviewing' -To 'correcting')
    Assert-True (Test-OrcaStateTransition -From 'correcting' -To 'executing')
    Assert-True (Test-OrcaStateTransition -From 'validating' -To 'correcting')
    Assert-True (Test-OrcaStateTransition -From 'approved' -To 'validating')
    Assert-False (Test-OrcaStateTransition -From 'ready' -To 'done')
    Assert-False (Test-OrcaStateTransition -From 'reviewing' -To 'committing')
}
