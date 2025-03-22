import { createServer } from '@server';
import {
  createWs,
  isReadyMessage,
  logStatusAndExecute,
  USER_1_TOKEN,
  USER_2_TOKEN,
} from '@util/demo';
import { WebSocket } from 'ws';
import { resetStorage } from '@server/services/usageService';
import { BufferCounter, bufferTextOrThrow } from '@util/buffer';
import { BYTES_PER_WORD, MS_PER_WORD } from '@server/services/trascribeService';
import { bufferFromRawData } from '@server/ws/wsTranscribe';
import { delay } from '@util/delay';
import { getRandomArbitrary } from '@util/random';

function setupHandlers(ws: WebSocket, label: string) {
  ws.once('open', () => {
    console.log(`${label} connected`);
    ws.once('message', (data) => {
      if (!isReadyMessage(data)) {
        throw new Error('unexpected message');
      }
      console.log(`${label} ready`);
      const abortController = new AbortController();
      let sent = 0;
      let recieved = 0;
      ws.once('close', (code, reason) => {
        abortController.abort();
        console.log(`${label} disconnected`);
        const message = bufferTextOrThrow(bufferFromRawData(reason));
        console.log(`${label} disconnected - ${code}, reason: ${message}`);
      });
      ws.on('message', (data) => {
        const message = bufferTextOrThrow(bufferFromRawData(data));
        recieved += 1;
        console.log(
          `${label} (sent: ${sent}, recv: ${recieved}) received: ${message}`,
        );
      });
      void (async () => {
        const bufferCounter = new BufferCounter();
        while (true) {
          if (abortController.signal.aborted) {
            break;
          }
          const bytes = Math.round(
            getRandomArbitrary(BYTES_PER_WORD, BYTES_PER_WORD * 10),
          );
          const payload = bufferCounter.wrap(Buffer.alloc(bytes));
          sent += 1;
          console.log(
            `${label} (sent: ${sent}, recv: ${recieved}) sending id: ${bufferCounter.lastId}, bytes: ${bytes}`,
          );
          ws.send(payload);
          await delay((bytes / BYTES_PER_WORD) * MS_PER_WORD);
        }
      })();
    });
  });
}

function waitForClose(ws: WebSocket): Promise<void> {
  return new Promise<void>((resolve) => {
    ws.once('close', resolve);
  });
}

async function main() {
  const server = await logStatusAndExecute(
    'starting server',
    createServer(3000),
  );

  resetStorage(60_000);

  const wsA = createWs(USER_1_TOKEN);
  setupHandlers(wsA, 'User A:');

  const wsB = createWs(USER_2_TOKEN);
  setupHandlers(wsB, 'User B:');

  await Promise.all([waitForClose(wsA), waitForClose(wsB)]);

  await server.shutdown();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
