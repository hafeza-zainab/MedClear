param(
  [string]$OutputPath = (Join-Path (Split-Path -Parent $PSScriptRoot) "medclear-code-submission.html")
)

$projectRoot = Split-Path -Parent $PSScriptRoot
$excludedDirectories = @("node_modules", ".next", ".git", "out", "build")
$excludedFiles = @("package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml", "medclear-code-submission.html", ".env.local")
$files = Get-ChildItem -LiteralPath $projectRoot -Recurse -File | Where-Object {
  $relative = [IO.Path]::GetRelativePath($projectRoot, $_.FullName)
  $parts = $relative -split "[\\/]"
  ($parts | Where-Object { $excludedDirectories -contains $_ }).Count -eq 0 -and
  $excludedFiles -notcontains $_.Name -and
  (-not $_.Name.StartsWith(".env") -or $_.Name -eq ".env.example") -and
  $_.Extension -notin @(".pdf", ".tsbuildinfo")
} | Sort-Object FullName

$builder = [Text.StringBuilder]::new()
[void]$builder.AppendLine("<!doctype html><html lang='en'><head><meta charset='utf-8'><title>MedClear source code</title>")
[void]$builder.AppendLine("<style>body{font:14px Arial,sans-serif;color:#183a3b;margin:32px}h1{font-size:26px}h2{font-size:16px;background:#edf5f1;padding:10px;page-break-after:avoid;overflow-wrap:anywhere}pre{font:10px/1.4 Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere;border:1px solid #dce8e2;padding:12px;page-break-inside:auto}section{page-break-before:auto} @media print{body{margin:14mm}h2{page-break-after:avoid}pre{font-size:8pt}}</style></head><body>")
[void]$builder.AppendLine("<h1>MedClear — Source Code Submission</h1><p>Generated $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')</p>")

foreach ($file in $files) {
  $relative = [IO.Path]::GetRelativePath($projectRoot, $file.FullName).Replace("\", "/")
  $content = [IO.File]::ReadAllText($file.FullName, [Text.Encoding]::UTF8)
  $escapedPath = [Net.WebUtility]::HtmlEncode($relative)
  $escapedContent = [Net.WebUtility]::HtmlEncode($content)
  [void]$builder.AppendLine("<section><h2>$escapedPath</h2><pre>$escapedContent</pre></section>")
}

[void]$builder.AppendLine("</body></html>")
[IO.File]::WriteAllText($OutputPath, $builder.ToString(), [Text.UTF8Encoding]::new($false))
Write-Host "Created print-ready source bundle: $OutputPath"
Write-Host "Open it in a browser, press Ctrl+P, and choose Save as PDF."
