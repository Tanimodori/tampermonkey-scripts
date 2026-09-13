import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { getLogger } from '@logtape/logtape';
import type { Express } from 'express';
import { LOG_CATEGORY } from './logger.ts';

const SHUTDOWN_TIMEOUT_MS = 15_000;

export interface RunningServer {
  readonly server: Server;
  /** Base URL, with the actually-bound port (so `port: 0` works for tests). */
  readonly url: string;
  readonly port: number;
  /** Stops accepting connections, flushes the write queue, then resolves. */
  close(): Promise<void>;
}

export interface StartServerOptions {
  readonly app: Express;
  readonly host: string;
  readonly port: number;
  /** Runs during shutdown, after the listener closes — used to flush the write queue. */
  readonly onClosed?: () => Promise<void>;
  readonly shutdownTimeoutMs?: number;
}

/**
 * Binds the Express app to a real HTTP server with a graceful shutdown path.
 *
 * Shared by the process entry point and the network tests, so both exercise the same
 * production wiring: a listening socket, connection draining, then a write-queue flush.
 */
export async function startServer(options: StartServerOptions): Promise<RunningServer> {
  const server = createServer(options.app);
  let shuttingDown = false;

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => reject(error);
    server.once('error', onError);
    server.listen(options.port, options.host, () => {
      server.removeListener('error', onError);
      resolve();
    });
  });

  const address = server.address();
  const port = address !== null && typeof address === 'object' ? address.port : options.port;
  const displayHost = options.host === '0.0.0.0' || options.host === '::' ? '127.0.0.1' : options.host;

  const close = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;

    const forceExit = setTimeout(() => {
      getLogger(LOG_CATEGORY).error('Shutdown timed out; exiting with pending work');
      process.exit(1);
    }, options.shutdownTimeoutMs ?? SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();

    try {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined || error === null ? resolve() : reject(error)));
      });
      await options.onClosed?.();
      clearTimeout(forceExit);
    } catch (error) {
      clearTimeout(forceExit);
      throw error;
    }
  };

  return { server, url: `http://${displayHost}:${port}`, port, close };
}

export { SHUTDOWN_TIMEOUT_MS };
