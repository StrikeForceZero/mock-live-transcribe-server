import express from 'express';
import http, { Server as HttpServer } from 'http';
import { WebSocketServer } from 'ws';
import { defaultErrorHandler } from '@server/defaultErrorHandler';
import { router } from '@server/routes';
import { setupWebSocket } from '@server/ws/wsTranscribe';

export async function createServer(port: number): Promise<{
  httpServer: HttpServer;
  wss: WebSocketServer;
  shutdown: () => Promise<void[]>;
}> {
  const app = express();
  const httpServer = http.createServer((req, res) => {
    // apparently @typescript-eslint/no-floating-promises thinks app is a promise...
    void app(req, res);
  });

  async function shutdownHttp() {
    return new Promise<void>((resolve, reject) => {
      httpServer.close((err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  app.use('/api', router);
  app.use(defaultErrorHandler);

  const { wss, shutdown: shutdownWss } = setupWebSocket(httpServer);

  async function shutdown() {
    return Promise.all([shutdownWss(), shutdownHttp()]);
  }

  return new Promise((resolve, reject) => {
    httpServer.on('error', (err) => {
      reject(err);
    });
    httpServer.listen(port, () =>
      resolve({
        httpServer,
        wss,
        shutdown,
      }),
    );
  });
}
