import { getLogger } from '@logtape/logtape';
import { createApp } from './app.ts';
import { getConfig, loadConfig, loadEnvFiles } from './config.ts';
import { ConfigError } from './errors.ts';
import { configureLogging, LOG_CATEGORY } from './logger.ts';
import { startServer } from './server.ts';
import { upstreamStore } from './stores/upstream.ts';

async function main(): Promise<void> {
  // Local runs read `.env.development(.local)`; a container was handed its variables already, and
  // carries none of these files.
  loadEnvFiles();

  try {
    loadConfig();
  } catch (error) {
    const message = error instanceof ConfigError ? error.message : `Failed to load configuration: ${String(error)}`;
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
    return;
  }

  const config = getConfig();
  // The one place logging is set up: from here on every module reads the same logger by category.
  configureLogging(config.server.logLevel);
  const logger = getLogger(LOG_CATEGORY);
  logger.info('Starting occult-pot-server', {
    host: config.server.host,
    port: config.server.port,
    apiBase: config.docs.apiBase,
    encodedId: upstreamStore.encodedId,
  });

  const created = createApp();

  try {
    await upstreamStore.resolve();
  } catch (error) {
    logger.error('Could not resolve the Tencent Docs document or validate the credential; refusing to start', {
      error: error instanceof Error ? error.message : String(error),
    });
    await created.close().catch(() => undefined);
    process.exitCode = 1;
    return;
  }

  let running;
  try {
    running = await startServer({
      app: created.app,
      host: config.server.host,
      port: config.server.port,
      onClosed: () => created.close(),
    });
  } catch (error) {
    logger.error('Could not bind the HTTP listener', { error: error instanceof Error ? error.message : String(error) });
    await created.close().catch(() => undefined);
    process.exitCode = 1;
    return;
  }

  logger.info('Listening', { host: config.server.host, port: running.port });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('Shutting down', { signal });
    try {
      await running.close();
      logger.info('Shutdown complete');
      process.exit(0);
    } catch (error) {
      logger.error('Shutdown failed', { error: error instanceof Error ? error.message : String(error) });
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  running.server.on('error', (error: Error) => {
    logger.error('HTTP server error', { error: error.message });
    process.exitCode = 1;
  });
}

await main();
