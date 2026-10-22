# Security Policy

## What the extension does

Vibe Review runs locally. It reads the files in the folder you open, runs `git` (`git diff`, `git ls-files`) in that folder, and draws the result in a VS Code webview. It makes no network requests, collects no telemetry, and loads no remote code (the webview's content security policy allows only its own bundled script and styles).

## Reporting a vulnerability

Please **do not open a public issue** for a security problem. Use GitHub's private reporting instead: on the repository page, open the **Security** tab and choose **Report a vulnerability**. Include what you found, how to reproduce it, and the version (or commit) you tested.

You can expect an acknowledgement within a few days. Fixes for confirmed issues are released as soon as practical, and the report is credited unless you prefer otherwise.

## Supported versions

The project is in alpha: only the latest commit on `main` receives fixes.
