import * as console from 'node:console';
import process from 'node:process';
import { createServer } from '@server';
import { printListeningAddress } from '@util/ip';

function registerShutdownHandler(shutdown: () => Promise<void[]>) {
  process.on('SIGINT', () => {
    console.log('Received SIGINT (Ctrl+C)');
    void shutdownAndExit();
  });

  process.on('SIGTERM', () => {
    console.log('Received SIGTERM');
    void shutdownAndExit();
  });

  process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
    void shutdownAndExit(1);
  });

  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled Rejection:', reason);
    void shutdownAndExit(1);
  });

  async function shutdownAndExit(exitCode = 0) {
    try {
      // Clean up, stop servers, etc.
      process.stdout.write('Shutting down... ');
      await shutdown();
      process.stdout.write('done.\n');
    } catch (err) {
      console.error('error while shutting down! ', err);
    } finally {
      process.stdout.write('Exiting... \n');
      process.exit(exitCode);
    }
  }
}

async function bootstrap() {
  process.stdout.write('Starting server... ');
  const { httpServer, shutdown } = await createServer(
    Number(process.env.PORT) || 3000,
  );
  process.stdout.write('done.\n');
  registerShutdownHandler(shutdown);
  printListeningAddress(httpServer);
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
