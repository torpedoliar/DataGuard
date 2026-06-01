param(
  [string]$HostName = "127.0.0.1",
  [int]$Port = 514,
  [string]$Message = "<34>May 22 10:15:30 test-host sshd: Failed password for admin from 10.10.1.25 port 22 ssh2"
)

$udp = New-Object System.Net.Sockets.UdpClient
$bytes = [Text.Encoding]::UTF8.GetBytes($Message)
[void]$udp.Send($bytes, $bytes.Length, $HostName, $Port)
$udp.Close()
Write-Host "Sent $($bytes.Length) bytes to $HostName`:$Port"
