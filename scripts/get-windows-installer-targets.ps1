function Get-NextWindowsInstallerTargets {
  param(
    [Parameter(Mandatory = $true)]
    [string]$RootPath,
    [ValidateSet("all", "msi", "nsis")]
    [string]$Bundles = "all"
  )

  # Product name/version must come from the same metadata Tauri bundles with.
  # Keep the binary/application identifier separate for upgrade compatibility.
  $config = Get-Content -LiteralPath (Join-Path $RootPath "src-tauri\tauri.conf.json") -Raw | ConvertFrom-Json
  $baseName = "$($config.productName)_$($config.version)_x64"
  $targets = @(
    [pscustomobject]@{
      kind = "nsis"
      path = Join-Path $RootPath "src-tauri\target\release\bundle\nsis\$baseName-setup.exe"
    },
    [pscustomobject]@{
      kind = "msi"
      path = Join-Path $RootPath "src-tauri\target\release\bundle\msi\$($baseName)_en-US.msi"
    }
  )

  return @($targets | Where-Object { $Bundles -eq "all" -or $_.kind -eq $Bundles })
}
