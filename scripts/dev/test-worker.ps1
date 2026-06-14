$ErrorActionPreference = "Stop"

function Resolve-Python {
    if ($env:PYTHON -and (Test-Path -LiteralPath $env:PYTHON)) {
        return $env:PYTHON
    }

    $command = Get-Command python.exe -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($command -and $command.Source -and (Test-Path -LiteralPath $command.Source)) {
        return $command.Source
    }

    $codexPython = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
    if (Test-Path -LiteralPath $codexPython) {
        return $codexPython
    }

    throw "Python executable not found. Set the PYTHON environment variable to an absolute python.exe path."
}

$python = Resolve-Python
$env:PYTHONPATH = Join-Path (Get-Location) "workers\document_worker\src"
& $python -m unittest discover workers/document_worker/tests
