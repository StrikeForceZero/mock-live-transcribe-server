import { describe, expect, it } from '@jest/globals';
import { Queue } from '@util/queue';

describe('Queue', () => {
  it('should enqueue / dequeue', () => {
    const queue = new Queue<number>();
    queue.enqueue(1);
    queue.enqueue(2);
    expect(queue.dequeue()).toBe(1);
    queue.enqueue(3);
    expect(queue.dequeue()).toBe(2);
    expect(queue.dequeue()).toBe(3);
  });
  it('should toArray', () => {
    const queue = new Queue<number>();
    queue.enqueue(1);
    queue.enqueue(2);
    expect(queue.toArray()).toEqual([1, 2]);
    expect(queue.dequeue()).toBe(1);
    queue.enqueue(3);
    expect(queue.toArray()).toEqual([2, 3]);
  });
  it('should peek', () => {
    const queue = new Queue<number>();
    queue.enqueue(1);
    queue.enqueue(2);
    expect(queue.peek()).toBe(1);
    expect(queue.dequeue()).toBe(1);
    expect(queue.peek()).toBe(2);
  });
  it('should isEmpty', () => {
    const queue = new Queue<number>();
    expect(queue.isEmpty()).toBe(true);
    queue.enqueue(1);
    expect(queue.isEmpty()).toBe(false);
    queue.dequeue();
    expect(queue.isEmpty()).toBe(true);
    queue.enqueue(1);
    expect(queue.isEmpty()).toBe(false);
  });
  it('should clear', () => {
    const queue = new Queue<number>();
    queue.enqueue(1);
    queue.enqueue(2);
    queue.clear();
    expect(queue.dequeue()).toBe(undefined);
    expect(queue.toArray()).toEqual([]);
    queue.enqueue(1);
    expect(queue.dequeue()).toBe(1);
  });
});
