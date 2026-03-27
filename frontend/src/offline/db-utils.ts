import { db } from "./db";
import Dexie from "dexie/dist/dexie.mjs";

let writeChain: Promise<unknown> = Promise.resolve();

export function withWriteLock(fn: () => Promise<unknown> | unknown) {
	writeChain = writeChain
		.then(() => fn())
		.catch((e) => {
			console.error("DB operation failed", e);
		});
	return writeChain;
}

export async function getAllByCursor(store: string, limit = Infinity) {
	const results: any[] = [];
	try {
		await db.transaction("r", db.table(store), async () => {
			let count = 0;
			await db.table(store).each((item: any) => {
				results.push(item);
				count += 1;
				if (count >= limit) throw Dexie.IterationComplete;
			});
		});
	} catch (e) {
		if (e !== Dexie.IterationComplete) {
			console.error("Cursor read failed", e);
		}
	}
	return results;
}
