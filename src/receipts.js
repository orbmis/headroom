import { clone, hashOf } from "./utils.js";

export class ReceiptStore {
  constructor({ clock }) {
    this.clock = clock;
    this.receipts = [];
  }

  record(receipt) {
    const timestamp = this.clock();
    const base = {
      ...receipt,
      timestamp
    };
    const receiptHash = hashOf({
      type: "RebalanceAttemptReceipt",
      receipt: base,
      ordinal: this.receipts.length + 1
    });
    const stored = {
      receiptHash,
      ...base
    };
    this.receipts.push(stored);
    return clone(stored);
  }

  list() {
    return clone(this.receipts);
  }

  latest() {
    return clone(this.receipts.at(-1));
  }
}
