declare module '@ethereumjs/trie' {
  export class Trie {
    constructor(opts?: unknown);
    put(key: Uint8Array, value: Uint8Array): Promise<void>;
    get(key: Uint8Array): Promise<Uint8Array | null>;
    del(key: Uint8Array): Promise<void>;
    root(): Uint8Array;
  }
}
