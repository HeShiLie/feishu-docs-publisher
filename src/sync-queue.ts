/** Serialize complete sync operations, including binding reads and writes. */
export class SyncQueue {
	private tail: Promise<unknown> = Promise.resolve();

	async run<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.tail.then(operation);
		// A failed operation must not prevent the next sync from running.
		this.tail = result.catch(() => undefined);
		return await result;
	}
}
