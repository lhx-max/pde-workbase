# Canvas CLI

Install in the MA execution container/workspace (Node 24). This is an HTTP client;
it does not start another server or store another copy of canvas data.

```sh
npm install -g @ks-designai/canvas-cli@0.1.1 --registry=https://npm.corp.kuaishou.com/
canvas-cli --version
canvas-cli --help
```

Offline installation: `npm install -g ./ks-designai-canvas-cli-0.1.1.tgz`.

Supply `CANVAS_SERVER_URL` pointing to the reachable canvas API. The execution
environment supplies `CANVAS_AUTH_TOKEN` via its secret manager where required;
never put the token in the prompt, manifest, source, or command arguments.
`CANVAS_TEAM_ID` and `CANVAS_USER_ID` provide context, not proof of authorization.
The deployed service must authenticate and authorize that context.

```sh
canvas-cli apps list
canvas-cli request GET /api/apps/canvas
canvas-cli apps state canvas --instance ACTUAL_CANVAS_ID
canvas-cli request POST /api/apps/canvas/instances/ACTUAL_CANVAS_ID/operations --body-file operations.json
```

Read capabilities and operation schema before writing. Instance IDs here are
actual canvas IDs returned by the Provider, not MA applicationInstanceId or
providerInstanceId. The MA adapter must supply the mapping. Use the existing
revision/idempotency contract; no automatic write retry is performed.

The package includes `skills/canvas-cli/SKILL.md`; install that skill using the
MA runtime's documented skill loader. Installing npm does not register an Agent
tool or grant execution permissions automatically. Nonzero exit means failure;
successful API responses go to stdout. The same client can call registered doc
App actions through the canvas App gateway.
