function Get-AntigravityAdapter {
    [pscustomobject]@{
        Id = 'antigravity'
        DisplayName = 'Antigravity'
        Executable = 'agy'
        OrcaAgentId = 'antigravity'
        Mode = 'non-interactive-stream-json-plan'
        SupportsResume = $true
        SupportsWrite = $false
        HelpVerified = $true
    }
}

function New-AntigravityInvocation {
    param(
        [Parameter(Mandatory)][string]$WorkingDirectory,
        [Parameter(Mandatory)][string]$Prompt,
        [Parameter(Mandatory)][string]$PromptPath,
        [Parameter(Mandatory)][string]$RunDirectory,
        [string]$SessionId
    )

    $arguments = @('--add-dir', $WorkingDirectory, '--input-format', 'text', '--output-format', 'stream-json', '--mode', 'plan', '--dangerously-skip-permissions', '--log-file', (Join-Path $RunDirectory 'antigravity-cli.log'), '--print', $Prompt)
    if ($SessionId) {
        $arguments += @('--conversation', $SessionId)
    }

    [pscustomobject]@{
        Executable = 'agy'
        Arguments = $arguments
        StandardInput = $null
        WorkingDirectory = $WorkingDirectory
    }
}
