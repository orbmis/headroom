import { assertCondition } from "./utils.js";

export class MockToken {
  constructor({ name, symbol, decimals }) {
    this.name = name;
    this.symbol = symbol;
    this.decimals = decimals;
    this.balances = new Map();
    this.totalSupply = 0;
  }

  mint(to, amount) {
    this.#assertPositiveAmount(amount);
    this.balances.set(to, this.balanceOf(to) + amount);
    this.totalSupply += amount;
  }

  transfer(from, to, amount) {
    this.#assertPositiveAmount(amount);
    assertCondition(this.balanceOf(from) >= amount, "TOKEN_INSUFFICIENT_BALANCE", "Token balance is insufficient.", {
      from,
      requested: amount,
      available: this.balanceOf(from)
    });
    this.balances.set(from, this.balanceOf(from) - amount);
    this.balances.set(to, this.balanceOf(to) + amount);
  }

  balanceOf(owner) {
    return this.balances.get(owner) ?? 0;
  }

  snapshot() {
    return {
      name: this.name,
      symbol: this.symbol,
      decimals: this.decimals,
      totalSupply: this.totalSupply,
      balances: Object.fromEntries(this.balances)
    };
  }

  restore(snapshot) {
    this.name = snapshot.name;
    this.symbol = snapshot.symbol;
    this.decimals = snapshot.decimals;
    this.totalSupply = snapshot.totalSupply;
    this.balances = new Map(Object.entries(snapshot.balances));
  }

  #assertPositiveAmount(amount) {
    assertCondition(Number.isInteger(amount) && amount > 0, "TOKEN_INVALID_AMOUNT", "Token amount must be a positive integer.", {
      amount
    });
  }
}
