Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:StateOrder = @(
    'ready',
    'preparing',
    'executing',
    'validating',
    'reviewing',
    'correcting',
    'approved',
    'committing',
    'merging',
    'done'
)

$script:AllowedTransitions = @{
    ready      = @('preparing')
    preparing  = @('executing')
    executing  = @('validating', 'correcting')
    validating = @('reviewing', 'correcting')
    reviewing  = @('approved', 'correcting', 'review_failed', 'paused-agent-error')
    correcting = @('executing')
    review_failed = @('reviewing')
    'paused-agent-error' = @('reviewing')
    approved   = @('committing', 'validating')
    committing = @('merging')
    merging    = @('done')
    done       = @()
}

Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot 'adapters') -Filter '*.ps1' -File |
    Sort-Object Name |
    ForEach-Object { . $_.FullName }

function Get-OrcaStateOrder {
    @($script:StateOrder)
}

function Test-OrcaStateTransition {
    param(
        [Parameter(Mandatory)][string]$From,
        [Parameter(Mandatory)][string]$To
    )

    if (-not $script:AllowedTransitions.ContainsKey($From)) {
        return $false
    }

    return $script:AllowedTransitions[$From] -contains $To
}

function ConvertFrom-OrcaYamlScalar {
    param([AllowNull()][string]$Value)

    if ($null -eq $Value) { return $null }
    $trimmed = $Value.Trim()
    if ($trimmed -eq '' -or $trimmed -eq 'null') { return $null }
    if ($trimmed.StartsWith('"') -and $trimmed.EndsWith('"')) {
        return ($trimmed | ConvertFrom-Json)
    }
    if ($trimmed.StartsWith("'") -and $trimmed.EndsWith("'")) {
        return $trimmed.Substring(1, $trimmed.Length - 2).Replace("''", "'")
    }
    return $trimmed
}

function Get-OrcaYamlScalar {
    param(
        [Parameter(Mandatory)][AllowEmptyString()][string[]]$Lines,
        [Parameter(Mandatory)][string]$Name
    )

    foreach ($line in $Lines) {
        if ($line -match "^$([regex]::Escape($Name)):\s*(.*)$") {
            return ConvertFrom-OrcaYamlScalar $Matches[1]
        }
    }
    return $null
}

function Get-OrcaYamlNestedScalar {
    param(
        [Parameter(Mandatory)][AllowEmptyString()][string[]]$Lines,
        [Parameter(Mandatory)][string]$Parent,
        [Parameter(Mandatory)][string]$Name
    )

    $inside = $false
    foreach ($line in $Lines) {
        if ($line -match "^$([regex]::Escape($Parent)):\s*$") {
            $inside = $true
            continue
        }
        if ($inside -and $line -match '^\S') { break }
        if ($inside -and $line -match "^  $([regex]::Escape($Name)):\s*(.*)$") {
            return ConvertFrom-OrcaYamlScalar $Matches[1]
        }
    }
    return $null
}

function Get-OrcaYamlList {
    param(
        [Parameter(Mandatory)][AllowEmptyString()][string[]]$Lines,
        [Parameter(Mandatory)][string]$Name,
        [string]$Parent
    )

    $values = [System.Collections.Generic.List[object]]::new()
    $headerIndent = if ($Parent) { 2 } else { 0 }
    $itemIndent = $headerIndent + 2
    $headerPrefix = ' ' * $headerIndent
    $itemPrefix = ' ' * $itemIndent
    $insideParent = -not [bool]$Parent
    $insideList = $false

    foreach ($line in $Lines) {
        if ($Parent -and $line -match "^$([regex]::Escape($Parent)):\s*$") {
            $insideParent = $true
            continue
        }
        if ($Parent -and $insideParent -and $line -match '^\S') { break }
        if (-not $insideParent) { continue }

        if ($line -match "^$([regex]::Escape($headerPrefix))$([regex]::Escape($Name)):\s*$") {
            $insideList = $true
            continue
        }

        if ($insideList) {
            if ($line -match "^$([regex]::Escape($itemPrefix))-\s+(.*)$") {
                $values.Add((ConvertFrom-OrcaYamlScalar $Matches[1]))
                continue
            }

            if ($line.Trim() -ne '') {
                $leading = $line.Length - $line.TrimStart().Length
                if ($leading -le $headerIndent) { break }
            }
        }
    }

    return @($values)
}

function Get-OrcaYamlInlineList {
    param(
        [Parameter(Mandatory)][AllowEmptyString()][string[]]$Lines,
        [Parameter(Mandatory)][string]$Name
    )

    foreach ($line in $Lines) {
        if ($line -match "^$([regex]::Escape($Name)):\s*\[(.*)\]\s*$") {
            $body = $Matches[1].Trim()
            if (-not $body) { return @() }
            return @($body.Split(',') | ForEach-Object { ConvertFrom-OrcaYamlScalar $_ })
        }
    }
    return @()
}

function Get-OrcaYamlBlock {
    param(
        [Parameter(Mandatory)][AllowEmptyString()][string[]]$Lines,
        [Parameter(Mandatory)][string]$Name
    )

    $collect = $false
    $parts = [System.Collections.Generic.List[string]]::new()
    foreach ($line in $Lines) {
        if ($line -match "^$([regex]::Escape($Name)):\s*>-\s*$") {
            $collect = $true
            continue
        }
        if ($collect -and $line -match '^\S') { break }
        if ($collect -and $line -match '^  (.*)$') { $parts.Add($Matches[1]) }
    }
    return ($parts -join ' ').Trim()
}

function Find-OrcaTaskFile {
    param(
        [Parameter(Mandatory)][string]$RepoRoot,
        [Parameter(Mandatory)][string]$TaskId
    )

    $taskRoot = Join-Path $RepoRoot 'tasks'
    $matches = @(Get-ChildItem -LiteralPath $taskRoot -Directory |
        ForEach-Object { Get-ChildItem -LiteralPath $_.FullName -Filter "$TaskId-*.yaml" -File -ErrorAction SilentlyContinue })
    if ($matches.Count -ne 1) {
        throw "Expected exactly one YAML for task $TaskId; found $($matches.Count)."
    }
    return $matches[0]
}

function Read-OrcaTask {
    param(
        [Parameter(Mandatory)][string]$RepoRoot,
        [Parameter(Mandatory)][string]$TaskId
    )

    $file = Find-OrcaTaskFile -RepoRoot $RepoRoot -TaskId $TaskId
    $raw = [IO.File]::ReadAllText($file.FullName)
    $lines = @($raw -split "`r?`n")
    $relativePath = [IO.Path]::GetRelativePath($RepoRoot, $file.FullName).Replace('\', '/')

    [pscustomobject]@{
        Id = Get-OrcaYamlScalar $lines 'id'
        Title = Get-OrcaYamlScalar $lines 'title'
        Phase = Get-OrcaYamlScalar $lines 'phase'
        Status = Get-OrcaYamlScalar $lines 'status'
        Kind = Get-OrcaYamlScalar $lines 'kind'
        OwnerRole = Get-OrcaYamlScalar $lines 'owner_role'
        Objective = Get-OrcaYamlBlock $lines 'objective'
        Dependencies = @(Get-OrcaYamlInlineList $lines 'dependencies')
        InputFiles = @(Get-OrcaYamlList $lines 'files' 'inputs')
        InputDocs = @(Get-OrcaYamlList $lines 'docs' 'inputs')
        AllowedPaths = @(Get-OrcaYamlList $lines 'allowed_paths' 'scope')
        ForbiddenPaths = @(Get-OrcaYamlList $lines 'forbidden_paths' 'scope')
        Constraints = @(Get-OrcaYamlList $lines 'constraints')
        AcceptanceCriteria = @(Get-OrcaYamlList $lines 'acceptance_criteria')
        ValidationCommands = @(Get-OrcaYamlList $lines 'validation_commands')
        Deliverables = @(Get-OrcaYamlList $lines 'deliverables')
        Links = @(Get-OrcaYamlList $lines 'links')
        DeclaredWriter = Get-OrcaYamlNestedScalar $lines 'orca' 'writer'
        DeclaredReviewer = Get-OrcaYamlNestedScalar $lines 'orca' 'reviewer'
        DeclaredBranch = Get-OrcaYamlNestedScalar $lines 'orca' 'branch'
        DeclaredWorktree = Get-OrcaYamlNestedScalar $lines 'orca' 'worktree'
        FilePath = $file.FullName
        RelativePath = $relativePath
        Raw = $raw
    }
}

function Get-OrcaAdapterCatalog {
    @(
        Get-CodexAdapter
        Get-KiroAdapter
        Get-DevinAdapter
        Get-AntigravityAdapter
    )
}

function Get-OrcaRoles {
    param([Parameter(Mandatory)]$Task)

    $owner = [string]$Task.OwnerRole
    $writer = if ($owner -match '(?i)Kiro') {
        'kiro'
    }
    elseif ($owner -match '(?i)Devin') {
        'devin'
    }
    elseif ($owner -match '(?i)Antigravity') {
        'antigravity'
    }
    elseif ($owner -match '(?i)Codex') {
        'codex'
    }
    elseif ($Task.Kind -in @('specification', 'adr')) {
        'kiro'
    }
    elseif ($Task.Kind -in @('implementation', 'test')) {
        'devin'
    }
    else {
        'codex'
    }

    $declaredWriter = ([string]$Task.DeclaredWriter).ToLowerInvariant()
    if ($declaredWriter -in @('codex', 'kiro', 'devin', 'antigravity')) {
        $writer = $declaredWriter
    }
    $reviewer = ([string]$Task.DeclaredReviewer).ToLowerInvariant()
    if ($reviewer -notin @('codex', 'kiro', 'devin', 'antigravity') -or $reviewer -eq $writer) {
        $reviewer = if ($writer -eq 'antigravity') { 'codex' } else { 'antigravity' }
    }

    @{
        writer = $writer
        reviewer = $reviewer
        integrator = 'codex'
    }
}

function Expand-OrcaPromptTemplate {
    param(
        [Parameter(Mandatory)][string]$TemplatePath,
        [Parameter(Mandatory)][hashtable]$Values
    )

    $text = [IO.File]::ReadAllText($TemplatePath)
    foreach ($key in ($Values.Keys | Sort-Object)) {
        $text = $text.Replace("{{$key}}", [string]$Values[$key])
    }
    if ($text -match '\{\{[A-Z0-9_]+\}\}') {
        throw "Unresolved prompt token $($Matches[0]) in $TemplatePath."
    }
    return $text
}

function New-OrcaPrompts {
    param(
        [Parameter(Mandatory)][string]$RepoRoot,
        [Parameter(Mandatory)]$Task,
        [Parameter(Mandatory)][hashtable]$Roles,
        [Parameter(Mandatory)][string]$Worktree,
        [string]$Findings = 'None.'
    )

    $agents = @{}
    foreach ($adapter in Get-OrcaAdapterCatalog) { $agents[$adapter.Id] = $adapter.DisplayName }
    $agents['codex'] = 'Codex / GPT-5.6 Sol'
    $agents['kiro'] = 'Kiro'
    $agents['devin'] = 'Devin CLI / SWE-2'
    $agents['antigravity'] = 'Antigravity / Gemini'

    $base = @{
        TASK_ID = $Task.Id
        TASK_FILE = $Task.RelativePath
        TASK_CONTENT = $Task.Raw
        AGENTS_CONTENT = [IO.File]::ReadAllText((Join-Path $RepoRoot 'AGENTS.md'))
        WORKTREE = $Worktree
        FINDINGS = $Findings
    }
    $promptRoot = Join-Path $PSScriptRoot 'prompts'

    $writerValues = $base.Clone(); $writerValues['ROLE_NAME'] = $agents[$Roles.writer]
    $reviewerValues = $base.Clone(); $reviewerValues['ROLE_NAME'] = $agents[$Roles.reviewer]
    $integratorValues = $base.Clone(); $integratorValues['ROLE_NAME'] = $agents[$Roles.integrator]

    [ordered]@{
        writer = Expand-OrcaPromptTemplate (Join-Path $promptRoot 'writer.txt') $writerValues
        reviewer = Expand-OrcaPromptTemplate (Join-Path $promptRoot 'reviewer.txt') $reviewerValues
        correction = Expand-OrcaPromptTemplate (Join-Path $promptRoot 'correction.txt') $writerValues
        integrator = Expand-OrcaPromptTemplate (Join-Path $promptRoot 'integrator.txt') $integratorValues
    }
}

function Invoke-OrcaNativeProcess {
    param(
        [Parameter(Mandatory)][string]$Executable,
        [string[]]$Arguments = @(),
        [Parameter(Mandatory)][string]$WorkingDirectory,
        [AllowNull()][string]$StandardInput,
        [scriptblock]$OnStarted
    )

    $command = Get-Command $Executable -ErrorAction Stop | Select-Object -First 1
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $command.Source
    $info.WorkingDirectory = $WorkingDirectory
    $info.UseShellExecute = $false
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $info.RedirectStandardInput = $null -ne $StandardInput
    $info.CreateNoWindow = $true
    foreach ($argument in $Arguments) { [void]$info.ArgumentList.Add([string]$argument) }

    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $info
    $startedAt = [DateTimeOffset]::UtcNow
    if (-not $process.Start()) { throw "Failed to start $Executable." }
    if ($OnStarted) { & $OnStarted $process.Id }

    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    if ($null -ne $StandardInput) {
        $process.StandardInput.Write($StandardInput)
        $process.StandardInput.Close()
    }
    $process.WaitForExit()
    $stdout = $stdoutTask.GetAwaiter().GetResult()
    $stderr = $stderrTask.GetAwaiter().GetResult()
    $finishedAt = [DateTimeOffset]::UtcNow

    [pscustomobject]@{
        executable = $Executable
        arguments = @($Arguments)
        exitCode = $process.ExitCode
        stdout = $stdout
        stderr = $stderr
        startedAt = $startedAt.ToString('o')
        finishedAt = $finishedAt.ToString('o')
        durationMs = [math]::Round(($finishedAt - $startedAt).TotalMilliseconds)
        processId = $process.Id
    }
}

function Get-OrcaPreflight {
    param([Parameter(Mandatory)][string]$RepoRoot)

    $checks = [System.Collections.Generic.List[object]]::new()
    $windowsVersion = [Environment]::OSVersion.Version
    $isWindowsHost = [Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT -and $windowsVersion.Build -ge 22000
    $checks.Add([pscustomobject]@{ name = 'windows11'; ok = $isWindowsHost; detail = [Environment]::OSVersion.VersionString })
    $checks.Add([pscustomobject]@{ name = 'powershell7'; ok = $PSVersionTable.PSVersion.Major -ge 7; detail = $PSVersionTable.PSVersion.ToString() })

    foreach ($tool in @('git', 'pwsh', 'orca', 'codex', 'kiro-cli', 'devin', 'agy')) {
        $command = Get-Command $tool -ErrorAction SilentlyContinue | Select-Object -First 1
        $checks.Add([pscustomobject]@{ name = "tool:$tool"; ok = $null -ne $command; detail = if ($command) { $command.Source } else { 'missing' } })
    }

    $orcaCheck = $null
    if ((Get-Command orca -ErrorAction SilentlyContinue)) {
        $result = Invoke-OrcaNativeProcess -Executable 'orca' -Arguments @('status', '--json') -WorkingDirectory $RepoRoot -StandardInput $null
        $orcaCheck = [pscustomobject]@{ name = 'orca-runtime'; ok = $result.exitCode -eq 0; detail = if ($result.exitCode -eq 0) { 'reachable' } else { $result.stderr } }
        $checks.Add($orcaCheck)
    }

    $failed = @($checks | Where-Object { -not $_.ok })
    [ordered]@{
        success = $failed.Count -eq 0
        command = 'preflight'
        canonicalEnvironment = 'Windows 11 / PowerShell 7'
        checks = @($checks)
        failures = $failed
    }
}

function Get-OrcaRunRoot {
    param([string]$RepoRoot, [string]$TaskId)
    Join-Path (Join-Path (Join-Path $RepoRoot '.orca') 'runs') $TaskId
}

function Write-OrcaRunEvent {
    param([string]$RunRoot, [string]$Type, [System.Collections.IDictionary]$Data)
    [IO.Directory]::CreateDirectory($RunRoot) | Out-Null
    $event = [ordered]@{ timestamp = [DateTimeOffset]::UtcNow.ToString('o'); type = $Type; data = $Data }
    [IO.File]::AppendAllText((Join-Path $RunRoot 'events.jsonl'), (($event | ConvertTo-Json -Depth 30 -Compress) + [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
}

function Save-OrcaRunState {
    param([string]$RunRoot, [hashtable]$State)
    [IO.Directory]::CreateDirectory($RunRoot) | Out-Null
    $State.updatedAt = [DateTimeOffset]::UtcNow.ToString('o')
    $path = Join-Path $RunRoot 'state.json'
    $temp = "$path.tmp"
    [IO.File]::WriteAllText($temp, ($State | ConvertTo-Json -Depth 40), [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temp -Destination $path -Force
}

function Read-OrcaRunState {
    param([string]$RunRoot)
    $path = Join-Path $RunRoot 'state.json'
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return $null }
    return ([IO.File]::ReadAllText($path) | ConvertFrom-Json -AsHashtable)
}

function Set-OrcaRunTransition {
    param([string]$RunRoot, [hashtable]$State, [string]$To)
    $from = [string]$State.state
    if (-not (Test-OrcaStateTransition -From $from -To $To)) {
        throw "Invalid state transition: $from -> $To."
    }
    $State.state = $To
    $State.history += ,([ordered]@{ from = $from; to = $To; at = [DateTimeOffset]::UtcNow.ToString('o') })
    Save-OrcaRunState $RunRoot $State
    Write-OrcaRunEvent $RunRoot 'transition' @{ from = $from; to = $To }
}

function Acquire-OrcaLock {
    param([string]$Path, [string]$TaskId)
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($Path)) | Out-Null
    if (Test-Path -LiteralPath $Path) {
        try {
            $existing = [IO.File]::ReadAllText($Path) | ConvertFrom-Json
            if ($existing.processId -and (Get-Process -Id $existing.processId -ErrorAction SilentlyContinue)) {
                throw "Writer lock is active for task $($existing.taskId) in process $($existing.processId)."
            }
        }
        catch [System.Management.Automation.RuntimeException] { throw }
        catch { }
        Remove-Item -LiteralPath $Path -Force
    }
    $payload = [ordered]@{ taskId = $TaskId; processId = $PID; machine = [Environment]::MachineName; acquiredAt = [DateTimeOffset]::UtcNow.ToString('o') }
    $stream = [IO.File]::Open($Path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try {
        $bytes = [Text.UTF8Encoding]::new($false).GetBytes(($payload | ConvertTo-Json -Compress))
        $stream.Write($bytes, 0, $bytes.Length)
    }
    finally { $stream.Dispose() }
}

function Release-OrcaLock {
    param([string]$Path)
    if ($Path -and (Test-Path -LiteralPath $Path)) { Remove-Item -LiteralPath $Path -Force }
}

function New-OrcaAgentInvocation {
    param(
        [string]$AgentId,
        [string]$WorkingDirectory,
        [string]$Prompt,
        [string]$PromptPath,
        [string]$RunDirectory,
        [string]$SessionId,
        [string]$Role
    )
    $parameters = @{
        WorkingDirectory = $WorkingDirectory
        Prompt = $Prompt
        PromptPath = $PromptPath
        RunDirectory = $RunDirectory
        SessionId = $SessionId
    }
    switch ($AgentId) {
        'codex' { return New-CodexInvocation @parameters -Role $Role }
        'kiro' { return New-KiroInvocation @parameters }
        'devin' { return New-DevinInvocation @parameters }
        'antigravity' { return New-AntigravityInvocation @parameters }
        default { throw "Unknown agent adapter: $AgentId" }
    }
}

function Get-OrcaSessionId {
    param([string]$Text)
    foreach ($pattern in @('"session_id"\s*:\s*"([^"]+)"', '"sessionId"\s*:\s*"([^"]+)"', '"thread_id"\s*:\s*"([^"]+)"', '"conversation_id"\s*:\s*"([^"]+)"')) {
        $match = [regex]::Match($Text, $pattern)
        if ($match.Success) { return $match.Groups[1].Value }
    }
    return $null
}

function Get-OrcaBalancedJsonObjects {
    param([AllowEmptyString()][string]$Text)
    $objects = [System.Collections.Generic.List[string]]::new()
    $depth = 0
    $start = -1
    $insideString = $false
    $escaped = $false
    for ($index = 0; $index -lt $Text.Length; $index++) {
        $character = $Text[$index]
        if ($insideString) {
            if ($escaped) { $escaped = $false; continue }
            if ($character -eq '\') { $escaped = $true; continue }
            if ($character -eq '"') { $insideString = $false }
            continue
        }
        if ($character -eq '"') { $insideString = $true; continue }
        if ($character -eq '{') {
            if ($depth -eq 0) { $start = $index }
            $depth++
            continue
        }
        if ($character -eq '}' -and $depth -gt 0) {
            $depth--
            if ($depth -eq 0 -and $start -ge 0) {
                $objects.Add($Text.Substring($start, $index - $start + 1))
                $start = -1
            }
        }
    }
    return @($objects)
}

function Get-OrcaAgentResponseTexts {
    param([AllowEmptyString()][string]$Text)
    $resultResponses = [System.Collections.Generic.List[string]]::new()
    $agentMessages = [System.Collections.Generic.List[string]]::new()
    $messageContents = [System.Collections.Generic.List[string]]::new()
    foreach ($line in @($Text -split "`r?`n")) {
        if (-not $line.Trim()) { continue }
        try { $record = $line | ConvertFrom-Json -AsHashtable } catch { continue }
        if ($record.ContainsKey('event') -and $record.event -eq 'result' -and $record.ContainsKey('result') -and $record.result -and $record.result.ContainsKey('response') -and $record.result.response) {
            $resultResponses.Add([string]$record.result.response)
        }
        elseif ($record.ContainsKey('type') -and $record.type -eq 'item.completed' -and $record.ContainsKey('item') -and $record.item -and $record.item.ContainsKey('type') -and $record.item.type -eq 'agent_message' -and $record.item.ContainsKey('text') -and $record.item.text) {
            $agentMessages.Add([string]$record.item.text)
        }
        elseif ($record.ContainsKey('message') -and $record.message -and $record.message.ContainsKey('content') -and $record.message.content -is [string]) {
            $messageContents.Add([string]$record.message.content)
        }
    }
    if ($resultResponses.Count -gt 0) { return @($resultResponses[-1]) }
    if ($agentMessages.Count -gt 0) { return @($agentMessages[-1]) }
    if ($messageContents.Count -gt 0) { return @($messageContents[-1]) }
    return @($Text)
}

function ConvertTo-OrcaComparableText {
    param([AllowEmptyString()][string]$Text)
    $decomposed = $Text.Normalize([Text.NormalizationForm]::FormD)
    $builder = [Text.StringBuilder]::new()
    foreach ($character in $decomposed.ToCharArray()) {
        if ([Globalization.CharUnicodeInfo]::GetUnicodeCategory($character) -ne [Globalization.UnicodeCategory]::NonSpacingMark) {
            [void]$builder.Append($character)
        }
    }
    return (($builder.ToString().ToLowerInvariant() -replace '[^a-z0-9]+', '_').Trim('_'))
}

function ConvertTo-OrcaReviewVerdictValue {
    param([AllowNull()]$Value)
    $comparable = ConvertTo-OrcaComparableText ([string]$Value)
    switch ($comparable) {
        'approved' { return 'approved' }
        'aprobado' { return 'approved' }
        'aprobada' { return 'approved' }
        'changes_requested' { return 'changes_requested' }
        'requiere_correcciones' { return 'changes_requested' }
        'correcciones_requeridas' { return 'changes_requested' }
        'cambios_solicitados' { return 'changes_requested' }
        default { return $null }
    }
}

function ConvertTo-OrcaReviewSeverity {
    param([AllowNull()]$Value)
    $comparable = ConvertTo-OrcaComparableText ([string]$Value)
    switch ($comparable) {
        'blocking' { return 'blocking' }
        'critical' { return 'blocking' }
        'high' { return 'high' }
        'major' { return 'high' }
        'medium' { return 'medium' }
        'low' { return 'low' }
        'minor' { return 'low' }
        default { return $null }
    }
}

function ConvertFrom-OrcaReviewOutput {
    param([AllowEmptyString()][string]$Text)
    $valid = [System.Collections.Generic.List[object]]::new()
    $candidateErrors = [System.Collections.Generic.List[string]]::new()
    foreach ($responseText in @(Get-OrcaAgentResponseTexts $Text)) {
        foreach ($jsonText in @(Get-OrcaBalancedJsonObjects $responseText)) {
            try { $candidate = $jsonText | ConvertFrom-Json -AsHashtable } catch {
                $candidateErrors.Add($_.Exception.Message)
                continue
            }
            if (-not $candidate.ContainsKey('verdict') -or -not $candidate.ContainsKey('summary') -or -not $candidate.ContainsKey('findings')) { continue }
            $verdict = ConvertTo-OrcaReviewVerdictValue $candidate.verdict
            if (-not $verdict) {
                $candidateErrors.Add("Unsupported reviewer verdict: $($candidate.verdict)")
                continue
            }
            if ($candidate.summary -isnot [string]) {
                $candidateErrors.Add('Reviewer summary must be a string.')
                continue
            }
            $findings = [System.Collections.Generic.List[object]]::new()
            $findingError = $null
            if ($null -eq $candidate.findings -or $candidate.findings -is [string] -or $candidate.findings -isnot [System.Collections.IEnumerable]) {
                $findingError = 'Reviewer findings must be an array.'
            }
            else {
                foreach ($finding in @($candidate.findings)) {
                    if ($finding -isnot [System.Collections.IDictionary]) { $findingError = 'Every reviewer finding must be an object.'; break }
                    $severity = ConvertTo-OrcaReviewSeverity $finding.severity
                    if (-not $severity) { $findingError = "Unsupported finding severity: $($finding.severity)"; break }
                    $description = if ($finding.ContainsKey('description')) { $finding.description } elseif ($finding.ContainsKey('message')) { $finding.message } else { $null }
                    if ($finding.file -isnot [string] -or $description -isnot [string]) {
                        $findingError = 'Every reviewer finding requires string file and description fields.'
                        break
                    }
                    $recommendation = if ($finding.ContainsKey('recommendation')) { $finding.recommendation } else { '' }
                    if ($recommendation -isnot [string]) { $findingError = 'Every reviewer recommendation must be a string.'; break }
                    $findings.Add([ordered]@{
                        severity = $severity
                        file = [string]$finding.file
                        description = [string]$description
                        recommendation = [string]$recommendation
                    })
                }
            }
            if ($findingError) { $candidateErrors.Add($findingError); continue }
            $valid.Add([ordered]@{ verdict = $verdict; summary = [string]$candidate.summary; findings = @($findings) })
        }
    }
    if ($valid.Count -eq 1) {
        return [ordered]@{ success = $true; normalized = $valid[0]; error = $null }
    }
    $error = if ($valid.Count -gt 1) {
        "Reviewer output contained $($valid.Count) valid verdict objects; exactly one is required."
    }
    elseif ($candidateErrors.Count -gt 0) {
        "Reviewer output did not contain exactly one valid verdict JSON. $($candidateErrors[-1])"
    }
    else { 'Reviewer output did not contain exactly one valid verdict JSON.' }
    return [ordered]@{ success = $false; normalized = $null; error = $error }
}

function Save-OrcaPrompt {
    param([string]$RunRoot, [string]$Name, [string]$Prompt)
    $directory = Join-Path $RunRoot 'prompts'
    [IO.Directory]::CreateDirectory($directory) | Out-Null
    $path = Join-Path $directory "$Name.txt"
    [IO.File]::WriteAllText($path, $Prompt, [Text.UTF8Encoding]::new($false))
    return $path
}

function Invoke-OrcaAgent {
    param(
        [string]$AgentId,
        [string]$Role,
        [string]$Prompt,
        [string]$Worktree,
        [string]$RunRoot,
        [hashtable]$State,
        [string]$SessionId
    )
    $promptPath = Save-OrcaPrompt $RunRoot "$Role-$($State.correctionCount)" $Prompt
    $invocation = New-OrcaAgentInvocation -AgentId $AgentId -WorkingDirectory $Worktree -Prompt $Prompt -PromptPath $promptPath -RunDirectory $RunRoot -SessionId $SessionId -Role $Role
    Write-OrcaRunEvent $RunRoot 'agent-starting' @{ agent = $AgentId; role = $Role; executable = $invocation.Executable; arguments = $invocation.Arguments }
    $result = Invoke-OrcaNativeProcess -Executable $invocation.Executable -Arguments $invocation.Arguments -WorkingDirectory $invocation.WorkingDirectory -StandardInput $invocation.StandardInput -OnStarted {
        param($processId)
        $State.currentProcess = @{ processId = $processId; agent = $AgentId; role = $Role }
        Save-OrcaRunState $RunRoot $State
    }
    $persistedState = Read-OrcaRunState $RunRoot
    if ($persistedState -and $persistedState.stopRequested) { $State.stopRequested = $true }
    $State.currentProcess = $null
    $sessionText = $result.stdout + "`n" + $result.stderr
    $devinExport = Join-Path $RunRoot 'devin-session.json'
    if ($AgentId -eq 'devin' -and (Test-Path -LiteralPath $devinExport -PathType Leaf)) {
        $sessionText += "`n" + [IO.File]::ReadAllText($devinExport)
    }
    $session = Get-OrcaSessionId $sessionText
    if ($session) { $State.sessions[$AgentId] = $session }
    Save-OrcaRunState $RunRoot $State
    Write-OrcaRunEvent $RunRoot 'agent-finished' @{ agent = $AgentId; role = $Role; sessionId = $session; result = $result }
    return $result
}

function Save-OrcaReviewAttempt {
    param(
        [string]$RunRoot,
        [string]$Role,
        [int]$Attempt,
        $ProcessResult,
        [System.Collections.IDictionary]$Analysis
    )
    $directory = Join-Path (Join-Path $RunRoot 'reviews') 'results'
    [IO.Directory]::CreateDirectory($directory) | Out-Null
    $path = Join-Path $directory ("$Role-attempt-$Attempt.json")
    $payload = [ordered]@{
        timestamp = [DateTimeOffset]::UtcNow.ToString('o')
        role = $Role
        attempt = $Attempt
        exitCode = $ProcessResult.exitCode
        stdout = [string]$ProcessResult.stdout
        stderr = [string]$ProcessResult.stderr
        normalizedJson = $Analysis.normalized
        parseError = $Analysis.error
    }
    $temporaryPath = "$path.tmp"
    [IO.File]::WriteAllText($temporaryPath, ($payload | ConvertTo-Json -Depth 40), [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temporaryPath -Destination $path -Force
    return $path
}

function Invoke-OrcaReviewerWithRetry {
    param(
        [string]$AgentId,
        [string]$Prompt,
        [string]$Worktree,
        [string]$RunRoot,
        [hashtable]$State,
        [scriptblock]$Invoker
    )
    for ($localAttempt = 1; $localAttempt -le 2; $localAttempt++) {
        $attempt = if ($State.ContainsKey('reviewAttemptCount')) { [int]$State.reviewAttemptCount + 1 } else { 1 }
        $State.reviewAttemptCount = $attempt
        Save-OrcaRunState $RunRoot $State
        $result = if ($Invoker) {
            & $Invoker $attempt $null
        }
        else {
            Invoke-OrcaAgent $AgentId 'reviewer' $Prompt $Worktree $RunRoot $State $null
        }
        $analysis = if ($result.exitCode -eq 0) {
            ConvertFrom-OrcaReviewOutput ([string]$result.stdout)
        }
        else {
            [ordered]@{ success = $false; normalized = $null; error = "Reviewer exited with code $($result.exitCode)." }
        }
        $logPath = Save-OrcaReviewAttempt -RunRoot $RunRoot -Role 'reviewer' -Attempt $attempt -ProcessResult $result -Analysis $analysis
        $State.lastReviewLog = $logPath
        $State.lastAgentLog = $logPath
        $State.lastReviewJson = $analysis.normalized
        $State.lastError = $analysis.error
        Save-OrcaRunState $RunRoot $State
        Write-OrcaRunEvent $RunRoot 'review-attempt-recorded' @{
            attempt = $attempt
            exitCode = $result.exitCode
            logPath = $logPath
            normalizedJson = $analysis.normalized
            parseError = $analysis.error
        }
        if ($result.exitCode -ne 0) {
            Set-OrcaRunTransition $RunRoot $State 'paused-agent-error'
            return [ordered]@{ success = $false; analysis = $analysis; logPath = $logPath; attempts = $localAttempt }
        }
        if ($analysis.success) {
            $State.lastError = $null
            $State.haltReason = $null
            Save-OrcaRunState $RunRoot $State
            return [ordered]@{ success = $true; analysis = $analysis; logPath = $logPath; attempts = $localAttempt }
        }
        if ($localAttempt -eq 1) {
            Write-OrcaRunEvent $RunRoot 'review-retry-scheduled' @{ failedAttempt = $attempt; reason = $analysis.error; newSession = $true }
            continue
        }
        $State.haltReason = 'review-output-invalid'
        Set-OrcaRunTransition $RunRoot $State 'review_failed'
        return [ordered]@{ success = $false; analysis = $analysis; logPath = $logPath; attempts = $localAttempt }
    }
}

function Test-OrcaPathPattern {
    param([string]$Path, [string]$Pattern)
    $normalizedPath = $Path.Replace('\', '/')
    $normalizedPattern = $Pattern.Replace('\', '/')
    if ($normalizedPattern.EndsWith('/')) { return $normalizedPath.StartsWith($normalizedPattern, [StringComparison]::OrdinalIgnoreCase) }
    if ($normalizedPattern.IndexOfAny([char[]]'*?[') -ge 0) {
        return [Management.Automation.WildcardPattern]::new($normalizedPattern, [Management.Automation.WildcardOptions]::IgnoreCase).IsMatch($normalizedPath)
    }
    return $normalizedPath.Equals($normalizedPattern, [StringComparison]::OrdinalIgnoreCase)
}

function Find-OrcaAdoptableTaskFile {
    param(
        [Parameter(Mandatory)][string]$RepoRoot,
        [Parameter(Mandatory)][string]$TaskId,
        [switch]$AllowMissing
    )

    $matches = @(
        foreach ($status in @('ready', 'active', 'done')) {
            $directory = Join-Path (Join-Path $RepoRoot 'tasks') $status
            if (Test-Path -LiteralPath $directory -PathType Container) {
                Get-ChildItem -LiteralPath $directory -Filter "$TaskId-*.yaml" -File -ErrorAction SilentlyContinue
            }
        }
    )
    if ($matches.Count -eq 0 -and $AllowMissing) { return $null }
    if ($matches.Count -ne 1) {
        throw "Expected exactly one adoptable YAML for task $TaskId under tasks/ready, tasks/active, or tasks/done; found $($matches.Count)."
    }
    return $matches[0]
}

function Test-OrcaSamePath {
    param([string]$Left, [string]$Right)
    if (-not $Left -or -not $Right) { return $false }
    $leftPath = [IO.Path]::GetFullPath($Left).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
    $rightPath = [IO.Path]::GetFullPath($Right).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
    return $leftPath.Equals($rightPath, [StringComparison]::OrdinalIgnoreCase)
}

function Assert-OrcaAdoptionMatches {
    param(
        [Parameter(Mandatory)]$Task,
        [Parameter(Mandatory)][string]$RepoRoot,
        [Parameter(Mandatory)][string]$CurrentBranch,
        [Parameter(Mandatory)]$CurrentWorktree
    )

    if (-not (Test-OrcaSamePath $RepoRoot ([string]$CurrentWorktree.path))) {
        throw "Current Orca worktree path does not match the repository root for task $($Task.Id)."
    }
    $reportedBranch = [string]$CurrentWorktree.branch
    if ($reportedBranch -and $reportedBranch -ne "refs/heads/$CurrentBranch") {
        throw "Orca reports branch $reportedBranch, but Git reports $CurrentBranch for the current worktree."
    }

    $expectedBranch = [string]$Task.DeclaredBranch
    if ($expectedBranch) {
        if ($CurrentBranch -ne $expectedBranch) {
            throw "Task $($Task.Id) declares branch $expectedBranch, but the current branch is $CurrentBranch."
        }
    }
    elseif ($CurrentBranch -notmatch "(?i)(^|[/_-])$([regex]::Escape($Task.Id))([/_-]|$)") {
        throw "Current branch $CurrentBranch does not correspond to task $($Task.Id)."
    }

    $expectedWorktree = [string]$Task.DeclaredWorktree
    if ($expectedWorktree) {
        $separator = $expectedWorktree.IndexOf('::', [StringComparison]::Ordinal)
        if ($separator -lt 1) { throw "Task $($Task.Id) has an invalid declared Orca worktree id." }
        $expectedRepoId = $expectedWorktree.Substring(0, $separator)
        $expectedPath = $expectedWorktree.Substring($separator + 2)
        if ([string]$CurrentWorktree.repoId -ne $expectedRepoId -or -not (Test-OrcaSamePath $expectedPath ([string]$CurrentWorktree.path))) {
            throw "Current Orca worktree $($CurrentWorktree.id) does not match the worktree declared by task $($Task.Id)."
        }
    }
}

function Get-OrcaIntegrationTarget {
    param([Parameter(Mandatory)][string]$WorkingDirectory)
    $result = Invoke-OrcaGit $WorkingDirectory @('worktree', 'list', '--porcelain')
    $records = @($result.stdout -split "(?:`r?`n){2,}" | Where-Object { $_.Trim() })
    foreach ($record in $records) {
        $lines = @($record -split "`r?`n")
        if ($lines -contains 'branch refs/heads/main') {
            $worktreeLine = $lines | Where-Object { $_ -like 'worktree *' } | Select-Object -First 1
            if ($worktreeLine) {
                return [ordered]@{ path = $worktreeLine.Substring('worktree '.Length); mode = 'main-worktree' }
            }
        }
    }
    return [ordered]@{ path = $WorkingDirectory; mode = 'update-ref' }
}

function Resolve-OrcaAdoptionContext {
    param([string]$RepoRoot, $Task)
    $branch = (Invoke-OrcaGit $RepoRoot @('branch', '--show-current')).stdout.Trim()
    $result = Invoke-OrcaNativeProcess -Executable 'orca' -Arguments @('worktree', 'current', '--json') -WorkingDirectory $RepoRoot -StandardInput $null
    if ($result.exitCode -ne 0) { throw "Unable to identify the current Orca worktree: $($result.stderr)" }
    $worktree = ($result.stdout | ConvertFrom-Json).result.worktree
    if (-not $worktree) { throw 'Orca did not return a current worktree.' }
    Assert-OrcaAdoptionMatches -Task $Task -RepoRoot $RepoRoot -CurrentBranch $branch -CurrentWorktree $worktree
    $integration = Get-OrcaIntegrationTarget $RepoRoot
    [ordered]@{
        branch = $branch
        worktree = $worktree
        integrationRoot = $integration.path
        integrationMode = $integration.mode
    }
}

function New-OrcaRunState {
    param(
        [string]$RepoRoot,
        [string]$TaskId,
        $Task,
        [hashtable]$Roles,
        [string]$InitialState = 'ready'
    )
    @{
        schemaVersion = 1
        taskId = $TaskId
        state = $InitialState
        correctionCount = 0
        createdAt = [DateTimeOffset]::UtcNow.ToString('o')
        updatedAt = $null
        repoRoot = $RepoRoot
        integrationRoot = $RepoRoot
        integrationMode = 'main-worktree'
        taskFile = $Task.RelativePath
        worktree = $null
        roles = $Roles
        sessions = @{}
        currentProcess = $null
        writerLock = $null
        lastFindings = ''
        lastError = $null
        lastReviewLog = $null
        lastReviewJson = $null
        reviewAttemptCount = 0
        lastAgentLog = $null
        integrationAttemptCount = 0
        stopRequested = $false
        halted = $false
        haltReason = $null
        history = @()
        adopted = $false
    }
}

function New-OrcaAdoptedState {
    param([string]$RepoRoot, [string]$TaskId, $Task, [hashtable]$Roles, $Context)
    $state = New-OrcaRunState -RepoRoot $RepoRoot -TaskId $TaskId -Task $Task -Roles $Roles -InitialState 'validating'
    $state.integrationRoot = [string]$Context.integrationRoot
    $state.integrationMode = [string]$Context.integrationMode
    $state.worktree = @{
        id = [string]$Context.worktree.id
        path = [string]$Context.worktree.path
        branch = [string]$Context.branch
    }
    $state.writerLock = Join-Path (Join-Path ([string]$Context.worktree.path) '.orca') 'writer.lock'
    $state.adopted = $true
    $state.adoptedAt = [DateTimeOffset]::UtcNow.ToString('o')
    $state.adoptedFrom = @{
        status = [string]$Task.Status
        taskFile = [string]$Task.RelativePath
        branch = [string]$Context.branch
        worktreeId = [string]$Context.worktree.id
    }
    return $state
}

function Get-OrcaScopeViolations {
    param($Task, [string]$Worktree)
    $tracked = (Invoke-OrcaGit $Worktree @('diff', '--name-only', '--no-renames')).stdout -split "`r?`n"
    $staged = (Invoke-OrcaGit $Worktree @('diff', '--cached', '--name-only', '--no-renames')).stdout -split "`r?`n"
    $untracked = (Invoke-OrcaGit $Worktree @('ls-files', '--others', '--exclude-standard')).stdout -split "`r?`n"
    $changed = @($tracked + $staged + $untracked | Where-Object { $_ } | Sort-Object -Unique)
    $taskName = [IO.Path]::GetFileName($Task.FilePath)
    $violations = foreach ($path in $changed) {
        $normalized = $path.Replace('\', '/')
        if ($normalized -match "^tasks/(ready|active|done)/$([regex]::Escape($taskName))$") { continue }
        $forbidden = @($Task.ForbiddenPaths | Where-Object { Test-OrcaPathPattern $normalized $_ }).Count -gt 0
        $allowed = @($Task.AllowedPaths | Where-Object { Test-OrcaPathPattern $normalized $_ }).Count -gt 0
        if ($forbidden -or -not $allowed) { $normalized }
    }
    return @($violations)
}

function New-OrcaReviewWorkspace {
    param([string]$SourceWorktree, [string]$RunRoot, [string]$Label)
    $reviewsRoot = Join-Path $RunRoot 'reviews'
    [IO.Directory]::CreateDirectory($reviewsRoot) | Out-Null
    $reviewPath = Join-Path $reviewsRoot ("$Label-$([guid]::NewGuid().ToString('N'))")
    Invoke-OrcaGit $reviewsRoot @('clone', '--quiet', '--no-hardlinks', '--', $SourceWorktree, $reviewPath) | Out-Null

    $relevantPaths = (Invoke-OrcaGit $SourceWorktree @('ls-files', '--cached', '--others', '--exclude-standard')).stdout -split "`r?`n" |
        Where-Object { $_ } | Sort-Object -Unique
    foreach ($relativePath in $relevantPaths) {
        $platformPath = $relativePath.Replace('/', [IO.Path]::DirectorySeparatorChar)
        $source = Join-Path $SourceWorktree $platformPath
        $target = Join-Path $reviewPath $platformPath
        if (Test-Path -LiteralPath $source -PathType Leaf) {
            [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target)) | Out-Null
            [IO.File]::Copy($source, $target, $true)
        }
        elseif (Test-Path -LiteralPath $target -PathType Leaf) {
            Remove-Item -LiteralPath $target -Force
        }
    }
    Write-OrcaRunEvent $RunRoot 'review-workspace-created' @{ source = $SourceWorktree; path = $reviewPath; label = $Label }
    return $reviewPath
}

function Invoke-OrcaValidations {
    param($Task, [string]$Worktree, [string]$RunRoot, [hashtable]$State)
    $results = [System.Collections.Generic.List[object]]::new()
    $violations = @(Get-OrcaScopeViolations $Task $Worktree)
    $scopeResult = [pscustomobject]@{
        command = 'scope-check'
        exitCode = if ($violations.Count -eq 0) { 0 } else { 1 }
        stdout = if ($violations.Count -eq 0) { 'All changed paths are within task scope.' } else { '' }
        stderr = if ($violations.Count -eq 0) { '' } else { "Out-of-scope paths: $($violations -join ', ')" }
        durationMs = 0
    }
    $results.Add($scopeResult)
    Write-OrcaRunEvent $RunRoot 'validation' @{ command = 'scope-check'; result = $scopeResult }
    if ($scopeResult.exitCode -ne 0) { return @($results) }

    foreach ($command in $Task.ValidationCommands) {
        $result = Invoke-OrcaNativeProcess -Executable 'pwsh' -Arguments @('-NoProfile', '-Command', $command) -WorkingDirectory $Worktree -StandardInput $null
        $results.Add([pscustomobject]@{ command = $command; exitCode = $result.exitCode; stdout = $result.stdout; stderr = $result.stderr; durationMs = $result.durationMs })
        Write-OrcaRunEvent $RunRoot 'validation' @{ command = $command; result = $result }
        if ($result.exitCode -ne 0) { break }
    }
    return @($results)
}

function ConvertTo-OrcaSlug {
    param([string]$Text)
    (($Text.ToLowerInvariant() -replace '[^a-z0-9]+', '-') -replace '^-|-$', '')
}

function Set-OrcaTaskStatusFile {
    param([string]$Path, [string]$Status)
    $content = [IO.File]::ReadAllText($Path)
    $updated = [regex]::Replace($content, '(?m)^status:\s*.*$', "status: $Status", 1)
    [IO.File]::WriteAllText($Path, $updated, [Text.UTF8Encoding]::new($false))
}

function Set-OrcaTaskExecutionMetadata {
    param([string]$Path, [hashtable]$State)
    $content = [IO.File]::ReadAllText($Path)
    $values = [ordered]@{
        branch = [string]$State.worktree.branch
        worktree = [string]$State.worktree.id
        writer = [string]$State.roles.writer
        reviewer = [string]$State.roles.reviewer
    }
    foreach ($entry in $values.GetEnumerator()) {
        $yamlValue = $entry.Value | ConvertTo-Json -Compress
        $content = [regex]::Replace($content, "(?m)^  $([regex]::Escape($entry.Key)):\s*.*$", "  $($entry.Key): $yamlValue", 1)
    }
    [IO.File]::WriteAllText($Path, $content, [Text.UTF8Encoding]::new($false))
}

function Set-OrcaTaskEvidence {
    param([string]$Path)
    $content = [IO.File]::ReadAllText($Path)
    $newline = if ($content.Contains("`r`n")) { "`r`n" } else { "`n" }
    $evidenceValues = @(
        'scope and validation_commands passed',
        'independent reviewer approved normalized JSON',
        'integrator approved normalized JSON'
    )
    $missingLines = @($evidenceValues | Where-Object { $content -notmatch [regex]::Escape($_) } | ForEach-Object { "  - $($_ | ConvertTo-Json -Compress)" })
    if ($missingLines.Count -gt 0) {
        if ($content -match '(?m)^evidence:\s*\[\]\s*$') {
            $replacement = 'evidence:' + $newline + ($missingLines -join $newline)
            $content = [regex]::Replace($content, '(?m)^evidence:\s*\[\]\s*$', $replacement, 1)
        }
        else {
            $content = $content.TrimEnd("`r", "`n") + $newline + ($missingLines -join $newline) + $newline
        }
    }
    [IO.File]::WriteAllText($Path, $content, [Text.UTF8Encoding]::new($false))
}

function Invoke-OrcaGit {
    param([string]$WorkingDirectory, [string[]]$Arguments)
    $result = Invoke-OrcaNativeProcess -Executable 'git' -Arguments $Arguments -WorkingDirectory $WorkingDirectory -StandardInput $null
    if ($result.exitCode -ne 0) { throw "git $($Arguments -join ' ') failed: $($result.stderr)" }
    return $result
}

function Initialize-OrcaTaskWorktree {
    param([string]$RepoRoot, $Task, [string]$RunRoot, [hashtable]$State)
    $branch = (Invoke-OrcaGit $RepoRoot @('branch', '--show-current')).stdout.Trim()
    if ($branch -ne 'main') { throw "Actual runs must start from main; current branch is $branch." }
    $dirty = (Invoke-OrcaGit $RepoRoot @('status', '--porcelain')).stdout
    if ($dirty) { throw 'Main worktree must be clean before preparing a task.' }

    $slug = ConvertTo-OrcaSlug $Task.Title
    $name = "$($Task.Id.ToLowerInvariant())-$slug"
    if ($name.Length -gt 64) { $name = $name.Substring(0, 64).TrimEnd('-') }
    $targetBranch = "task/$($Task.Id.ToLowerInvariant())-$slug"
    $State.preparation = @{ name = $name; branch = $targetBranch }
    Save-OrcaRunState $RunRoot $State

    $worktree = $null
    $listResult = Invoke-OrcaNativeProcess -Executable 'orca' -Arguments @('worktree', 'list', '--repo', "path:$RepoRoot", '--json') -WorkingDirectory $RepoRoot -StandardInput $null
    if ($listResult.exitCode -eq 0) {
        $existing = @(($listResult.stdout | ConvertFrom-Json).result.worktrees | Where-Object {
            $_.displayName -eq $name -or $_.branch -eq "refs/heads/$targetBranch"
        })
        if ($existing.Count -gt 1) { throw "Multiple Orca worktrees match $name; manual product decision is required." }
        if ($existing.Count -eq 1) { $worktree = $existing[0] }
    }
    if (-not $worktree) {
        $orcaResult = Invoke-OrcaNativeProcess -Executable 'orca' -Arguments @('worktree', 'create', '--repo', "path:$RepoRoot", '--name', $name, '--base-branch', 'main', '--no-parent', '--setup', 'skip', '--comment', "$($Task.Id): executing", '--json') -WorkingDirectory $RepoRoot -StandardInput $null
        if ($orcaResult.exitCode -ne 0) { throw "Orca worktree creation failed: $($orcaResult.stderr)" }
        $worktree = ($orcaResult.stdout | ConvertFrom-Json).result.worktree
    }
    $currentBranch = (Invoke-OrcaGit $worktree.path @('branch', '--show-current')).stdout.Trim()
    if ($currentBranch -ne $targetBranch) { Invoke-OrcaGit $worktree.path @('branch', '-m', $targetBranch) | Out-Null }

    $sourceRelative = $Task.RelativePath.Replace('/', [IO.Path]::DirectorySeparatorChar)
    $source = Join-Path $worktree.path $sourceRelative
    $destinationDirectory = Join-Path $worktree.path 'tasks/active'
    [IO.Directory]::CreateDirectory($destinationDirectory) | Out-Null
    $destination = Join-Path $destinationDirectory ([IO.Path]::GetFileName($source))
    if (Test-Path -LiteralPath $source -PathType Leaf) {
        Set-OrcaTaskStatusFile $source 'active'
        Move-Item -LiteralPath $source -Destination $destination
    }
    elseif (-not (Test-Path -LiteralPath $destination -PathType Leaf)) {
        throw "Neither ready nor active task file exists in worktree $($worktree.path)."
    }

    $State.worktree = @{ id = $worktree.id; path = $worktree.path; branch = $targetBranch }
    $State.taskFile = [IO.Path]::GetRelativePath($worktree.path, $destination).Replace('\', '/')
    $writerLock = Join-Path (Join-Path $worktree.path '.orca') 'writer.lock'
    Acquire-OrcaLock $writerLock $Task.Id
    $State.writerLock = $writerLock
    Set-OrcaTaskExecutionMetadata $destination $State
    Save-OrcaRunState $RunRoot $State
    Write-OrcaRunEvent $RunRoot 'worktree-created' @{ id = $worktree.id; path = $worktree.path; branch = $targetBranch }
}

function Complete-OrcaCommitAndMerge {
    param([string]$RepoRoot, $Task, [string]$RunRoot, [hashtable]$State)
    $worktree = [string]$State.worktree.path
    $doneDirectory = Join-Path $worktree 'tasks/done'
    [IO.Directory]::CreateDirectory($doneDirectory) | Out-Null
    $taskName = [IO.Path]::GetFileName($Task.FilePath)
    $readyFile = Join-Path (Join-Path $worktree 'tasks/ready') $taskName
    $activeFile = Join-Path (Join-Path $worktree 'tasks/active') $taskName
    $doneFile = Join-Path $doneDirectory $taskName
    $sourceFile = if (Test-Path -LiteralPath $activeFile -PathType Leaf) {
        $activeFile
    }
    elseif (Test-Path -LiteralPath $readyFile -PathType Leaf) {
        $readyFile
    }
    else { $null }
    if ($sourceFile) {
        Set-OrcaTaskStatusFile $sourceFile 'done'
        Set-OrcaTaskEvidence $sourceFile
        Move-Item -LiteralPath $sourceFile -Destination $doneFile
    }
    elseif (-not (Test-Path -LiteralPath $doneFile -PathType Leaf)) {
        throw "Neither active nor done task file exists in worktree $worktree."
    }
    if ((Invoke-OrcaGit $worktree @('status', '--porcelain')).stdout) {
        Invoke-OrcaGit $worktree @('add', '--all') | Out-Null
        Invoke-OrcaGit $worktree @('diff', '--cached', '--check') | Out-Null
        Invoke-OrcaGit $worktree @('commit', '-m', "task($($Task.Id)): $($Task.Title)") | Out-Null
    }
    Set-OrcaRunTransition $RunRoot $State 'merging'
    Complete-OrcaMerge $RepoRoot $Task $RunRoot $State
}

function Complete-OrcaMerge {
    param([string]$RepoRoot, $Task, [string]$RunRoot, [hashtable]$State)
    $integrationMode = if ($State.ContainsKey('integrationMode')) { [string]$State.integrationMode } else { 'main-worktree' }
    if ($integrationMode -eq 'main-worktree') {
        $mainBranch = (Invoke-OrcaGit $RepoRoot @('branch', '--show-current')).stdout.Trim()
        if ($mainBranch -ne 'main') { throw "Merge requires main checkout; found $mainBranch." }
        if ((Invoke-OrcaGit $RepoRoot @('status', '--porcelain')).stdout) { throw 'Merge requires a clean main worktree.' }
    }
    elseif ($integrationMode -eq 'update-ref') {
        $integration = Get-OrcaIntegrationTarget $RepoRoot
        if ($integration.mode -ne 'update-ref') {
            throw 'Branch main became checked out while adoption was running; resume from its clean worktree.'
        }
    }
    else { throw "Unknown integration mode: $integrationMode" }

    $taskHead = (Invoke-OrcaGit $RepoRoot @('rev-parse', [string]$State.worktree.branch)).stdout.Trim()
    $mainHead = (Invoke-OrcaGit $RepoRoot @('rev-parse', 'main')).stdout.Trim()
    if ($mainHead -ne $taskHead) {
        $mainIsAncestor = Invoke-OrcaNativeProcess -Executable 'git' -Arguments @('merge-base', '--is-ancestor', 'main', [string]$State.worktree.branch) -WorkingDirectory $RepoRoot -StandardInput $null
        $taskIsAncestor = Invoke-OrcaNativeProcess -Executable 'git' -Arguments @('merge-base', '--is-ancestor', [string]$State.worktree.branch, 'main') -WorkingDirectory $RepoRoot -StandardInput $null
        if ($mainIsAncestor.exitCode -eq 0) {
            if ($integrationMode -eq 'main-worktree') {
                Invoke-OrcaGit $RepoRoot @('merge', '--ff-only', [string]$State.worktree.branch) | Out-Null
            }
            else {
                Invoke-OrcaGit $RepoRoot @('update-ref', 'refs/heads/main', $taskHead, $mainHead) | Out-Null
            }
        }
        elseif ($taskIsAncestor.exitCode -ne 0) {
            $State.halted = $true
            $State.haltReason = 'merge-conflict'
            Save-OrcaRunState $RunRoot $State
            throw 'Fast-forward integration is not possible; main diverged from the task branch.'
        }
    }
    $orcaResult = Invoke-OrcaNativeProcess -Executable 'orca' -Arguments @('worktree', 'set', '--worktree', "id:$($State.worktree.id)", '--comment', "$($Task.Id): done", '--workspace-status', 'completed', '--json') -WorkingDirectory $RepoRoot -StandardInput $null
    if ($orcaResult.exitCode -ne 0) { throw "Orca metadata update failed: $($orcaResult.stderr)" }
    Set-OrcaRunTransition $RunRoot $State 'done'
}

function New-OrcaDryRun {
    param([Parameter(Mandatory)][string]$RepoRoot, [Parameter(Mandatory)][string]$TaskId)
    $task = Read-OrcaTask $RepoRoot $TaskId
    $roles = Get-OrcaRoles $task
    $worktree = '<TASK_WORKTREE>'
    $prompts = New-OrcaPrompts $RepoRoot $task $roles $worktree '<REVIEW_FINDINGS>'
    $catalog = Get-OrcaAdapterCatalog
    $agentPlans = foreach ($adapter in $catalog) {
        $role = @($roles.Keys | Where-Object { $roles[$_] -eq $adapter.Id }) -join ','
        $samplePrompt = if ($role) { $prompts[$role.Split(',')[0]] } else { $prompts.writer }
        $samplePath = "<RUN_DIR>\prompts\$($adapter.Id).txt"
        $primaryRole = if ($role) { $role.Split(',')[0] } else { 'writer' }
        $invocation = New-OrcaAgentInvocation -AgentId $adapter.Id -WorkingDirectory $worktree -Prompt $samplePrompt -PromptPath $samplePath -RunDirectory '<RUN_DIR>' -SessionId $null -Role $primaryRole
        $arguments = @($invocation.Arguments | ForEach-Object { if ($_ -eq $samplePrompt) { '<PROMPT>' } else { $_ } })
        [ordered]@{
            id = $adapter.Id
            displayName = $adapter.DisplayName
            assignedRoles = if ($role) { @($role.Split(',')) } else { @() }
            available = $null -ne (Get-Command $adapter.Executable -ErrorAction SilentlyContinue)
            executable = $adapter.Executable
            arguments = $arguments
            input = if ($null -ne $invocation.StandardInput) { '<PROMPT via stdin>' } else { '<prompt via verified CLI argument/file>' }
            supportsResume = $adapter.SupportsResume
        }
    }

    [ordered]@{
        success = $true
        command = 'dry-run'
        task = [ordered]@{ id = $task.Id; title = $task.Title; kind = $task.Kind; source = $task.RelativePath }
        preflight = Get-OrcaPreflight $RepoRoot
        roles = $roles
        adapters = @($agentPlans)
        prompts = $prompts
        validationCommands = @($task.ValidationCommands)
        stateTransitions = @($script:StateOrder)
        correctionPolicy = [ordered]@{ maximumCycles = 2; findingsReturnToOriginalWriter = $true }
        gitActions = @(
            'verify clean main',
            'orca worktree create --base-branch main --no-parent',
            'rename branch to task/<id>-<slug>',
            'move task ready -> active',
            'stage and commit only after approvals',
            'move task active -> done',
            'git merge --ff-only into main'
        )
        stopConditions = @('product-decision', 'adr-acceptance', 'destructive-action', 'merge-conflict', 'two-failed-corrections', 'contradictory-requirements')
        mutationsPerformed = $false
    }
}

function Invoke-OrcaRun {
    param([string]$RepoRoot, [string]$TaskId, [switch]$Autonomous, [switch]$Resume, [switch]$Adopt)
    if ($Adopt -and -not $Autonomous) { throw 'adopt requires -Autonomous.' }
    if (-not $Autonomous -and -not $Resume) { throw 'run requires -Autonomous. Use dry-run for inspection.' }

    $runRoot = Get-OrcaRunRoot $RepoRoot $TaskId
    $runLock = Join-Path (Join-Path (Join-Path $RepoRoot '.orca') 'locks') "$TaskId.lock"
    $state = Read-OrcaRunState $runRoot
    if ($Adopt) {
        Find-OrcaAdoptableTaskFile -RepoRoot $RepoRoot -TaskId $TaskId | Out-Null
        if ($state) { throw "Task $TaskId is already managed; use resume instead of adopt." }
    }
    elseif (-not $Resume -and $state) {
        throw "A persisted run already exists for $TaskId; use resume."
    }
    elseif ($Resume -and -not $state) {
        $unmanagedTask = Find-OrcaAdoptableTaskFile -RepoRoot $RepoRoot -TaskId $TaskId -AllowMissing
        if ($unmanagedTask) {
            throw "Task $TaskId is unmanaged; run .\orca.ps1 adopt $TaskId -Autonomous before resume."
        }
        throw "No persisted run exists for $TaskId."
    }

    $task = Read-OrcaTask $RepoRoot $TaskId
    if (-not $Adopt -and -not $Resume -and $task.Status -ne 'ready') { throw "Task $TaskId must be ready; found $($task.Status)." }
    $roles = Get-OrcaRoles $task
    $adoptionContext = if ($Adopt) { Resolve-OrcaAdoptionContext $RepoRoot $task } else { $null }
    $preflight = Get-OrcaPreflight $RepoRoot
    if (-not $preflight.success) { throw "Preflight failed: $($preflight.failures.name -join ', ')" }
    Acquire-OrcaLock $runLock $TaskId

    try {
        $state = Read-OrcaRunState $runRoot
        if ($Adopt) {
            if ($state) { throw "Task $TaskId became managed while adoption was starting; use resume." }
            $state = New-OrcaAdoptedState -RepoRoot $RepoRoot -TaskId $TaskId -Task $task -Roles $roles -Context $adoptionContext
            Acquire-OrcaLock ([string]$state.writerLock) $TaskId
            Save-OrcaRunState $runRoot $state
            Write-OrcaRunEvent $runRoot 'task-adopted' @{
                taskId = $TaskId
                taskFile = $task.RelativePath
                priorStatus = $task.Status
                branch = $state.worktree.branch
                worktreeId = $state.worktree.id
                startsAt = 'validating'
            }
        }
        elseif (-not $state) {
            $state = New-OrcaRunState -RepoRoot $RepoRoot -TaskId $TaskId -Task $task -Roles $roles
            Save-OrcaRunState $runRoot $state
            Write-OrcaRunEvent $runRoot 'run-created' @{ taskId = $TaskId; roles = $roles }
        }
        if ($state.halted) {
            $legacyReviewParserFailure = $Resume -and $state.state -eq 'reviewing' -and $state.haltReason -eq 'contradictory-requirements-or-review-block'
            $recoverableIntegratorFailure = $Resume -and $state.state -eq 'approved' -and $state.haltReason -eq 'integrator-not-approved'
            if ($legacyReviewParserFailure -or $recoverableIntegratorFailure) {
                $state.halted = $false
                $state.haltReason = $null
                $state.lastError = if ($legacyReviewParserFailure) {
                    'Recovered persisted review state created by the legacy verdict parser.'
                }
                else { 'Retrying the persisted integration gate with a new session.' }
                Save-OrcaRunState $runRoot $state
                if ($recoverableIntegratorFailure) {
                    Set-OrcaRunTransition $runRoot $state 'validating'
                }
                Write-OrcaRunEvent $runRoot 'agent-gate-recovered' @{ state = $state.state; priorFailure = if ($legacyReviewParserFailure) { 'legacy-review-parser' } else { 'integrator-not-approved' }; newSession = $true }
            }
            else { throw "Run is halted: $($state.haltReason)" }
        }
        $state.stopRequested = $false
        Save-OrcaRunState $runRoot $state

        while ($state.state -ne 'done') {
            if ($state.stopRequested) { throw 'Stop requested.' }
            switch ([string]$state.state) {
                'ready' { Set-OrcaRunTransition $runRoot $state 'preparing' }
                'preparing' {
                    Initialize-OrcaTaskWorktree $RepoRoot $task $runRoot $state
                    Set-OrcaRunTransition $runRoot $state 'executing'
                }
                'executing' {
                    $worktree = [string]$state.worktree.path
                    $promptTask = Read-OrcaTask $worktree $TaskId
                    $findings = [string]$state.lastFindings
                    $prompts = New-OrcaPrompts $worktree $promptTask $roles $worktree $findings
                    $prompt = if ($state.correctionCount -gt 0) { $prompts.correction } else { $prompts.writer }
                    $session = if ($state.sessions[$roles.writer]) { [string]$state.sessions[$roles.writer] } else { $null }
                    $result = Invoke-OrcaAgent $roles.writer 'writer' $prompt $worktree $runRoot $state $session
                    if ($state.stopRequested) { throw 'Stop requested.' }
                    if ($result.exitCode -ne 0) {
                        if ($state.correctionCount -ge 2) {
                            $state.halted = $true; $state.haltReason = 'two-failed-corrections'; Save-OrcaRunState $runRoot $state
                            throw "Writer exited with code $($result.exitCode) after the maximum correction cycles."
                        }
                        $state.correctionCount++
                        $state.lastFindings = "Writer CLI exited with code $($result.exitCode). STDERR: $($result.stderr)"
                        Save-OrcaRunState $runRoot $state
                        Set-OrcaRunTransition $runRoot $state 'correcting'
                    }
                    else {
                        Set-OrcaRunTransition $runRoot $state 'validating'
                    }
                }
                'validating' {
                    $promptTask = Read-OrcaTask ([string]$state.worktree.path) $TaskId
                    $results = Invoke-OrcaValidations $promptTask ([string]$state.worktree.path) $runRoot $state
                    $failed = @($results | Where-Object { $_.exitCode -ne 0 })
                    if ($failed.Count -eq 0) {
                        Set-OrcaRunTransition $runRoot $state 'reviewing'
                    }
                    else {
                        if ($state.correctionCount -ge 2) {
                            $state.halted = $true; $state.haltReason = 'two-failed-corrections'; Save-OrcaRunState $runRoot $state
                            throw 'Maximum correction cycles reached.'
                        }
                        $state.correctionCount++
                        $state.lastFindings = ($failed | ConvertTo-Json -Depth 10)
                        Save-OrcaRunState $runRoot $state
                        Set-OrcaRunTransition $runRoot $state 'correcting'
                    }
                }
                'reviewing' {
                    $worktree = [string]$state.worktree.path
                    $reviewWorktree = New-OrcaReviewWorkspace $worktree $runRoot "review-$($state.correctionCount)"
                    $promptTask = Read-OrcaTask $reviewWorktree $TaskId
                    $prompts = New-OrcaPrompts $reviewWorktree $promptTask $roles $reviewWorktree
                    $reviewOutcome = Invoke-OrcaReviewerWithRetry $roles.reviewer $prompts.reviewer $reviewWorktree $runRoot $state
                    if ($state.stopRequested) { throw 'Stop requested.' }
                    if (-not $reviewOutcome.success) { throw $reviewOutcome.analysis.error }
                    $verdict = $reviewOutcome.analysis.normalized
                    Write-OrcaRunEvent $runRoot 'review-verdict' $verdict
                    if ($verdict.verdict -eq 'approved') {
                        Set-OrcaRunTransition $runRoot $state 'approved'
                    }
                    elseif ($verdict.verdict -eq 'changes_requested') {
                        if ($state.correctionCount -ge 2) {
                            $state.halted = $true; $state.haltReason = 'two-failed-corrections'; Save-OrcaRunState $runRoot $state
                            throw 'Maximum correction cycles reached.'
                        }
                        $state.correctionCount++
                        $state.lastFindings = ($verdict.findings | ConvertTo-Json -Depth 10)
                        Save-OrcaRunState $runRoot $state
                        Set-OrcaRunTransition $runRoot $state 'correcting'
                    }
                }
                'review_failed' { Set-OrcaRunTransition $runRoot $state 'reviewing' }
                'paused-agent-error' { Set-OrcaRunTransition $runRoot $state 'reviewing' }
                'correcting' { Set-OrcaRunTransition $runRoot $state 'executing' }
                'approved' {
                    if ($task.Kind -eq 'adr') {
                        $state.halted = $true; $state.haltReason = 'adr-acceptance-required'; Save-OrcaRunState $runRoot $state
                        throw 'ADR acceptance requires Product Owner action.'
                    }
                    $worktree = [string]$state.worktree.path
                    $integrationWorktree = New-OrcaReviewWorkspace $worktree $runRoot "integration-$($state.correctionCount)"
                    $promptTask = Read-OrcaTask $integrationWorktree $TaskId
                    $prompts = New-OrcaPrompts $integrationWorktree $promptTask $roles $integrationWorktree
                    $integrationAttempt = if ($state.ContainsKey('integrationAttemptCount')) { [int]$state.integrationAttemptCount + 1 } else { 1 }
                    $state.integrationAttemptCount = $integrationAttempt
                    Save-OrcaRunState $runRoot $state
                    $result = Invoke-OrcaAgent $roles.integrator 'integrator' $prompts.integrator $integrationWorktree $runRoot $state $null
                    if ($state.stopRequested) { throw 'Stop requested.' }
                    $analysis = if ($result.exitCode -eq 0) {
                        ConvertFrom-OrcaReviewOutput ([string]$result.stdout)
                    }
                    else { [ordered]@{ success = $false; normalized = $null; error = "Integrator exited with code $($result.exitCode)." } }
                    $integrationLog = Save-OrcaReviewAttempt -RunRoot $runRoot -Role 'integrator' -Attempt $integrationAttempt -ProcessResult $result -Analysis $analysis
                    $state.lastAgentLog = $integrationLog
                    $state.lastIntegrationLog = $integrationLog
                    $state.lastIntegrationJson = $analysis.normalized
                    Write-OrcaRunEvent $runRoot 'integration-verdict-recorded' @{ logPath = $integrationLog; normalizedJson = $analysis.normalized; parseError = $analysis.error }
                    $verdict = $analysis.normalized
                    if (-not $analysis.success -or $verdict.verdict -ne 'approved') {
                        $state.lastError = if ($analysis.error) { $analysis.error } else { [string]$verdict.summary }
                        $state.halted = $true; $state.haltReason = 'integrator-not-approved'; Save-OrcaRunState $runRoot $state
                        $integrationError = if ($analysis.error) { $analysis.error } else { 'Integrator did not approve the task.' }
                        throw $integrationError
                    }
                    $state.lastError = $null
                    Save-OrcaRunState $runRoot $state
                    Set-OrcaRunTransition $runRoot $state 'committing'
                }
                'committing' {
                    $integrationRoot = if ($state.ContainsKey('integrationRoot')) { [string]$state.integrationRoot } else { $RepoRoot }
                    Complete-OrcaCommitAndMerge $integrationRoot $task $runRoot $state
                }
                'merging' {
                    $integrationRoot = if ($state.ContainsKey('integrationRoot')) { [string]$state.integrationRoot } else { $RepoRoot }
                    Complete-OrcaMerge $integrationRoot $task $runRoot $state
                }
                default { throw "Unsupported run state: $($state.state)" }
            }
        }
    }
    catch {
        Write-OrcaRunEvent $runRoot 'run-stopped' @{ state = if ($state) { $state.state } else { $null }; reason = $_.Exception.Message; haltReason = if ($state) { $state.haltReason } else { $null } }
        throw
    }
    finally {
        Release-OrcaLock $runLock
        if ($state -and $state.state -eq 'done' -and $state.writerLock) { Release-OrcaLock ([string]$state.writerLock) }
    }

    $resultCommand = if ($Adopt) { 'adopt' } elseif ($Resume) { 'resume' } else { 'run' }
    [ordered]@{ success = $true; command = $resultCommand; taskId = $TaskId; state = $state }
}

function Get-OrcaRunStatus {
    param([string]$RepoRoot, [string]$TaskId)
    if ($TaskId) {
        $state = Read-OrcaRunState (Get-OrcaRunRoot $RepoRoot $TaskId)
        if ($state) {
            $lastError = if ($state.ContainsKey('lastError') -and $state.lastError) {
                $state.lastError
            }
            elseif ($state.halted -and $state.haltReason) { "Run halted: $($state.haltReason)" }
            else { $null }
            $logPath = if ($state.ContainsKey('lastAgentLog') -and $state.lastAgentLog) {
                $state.lastAgentLog
            }
            elseif ($state.ContainsKey('lastReviewLog') -and $state.lastReviewLog) {
                $state.lastReviewLog
            }
            else {
                $eventsPath = Join-Path (Get-OrcaRunRoot $RepoRoot $TaskId) 'events.jsonl'
                if (Test-Path -LiteralPath $eventsPath -PathType Leaf) { $eventsPath } else { $null }
            }
            return [ordered]@{
                success = $true
                command = 'status'
                taskId = $TaskId
                state = $state
                lastError = $lastError
                logPath = $logPath
                adoptable = $false
            }
        }
        $taskFile = Find-OrcaAdoptableTaskFile -RepoRoot $RepoRoot -TaskId $TaskId -AllowMissing
        if ($taskFile) {
            return [ordered]@{
                success = $true
                command = 'status'
                taskId = $TaskId
                state = 'unmanaged'
                adoptable = $true
                taskFile = [IO.Path]::GetRelativePath($RepoRoot, $taskFile.FullName).Replace('\', '/')
            }
        }
        return [ordered]@{ success = $false; command = 'status'; taskId = $TaskId; state = $null; adoptable = $false }
    }
    $root = Join-Path (Join-Path $RepoRoot '.orca') 'runs'
    $states = if (Test-Path -LiteralPath $root) {
        @(Get-ChildItem -LiteralPath $root -Directory | ForEach-Object { Read-OrcaRunState $_.FullName } | Where-Object { $null -ne $_ })
    }
    else { @() }
    [ordered]@{ success = $true; command = 'status'; runs = @($states) }
}

function Get-OrcaRunLogs {
    param([string]$RepoRoot, [string]$TaskId)
    $path = Join-Path (Get-OrcaRunRoot $RepoRoot $TaskId) 'events.jsonl'
    $events = if (Test-Path -LiteralPath $path) { @(Get-Content -LiteralPath $path | ForEach-Object { $_ | ConvertFrom-Json }) } else { @() }
    [ordered]@{ success = $true; command = 'logs'; taskId = $TaskId; path = $path; events = @($events) }
}

function Stop-OrcaRun {
    param([string]$RepoRoot, [string]$TaskId)
    $runRoot = Get-OrcaRunRoot $RepoRoot $TaskId
    $state = Read-OrcaRunState $runRoot
    if (-not $state) { throw "No persisted run exists for $TaskId." }
    $state.stopRequested = $true
    $state.stoppedAt = [DateTimeOffset]::UtcNow.ToString('o')
    if ($state.currentProcess -and $state.currentProcess.processId) {
        $process = Get-Process -Id $state.currentProcess.processId -ErrorAction SilentlyContinue
        if ($process) { Stop-Process -Id $process.Id }
    }
    Save-OrcaRunState $runRoot $state
    Write-OrcaRunEvent $runRoot 'stop-requested' @{ taskId = $TaskId }
    [ordered]@{ success = $true; command = 'stop'; taskId = $TaskId; state = $state.state; workPreserved = $true }
}

function Invoke-OrcaPipelineCommand {
    param(
        [Parameter(Mandatory)][string]$Command,
        [string]$TaskId,
        [switch]$Autonomous,
        [Parameter(Mandatory)][string]$RepoRoot
    )

    switch ($Command) {
        'preflight' { return Get-OrcaPreflight $RepoRoot }
        'dry-run' {
            if (-not $TaskId) { throw 'dry-run requires TASK-ID.' }
            return New-OrcaDryRun $RepoRoot $TaskId
        }
        'run' {
            if (-not $TaskId) { throw 'run requires TASK-ID.' }
            return Invoke-OrcaRun $RepoRoot $TaskId -Autonomous:$Autonomous
        }
        'adopt' {
            if (-not $TaskId) { throw 'adopt requires TASK-ID.' }
            return Invoke-OrcaRun $RepoRoot $TaskId -Autonomous:$Autonomous -Adopt
        }
        'resume' {
            if (-not $TaskId) { throw 'resume requires TASK-ID.' }
            return Invoke-OrcaRun $RepoRoot $TaskId -Autonomous -Resume
        }
        'status' { return Get-OrcaRunStatus $RepoRoot $TaskId }
        'logs' {
            if (-not $TaskId) { throw 'logs requires TASK-ID.' }
            return Get-OrcaRunLogs $RepoRoot $TaskId
        }
        'stop' {
            if (-not $TaskId) { throw 'stop requires TASK-ID.' }
            return Stop-OrcaRun $RepoRoot $TaskId
        }
        default { throw "Unknown command: $Command" }
    }
}

Export-ModuleMember -Function @(
    'Invoke-OrcaPipelineCommand',
    'Get-OrcaStateOrder',
    'Test-OrcaStateTransition',
    'Expand-OrcaPromptTemplate',
    'Read-OrcaTask',
    'New-OrcaDryRun',
    'Get-OrcaRoles'
)
