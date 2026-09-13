import { getLogger } from '@logtape/logtape';
import { createApp } from './app.ts';
import { getConfig, loadConfig, loadEnv, publishEnv } from './config.ts';
import { ConfigError } from './errors.ts';
import { configureLogging, LOG_CATEGORY } from './logger.ts';
import { startServer } from './server.ts';
import { getRedis } from './services/redis.ts';
import { upstreamStore } from './stores/upstream.ts';

async function main(): Promise<void> {
  // The environment first: the ambient one, the files vite's mode names, and whatever
  // `OPS_ENV_PATH` adds on top. A container carries no files at all and is handed its variables.
  let env: NodeJS.ProcessEnv;
  try {
    env = loadEnv();
    // Names the environment did not have yet reach `process.env` as well, for anything that reads it
    // directly.
    publishEnv(env);
    loadConfig(env);
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
    fileIdLength: upstreamStore.fileId.length,
  });

  const created = createApp();

  // Redis holds the state the service serves, so it is as much a startup dependency as the document
  // the state comes from — and a mock never fails this.
  try {
    await getRedis().ping();
  } catch (error) {
    logger.error('Could not reach Redis; refusing to start', { error: error instanceof Error ? error.message : String(error) });
    await created.close().catch(() => undefined);
    process.exitCode = 1;
    return;
  }

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
