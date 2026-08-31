const { spawn } = require('child_process');
const { clipboard } = require('electron');

const PS = String.raw`
param([string]$Payload)
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class NativeInput {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, int data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] public static extern short VkKeyScan(char ch);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
"@
[NativeInput]::SetProcessDPIAware() | Out-Null
$p = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Payload)) | ConvertFrom-Json
$DOWN=0x0002; $UP=0x0004; $RIGHTDOWN=0x0008; $RIGHTUP=0x0010; $MIDDLEDOWN=0x0020; $MIDDLEUP=0x0040; $WHEEL=0x0800; $HWHEEL=0x01000
function Move([int]$x,[int]$y){ [NativeInput]::SetCursorPos($x,$y) | Out-Null }
function Mouse([uint32]$a,[int]$d=0){ [NativeInput]::mouse_event($a,0,0,$d,[UIntPtr]::Zero) }
function Click([string]$button,[int]$count){
  $d=$DOWN; $u=$UP
  if($button -eq 'right'){ $d=$RIGHTDOWN; $u=$RIGHTUP }
  if($button -eq 'middle'){ $d=$MIDDLEDOWN; $u=$MIDDLEUP }
  for($i=0;$i -lt $count;$i++){ Mouse $d; Start-Sleep -Milliseconds 45; Mouse $u; if($i+1 -lt $count){Start-Sleep -Milliseconds 80} }
}
$vkMap = @{ 'ctrl'=0x11; 'control'=0x11; 'shift'=0x10; 'alt'=0x12; 'win'=0x5B; 'windows'=0x5B; 'enter'=0x0D; 'return'=0x0D; 'tab'=0x09; 'escape'=0x1B; 'esc'=0x1B; 'space'=0x20; 'backspace'=0x08; 'delete'=0x2E; 'insert'=0x2D; 'home'=0x24; 'end'=0x23; 'pageup'=0x21; 'pagedown'=0x22; 'up'=0x26; 'down'=0x28; 'left'=0x25; 'right'=0x27; 'f1'=0x70; 'f2'=0x71; 'f3'=0x72; 'f4'=0x73; 'f5'=0x74; 'f6'=0x75; 'f7'=0x76; 'f8'=0x77; 'f9'=0x78; 'f10'=0x79; 'f11'=0x7A; 'f12'=0x7B }
function VK([string]$k){
  $n=$k.ToLower()
  if($vkMap.ContainsKey($n)){ return [byte]$vkMap[$n] }
  if($n.Length -eq 1){ return [byte]([NativeInput]::VkKeyScan($n[0]) -band 0xff) }
  throw "Unsupported key: $k"
}
function KeyDown([byte]$vk){ [NativeInput]::keybd_event($vk,0,0,[UIntPtr]::Zero) }
function KeyUp([byte]$vk){ [NativeInput]::keybd_event($vk,0,2,[UIntPtr]::Zero) }
function Combo([string]$combo,[int]$holdMs=50){
  $parts=$combo -split '\+'
  $vks=@(); foreach($part in $parts){ $vks += ,(VK $part) }
  foreach($v in $vks){ KeyDown $v; Start-Sleep -Milliseconds 20 }
  Start-Sleep -Milliseconds $holdMs
  [array]::Reverse($vks); foreach($v in $vks){ KeyUp $v; Start-Sleep -Milliseconds 20 }
}

switch($p.action){
  'move' { Move $p.x $p.y }
  'click' { Move $p.x $p.y; Click $p.button ([int]$p.count) }
  'down' { Move $p.x $p.y; if($p.button -eq 'left'){Mouse $DOWN} elseif($p.button -eq 'right'){Mouse $RIGHTDOWN}else{Mouse $MIDDLEDOWN} }
  'up' { Move $p.x $p.y; if($p.button -eq 'left'){Mouse $UP} elseif($p.button -eq 'right'){Mouse $RIGHTUP}else{Mouse $MIDDLEUP} }
  'drag' { Move $p.x1 $p.y1; Mouse $DOWN; Start-Sleep -Milliseconds 100; $steps=18; for($i=1;$i -le $steps;$i++){ $x=[int]($p.x1 + (($p.x2-$p.x1)*$i/$steps)); $y=[int]($p.y1 + (($p.y2-$p.y1)*$i/$steps)); Move $x $y; Start-Sleep -Milliseconds 18 }; Mouse $UP }
  'scroll' { Move $p.x $p.y; $amount=[int]$p.amount; if($p.direction -eq 'down'){$amount=-[math]::Abs($amount)} elseif($p.direction -eq 'up'){$amount=[math]::Abs($amount)}; if($p.direction -eq 'left'){$amount=-[math]::Abs($amount); [NativeInput]::mouse_event($HWHEEL,0,0,$amount,[UIntPtr]::Zero)} elseif($p.direction -eq 'right'){$amount=[math]::Abs($amount); [NativeInput]::mouse_event($HWHEEL,0,0,$amount,[UIntPtr]::Zero)} else {[NativeInput]::mouse_event($WHEEL,0,0,$amount,[UIntPtr]::Zero)} }
  'key' { Combo $p.key 50 }
  'hold_key' { Combo $p.key ([int]([double]$p.duration*1000)) }
  default { throw "Unknown action $($p.action)" }
}
`;

function runPowerShell(payload) {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') return reject(new Error('Desktop actions are implemented for Windows only.'));
    const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
    const child = spawn('powershell.exe', ['-NoProfile','-STA','-ExecutionPolicy','Bypass','-Command', PS, '-Payload', encoded], { windowsHide: true });
    let err = '';
    child.stderr.on('data', d => err += d.toString());
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(err || `PowerShell exited ${code}`)));
  });
}

async function pasteText(text) {
  await clipboard.writeText(text);
  await runPowerShell({ action: 'key', key: 'ctrl+v' });
}

module.exports = { runPowerShell, pasteText };
