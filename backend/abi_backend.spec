# -*- mode: python ; coding: utf-8 -*-
import sys
sys.setrecursionlimit(5000)

a = Analysis(
    ['server.py'],
    pathex=[],
    binaries=[],
    datas=[
        ('tools.py', '.'),
        ('privacy_guard.py', '.'),
        ('refresh_data.py', '.'),
        # NOTE: Do NOT include .env or db.sqlite - these are user data
    ],
    hiddenimports=['duckduckgo_search', 'primp', 'lxml'],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['tensorflow', 'torch', 'keras', 'tensorboard', 'jax', 'caffe2'],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='abi_backend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
