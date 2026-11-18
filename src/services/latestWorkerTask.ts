/** Let a running scan finish; retain only the newest waiting snapshot. */
export class LatestWorkerTask<T> {
  private nextId = 0;
  private runningId: number | undefined;
  private pending: { taskId: number; input: T } | undefined;
  private disposed = false;

  constructor(private send: (task: { taskId: number; input: T }) => void) {}

  submit(input: T): void {
    if (this.disposed) return;
    this.pending = { taskId: ++this.nextId, input };
    this.startNext();
  }

  accepts(taskId: number): boolean {
    return !this.disposed && this.runningId === taskId;
  }

  complete(taskId: number): void {
    if (!this.accepts(taskId)) return;
    this.runningId = undefined;
    this.startNext();
  }

  dispose(): void {
    this.disposed = true;
    this.pending = undefined;
  }

  private startNext(): void {
    if (this.runningId !== undefined || !this.pending) return;
    const task = this.pending;
    this.pending = undefined;
    this.runningId = task.taskId;
    this.send(task);
  }
}
