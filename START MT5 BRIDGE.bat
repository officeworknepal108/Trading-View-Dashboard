@echo off
cd /d "%~dp0"
title Kalbairab MT5 Bridge
echo Starting the MT5 bridge...
echo Keep this window open while automatic execution is enabled.
echo.
py mt5_bridge.py
echo.
echo The bridge stopped. Review any message above before restarting it.
pause
