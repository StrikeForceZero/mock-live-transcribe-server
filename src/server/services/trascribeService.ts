import { LoremIpsum } from 'lorem-ipsum';
import { rejectOnAbort } from '@util/abort';
import { delay } from '@util/delay';
import { ExceededAllocatedUsageError } from '@util/error';
import { getRandomArbitrary } from '@util/random';
import { UserId } from '@server/types';
import * as usageService from '@server/services/usageService';

export const BYTES_PER_WORD = 16_000; // 16k bytes per word is probably an ok average with PCM 16kz/16bit
export const MS_PER_WORD = 250;

const lorem = new LoremIpsum({
  sentencesPerParagraph: {
    max: 8,
    min: 4,
  },
  wordsPerSentence: {
    max: 16,
    min: 4,
  },
});

function fakeSpeechWordCount(audioPacket: Buffer): number {
  // fake processing time by saying it will take 50ms per word
  return Math.ceil(audioPacket.length / BYTES_PER_WORD);
}

function fakeProcessTime(wordCount: number): number {
  // fake processing time by saying it will take 250ms per word
  return Math.ceil(wordCount * MS_PER_WORD);
}

function fakeTranscriptText(audioPacket: Buffer): string {
  const estimatedWordCount = fakeSpeechWordCount(audioPacket);
  return lorem.generateWords(estimatedWordCount);
}

async function fakeTranscribe(
  audioPacket: Buffer,
  abortSignal?: AbortSignal,
): Promise<TranscribeResult> {
  const fakeProcessTimeMs = fakeProcessTime(fakeSpeechWordCount(audioPacket));
  const transcribeProcess = delay(fakeProcessTimeMs);
  if (abortSignal) {
    if (abortSignal.aborted) {
      throw new Error('Aborted');
    }
    await Promise.race([transcribeProcess, rejectOnAbort(abortSignal)]);
  } else {
    await transcribeProcess;
  }
  const transcript = fakeTranscriptText(audioPacket);
  return {
    transcript,
    confidence: getRandomArbitrary(0.5, 1.0),
    usageUsedMs: fakeProcessTimeMs,
  };
}

export interface TranscribeForUserRequest {
  userId: UserId;
  audioPacket: Buffer;
  abortSignal?: AbortSignal;
}

export interface TranscribeRequest {
  audioPacket: Buffer;
  usageRemainingMs: number;
  abortSignal?: AbortSignal;
}

export interface TranscribeResult {
  transcript: string;
  usageUsedMs: number;
  confidence: number;
}

export type TranscribeResponse = TranscribeResult & {
  usageRemainingMs: number;
};

export function estimateUsageMs(audioPacket: Buffer): number {
  return fakeProcessTime(fakeSpeechWordCount(audioPacket));
}

async function transcribe(
  audioPacket: Buffer,
  abortSignal?: AbortSignal,
): Promise<TranscribeResult> {
  // process audio packet via native module or external service
  return await fakeTranscribe(audioPacket, abortSignal);
}

export async function handleTranscribeRequest(
  request: Readonly<TranscribeRequest>,
): Promise<TranscribeResponse> {
  const result = await transcribe(request.audioPacket, request.abortSignal);
  return {
    ...result,
    usageRemainingMs: request.usageRemainingMs - result.usageUsedMs,
  };
}

export async function transcribeForUser(
  request: TranscribeForUserRequest,
): Promise<TranscribeResponse> {
  const usageForUsage = await usageService.getUsage(request.userId);
  const remainingMs = usageForUsage.remainingMs;
  if (remainingMs <= 0) {
    throw new ExceededAllocatedUsageError('No usage remaining');
  }
  if (remainingMs < estimateUsageMs(request.audioPacket)) {
    throw new ExceededAllocatedUsageError(
      'Not enough usage remaining to process request',
    );
  }
  const transcribeResult = await handleTranscribeRequest({
    usageRemainingMs: remainingMs,
    audioPacket: request.audioPacket,
    abortSignal: request.abortSignal,
  });
  await usageService.updateUsage(request.userId, transcribeResult.usageUsedMs);
  return transcribeResult;
}
