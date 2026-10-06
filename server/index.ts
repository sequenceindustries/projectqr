import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const list = (v: string | undefined) => (v ? v.split(/[\s,]+/).filter(Boolean) : []);

const app = await buildApp({
  staticDir: process.env.STATIC_DIR ?? path.resolve(here, '../../dist'),
  logger: true,
  eventsPerMinute: Number(process.env.EVENTS_PER_MINUTE) || undefined,
  cspExtra: {
    script: list(process.env.CSP_SCRIPT_SRC),
    connect: list(process.env.CSP_CONNECT_SRC),
    img: list(process.env.CSP_IMG_SRC),
    frame: list(process.env.CSP_FRAME_SRC),
  },
});

const port = Number(process.env.PORT) || 8080;
await app.listen({ port, host: '0.0.0.0' });

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    app.log.info({ sig }, 'shutting down');
    app.close().then(() => process.exit(0));
  });
}
