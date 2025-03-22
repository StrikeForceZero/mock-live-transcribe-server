import * as console from 'node:console';
import { UsageData } from '@server/services/usageService';
import { UsageResponse } from '@server/controllers/usageController';
import { RawData, WebSocket } from 'ws';
import { bufferFromRawData } from '@server/ws/wsTranscribe';
import { bufferTextOrThrow } from '@util/buffer';

const HOST = 'localhost:3000';
const API_USAGE_URL = `http://${HOST}/api/usage`;
const WS_TRANSCRIBE_URL = `ws://${HOST}/transcribe`;
export const USER_1_TOKEN = 'Bearer a';
export const USER_2_TOKEN = 'Bearer b';

export async function fetchUsageData(token: string): Promise<UsageData> {
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

export function createWs(token: string): WebSocket {
  return new WebSocket(WS_TRANSCRIBE_URL, {
    headers: {
      authorization: token,
    },
  });
}

export async function logStatusAndExecute<T>(
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

export function isReadyMessage(rawData: RawData): boolean {
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
