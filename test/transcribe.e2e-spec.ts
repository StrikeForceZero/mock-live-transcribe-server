import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import pLimit from 'p-limit';
import { RawData, WebSocket } from 'ws';
import { createServer } from '@server';
import {
  BYTES_PER_WORD,
  MS_PER_WORD,
  TranscribeResponse,
} from '@server/services/trascribeService';
import {
  resetStorage,
  STARTING_USAGE_LIMIT_MS,
  UsageData,
} from '@server/services/usageService';
import {
  bufferFromRawData,
  CloseReasonObj,
  InternalErrorCode,
  WsCloseCode,
} from '@server/ws/wsTranscribe';
import { bufferTextOrThrow } from '@util/buffer';
import { delay } from '@util/delay';
import { timeout } from '@util/timeout';

const limit = pLimit(1);

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
  return (await response.json()) as UsageData;
}

function createWs(token: string): WebSocket {
  return new WebSocket(WS_TRANSCRIBE_URL, {
    headers: {
      authorization: token,
    },
  });
}

enum WsEventName {
  Open = 'open',
  Close = 'close',
  Error = 'error',
  Message = 'message',
}

type WsOpenEvent = { event: WsEventName.Open };
type WsCloseEvent = { event: WsEventName.Close; code: number; reason: Buffer };
type WsErrorEvent = { event: WsEventName.Error; error: Error };
type WsMessageEvent = { event: WsEventName.Message; data: RawData };

const WS_EVENT_KEY_OBJ_OPEN: Pick<WsOpenEvent, 'event'> = {
  event: WsEventName.Open,
};
const WS_EVENT_KEY_OBJ__CLOSE: Pick<WsCloseEvent, 'event'> = {
  event: WsEventName.Close,
};
const WS_EVENT_KEY_OBJ_ERROR: Pick<WsErrorEvent, 'event'> = {
  event: WsEventName.Error,
};
const WS_EVENT_KEY_OBJ_MESSAGE: Pick<WsMessageEvent, 'event'> = {
  event: WsEventName.Message,
};

function createOpenEvent(): WsOpenEvent {
  return { ...WS_EVENT_KEY_OBJ_OPEN };
}

function createCloseEvent({
  code,
  reason,
}: Omit<WsCloseEvent, 'event'>): WsCloseEvent {
  return { ...WS_EVENT_KEY_OBJ__CLOSE, code, reason };
}

function createErrorEvent({
  error,
}: Omit<WsErrorEvent, 'event'>): WsErrorEvent {
  return { ...WS_EVENT_KEY_OBJ_ERROR, error };
}

function createMessageEvent({
  data,
}: Omit<WsMessageEvent, 'event'>): WsMessageEvent {
  return { ...WS_EVENT_KEY_OBJ_MESSAGE, data };
}

type WsEvent = WsOpenEvent | WsCloseEvent | WsErrorEvent | WsMessageEvent;

type EventQueue = Queue<WsEvent>;

class Queue<T> {
  private items: T[] = [];

  enqueue(item: T): void {
    this.items.push(item);
  }

  dequeue(): T | undefined {
    return this.items.shift();
  }

  peek(): T | undefined {
    return this.items[0];
  }

  isEmpty(): boolean {
    return this.items.length === 0;
  }

  size(): number {
    return this.items.length;
  }

  clear(): void {
    this.items = [];
  }

  toArray(): T[] {
    return [...this.items];
  }

  findIndex(predicate: (item: T) => boolean): number {
    return this.items.findIndex(predicate);
  }

  filter(predicate: (item: T) => boolean): T[] {
    return this.items.filter(predicate);
  }
}

// type WsEventHandlers = {
//   [K in WsEventName]: Parameters<WebSocket['on']>[1] extends (
//     event: K,
//     listener: infer F,
//   ) => any
//     ? F
//     : never;
// };

type WsEventHandlers = {
  open: () => void;
  message: (data: RawData) => void;
  close: (code: number, reason: Buffer) => void;
  error: (err: Error) => void;
};

function registerEvents(ws: WebSocket, eventHandlers: WsEventHandlers) {
  const entries = Object.entries(eventHandlers) as [
    keyof WsEventHandlers,
    WsEventHandlers[keyof WsEventHandlers],
  ][];
  for (const [eventName, handler] of entries) {
    ws.on(eventName, handler);
  }
}

function unRegisterEvents(ws: WebSocket, eventHandlers: WsEventHandlers) {
  for (const [eventName, handler] of Object.entries(eventHandlers)) {
    ws.off(eventName, handler);
  }
}

class WsEventQueueWrapper {
  private readonly eventQueue: EventQueue = new Queue<WsEvent>();
  private readonly eventHandlers: WsEventHandlers = {
    open: this.onOpen.bind(this),
    close: this.onClose.bind(this),
    error: this.onError.bind(this),
    message: this.onMessage.bind(this),
  };
  private totalEventCounter: number = 0;
  constructor(readonly ws: WebSocket) {
    registerEvents(ws, this.eventHandlers);
  }

  private removeListeners(): void {
    unRegisterEvents(this.ws, this.eventHandlers);
  }

  private onOpen(): void {
    this.pushBackEvent(createOpenEvent());
  }

  private onClose(code: number, reason: Buffer): void {
    this.pushBackEvent(createCloseEvent({ code, reason }));
  }

  private onError(err: Error): void {
    this.pushBackEvent(createErrorEvent({ error: err }));
  }

  private onMessage(data: RawData): void {
    this.pushBackEvent(createMessageEvent({ data }));
  }

  private pushBackEvent(event: WsEvent): void {
    this.totalEventCounter++;
    this.eventQueue.enqueue(event);
  }

  popFrontEvent(): WsEvent | undefined {
    return this.eventQueue.dequeue();
  }

  eventQueuePeek(): WsEvent | undefined {
    return this.eventQueue.peek();
  }

  eventQueueIsEmpty(): boolean {
    return this.eventQueue.isEmpty();
  }

  eventQueueSize(): number {
    return this.eventQueue.size();
  }

  eventQueueClear(): void {
    this.eventQueue.clear();
  }

  eventQueueToArray(): WsEvent[] {
    return this.eventQueue.toArray();
  }

  findIndex(predicate: (item: WsEvent) => boolean): number {
    return this.eventQueue.findIndex(predicate);
  }

  filter(predicate: (item: WsEvent) => boolean): WsEvent[] {
    return this.eventQueue.filter(predicate);
  }

  isClosed(): boolean {
    return this.ws.readyState === WebSocket.CLOSED;
  }

  close(code: WsCloseCode, data?: string | Buffer): void {
    this.ws.close(code, data);
  }

  async send(data: Buffer): Promise<void> {
    if (this.isClosed()) {
      throw new Error('socket closed');
    }
    return new Promise<void>((resolve, reject) => {
      this.ws.send(data, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  totalEventsSeenCount(): number {
    return this.totalEventCounter;
  }

  private isPolling = false;
  // TODO: isPolling isn't set until first .next()
  async *pollQueue({
    timeout: timeoutMs,
  }: {
    timeout?: number;
  } = {}): AsyncGenerator<WsEvent, void, boolean> {
    if (this.isPolling) {
      throw new Error('already polling');
    }
    if (this.isClosed()) {
      return;
    }
    this.isPolling = true;
    let wakeUp: (() => void) | null = null;
    const wakeupHandler = () => {
      wakeUp?.();
    };
    const eventHandlers: WsEventHandlers = {
      open: wakeupHandler,
      close: wakeupHandler,
      error: wakeupHandler,
      message: wakeupHandler,
    };
    try {
      registerEvents(this.ws, eventHandlers);
      while (true) {
        // Yield all items currently in the queue
        while (!this.eventQueue.isEmpty()) {
          const shouldEnd = yield this.eventQueue.dequeue()!;
          if (shouldEnd) {
            return;
          }
        }

        if (this.isClosed()) {
          return;
        }

        // Wait for the next pushBackEvent call
        const wakeupPromise = new Promise<void>((resolve) => {
          wakeUp = resolve;
        });
        if (timeoutMs !== undefined) {
          await timeout(timeoutMs, () => wakeupPromise);
        } else {
          await wakeupPromise;
        }
        wakeUp = null;
      }
    } finally {
      unRegisterEvents(this.ws, eventHandlers);
      wakeUp = null;
      this.isPolling = false;
    }
  }
}

type Awaitable<T> = T | PromiseLike<T>;

async function nextEventOrThrow(
  asyncIteratorResult: Promise<IteratorResult<WsEvent, void>>,
): Promise<WsEvent> {
  const { value, done } = await asyncIteratorResult;
  if (done) {
    throw new Error('async iterator done');
  }
  return value;
}

function uncheckedRawDataToObject<T>(rawData: RawData): T {
  return uncheckedBufferToObject(bufferFromRawData(rawData));
}

function uncheckedBufferToObject<T>(
  buffer: Buffer,
  emptyBufferAsEmptyObject = false,
): T {
  const bufferString = bufferTextOrThrow(buffer);
  if (emptyBufferAsEmptyObject && bufferString === '') {
    return {} as T;
  }
  try {
    return JSON.parse(bufferString) as T;
  } catch (_err) {
    throw new Error(`failed to deserialize json from: ${bufferString}`);
  }
}

type InferWsEventFromType<ET> = ET extends WsEventName.Open
  ? WsOpenEvent
  : ET extends WsEventName.Close
    ? WsCloseEvent
    : ET extends WsEventName.Error
      ? WsErrorEvent
      : ET extends WsEventName.Message
        ? WsMessageEvent
        : never;

function _assertWsEvent<T extends WsEvent, ET extends T['event']>(
  wsEvent: WsEvent,
  eventType: ET,
): asserts wsEvent is InferWsEventFromType<typeof eventType> {
  expect(wsEvent.event).toBe(eventType);
}

async function expectWsEventIsType<T extends WsEvent, ET extends T['event']>(
  asyncWsEvent: Awaitable<T>,
  eventType: ET,
): Promise<InferWsEventFromType<ET>> {
  const wsEvent = await asyncWsEvent;
  _assertWsEvent(wsEvent, eventType);
  return wsEvent;
}

const MESSAGE_DATA_READY_EVENT = { event: 'ready' };

async function expectWsEventOpen(
  asyncWsEvent: Awaitable<WsEvent>,
): Promise<void> {
  await expectWsEventIsType(asyncWsEvent, WsEventName.Open);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function expectWsEventCloseHasReasonObj<T>(
  asyncWsEvent: Awaitable<WsCloseEvent>,
  expectedWsCloseCode: WsCloseCode,
  expectedReasonObject: T,
): Promise<T> {
  const closeEvent = await expectWsEventIsType(asyncWsEvent, WsEventName.Close);
  const reasonObj = uncheckedBufferToObject<T>(closeEvent.reason, true);
  expect({ code: closeEvent.code, reason: reasonObj }).toEqual({
    code: expectedWsCloseCode,
    reason: expectedReasonObject,
  });
  return reasonObj;
}

async function expectWsEventCloseHasReasonPartialObj<T>(
  asyncWsEvent: Awaitable<WsEvent>,
  expectedWsCloseCode: WsCloseCode,
  expectedReasonObject?: Partial<T>,
): Promise<T> {
  const closeEvent = await expectWsEventIsType(asyncWsEvent, WsEventName.Close);
  const reasonObj = uncheckedBufferToObject<T>(closeEvent.reason, true);
  const baseExpectedObj = { code: expectedWsCloseCode };
  const expectedObj = expectedReasonObject
    ? {
        ...baseExpectedObj,
        reason: expect.objectContaining(expectedReasonObject),
      }
    : baseExpectedObj;
  expect({ code: closeEvent.code, reason: reasonObj }).toEqual(
    expect.objectContaining(expectedObj),
  );
  return reasonObj;
}

async function expectWsEventCloseNormal(
  asyncWsEvent: Awaitable<WsEvent>,
): Promise<void> {
  await expectWsEventCloseHasReasonPartialObj(asyncWsEvent, WsCloseCode.Normal);
}

async function expectWsEventReady(
  asyncWsEvent: Awaitable<WsEvent>,
): Promise<void> {
  await expectWsEventMessageWithDataObj(
    expectWsEventIsType(asyncWsEvent, WsEventName.Message),
    MESSAGE_DATA_READY_EVENT,
  );
}

async function expectWsEventMessageWithDataObj<T>(
  asyncWsEvent: Awaitable<WsEvent>,
  expectedData: T,
): Promise<T> {
  const messageEvent = await expectWsEventIsType(
    asyncWsEvent,
    WsEventName.Message,
  );
  const dataObj = uncheckedRawDataToObject<T>(messageEvent.data);
  expect(dataObj).toEqual(expectedData);
  return dataObj;
}

async function expectWsEventMessageWithDataPartialObj<T>(
  asyncWsEvent: Awaitable<WsEvent>,
  expectedPartialData: Partial<T>,
): Promise<T> {
  const messageEvent = await expectWsEventIsType(
    asyncWsEvent,
    WsEventName.Message,
  );
  const dataObj = uncheckedRawDataToObject<T>(messageEvent.data);
  expect(dataObj).toEqual(expect.objectContaining(expectedPartialData));
  return dataObj;
}

describe('Transcribe', () => {
  let server: { shutdown: () => Promise<void[]> };
  beforeEach(async () => {
    resetStorage();
    server = await createServer(3000);
  });
  afterEach(async () => {
    await server.shutdown();
  });
  describe('WsEventQueueWrapper', () => {
    it('should collect events', async () => {
      await limit(async () => {
        const ws = new WsEventQueueWrapper(createWs(USER_1_TOKEN));
        await delay(100);
        const events = ws.eventQueueToArray();
        expect(events.length).toBeGreaterThan(0);
      });
    });
    it('should pollQueue', async () => {
      await limit(async () => {
        const ws = new WsEventQueueWrapper(createWs(USER_1_TOKEN));
        const events = ws.pollQueue({ timeout: 100 });
        await expect(events.next()).resolves.toEqual(
          expect.objectContaining({
            value: expect.objectContaining({
              event: WsEventName.Open,
            }),
            done: false,
          }),
        );
        await expectWsEventReady(nextEventOrThrow(events.next()));
        ws.close(WsCloseCode.Normal);
        await expectWsEventCloseNormal(nextEventOrThrow(events.next()));
        expect(ws.totalEventsSeenCount()).toBeGreaterThanOrEqual(2);
      });
    });
    it('should only allow one pollQueue at a time', async () => {
      await limit(async () => {
        const ws = new WsEventQueueWrapper(createWs(USER_1_TOKEN));
        const events = ws.pollQueue({ timeout: 100 });
        // consume the generator
        await expectWsEventOpen(nextEventOrThrow(events.next()));
        await expectWsEventReady(nextEventOrThrow(events.next()));
        await expect(ws.pollQueue({ timeout: 100 }).next()).rejects.toThrow(
          'already polling',
        );
        // stop polling
        await events.return();
        ws.close(WsCloseCode.Normal);
        await expect(events.next()).resolves.toEqual({
          done: true,
          value: undefined,
        });
      });
    });
  });
  it('should block unauthorized http requests', async () =>
    await limit(async () => {
      const response = await fetch(API_USAGE_URL, {
        method: 'GET',
      });
      expect(response.status).toBe(401);
    }));
  it('should allow authorized http requests', async () =>
    await limit(async () => {
      const response = await fetch(API_USAGE_URL, {
        method: 'GET',
        headers: {
          authorization: USER_1_TOKEN,
        },
      });
      expect(response.status).toBe(200);
    }));
  it('should block unauthorized ws requests', async () =>
    await limit(async () => {
      const ws = new WsEventQueueWrapper(new WebSocket(WS_TRANSCRIBE_URL));
      const events = ws.pollQueue({ timeout: 100 });
      await expectWsEventIsType(
        nextEventOrThrow(events.next()),
        WsEventName.Open,
      );
      await expectWsEventCloseHasReasonPartialObj(
        nextEventOrThrow(events.next()),
        WsCloseCode.PolicyViolation,
        {
          code: InternalErrorCode.Unauthorized,
        },
      );
    }));
  it('should allow authorized ws requests', async () =>
    await limit(async () => {
      const ws = new WsEventQueueWrapper(createWs(USER_1_TOKEN));
      const events = ws.pollQueue({ timeout: 100 });
      await expectWsEventOpen(nextEventOrThrow(events.next()));
      await expectWsEventReady(nextEventOrThrow(events.next()));
      ws.close(WsCloseCode.Normal);
      await expectWsEventCloseNormal(nextEventOrThrow(events.next()));
    }));
  it('should transcribe', async () => {
    await limit(async () => {
      const ws = new WsEventQueueWrapper(createWs(USER_1_TOKEN));
      const events = ws.pollQueue({
        // endpoint should return within time it takes to transcribe one word x 2
        timeout: BYTES_PER_WORD * 2,
      });
      await expectWsEventOpen(nextEventOrThrow(events.next()));
      await expectWsEventReady(nextEventOrThrow(events.next()));
      await ws.send(Buffer.alloc(BYTES_PER_WORD));
      const response =
        await expectWsEventMessageWithDataPartialObj<TranscribeResponse>(
          nextEventOrThrow(events.next()),
          {
            usageUsedMs: MS_PER_WORD,
          },
        );
      expect(response.usageUsedMs).toEqual(MS_PER_WORD);
      ws.close(WsCloseCode.Normal);
      await expectWsEventCloseNormal(nextEventOrThrow(events.next()));
    });
  });
  it('should only allow one connection per user/token', async () => {
    await limit(async () => {
      const wsA1 = new WsEventQueueWrapper(createWs(USER_1_TOKEN));
      const eventsA1 = wsA1.pollQueue({ timeout: 100 });
      await expectWsEventOpen(nextEventOrThrow(eventsA1.next()));
      await expectWsEventReady(nextEventOrThrow(eventsA1.next()));

      const wsA2 = new WsEventQueueWrapper(createWs(USER_1_TOKEN));
      const eventsA2 = wsA2.pollQueue({ timeout: 100 });
      await expectWsEventOpen(nextEventOrThrow(eventsA2.next()));

      // connection should be replaced
      await expectWsEventCloseHasReasonPartialObj<CloseReasonObj>(
        nextEventOrThrow(eventsA1.next()),
        WsCloseCode.PolicyViolation,
        {
          code: InternalErrorCode.ConnectionReplacedError,
        },
      );

      await expectWsEventReady(nextEventOrThrow(eventsA2.next()));

      // user 2 should be able to connect no problem
      const wsB1 = new WsEventQueueWrapper(createWs(USER_2_TOKEN));
      const eventsB1 = wsB1.pollQueue({ timeout: 100 });
      await expectWsEventOpen(nextEventOrThrow(eventsB1.next()));
      await expectWsEventReady(nextEventOrThrow(eventsB1.next()));

      wsB1.close(WsCloseCode.Normal);
      await expectWsEventCloseNormal(nextEventOrThrow(eventsB1.next()));
      wsA2.close(WsCloseCode.Normal);
      await expectWsEventCloseNormal(nextEventOrThrow(eventsA2.next()));
    });
  });
  it('should block connection after usage limit', async () => {
    await limit(async () => {
      const MAX_REMAINING_PAYLOAD_SIZE = Math.ceil(
        (STARTING_USAGE_LIMIT_MS / MS_PER_WORD) * BYTES_PER_WORD,
      );
      const MAX_REMAINING_USAGE_MS =
        (MAX_REMAINING_PAYLOAD_SIZE / BYTES_PER_WORD) * MS_PER_WORD;
      // closed after usage
      {
        const ws = new WsEventQueueWrapper(createWs(USER_1_TOKEN));
        const events = ws.pollQueue({
          // endpoint should return within time it takes to transcribe MAX_REMAINING_PAYLOAD_SIZE x 2
          timeout: MAX_REMAINING_USAGE_MS * 2,
        });
        await expectWsEventOpen(nextEventOrThrow(events.next()));
        await expectWsEventReady(nextEventOrThrow(events.next()));
        await ws.send(Buffer.alloc(MAX_REMAINING_PAYLOAD_SIZE));
        await expectWsEventMessageWithDataPartialObj(
          nextEventOrThrow(events.next()),
          {
            usageUsedMs: MAX_REMAINING_USAGE_MS,
          },
        );
        await expectWsEventCloseHasReasonPartialObj(
          nextEventOrThrow(events.next()),
          WsCloseCode.PolicyViolation,
          {
            code: InternalErrorCode.ExceededAllocatedUsageError,
          },
        );
      }
      // closed on connection
      {
        const ws = new WsEventQueueWrapper(createWs(USER_1_TOKEN));
        const events = ws.pollQueue({ timeout: 100 });
        await expectWsEventOpen(nextEventOrThrow(events.next()));
        await expectWsEventCloseHasReasonPartialObj(
          nextEventOrThrow(events.next()),
          WsCloseCode.PolicyViolation,
          {
            code: InternalErrorCode.ExceededAllocatedUsageError,
          },
        );
      }
    });
  });
  it('should transcribe until out of usage', async () =>
    await limit(async () => {
      async function runTest(token: string): Promise<void> {
        const ws = new WsEventQueueWrapper(createWs(token));
        const events = ws.pollQueue({
          // endpoint should return within time it takes to transcribe one word x 2
          timeout: MS_PER_WORD * 2,
        });
        await expectWsEventOpen(nextEventOrThrow(events.next()));
        await expectWsEventReady(nextEventOrThrow(events.next()));
        let usageRemainingMs = STARTING_USAGE_LIMIT_MS;
        let totalUsed = 0;
        while (usageRemainingMs > 0) {
          await ws.send(Buffer.alloc(BYTES_PER_WORD));
          const data =
            await expectWsEventMessageWithDataPartialObj<TranscribeResponse>(
              nextEventOrThrow(events.next()),
              {
                usageUsedMs: MS_PER_WORD,
              },
            );
          usageRemainingMs -= data.usageUsedMs;
          totalUsed += data.usageUsedMs;
          expect(await fetchUsageData(token)).toEqual({
            usage: {
              remainingMs: usageRemainingMs,
              totalUsedMs: totalUsed,
            },
          });
          if (usageRemainingMs <= 0) {
            expect(data.usageRemainingMs).toBe(usageRemainingMs);
          }
        }
        await expectWsEventCloseHasReasonPartialObj(
          nextEventOrThrow(events.next()),
          WsCloseCode.PolicyViolation,
          {
            code: InternalErrorCode.ExceededAllocatedUsageError,
          },
        );
      }
      await Promise.all([runTest(USER_1_TOKEN), runTest(USER_2_TOKEN)]);
    }));
});
