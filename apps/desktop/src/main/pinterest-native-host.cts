import { createConnection } from 'node:net';
import { dirname } from 'node:path';
import { bindNativeHostLocaleDir, nhu } from './locales/native-host-ui.cjs';

// Chrome Native Messaging framing. Stdout is protocol only; never print pairing secrets.
const socketPath = process.argv[2];
const origin = process.argv[3];
if (!socketPath || origin !== 'chrome-extension://acgnbiifgajbjpcjfaodlmpekhhdjmfm/') process.exit(1);
bindNativeHostLocaleDir(dirname(socketPath));
let buffer = Buffer.alloc(0);
let handled = false;
const deadline = setTimeout(() => process.exit(1), 5000);
function reply(value: unknown) {
  const body = Buffer.from(JSON.stringify(value));
  const header = Buffer.alloc(4); header.writeUInt32LE(body.length);
  process.stdout.write(Buffer.concat([header, body]), () => { clearTimeout(deadline); process.exit(0); });
}
process.stdin.on('data', (chunk: Buffer) => {
  if (handled) return;
  buffer = Buffer.concat([buffer, chunk]);
  if (buffer.length < 4) return;
  const size = buffer.readUInt32LE(0);
  if (size > 4096) process.exit(1);
  if (buffer.length < size + 4) return;
  handled = true;
  try { if (JSON.parse(buffer.subarray(4, size + 4).toString()).type !== 'claim') throw new Error(); }
  catch { reply({ error: nhu().invalidRequest }); return; }
  const socket = createConnection(socketPath, () => socket.write('claim\n'));
  let text = '';
  socket.on('data', data => { text += data.toString(); if (text.length > 4096) socket.destroy(); });
  socket.on('end', () => { try { reply(JSON.parse(text)); } catch { reply({ error: nhu().connectionUnavailable }); } });
  socket.on('error', () => reply({ error: nhu().startSignInFirst }));
});
