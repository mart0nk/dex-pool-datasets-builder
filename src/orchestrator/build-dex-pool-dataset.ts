import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Timeframe } from "../contracts/timeframe.js";
import { getTimeframeMs } from "../contracts/timeframe.js";
import { buildCandlesFromSwaps } from "../candles/pool-candle-builder.js";
import { fillNoTradeIntervals } from "../candles/no-trade-fill-policy.js";
import { aggregateDexPoolCandles } from "../candles/timeframe-aggregator.js";
import { readUniswapV3PoolSwapsWithQuality } from "../evm/evm-pool-event-reader.js";
import { exportDexWalkForwardDatasetToStorage } from "../export/walk-forward-storage-export-adapter.js";
import {
  validatePoolRegistry,
  buildReplaySymbol,
} from "../registry/pool-registry.js";
import { resolveDatasetStorage } from "../storage/resolve-dataset-storage.js";
import type { ResolvedDexBuildConfig } from "../config/dex-build-config.types.js";
import type {
  DexPoolCandle,
  DexPoolConfig,
  DexPoolDatasetManifest,
} from "../types/dex-pool-dataset.types.js";
import type { WrittenDatasetObject } from "../storage/dataset-storage.types.js";
import type {
  DexBuildResult,
  DexBuildRunReport,
} from "./dex-build-result.types.js";

export async function buildDexPoolDataset(
  options: ResolvedDexBuildConfig,
): Promise<DexBuildResult> {
  const startedAt = new Date().toISOString();
  const runId = randomUUID();

  const registryInput: unknown =
    options.registryPools ??
    JSON.parse(await readFile(options.registryPath, "utf8"));

  const { pools: registryPools, errors: registryErrors } =
    validatePoolRegistry(registryInput);

  const fatalErrors: DexBuildRunReport["fatalErrors"] = [];

  if (registryErrors.length > 0) {
    const message = `POOL_REGISTRY_INVALID: ${registryErrors.join(", ")}`;

    if (options.build.failFast) {
      throw new Error(message);
    }

    fatalErrors.push({
      code: "POOL_REGISTRY_INVALID",
      message,
    });
  }

  const poolById = new Map(registryPools.map((pool) => [pool.id, pool]));
  const selectedPools: DexPoolConfig[] = [];

  for (const poolId of options.build.pools) {
    const pool = poolById.get(poolId);

    if (pool === undefined) {
      const message = `POOL_NOT_FOUND:${poolId}`;

      fatalErrors.push({
        code: "POOL_NOT_FOUND",
        message,
        poolId,
      });

      if (options.build.failFast) {
        throw new Error(message);
      }

      continue;
    }

    selectedPools.push(pool);
  }

  const storage = resolveDatasetStorage(options.output.uri);
  const poolResults: DexBuildRunReport["pools"] = [];

  for (const pool of selectedPools) {
    let writtenObjects: WrittenDatasetObject[] = [];

    try {
      const { swaps, quality } = await readUniswapV3PoolSwapsWithQuality({
        pool,
        rpcUrl: options.network.rpcUrl,
        fromBlock: options.build.fromBlock,
        toBlock: options.build.toBlock,
        chunkSize: options.build.chunkSize,
        failFast: options.build.failFast,
      });

      if (swaps.length === 0) {
        const message = `NO_SWAPS_IN_RANGE:${pool.id}:${options.build.fromBlock.toString()}:${options.build.toBlock.toString()}`;

        fatalErrors.push({
          code: "NO_SWAPS_IN_RANGE",
          message,
          poolId: pool.id,
        });

        if (options.build.failFast) {
          throw new Error(message);
        }

        continue;
      }

      const baseCandles = buildCandlesFromSwaps({
        pool,
        timeframe: options.build.baseTimeframe,
        swaps,
      });

      const fromTime = swaps[0]!.blockTimestamp * 1000;
      const toTime = swaps[swaps.length - 1]!.blockTimestamp * 1000;

      const filledBase = fillNoTradeIntervals({
        candles: baseCandles,
        timeframe: options.build.baseTimeframe,
        fromTime,
        toTime,
      });

      const filledNoTradeIntervals = filledBase.filter((candle) => {
        return (
          candle.qualityFlags.noTradeInterval === true ||
          candle.qualityFlags.fillForwarded === true
        );
      }).length;

      quality.noTradeIntervals += filledNoTradeIntervals;

      const candlesByTimeframe: Partial<Record<Timeframe, DexPoolCandle[]>> =
        {};

      for (const timeframe of options.build.timeframes) {
        if (timeframe === options.build.baseTimeframe) {
          candlesByTimeframe[timeframe] = filledBase;
        } else {
          candlesByTimeframe[timeframe] = aggregateDexPoolCandles(
            filledBase,
            timeframe,
          );
        }
      }

      const intervalMs = getTimeframeMs(options.build.baseTimeframe);

      const firstOpenTime =
        filledBase.length > 0
          ? filledBase[0]!.openTime
          : Math.floor(fromTime / intervalMs) * intervalMs;

      const lastCloseTime =
        filledBase.length > 0
          ? filledBase[filledBase.length - 1]!.closeTime
          : firstOpenTime + intervalMs - 1;

      let globalFirstOpenTime = firstOpenTime;
      let globalLastCloseTime = lastCloseTime;

      for (const timeframe of options.build.timeframes) {
        const candles = candlesByTimeframe[timeframe];

        if (candles !== undefined && candles.length > 0) {
          globalFirstOpenTime = Math.min(
            globalFirstOpenTime,
            candles[0]!.openTime,
          );
          globalLastCloseTime = Math.max(
            globalLastCloseTime,
            candles[candles.length - 1]!.closeTime,
          );
        }
      }

      const truthManifest: DexPoolDatasetManifest = {
        datasetType: "DEX_POOL",
        sourceMode: "ONCHAIN_POOL_EVENTS",
        datasetId: options.datasetId,
        chain: pool.chain,
        dex: pool.dex,
        poolKind: pool.kind,
        poolAddress: pool.poolAddress,
        token0: pool.token0,
        token1: pool.token1,
        baseToken: pool.baseToken,
        quoteToken: pool.quoteToken,

        blockRange: {
          fromBlock: options.build.fromBlock.toString(),
          toBlock: options.build.toBlock.toString(),
          finalizedToBlock: options.build.toBlock.toString(),
          finalityMode: "confirmation_lag",
        },

        timeRange: {
          from: new Date(globalFirstOpenTime).toISOString(),
          to: new Date(globalLastCloseTime).toISOString(),
        },

        source: {
          rpcProvider: "configured_archive_rpc",
          eventSource: "eth_getLogs",
          events: ["Swap"],
        },

        timeframes: options.build.timeframes,

        replaySafety: {
          closedCandlesOnly: true,
          availableFromCloseTime: true,
          lookaheadSafe: true,
          intrablockOrderingPreserved: true,
        },

        quality,
        generatedAt: new Date().toISOString(),
      };

      const exportResult = await exportDexWalkForwardDatasetToStorage({
        truthManifest,
        candlesByTimeframe,
        storage,
        rootKey: `${options.datasetId}/${pool.id}`,
        now: new Date(),
      });

      writtenObjects = exportResult.writtenObjects;

      poolResults.push({
        poolId: pool.id,
        symbol: buildReplaySymbol(pool),
        blockRange: {
          fromBlock: options.build.fromBlock.toString(),
          toBlock: options.build.toBlock.toString(),
        },
        timeframes: options.build.timeframes,
        quality,
        writtenObjects,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      fatalErrors.push({
        code: "POOL_BUILD_FAILED",
        message,
        poolId: pool.id,
      });

      if (options.build.failFast) {
        throw error;
      }
    }
  }

  const finishedAt = new Date().toISOString();
  const status: "completed" | "failed" =
    fatalErrors.length > 0 ? "failed" : "completed";

  const runReport: DexBuildRunReport = {
    schemaVersion: 1,
    datasetId: options.datasetId,
    runId,
    startedAt,
    finishedAt,
    status,
    config: {
      profile: options.profile,
      registryPath: options.registryPath,
      outputUri: options.output.uri,
      selectedPools: options.build.pools,
    },
    pools: poolResults,
    fatalErrors,
  };

  await storage.writeObject({
    key: `${options.datasetId}/run-report.json`,
    body: `${JSON.stringify(runReport, null, 2)}\n`,
    contentType: "application/json",
  });

  return {
    runReport,
    status,
  };
}
