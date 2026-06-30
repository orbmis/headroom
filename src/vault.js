import { assertCondition } from "./utils.js";

export class MockVault {
  constructor({ name, riskBucket, apyBps, token }) {
    this.name = name;
    this.riskBucket = riskBucket;
    this.apyBps = apyBps;
    this.token = token;
    this.address = `vault:${name}`;
    this.shareBalances = new Map();
  }

  deposit(owner, amount) {
    this.#assertPositiveAmount(amount);
    this.token.transfer(owner, this.address, amount);
    this.shareBalances.set(owner, this.balanceOf(owner) + amount);
  }

  withdraw(owner, amount) {
    this.#assertPositiveAmount(amount);
    assertCondition(this.balanceOf(owner) >= amount, "VAULT_INSUFFICIENT_SHARES", "Vault balance is insufficient.", {
      vault: this.name,
      owner,
      requested: amount,
      available: this.balanceOf(owner)
    });
    this.shareBalances.set(owner, this.balanceOf(owner) - amount);
    this.token.transfer(this.address, owner, amount);
  }

  balanceOf(owner) {
    return this.shareBalances.get(owner) ?? 0;
  }

  setApyBps(apyBps) {
    assertCondition(Number.isInteger(apyBps) && apyBps >= 0, "VAULT_INVALID_APY", "APY must be a non-negative integer bps value.", {
      apyBps
    });
    this.apyBps = apyBps;
  }

  metadata() {
    return {
      name: this.name,
      riskBucket: this.riskBucket,
      apyBps: this.apyBps
    };
  }

  snapshot() {
    return {
      name: this.name,
      riskBucket: this.riskBucket,
      apyBps: this.apyBps,
      shareBalances: Object.fromEntries(this.shareBalances)
    };
  }

  restore(snapshot) {
    this.name = snapshot.name;
    this.riskBucket = snapshot.riskBucket;
    this.apyBps = snapshot.apyBps;
    this.shareBalances = new Map(Object.entries(snapshot.shareBalances));
  }

  #assertPositiveAmount(amount) {
    assertCondition(Number.isInteger(amount) && amount > 0, "VAULT_INVALID_AMOUNT", "Vault amount must be a positive integer.", {
      amount
    });
  }
}
