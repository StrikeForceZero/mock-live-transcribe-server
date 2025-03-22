import * as console from 'node:console';
import { RawData, WebSocket } from 'ws';
import { createServer } from '@server';
import {
  BYTES_PER_WORD,
  estimateUsageMs,
  MS_PER_WORD,
  TranscribeResponse,
} from '@server/services/trascribeService';
import { STARTING_USAGE_LIMIT_MS } from '@server/services/usageService';
import { bufferFromRawData } from '@server/ws/wsTranscribe';
import { BufferCounter, bufferTextOrThrow } from '@util/buffer';
import { timeout } from '@util/timeout';
import {
  createWs,
  fetchUsageData,
  isReadyMessage,
  logStatusAndExecute,
  USER_1_TOKEN,
  USER_2_TOKEN,
} from '@util/demo';

async function connectWs(token: string): Promise<WebSocket> {
  const ws = createWs(token);
  const promise = new Promise<WebSocket>((resolve, reject) => {
    ws.once('open', () => {
      ws.once('message', (data) => {
        if (isReadyMessage(data)) {
          return resolve(ws);
        }
        reject(new Error('unexpected message'));
      });
    });
  });
  return await timeout(100, () => promise);
}

async function sendData(ws: WebSocket, data: Buffer): Promise<void> {
  if (ws.readyState !== WebSocket.OPEN) {
    throw new Error('socket not open');
  }
  return new Promise<void>((resolve, reject) => {
    function removeListeners() {
      ws.off('close', onClose);
      ws.off('error', onError);
    }
    function onError(err?: Error | null) {
      removeListeners();
      reject(err instanceof Error ? err : new Error('unexpected error'));
    }
    function onClose(code: number, reason: Buffer) {
      removeListeners();
      const reasonString = bufferTextOrThrow(reason);
      reject(new Error(`close code: ${code}, reason: ${reasonString}`));
    }
    function onSentData(err?: Error | null) {
      removeListeners();
      if (err) {
        return reject(err);
      }
      resolve();
    }
    ws.once('error', onError);
    ws.once('close', onClose);
    ws.send(data, onSentData);
  });
}

async function messageReceived<T>(
  ws: WebSocket,
  validateMessage: (message: T) => Promise<void>,
): Promise<T> {
  if (ws.readyState !== WebSocket.OPEN) {
    throw new Error('socket not open');
  }
  return new Promise<T>((resolve, reject) => {
    function removeListeners() {
      ws.off('close', onClose);
      ws.off('error', onError);
      ws.off('message', onMessage);
    }
    function onError(err?: Error | null) {
      removeListeners();
      reject(err instanceof Error ? err : new Error('unexpected error'));
    }
    function onClose(code: number, reason: Buffer) {
      removeListeners();
      const reasonString = bufferTextOrThrow(reason);
      reject(new Error(`close code: ${code}, reason: ${reasonString}`));
    }
    function onMessage(data: RawData) {
      removeListeners();
      const buffer = bufferFromRawData(data);
      const bufferString = bufferTextOrThrow(buffer);
      const message = JSON.parse(bufferString) as T;
      validateMessage(message)
        .then(() => {
          resolve(message);
        })
        .catch(reject);
    }
    ws.once('error', onError);
    ws.once('close', onClose);
    ws.once('message', onMessage);
  });
}

// increases complexity if async is removed
// eslint-disable-next-line @typescript-eslint/require-await
async function validateWsUsageResponse(message: unknown): Promise<void> {
  // TODO: use zod for validation
  if (
    typeof message === 'object' &&
    message !== null &&
    'transcript' in message
  ) {
    return;
  }
  throw new Error('unexpected message');
}

async function main() {
  // space out log messages for easier reading
  console.log('\n--- starting demo ---\n');

  const server = await logStatusAndExecute(
    'starting server',
    createServer(3000),
  );

  // space out log messages for easier reading
  console.log('\n--- connecting both users at same time ---\n');

  // connect both users at the same time
  const ws1 = await logStatusAndExecute(
    'user 1 connecting to ws',
    connectWs(USER_1_TOKEN),
  );
  const ws2 = await logStatusAndExecute(
    'user 2 connecting to ws',
    connectWs(USER_2_TOKEN),
  );

  // space out log messages for easier reading
  console.log('\n--- user 1 ---\n');

  // user 1 transcribe one word at a time (250ms) until exhausted
  {
    let usage1 = await logStatusAndExecute(
      'fetching user 1 usage stats',
      fetchUsageData(USER_1_TOKEN),
    );
    const bufferCounter = new BufferCounter();
    while (usage1.remainingMs > 0) {
      const onMessagePromise = messageReceived<TranscribeResponse>(
        ws1,
        validateWsUsageResponse,
      );
      const packet = Buffer.alloc(BYTES_PER_WORD);
      await logStatusAndExecute(
        `sending ${BYTES_PER_WORD} bytes (${estimateUsageMs(packet)}ms)`,
        sendData(ws1, bufferCounter.wrap(packet)),
      );
      const transcript = await logStatusAndExecute(
        'waiting for transcript',
        onMessagePromise,
      );
      console.log(transcript);
      usage1 = await logStatusAndExecute(
        'fetching user 1 usage stats',
        fetchUsageData(USER_1_TOKEN),
      );
      console.log(usage1);
    }
  }

  // space out log messages for easier reading
  console.log('\n--- user 2 ---\n');

  // user 2 one shot exhaust usage
  {
    let usage2 = await logStatusAndExecute(
      'fetching user 2 usage stats',
      fetchUsageData(USER_2_TOKEN),
    );
    console.log(usage2);

    const onMessagePromise = messageReceived<TranscribeResponse>(
      ws2,
      validateWsUsageResponse,
    );
    const MAX_REMAINING_PAYLOAD_SIZE = Math.ceil(
      (STARTING_USAGE_LIMIT_MS / MS_PER_WORD) * BYTES_PER_WORD,
    );
    const bufferCounter = new BufferCounter();
    const packet = Buffer.alloc(MAX_REMAINING_PAYLOAD_SIZE);
    await logStatusAndExecute(
      `sending ${MAX_REMAINING_PAYLOAD_SIZE} bytes (${estimateUsageMs(packet)}ms)`,
      sendData(ws2, bufferCounter.wrap(packet)),
    );
    const transcript = await logStatusAndExecute(
      'waiting for transcript',
      onMessagePromise,
    );
    console.log(transcript);
    usage2 = await logStatusAndExecute(
      'fetching user 2 usage stats',
      fetchUsageData(USER_2_TOKEN),
    );
    console.log(usage2);
  }

  // space out log messages for easier reading
  console.log('\n--- shutting down ---\n');

  await logStatusAndExecute('closing server', server.shutdown());
  console.log('done');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
