param([int]$Port = 8000)

$root = [IO.Path]::GetFullPath($PSScriptRoot)
$server = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $Port)
$server.Server.SetSocketOption([Net.Sockets.SocketOptionLevel]::Socket, [Net.Sockets.SocketOptionName]::ReuseAddress, $true)
$server.Start(100)
Write-Host "TAMIZ RUTAS disponible en http://localhost:$Port/"

$types = @{
  ".html" = "text/html; charset=utf-8"
  ".js"   = "text/javascript; charset=utf-8"
  ".css"  = "text/css; charset=utf-8"
  ".json" = "application/json; charset=utf-8"
  ".svg"  = "image/svg+xml"
  ".png"  = "image/png"
}

try {
  while ($true) {
    $client = $server.AcceptTcpClient()
    try {
      $client.ReceiveTimeout = 1500
      $client.SendTimeout = 3000
      $stream = $client.GetStream()
      $stream.ReadTimeout = 1500
      $stream.WriteTimeout = 3000
      $reader = [IO.StreamReader]::new($stream, [Text.Encoding]::ASCII, $false, 1024, $true)
      $requestLine = $reader.ReadLine()
      if ([string]::IsNullOrWhiteSpace($requestLine)) { continue }
      while ($true) {
        $headerLine = $reader.ReadLine()
        if ([string]::IsNullOrEmpty($headerLine)) { break }
      }
      $requested = if ($requestLine -match '^GET\s+([^\s]+)') { $matches[1] } else { "/" }

      if ($requested.StartsWith("/api/geocode?")) {
        try {
          $encodedQuery = [regex]::Match($requested, '[?&]q=([^&]+)').Groups[1].Value
          $query = [Uri]::UnescapeDataString($encodedQuery)
          $clientApi = [Net.WebClient]::new()
          $clientApi.Headers.Add("User-Agent", "TAMIZ-RUTAS/1.0 local")
          $url = "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=ar&accept-language=es&q=$([Uri]::EscapeDataString($query))"
          $json = $clientApi.DownloadString($url)
          $body = [Text.Encoding]::UTF8.GetBytes($json)
          $header = "HTTP/1.1 200 OK`r`nContent-Type: application/json; charset=utf-8`r`nContent-Length: $($body.Length)`r`nCache-Control: no-store`r`nConnection: close`r`n`r`n"
        } catch {
          $body = [Text.Encoding]::UTF8.GetBytes('{"error":"No se pudo consultar Nominatim"}')
          $header = "HTTP/1.1 502 Bad Gateway`r`nContent-Type: application/json; charset=utf-8`r`nContent-Length: $($body.Length)`r`nConnection: close`r`n`r`n"
        }
        $headerBytes = [Text.Encoding]::ASCII.GetBytes($header); $stream.Write($headerBytes,0,$headerBytes.Length); $stream.Write($body,0,$body.Length); $stream.Flush(); continue
      }

      if ($requested.StartsWith("/api/route?")) {
        try {
          $encodedCoordinates = [regex]::Match($requested, '[?&]coordinates=([^&]+)').Groups[1].Value
          $coordinates = [Uri]::UnescapeDataString($encodedCoordinates)
          if ($coordinates -notmatch '^-?\d+(\.\d+)?,-?\d+(\.\d+)?(;?-?\d+(\.\d+)?,-?\d+(\.\d+)?)+$') { throw "Coordenadas inválidas" }
          $clientApi = [Net.WebClient]::new()
          $clientApi.Headers.Add("User-Agent", "TAMIZ-RUTAS/1.0 local")
          $url = "http://router.project-osrm.org/route/v1/driving/${coordinates}?overview=false&steps=false"
          $json = $clientApi.DownloadString($url)
          $body = [Text.Encoding]::UTF8.GetBytes($json)
          $header = "HTTP/1.1 200 OK`r`nContent-Type: application/json; charset=utf-8`r`nContent-Length: $($body.Length)`r`nCache-Control: no-store`r`nConnection: close`r`n`r`n"
        } catch {
          Add-Content -LiteralPath (Join-Path $root 'server-error.log') -Value "$(Get-Date -Format o) OSRM: $($_.Exception.Message)"
          $body = [Text.Encoding]::UTF8.GetBytes('{"error":"No se pudo consultar OSRM"}')
          $header = "HTTP/1.1 502 Bad Gateway`r`nContent-Type: application/json; charset=utf-8`r`nContent-Length: $($body.Length)`r`nConnection: close`r`n`r`n"
        }
        $headerBytes = [Text.Encoding]::ASCII.GetBytes($header); $stream.Write($headerBytes,0,$headerBytes.Length); $stream.Write($body,0,$body.Length); $stream.Flush(); continue
      }
      $relative = [Uri]::UnescapeDataString(($requested.Split('?')[0]).TrimStart('/'))
      if ([string]::IsNullOrWhiteSpace($relative)) { $relative = "index.html" }
      $file = [IO.Path]::GetFullPath((Join-Path $root $relative.Replace('/', [IO.Path]::DirectorySeparatorChar)))

      if ($file.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $file -PathType Leaf)) {
        $body = [IO.File]::ReadAllBytes($file)
        $type = $types[[IO.Path]::GetExtension($file).ToLowerInvariant()]
        if (-not $type) { $type = "application/octet-stream" }
        $header = "HTTP/1.1 200 OK`r`nContent-Type: $type`r`nContent-Length: $($body.Length)`r`nCache-Control: no-cache, no-store, must-revalidate`r`nConnection: close`r`n`r`n"
      } else {
        $body = [Text.Encoding]::UTF8.GetBytes("404 - Archivo no encontrado")
        $header = "HTTP/1.1 404 Not Found`r`nContent-Type: text/plain; charset=utf-8`r`nContent-Length: $($body.Length)`r`nConnection: close`r`n`r`n"
      }
      $headerBytes = [Text.Encoding]::ASCII.GetBytes($header)
      $stream.Write($headerBytes, 0, $headerBytes.Length)
      $stream.Write($body, 0, $body.Length)
      $stream.Flush()
    } catch [IO.IOException] {
      # Una conexión especulativa o abandonada no debe detener el servidor.
    } catch [Net.Sockets.SocketException] {
      # El navegador puede cerrar un socket antes de recibir la respuesta.
    } catch {
      Add-Content -LiteralPath (Join-Path $root 'server-error.log') -Value "$(Get-Date -Format o) $($_.Exception.Message)"
    } finally {
      if ($null -ne $client) { $client.Close() }
    }
  }
} finally {
  $server.Stop()
}