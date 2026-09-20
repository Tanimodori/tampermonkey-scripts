import { getLogger } from '@logtape/logtape';
import { createApp } from './app.ts';
import { describeConfig, loadConfig, loadEnv, publishEnv, readLoggingOptions } from './config.ts';
import { ConfigError, isAppError } from './errors.ts';
import { configureLogging, flushLogging, LOG_CATEGORIES, LOG_CATEGORY } from './logger.ts';
import { startServer } from './server.ts';
import { getRedis, traced } from './stores/redis.ts';
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
  } catch (error) {
    // Nothing could be read, so not even the log destination is known: stderr is all there is.
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
    return;
  }

  // Logging comes before the configuration, from the same variables it reads and tolerantly: a
  // configuration that fails validation still has to say *why*, and if it named a log file, that
  // reason belongs in the file. A logging variable that does not parse simply reads as unset here —
  // the strict load below is what reports it.
  const logging = readLoggingOptions(env);
  try {
    configureLogging(logging.level, { timezone: logging.timezone, file: logging.file, rotatingFile: logging.rotatingFile });
  } catch (error) {
    // A destination that cannot be opened is fatal and has nowhere else to go.
    process.stderr.write(`Could not open the log destination: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
    return;
  }

  const configLogger = getLogger(LOG_CATEGORIES.config);
  let config;
  try {
    config = loadConfig(env);
  } catch (error) {
    const problems = error instanceof ConfigError ? error.problems : [error instanceof Error ? error.message : String(error)];
    // The log record is the durable copy; stderr is what a container's log collector shows even when
    // the configured destination is the thing that is broken.
    configLogger.error('Configuration is invalid', { problems });
    process.stderr.write(`Invalid configuration:\n  - ${problems.join('\n  - ')}\n`);
    flushLogging();
    process.exitCode = 1;
    return;
  }

  // What the service decided to run with, and which files answered — one record, no credentials.
  configLogger.info('Configuration resolved', describeConfig(config));

  // The one place logging is set up: from here on every module reads the same logger by category.
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
    await traced('checkRedis', 'PING', [], getRedis().ping());
  } catch (error) {
    logger.error('Could not reach Redis; refusing to start', { error: error instanceof Error ? error.message : String(error) });
    await created.close().catch(() => undefined);
    flushLogging();
    process.exitCode = 1;
    return;
  }

  try {
    await upstreamStore.resolve();
  } catch (error) {
    // The document itself is wrong — a sub-sheet that does not exist, an Open-Id that does not belong
    // to the token. Trying again cannot fix either, so this is still a refusal to start.
    if (isAppError(error) && error.code === 'ERR_CONFIG_INVALID') {
      logger.error('The Tencent Docs document or the credential is configured wrongly; refusing to start', {
        error: error instanceof Error ? error.message : String(error),
      });
      await created.close().catch(() => undefined);
      flushLogging();
      process.exitCode = 1;
      return;
    }

    // The upstream was unreachable, throttling or answering badly. Nothing retries it here — a failed
    // call stays failed — so the service starts not-ready and the coordinates are checked again by the
    // first request that needs them. `/readyz` says why until then.
    logger.error('Could not verify the Tencent Docs document; starting not ready', {
      error: error instanceof Error ? error.message : String(error),
    });
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
    flushLogging();
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
      // Before the process goes: a file sink buffers, and this is the record an operator looks for.
      flushLogging();
      process.exit(0);
    } catch (error) {
      logger.error('Shutdown failed', { error: error instanceof Error ? error.message : String(error) });
      flushLogging();
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
