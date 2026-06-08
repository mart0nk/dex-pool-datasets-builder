export type HexString = `0x${string}`;

export type EvmRpcFetch = (
  url: string,
  init: {
    method: "POST";
    headers: Record<string, string>;
    body: string;
  },
) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}>;

export type EvmLog = {
  address: HexString;
  topics: HexString[];
  data: HexString;
  blockNumber: HexString;
  blockHash: HexString;
  transactionHash: HexString;
  transactionIndex: HexString;
  logIndex: HexString;
};

export type EvmBlock = {
  number: HexString;
  hash: HexString;
  timestamp: HexString;
};

export type GetLogsInput = {
  address: HexString;
  fromBlock: bigint;
  toBlock: bigint;
  topics?: HexString[];
};

export type EvmBlockTag = bigint | "latest";

export type EvmCallInput = {
  to: HexString;
  data: HexString;
  blockTag?: EvmBlockTag;
};

export type EvmJsonRpcClient = {
  getLogs(input: GetLogsInput): Promise<EvmLog[]>;
  getBlockByNumber(blockNumber: bigint): Promise<EvmBlock>;
  getLatestBlockNumber(): Promise<bigint>;
  getChainId(): Promise<bigint>;
  call(input: EvmCallInput): Promise<HexString>;
};

export function createEvmJsonRpcClient(input: {
  rpcUrl: string;
  fetchFn?: EvmRpcFetch;
}): EvmJsonRpcClient {
  const fetchFn = input.fetchFn ?? defaultFetch;
  let nextId = 1;

  async function request<T>(method: string, params: unknown[]): Promise<T> {
    const id = nextId;
    nextId += 1;

    const response = await fetchFn(input.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        method,
        params,
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`EVM_RPC_HTTP_ERROR:${response.status}:${text}`);
    }

    const text = await response.text();
    const json = JSON.parse(text) as {
      id?: number;
      result?: T;
      error?: { code?: number; message?: string };
    };

    if (json.error !== undefined) {
      throw new Error(
        `EVM_RPC_ERROR:${method}:${json.error.code ?? "unknown"}:${json.error.message ?? ""}`,
      );
    }

    if (json.result === undefined) {
      throw new Error(`EVM_RPC_RESULT_MISSING:${method}:${id}`);
    }

    return json.result;
  }

  return {
    getLogs(getLogsInput) {
      return request<EvmLog[]>("eth_getLogs", [
        {
          address: getLogsInput.address,
          fromBlock: toQuantityHex(getLogsInput.fromBlock),
          toBlock: toQuantityHex(getLogsInput.toBlock),
          ...(getLogsInput.topics !== undefined
            ? { topics: getLogsInput.topics }
            : {}),
        },
      ]);
    },

    getBlockByNumber(blockNumber) {
      return request<EvmBlock>("eth_getBlockByNumber", [
        toQuantityHex(blockNumber),
        false,
      ]);
    },

    async getLatestBlockNumber() {
      return hexToBigInt(await request<HexString>("eth_blockNumber", []));
    },

    async getChainId() {
      return hexToBigInt(await request<HexString>("eth_chainId", []));
    },

    call(callInput) {
      return request<HexString>("eth_call", [
        {
          to: callInput.to,
          data: callInput.data,
        },
        toBlockTag(callInput.blockTag ?? "latest"),
      ]);
    },
  };
}

export function toQuantityHex(value: bigint): HexString {
  if (value < 0n) {
    throw new Error(`EVM_QUANTITY_NEGATIVE:${value.toString()}`);
  }

  return `0x${value.toString(16)}`;
}

export function hexToBigInt(value: HexString): bigint {
  return BigInt(value);
}

export function hexToNumber(value: HexString): number {
  const parsed = hexToBigInt(value);

  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`EVM_HEX_UNSAFE_NUMBER:${value}`);
  }

  return Number(parsed);
}

function toBlockTag(value: EvmBlockTag): HexString | "latest" {
  return value === "latest" ? "latest" : toQuantityHex(value);
}

const defaultFetch: EvmRpcFetch = async (url, init) => {
  const response = await fetch(url, init);

  return {
    ok: response.ok,
    status: response.status,
    text: () => response.text(),
  };
};
