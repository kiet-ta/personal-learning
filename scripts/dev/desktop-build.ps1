$ErrorActionPreference = "Stop"

$node = "C:\Program Files\nodejs\node.exe"
$npmCli = "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js"

if (-not (Test-Path -LiteralPath $node)) {
    throw "Node executable not found at $node"
}

if (-not (Test-Path -LiteralPath $npmCli)) {
    throw "npm CLI not found at $npmCli"
}

& $node $npmCli --workspace apps/desktop run build
