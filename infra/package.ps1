param(
    [string]$OutputPath = (Join-Path $PSScriptRoot 'lottery-site.zip')
)

$sitePath = Join-Path $PSScriptRoot '..\site'
$stagingPath = Join-Path ([System.IO.Path]::GetTempPath()) "lottery-site-$([guid]::NewGuid())"

try {
    New-Item -ItemType Directory -Path $stagingPath | Out-Null
    Copy-Item -Path (Join-Path $sitePath '*') -Destination $stagingPath -Recurse

    $adminPath = Join-Path $stagingPath 'admin'
    New-Item -ItemType Directory -Path $adminPath | Out-Null
    Copy-Item -Path (Join-Path $sitePath 'admin.html') -Destination (Join-Path $adminPath 'index.html')
    Copy-Item -Path (Join-Path $PSScriptRoot '..\app\server.js') -Destination (Join-Path $stagingPath 'server.js')

    $csvFiles = Get-ChildItem -Path $stagingPath -Filter '*.csv' -File -Recurse
    if ($csvFiles) {
        throw "CSV files must not be included in the deployment package: $($csvFiles.FullName -join ', ')"
    }

    if (Test-Path $OutputPath) {
        Remove-Item $OutputPath -Force
    }

    Compress-Archive -Path (Join-Path $stagingPath '*') -DestinationPath $OutputPath
    Write-Output $OutputPath
}
finally {
    if (Test-Path $stagingPath) {
        Remove-Item $stagingPath -Recurse -Force
    }
}
