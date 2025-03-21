import * as console from 'node:console';
import { RawData, WebSocket } from 'ws';
import { createServer } from '@server';
import { UsageResponse } from '@server/controllers/usageController';
import {
  BYTES_PER_WORD,
  estimateUsageMs,
  MS_PER_WORD,
  TranscribeResponse,
} from '@server/services/trascribeService';
import {
  STARTING_USAGE_LIMIT_MS,
  UsageData,
} from '@server/services/usageService';
import { bufferFromRawData } from '@server/ws/wsTranscribe';
import { bufferTextOrThrow } from '@util/buffer';
import { timeout } from '@util/timeout';

const HOST = 'localhost:3000';
const API_USAGE_URL = `http://${HOST}/api/usage`;
const WS_TRANSCRIBE_URL = `ws://${HOST}/transcribe`;
const USER_1_TOKEN = 'Bearer a';
const USER_2_TOKEN = 'Bearer b';

async function fetchUsageData(token: string): Promise<UsageData> {
  const response = await fetch(API_USAGE_URL, {
    method: 'GET',
    headers: {
      authorization: token,
    },
  });
  if (!response.ok) {
    throw new Error(`fetchUsage response.status: ${response.status}`);
  }
  // TODO: validate with zod
  const usageResponse = (await response.json()) as UsageResponse;
  return usageResponse.usage;
}

function createWs(token: string): WebSocket {
  return new WebSocket(WS_TRANSCRIBE_URL, {
    headers: {
      authorization: token,
    },
  });
}

async function logStatusAndExecute<T>(
  message: string,
  promise: Promise<T>,
): Promise<T> {
  process.stdout.write(`${message}... `);
  try {
    const result = await promise;
    process.stdout.write('done.');
    return result;
  } catch (err) {
    process.stdout.write('failed.\n');
    console.error(err);
    throw err;
  } finally {
    process.stdout.write('\n');
  }
}

function isReady(rawData: RawData): boolean {
  const buffer = bufferFromRawData(rawData);
  const bufferString = bufferTextOrThrow(buffer);
  const message = JSON.parse(bufferString) as unknown;
  return (
    typeof message === 'object' &&
    message !== null &&
    'event' in message &&
    message.event === 'ready'
  );
}

async function connectWs(token: string): Promise<WebSocket> {
  const ws = createWs(token);
  const promise = new Promise<WebSocket>((resolve, reject) => {
    ws.once('open', () => {
      ws.once('message', (data) => {
        if (isReady(data)) {
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
    while (usage1.remainingMs > 0) {
      const onMessagePromise = messageReceived<TranscribeResponse>(
        ws1,
        validateWsUsageResponse,
      );
      const packet = Buffer.alloc(BYTES_PER_WORD);
      await logStatusAndExecute(
        `sending ${BYTES_PER_WORD} bytes (${estimateUsageMs(packet)}ms)`,
        sendData(ws1, packet),
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
    const packet = Buffer.alloc(MAX_REMAINING_PAYLOAD_SIZE);
    await logStatusAndExecute(
      `sending ${MAX_REMAINING_PAYLOAD_SIZE} bytes (${estimateUsageMs(packet)}ms)`,
      sendData(ws2, packet),
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
