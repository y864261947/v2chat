param(
    [string]$SecretsDirectory = ""
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if (-not $SecretsDirectory) {
    $SecretsDirectory = Join-Path (Split-Path $repoRoot -Parent) "release-secrets"
}
$SecretsDirectory = [System.IO.Path]::GetFullPath($SecretsDirectory)
$keystorePath = Join-Path $SecretsDirectory "v2chat-android-release.p12"
$credentialsPath = Join-Path $SecretsDirectory "v2chat-android-release-credentials.txt"
$propertiesPath = Join-Path $repoRoot "android\keystore.properties"
$alias = "v2chat-release"

if ((Test-Path $keystorePath) -or (Test-Path $credentialsPath)) {
    throw "Release signing material already exists. Refusing to replace the production signing identity."
}

[System.IO.Directory]::CreateDirectory($SecretsDirectory) | Out-Null
$passwordBytes = [byte[]]::new(36)
$random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try {
    $random.GetBytes($passwordBytes)
} finally {
    $random.Dispose()
}
$password = [Convert]::ToBase64String($passwordBytes).TrimEnd("=").Replace("+", "A").Replace("/", "B")

$keytool = (Get-Command keytool -ErrorAction Stop).Source
& $keytool -genkeypair `
    -keystore $keystorePath `
    -storetype PKCS12 `
    -storepass $password `
    -keypass $password `
    -alias $alias `
    -keyalg RSA `
    -keysize 4096 `
    -validity 10000 `
    -dname "CN=V2Chat, OU=Release, O=V2API, C=CN"
if ($LASTEXITCODE -ne 0) {
    throw "keytool failed with exit code $LASTEXITCODE"
}

$portableKeystorePath = $keystorePath.Replace("\", "/")
$credentials = @"
V2Chat Android release signing identity

Keystore: $keystorePath
Alias: $alias
Store password: $password
Key password: $password

Keep this file and the keystore together in at least two encrypted offline backups.
Losing this signing identity permanently prevents upgrades over installed production APKs.
"@
$properties = @"
storeFile=$portableKeystorePath
storePassword=$password
keyAlias=$alias
keyPassword=$password
"@

[System.IO.File]::WriteAllText($credentialsPath, $credentials, [System.Text.UTF8Encoding]::new($false))
[System.IO.File]::WriteAllText($propertiesPath, $properties, [System.Text.UTF8Encoding]::new($false))

Write-Host "Generated Android release keystore: $keystorePath"
Write-Host "Generated local Gradle signing config: $propertiesPath"
Write-Host "Move the release-secrets directory to encrypted offline storage after verification."
