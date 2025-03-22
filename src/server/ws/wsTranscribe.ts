import { IncomingMessage, Server } from 'http';
import * as console from 'node:console';
import { RawData, WebSocket, WebSocketServer } from 'ws';
import * as usageService from '@server/services/usageService';
import {
  AbortedError,
  ConnectionClosedUnexpectedlyError,
  ExceededAllocatedUsageError,
  InvalidData,
  TimeoutError,
} from '@util/error';
import { timeout } from '@util/timeout';
import { getTokenFromAuthorization, getUserIdFromToken } from '@server/auth';
import * as transcribeService from '@server/services/trascribeService';
import { UserId } from '@server/types';
import { Queue } from '@util/queue';
import { SoftLock } from '@util/lock';
import { onAbort, rejectOnAbort } from '@util/abort';
import { delay } from '@util/delay';
import { getIdFromBuffer } from '@util/buffer';

export enum WsCloseCode {
  Normal = 1000,
  GoingAway = 1001,
  ProtocolError = 1002,
  UnsupportedData = 1003,
  NoStatusReceived = 1005,
  AbnormalClosure = 1006,
  InvalidData = 1007,
  PolicyViolation = 1008,
  MessageTooLarge = 1009,
  UnexpectedError = 1011,
  ServiceRestart = 1012,
  ServiceUnavailable = 1013,
  // not exactly part of the rfc - https://www.iana.org/assignments/websocket/websocket.xhtml
  Timeout = 3008,
}

export enum InternalErrorCode {
  ExceededAllocatedUsageError = 0,
  TimeoutError = 1,
  AbortedError = 2,
  ConnectionReplacedError = 3,
  Unauthorized = 4,
  ShuttingDown = 5,
  NotReady = 6,
  InvalidData = 7,
  ServerError = 99,
}

type AuthenticatedWebSocket = WebSocket &
  typeof WebSocket & {
    user?: { id: UserId } | null;
    ready?: boolean;
  };

function authenticateClient(req: IncomingMessage): { id: UserId } | null {
  const token = getTokenFromAuthorization(req.headers.authorization);
  if (!token) {
    return null;
  }
  const userId = getUserIdFromToken(token);
  if (!userId) {
    return null;
  }
  return { id: userId };
}

export function bufferFromRawData(rawData: RawData): Buffer {
  if (Buffer.isBuffer(rawData)) {
    return rawData;
  } else if (rawData instanceof ArrayBuffer) {
    return Buffer.from(rawData);
  } else if (Array.isArray(rawData)) {
    return Buffer.concat(rawData);
  } else {
    throw new Error('Unknown binary data type');
  }
}

class QueueEntry {
  private readonly _id: number;
  private readonly _data: Buffer<ArrayBufferLike>;
  constructor(buffer: Buffer) {
    const { id, data } = getIdFromBuffer(buffer);
    this._id = id;
    this._data = data;
    if (this._data.length === 0) {
      throw new InvalidData('invalid message');
    }
  }
  get id() {
    return this._id;
  }
  get data() {
    return this._data;
  }
}

const USER_ID_SOCKET_MAP: Record<UserId, AuthenticatedWebSocket | undefined> =
  {};
const USER_ID_QUEUE_MAP: Record<UserId, SoftLock<Queue<QueueEntry>>> = {};

function getOrInitQueue(userId: UserId): Queue<QueueEntry> {
  USER_ID_QUEUE_MAP[userId] ??= new SoftLock(new Queue());
  return USER_ID_QUEUE_MAP[userId].inner;
}

function registerSocketForUserId(clientSocket: AuthenticatedWebSocket) {
  const userId = getUserIdFromSocketOrThrow(clientSocket);
  const existingSocket = USER_ID_SOCKET_MAP[userId];
  if (existingSocket) {
    existingSocket.close(
      WsCloseCode.PolicyViolation,
      JSON.stringify({
        error: 'Connection replaced',
        code: InternalErrorCode.ConnectionReplacedError,
      }),
    );
  }
  USER_ID_SOCKET_MAP[userId] = clientSocket;
}

export type CloseReasonObj = { error: unknown; code: InternalErrorCode };

function closeWithError(
  clientSocket: WebSocket,
  closeCode: WsCloseCode,
  data: CloseReasonObj,
) {
  clientSocket.close(closeCode, JSON.stringify(data));
}

function handleTranscribeError(err: unknown, clientSocket: WebSocket) {
  if (err instanceof AbortedError) {
    console.error('AbortedError', err);
    closeWithError(clientSocket, WsCloseCode.GoingAway, {
      error: 'Aborted',
      code: InternalErrorCode.AbortedError,
    });
  } else if (err instanceof TimeoutError) {
    console.error('TimeoutError', err);
    closeWithError(clientSocket, WsCloseCode.Timeout, {
      error: 'Timeout',
      code: InternalErrorCode.TimeoutError,
    });
  } else if (err instanceof ExceededAllocatedUsageError) {
    closeWithError(clientSocket, WsCloseCode.PolicyViolation, {
      error: 'Exceeded allocated usage',
      code: InternalErrorCode.ExceededAllocatedUsageError,
    });
  } else if (err instanceof InvalidData) {
    closeWithError(clientSocket, WsCloseCode.InvalidData, {
      error: err.message,
      code: InternalErrorCode.InvalidData,
    });
  } else if (err instanceof ConnectionClosedUnexpectedlyError) {
    // do nothing
  } else if (err instanceof Error) {
    console.error('Error', err);
    closeWithError(clientSocket, WsCloseCode.UnexpectedError, {
      error: err.message,
      code: InternalErrorCode.ServerError,
    });
  } else {
    console.error('Unknown error', err);
    closeWithError(clientSocket, WsCloseCode.UnexpectedError, {
      error: err,
      code: InternalErrorCode.ServerError,
    });
  }
}

function sendData(
  clientSocket: AuthenticatedWebSocket,
  data: unknown,
): Promise<void> {
  if (clientSocket.readyState !== WebSocket.OPEN) {
    throw new Error('Socket not open');
  }
  return new Promise<void>((resolve, reject) => {
    clientSocket.send(JSON.stringify(data), (err) => {
      if (err) {
        console.error('sendData err: ', err);
        return reject(err);
      }
      resolve();
    });
  });
}

function isOpen(socket: WebSocket): boolean {
  return socket.readyState === WebSocket.OPEN;
}

function getUserIdFromSocketOrThrow(
  clientSocket: WebSocket | AuthenticatedWebSocket,
): UserId {
  if (
    clientSocket instanceof WebSocket &&
    'user' in clientSocket &&
    typeof clientSocket.user !== 'undefined' &&
    clientSocket.user !== null
  ) {
    return clientSocket.user.id;
  }
  throw new Error('expected socket with user');
}

async function validateUsageRemaining(clientSocket: AuthenticatedWebSocket) {
  const userId = getUserIdFromSocketOrThrow(clientSocket);
  const usageData = await usageService.getUsage(userId).catch((err) => {
    console.error('error when checking usage: ', err);
    throw err;
  });
  if (usageData.remainingMs <= 0) {
    return closeWithError(clientSocket, WsCloseCode.PolicyViolation, {
      error: 'Exceeded allocated usage',
      code: InternalErrorCode.ExceededAllocatedUsageError,
    });
  }
  clientSocket.ready = true;
  try {
    await sendData(clientSocket, { event: 'ready' });
  } catch (err) {
    console.error('error sending ready: ', err);
  }
}

function clientSocketCloseHandler(this: AuthenticatedWebSocket): void {
  const userId = getUserIdFromSocketOrThrow(this);
  delete USER_ID_SOCKET_MAP[userId];
  delete USER_ID_QUEUE_MAP[userId];
}

function clientSocketMessageHandler(
  this: AuthenticatedWebSocket,
  data: RawData,
): void {
  const userId = getUserIdFromSocketOrThrow(this);
  if (!isReady(this)) {
    return closeWithError(this, WsCloseCode.PolicyViolation, {
      error: 'not ready',
      code: InternalErrorCode.NotReady,
    });
  }
  const buffer = bufferFromRawData(data);
  const queue = getOrInitQueue(userId);
  const queueEntry = new QueueEntry(buffer);
  queue.enqueue(queueEntry);
}

function isReady(clientSocket: AuthenticatedWebSocket): boolean {
  return clientSocket.ready ?? false;
}

function handleConnection(
  clientSocket: AuthenticatedWebSocket,
  req: IncomingMessage,
): void {
  clientSocket.user = authenticateClient(req);

  if (!clientSocket.user) {
    // Close with policy violation
    return closeWithError(clientSocket, WsCloseCode.PolicyViolation, {
      error: 'Unauthorized',
      code: InternalErrorCode.Unauthorized,
    });
  }

  registerSocketForUserId(clientSocket);
  const closeHandler = clientSocketCloseHandler.bind(clientSocket);
  const messageHandler = clientSocketMessageHandler.bind(clientSocket);
  clientSocket.once('close', closeHandler);
  clientSocket.on('message', messageHandler);

  void validateUsageRemaining(clientSocket);
}

function shutdownFactory(
  wss: WebSocketServer,
  abortController: AbortController,
): () => Promise<void> {
  return async () => {
    abortController.abort();
    wss.off('connection', handleConnection);
    wss.clients.forEach((client) => {
      if (client.readyState !== WebSocket.OPEN) {
        return;
      }
      try {
        closeWithError(client, WsCloseCode.GoingAway, {
          error: 'server closing',
          code: InternalErrorCode.ShuttingDown,
        });
      } catch (_err) {
        // socket probably closed from server.close()
      }
    });
    return new Promise<void>((resolve, reject) =>
      wss.close((err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      }),
    );
  };
}

async function processTranscribe(
  userId: UserId,
  queueEntry: QueueEntry,
  mainAbortSignal: AbortSignal,
) {
  const clientSocket = USER_ID_SOCKET_MAP[userId];
  if (!clientSocket) {
    throw new Error('client socket gone');
  }
  const abortController = new AbortController();
  onAbort(mainAbortSignal, () => {
    abortController.abort();
  });
  const unExpectedCloseHandler = () => abortController.abort();
  clientSocket.once('close', unExpectedCloseHandler);
  try {
    const result = await timeout(60_000, (abortSignal) => {
      return transcribeService.transcribeForUser({
        audioPacket: queueEntry.data,
        userId,
        abortSignal,
      });
    });
    if (!isOpen(clientSocket)) {
      // socket closed while we were processing
      // TODO: cache result for limited time and propagate during reconnect
      // noinspection ExceptionCaughtLocallyJS
      throw new ConnectionClosedUnexpectedlyError(
        'Socket closed while processing',
      );
    }
    await sendData(clientSocket, { id: queueEntry.id, ...result });
    if (result.usageRemainingMs <= 0) {
      return closeWithError(clientSocket, WsCloseCode.PolicyViolation, {
        error: 'Exceeded allocated usage',
        code: InternalErrorCode.ExceededAllocatedUsageError,
      });
    }
  } catch (err) {
    if (!isOpen(clientSocket)) {
      // don't attempt to propagate the error if the client disconnected
      return;
    }
    // TODO: refund user if server closing or server error
    handleTranscribeError(err, clientSocket);
  } finally {
    clientSocket.off('close', unExpectedCloseHandler);
  }
}

function* processQueue(
  mainAbortSignal: AbortSignal,
): Generator<Promise<void>, void, void> {
  for (const userId of Object.keys(USER_ID_QUEUE_MAP) as UserId[]) {
    if (mainAbortSignal.aborted) {
      return;
    }
    const clientSocket = USER_ID_SOCKET_MAP[userId];
    if (!clientSocket) {
      continue;
    }
    const lock = USER_ID_QUEUE_MAP[userId];
    if (!lock) {
      continue;
    }
    if (lock.isLocked) {
      continue;
    }
    if (!lock.lock()) {
      continue;
    }
    const queue = lock.inner;
    if (!isOpen(clientSocket)) {
      // TODO: allow reconnect to continue queue?
      delete USER_ID_QUEUE_MAP[userId];
      continue;
    }
    const nextItem = queue.dequeue();
    if (!nextItem) {
      lock.unlock();
      continue;
    }
    yield processTranscribe(userId, nextItem, mainAbortSignal)
      .catch((err) => {
        // TODO: recover by saving result or restoring entry in queue
        console.error(`failed to transcribe`, err);
      })
      .finally(() => {
        lock.unlock();
      });
  }
}

// TODO: potentially silly, should use a job queue system like RabbitMQ
async function queueRunner(
  maxConcurrent: number,
  mainAbortSignal: AbortSignal,
) {
  const set = new Set<Promise<void>>();
  while (true) {
    if (mainAbortSignal.aborted) {
      return;
    }
    await delay(0);
    const queue = processQueue(mainAbortSignal);
    for (const transcribePromise of queue) {
      set.add(
        transcribePromise.finally(() => {
          // remove from set as they finish
          set.delete(transcribePromise);
        }),
      );
      if (set.size === maxConcurrent) {
        await Promise.race([rejectOnAbort(mainAbortSignal), Promise.any(set)]);
        set.clear();
      }
    }
  }
}

function startQueueRunner(mainAbortSignal: AbortSignal) {
  void queueRunner(5, mainAbortSignal).catch((err) => {
    if (err instanceof AbortedError) {
      return;
    }
    console.error('impossible?', err);
  });
}

export function setupWebSocket(server: Server) {
  const wss = new WebSocketServer<AuthenticatedWebSocket>({
    server,
  });

  const abortController = new AbortController();
  const shutdown = shutdownFactory(wss, abortController);
  startQueueRunner(abortController.signal);
  wss.on('connection', handleConnection);

  return {
    wss,
    shutdown,
  };
}
