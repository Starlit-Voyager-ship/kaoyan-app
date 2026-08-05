# -*- coding: utf-8 -*-
"""下载 Build APK artifact (id 8920963312) 到桌面"""
import subprocess, os, sys
from pathlib import Path

TOKEN = open(r'C:\Users\yansh\WorkBuddy\考研软件\考研学习助手\.git\config').read()
import re
TOKEN = re.search(r'https://([^@]+)@github\.com', TOKEN).group(1)
URL = 'https://api.github.com/repos/Starlit-Voyager-ship/kaoyan-app/actions/artifacts/8920963312/zip'
DST = r'C:\Users\yansh\Desktop\kaoyan-study-helper-debug.apk'

# 用 PowerShell 下载到 .zip 再解压（之前下到 .apk 0字节，可能因 -OutFile 与 302 重定向冲突）
ps = f"""
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$url = '{URL}'
$zip = 'C:\\Users\\yansh\\Desktop\\_apk_dl.zip'
if (Test-Path $zip) {{ Remove-Item $zip -Force }}
$dst = '{DST}'
if (Test-Path $dst) {{ Remove-Item $dst -Force }}
# 走 GitHub token + 跟随重定向（Azure 302 后会带 SAS，不需要 Authorization）
Invoke-WebRequest -Uri $url -OutFile $zip -Headers @{{ Authorization = 'token {TOKEN}' }}
$zi = Get-Item $zip
Write-Host ('zip size: ' + $zi.Length)
# 解压 zip 找 .apk
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::ExtractToDirectory($zip, 'C:\\Users\\yansh\\Desktop\\_apk_dl_unzip')
$apk = Get-ChildItem -Path 'C:\\Users\\yansh\\Desktop\\_apk_dl_unzip' -Recurse -Filter '*.apk' | Select-Object -First 1
if ($apk) {{
    Copy-Item $apk.FullName $dst -Force
    Write-Host ('apk size: ' + (Get-Item $dst).Length)
    Remove-Item 'C:\\Users\\yansh\\Desktop\\_apk_dl_unzip' -Recurse -Force
    Remove-Item $zip -Force
}} else {{
    Write-Host 'no apk in zip'
    Get-ChildItem -Path 'C:\\Users\\yansh\\Desktop\\_apk_dl_unzip' -Recurse
}}
"""
r = subprocess.run(
    ['powershell', '-NoProfile', '-Command', ps],
    capture_output=True, text=True, encoding='gbk', errors='replace', timeout=300
)
print('stdout:', r.stdout[-1000:])
if r.stderr:
    print('stderr:', r.stderr[-500:])
print('returncode:', r.returncode)

apk = Path(DST)
if apk.exists():
    print(f'APK: {apk} -> {apk.stat().st_size/1024/1024:.2f} MB')
else:
    print('APK missing')
    sys.exit(1)
