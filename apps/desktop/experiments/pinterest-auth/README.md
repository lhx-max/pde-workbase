# Pinterest session handoff — independent development experiment

Restored from upstream `319e5eee`, with independent extension identity
`acgnbiifgajbjpcjfaodlmpekhhdjmfm` and Native Messaging host
`com.canvas_workspace.pinterest_auth`. It does not share the original app's pairing state.

**macOS, non-packaged development runtime only.** Other platforms and packaged builds return an explicit unsupported result. This is not verified production authentication support.

Build in the independent workspace with Node 24 and pnpm 10.33.2:

```sh
pnpm --filter @canvas/desktop build
```

The unpacked connector is emitted under:

```text
apps/desktop/dist/pinterest-auth-extension/
```

Open Pinterest in the embedded browser, use its sign-in connection action, and follow the native consent dialog. Installation opens the HTTPS default browser's extension settings and the generated connector folder. Only after explicit confirmation does the app register the independently named Native Messaging host. It never silently installs an extension or selects another browser. Unsupported default browsers offer ordinary Pinterest navigation without session return.

The connector requires an explicit optional Pinterest host permission. Pairing tokens use session storage, are single-use and expire. Only Pinterest cookies cross the local receiver; Google cookies, browser profiles and arbitrary files do not. The host checks the owning live guest and cancels on navigation; failed or cancelled imports restore touched keys rather than clearing unrelated storage. Logout/Stop and expiry revoke pairing. No cookie payload or pairing secret belongs in logs, clipboard or URLs passed to an external browser.

Automated checks use synthetic cookies and a temporary simulated Native Messaging registry. They do not install into, read, or modify a real browser profile. Native dialog visibility, actual Chrome/Edge installation, Google/Pinterest policy acceptance and successful real-account session return remain separate manual/E2E verification work. Do not carry forward historical upstream manual-verification claims as verification of this independent distribution.
