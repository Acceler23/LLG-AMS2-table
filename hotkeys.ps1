# Hotkeys globais — funciona com o jogo em foco
# , . = coluna | [ ] = pagina | P = destaque
# Se o AMS2 estiver como Admin, rode este script tambem como Admin.

$ErrorActionPreference = "Continue"
$cmdUrl = "http://127.0.0.1:8080/command"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @"
using System;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Windows.Forms;

public class KbHook {
  private const int WH_KEYBOARD_LL = 13;
  private const int WM_KEYDOWN = 0x0100;
  private const int WM_SYSKEYDOWN = 0x0104;

  public delegate IntPtr HookProc(int nCode, IntPtr wParam, IntPtr lParam);
  public static ConcurrentQueue<int> Queue = new ConcurrentQueue<int>();

  private static IntPtr _hook = IntPtr.Zero;
  private static HookProc _proc = HookCallback;
  private static int _lastVk = -1;
  private static int _lastTick = 0;

  [DllImport("user32.dll", SetLastError = true)]
  static extern IntPtr SetWindowsHookEx(int id, HookProc lpfn, IntPtr hMod, uint thread);
  [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr hhk);
  [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);
  [DllImport("kernel32.dll")] static extern IntPtr GetModuleHandle(string name);

  [StructLayout(LayoutKind.Sequential)]
  struct KBDLLHOOKSTRUCT {
    public uint vkCode;
    public uint scanCode;
    public uint flags;
    public uint time;
    public IntPtr dwExtraInfo;
  }

  public static void Start() {
    using (Process cur = Process.GetCurrentProcess())
    using (ProcessModule mod = cur.MainModule) {
      _hook = SetWindowsHookEx(WH_KEYBOARD_LL, _proc, GetModuleHandle(mod.ModuleName), 0);
    }
    if (_hook == IntPtr.Zero)
      throw new Exception("Falha ao instalar hook (erro " + Marshal.GetLastWin32Error() + "). Rode como Administrador.");
  }

  public static void Stop() {
    if (_hook != IntPtr.Zero) UnhookWindowsHookEx(_hook);
    _hook = IntPtr.Zero;
  }

  static IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam) {
    if (nCode >= 0 && (wParam == (IntPtr)WM_KEYDOWN || wParam == (IntPtr)WM_SYSKEYDOWN)) {
      KBDLLHOOKSTRUCT info = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));
      int vk = (int)info.vkCode;
      int now = Environment.TickCount;
      if (vk != _lastVk || (now - _lastTick) > 200) {
        _lastVk = vk;
        _lastTick = now;
        if (vk == 0xBC || vk == 0xBE || vk == 0xDB || vk == 0xDD || vk == 0x50)
          Queue.Enqueue(vk);
      }
    }
    return CallNextHookEx(_hook, nCode, wParam, lParam);
  }
}

public class PumpForm : Form {
  public Timer Timer;
  public PumpForm() {
    ShowInTaskbar = false;
    WindowState = FormWindowState.Minimized;
    Opacity = 0;
    FormBorderStyle = FormBorderStyle.FixedToolWindow;
    Timer = new Timer();
    Timer.Interval = 50;
  }
  protected override void SetVisibleCore(bool value) {
    base.SetVisibleCore(false);
  }
}
"@ -ReferencedAssemblies System.Windows.Forms

function Send-Cmd([string]$name) {
  try {
    $body = "{`"name`":`"$name`"}"
    $req = [System.Net.HttpWebRequest]::Create($cmdUrl)
    $req.Method = "POST"
    $req.ContentType = "application/json"
    $req.Timeout = 1500
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
    $req.ContentLength = $bytes.Length
    $s = $req.GetRequestStream()
    $s.Write($bytes, 0, $bytes.Length)
    $s.Close()
    $r = $req.GetResponse()
    $r.Close()
    return $true
  } catch {
    Write-Host ("Falha " + $name + ": " + $_.Exception.Message)
    return $false
  }
}

try {
  [KbHook]::Start()
  Write-Host "Hook OK. Teclas: , . [ ] P"
  Write-Host "Se o jogo for Admin, rode este script como Admin."
  Write-Host "Feche a janela para sair."

  $form = New-Object PumpForm
  $form.Timer.add_Tick({
    $vk = 0
    while ([KbHook]::Queue.TryDequeue([ref]$vk)) {
      switch ($vk) {
        0xBC { if (Send-Cmd "overlay.prevColumn") { Write-Host "[,] coluna -" } }
        0xBE { if (Send-Cmd "overlay.nextColumn") { Write-Host "[.] coluna +" } }
        0xDB { if (Send-Cmd "overlay.prevPage") { Write-Host "[[] pagina -" } }
        0xDD { if (Send-Cmd "overlay.nextPage") { Write-Host "[]] pagina +" } }
        0x50 { if (Send-Cmd "overlay.toggleHighlight") { Write-Host "[P] destaque" } }
      }
    }
  })
  $form.Timer.Start()
  [System.Windows.Forms.Application]::Run($form)
} finally {
  [KbHook]::Stop()
}
