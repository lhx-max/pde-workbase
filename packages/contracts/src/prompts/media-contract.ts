export const MEDIA_USER_REPLY_CONTRACT = `
### User-facing media completion (load-bearing)

Keep operational details in the tool output and daemon logs. The tool trace
retains the upstream failure, while the daemon logs a redacted error together
with the media task id, run id, model, provider, and status. Never copy model
or provider names, catalogue prefixes, CLI names, environment
variables, filenames, paths, task ids, stderr, exit codes, credential advice,
or diagnostic details into the visible assistant reply.

For an image request, the visible assistant reply contains exactly one short,
localized sentence and nothing else:

- Success: say the localized equivalent of "Image generated". For Simplified
  Chinese, reply exactly \`图片已生成\`.
- Failure, including a placeholder/stub outcome: say the localized equivalent
  of "The image generation service is temporarily unavailable". For Simplified
  Chinese, reply exactly \`图片生成服务暂时不可用\`.

Do not add a filename, model, provider, reason, remediation, retry offer, or
follow-up question. Use the command's structured result only to choose success
versus failure; retain its original diagnostics in the tool trace for debugging.`;

export const MEDIA_GENERATION_CONTRACT = `
---

## Media generation contract (load-bearing - overrides softer wording above)

This project is a **non-web** surface (image / video / audio). The unifying
contract is: skill workflow + project metadata tell you WHAT to make; one
shell command through \`BEZIER_NODE_BIN\` + \`BEZIER_BIN\` is HOW you actually produce bytes.
Do not try to embed binary content inside \`<artifact>\` tags, and do not
write image/video/audio bytes by hand. Always call out to the dispatcher.

The daemon injects these environment variables for agent sessions:

- \`BEZIER_NODE_BIN\` - absolute path to the Node-compatible runtime that started the daemon.
- \`BEZIER_BIN\` - absolute path to the Bezier CLI script. On POSIX shells run with \`"$BEZIER_NODE_BIN" "$BEZIER_BIN" ...\`.
- \`BEZIER_PROJECT_ID\` - active project id. Pass it as \`--project "$BEZIER_PROJECT_ID"\`.
- \`BEZIER_PROJECT_DIR\` - active project files directory.
- \`BEZIER_DAEMON_URL\` - base URL of the local daemon.

Run media generation through the dispatcher:

\`\`\`bash
"$BEZIER_NODE_BIN" "$BEZIER_BIN" media generate \\
  --project "$BEZIER_PROJECT_ID" \\
  --surface <image|video|audio> \\
  --model <model-id> \\
  --output <filename> \\
  --prompt "<full prompt>" \\
  [--aspect 1:1|16:9|9:16|4:3|3:4] \\
  [--quality <tier>] \\
  [--resolution <res>] \\
  [--length <seconds>] \\
  [--duration <seconds>] \\
  [--prompt-influence <0-1>] \\
  [--loop] \\
  [--audio-kind music|speech|sfx] \\
  [--voice <provider-voice-id>] \\
  [--language <lang>]
\`\`\`

Video generation requires at least 4 seconds per shot. Plans and reports must budget total duration >= shot count × 4 seconds. Flag conflicting confirmed budgets instead of silently changing them.

Always quote the prompt value. Never splice unquoted user text into the
command line. The command returns JSON containing either a final
\`file\` object or a \`taskId\` for long-running renders.

Pass \`--quality\` or \`--resolution\` only when the selected model supports
the option and the user has asked for it.
For long-running renders, continue with:

\`\`\`bash
"$BEZIER_NODE_BIN" "$BEZIER_BIN" media wait <taskId> --since <nextSince>
\`\`\`

\`media wait\` exits \`0\` when done, \`2\` when still running, and \`5\`
when the provider task failed. Exit code \`2\` is not an error; keep polling
with the returned \`nextSince\`.

Do not emit \`<artifact>\` blocks for media. The artifact is the generated
file written by the dispatcher, and the file viewer will render images,
videos, and audio automatically. If generation fails, retain the actual
stderr / exit status in the tool trace and daemon logs instead of exposing it
or inventing a diagnosis in the visible assistant reply.

Special case: \`hyperframes-html\` video projects may author composition HTML
in \`.hyperframes-cache/\`, then render through the daemon-backed dispatcher
with \`--composition-dir\` so Chrome-bound rendering runs outside the agent
sandbox.

${MEDIA_USER_REPLY_CONTRACT}
`;
