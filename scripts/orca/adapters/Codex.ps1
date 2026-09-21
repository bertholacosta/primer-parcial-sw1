function Get-CodexAdapter {
    [pscustomobject]@{
        Id = 'codex'
        DisplayName = 'Codex'
        Executable = 'codex'
        OrcaAgentId = 'codex'
        Mode = 'non-interactive-jsonl'
        SupportsResume = $true
        SupportsWrite = $true
        HelpVerified = $true
    }
}

function New-CodexInvocation {
    param(
        [Parameter(Mandatory)][string]$WorkingDirectory,
        [Parameter(Mandatory)][string]$Prompt,
        [Parameter(Mandatory)][string]$PromptPath,
        [Parameter(Mandatory)][string]$RunDirectory,
        [string]$SessionId,
        [string]$Role
    )

    if ($SessionId) {
        $arguments = @('exec', 'resume', $SessionId, '--dangerously-bypass-approvals-and-sandbox', '--json', '-')
    }
    else {
        $arguments = @('exec', '--dangerously-bypass-approvals-and-sandbox', '--json', '-C', $WorkingDirectory, '-o', (Join-Path $RunDirectory 'codex-last-message.txt'), '-')
    }

    [pscustomobject]@{
        Executable = 'codex'
        Arguments = $arguments
        StandardInput = $Prompt
        WorkingDirectory = $WorkingDirectory
    }
}
