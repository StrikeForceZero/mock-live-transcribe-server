import { IncomingMessage, Server } from 'http';
import * as console from 'node:console';
import { RawData, WebSocket, WebSocketServer } from 'ws';
import * as usageService from '@server/services/usageService';
import {
  AbortedError,
  ConnectionClosedUnexpectedlyError,
  ExceededAllocatedUsageError,
  TimeoutError,
} from '@util/error';
import { timeout } from '@util/timeout';
import { getTokenFromAuthorization, getUserIdFromToken } from '@server/auth';
import * as transcribeService from '@server/services/trascribeService';
import { userId, UserId } from '@server/types';

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
  ServerError = 99,
}

type AuthenticatedWebSocket = WebSocket &
  typeof WebSocket & {
    user?: { id: UserId } | null;
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

const USER_ID_SOCKET_MAP: Record<UserId, WebSocket | undefined> = {};
const USER_ID_READY_SOCKET_MAP: Record<UserId, boolean | undefined> = {};

function registerSocketForUserId(clientSocket: WebSocket, userId: UserId) {
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
  USER_ID_READY_SOCKET_MAP[userId] = false;
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

// TODO: cleanup
async function validateUsageRemaining(
  clientSocket: AuthenticatedWebSocket,
  userId: UserId,
  onReady: () => void,
) {
  const usageData = await usageService.getUsage(userId).catch((err) => {
    console.error('error when checking usage: ', err);
    throw err;
  });
  if (usageData.remainingMs <= 0) {
    closeWithError(clientSocket, WsCloseCode.PolicyViolation, {
      error: 'Exceeded allocated usage',
      code: InternalErrorCode.ExceededAllocatedUsageError,
    });
    return;
  }
  onReady();
  try {
    await sendData(clientSocket, { event: 'ready' });
  } catch (err) {
    console.error('error sending ready: ', err);
  }
}

function handleCloseFactory(userId: UserId): () => void {
  return () => {
    delete USER_ID_SOCKET_MAP[userId];
    delete USER_ID_READY_SOCKET_MAP[userId];
  };
}

function handleMessageFactory(
  userId: UserId,
): (this: AuthenticatedWebSocket, data: RawData) => void {
  return function (this: AuthenticatedWebSocket, data) {
    if (!isReady(userId)) {
      return closeWithError(this, WsCloseCode.PolicyViolation, {
        error: 'not ready',
        code: InternalErrorCode.NotReady,
      });
    }
    const buffer = bufferFromRawData(data);
    const abortController = new AbortController();
    void (async () => {
      const unExpectedCloseHandler = () => abortController.abort();
      this.once('close', unExpectedCloseHandler);
      try {
        // TODO: use a queue and offload packets to the filesystem if overloaded, this also ensures transcriptions are processed and returned in order
        //  or add some form of counter to the requests sent from the client so the server can return them in the correct order
        // TODO: mutex / lock for each user to prevent over usage or estimate the usage and subtract it from allowance up front
        const result = await timeout(60_000, (abortSignal) => {
          return transcribeService.transcribeForUser({
            audioPacket: buffer,
            userId,
            abortSignal,
          });
        });
        if (!isOpen(this)) {
          // socket closed while we were processing
          // TODO: cache result for limited time and propagate during reconnect
          // noinspection ExceptionCaughtLocallyJS
          throw new ConnectionClosedUnexpectedlyError(
            'Socket closed while processing',
          );
        }
        await sendData(this, result);
        if (result.usageRemainingMs <= 0) {
          return closeWithError(this, WsCloseCode.PolicyViolation, {
            error: 'Exceeded allocated usage',
            code: InternalErrorCode.ExceededAllocatedUsageError,
          });
        }
      } catch (err) {
        if (!isOpen(this)) {
          // don't attempt to propagate the error if the client disconnected
          return;
        }
        // TODO: refund user if server closing or server error
        handleTranscribeError(err, this);
      } finally {
        this.off('close', unExpectedCloseHandler);
      }
    })();
  };
}

function isReady(userId: UserId): boolean {
  return USER_ID_READY_SOCKET_MAP[userId] ?? false;
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

  const userId = clientSocket.user.id;
  registerSocketForUserId(clientSocket, userId);
  const closeHandler = handleCloseFactory(userId);
  const messageHandler = handleMessageFactory(userId).bind(clientSocket);
  clientSocket.once('close', closeHandler);
  clientSocket.on('message', messageHandler);

  void validateUsageRemaining(clientSocket, userId, () => {
    USER_ID_READY_SOCKET_MAP[userId] = true;
  });
}

function shutdownFactory(wss: WebSocketServer): () => Promise<void> {
  return async () => {
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

export function setupWebSocket(server: Server) {
  const wss = new WebSocketServer<AuthenticatedWebSocket>({
    server,
  });

  wss.on('connection', handleConnection);

  const shutdown = shutdownFactory(wss);

  return {
    wss,
    shutdown,
  };
}
