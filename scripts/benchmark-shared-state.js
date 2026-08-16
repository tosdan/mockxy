#!/usr/bin/env node
"use strict";

const os = require("node:os");
const { performance } = require("node:perf_hooks");
const { buildMockPayload } = require("../src/app");
const { SharedStateStore } = require("../src/mocks/shared-state");

const MIB = 1024 * 1024;
const WARMUP_SAMPLES = 5;
const MEASURED_SAMPLES = 30;
const DATASET_SEED = 0x5eed1234;

function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function createDataset(targetBytes, seed) {
  const random = createRandom(seed);
  const items = [];
  let serializedBytes = 2; // []
  for (let index = 0; ; index += 1) {
    const category = ["alpha", "beta", "gamma", "delta"][index % 4];
    const item = {
      id: `item-${String(index).padStart(6, "0")}`,
      category,
      active: index % 3 !== 0,
      score: Math.floor(random() * 100000) / 100,
      name: `Deterministic catalog item ${index}`,
      description: `Fixture payload ${"x".repeat(96)} ${Math.floor(random() * 1e9)}`,
      tags: [`group-${index % 17}`, `bucket-${index % 31}`],
      metadata: { revision: index % 11, source: "shared-state-benchmark" },
    };
    const itemBytes = Buffer.byteLength(JSON.stringify(item), "utf8");
    const nextBytes = serializedBytes + itemBytes + (items.length === 0 ? 0 : 1);
    if (nextBytes > targetBytes) {
      break;
    }
    items.push(item);
    serializedBytes = nextBytes;
  }
  return { items, serializedBytes };
}

function percentile(samples, percentileValue) {
  const sorted = [...samples].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(sorted.length * percentileValue) - 1);
  return sorted[index];
}

function forceGc() {
  if (typeof global.gc === "function") {
    global.gc();
  }
}

function memoryDelta(before, after) {
  return {
    heapUsedBytes: Math.max(0, after.heapUsed - before.heapUsed),
    rssBytes: Math.max(0, after.rss - before.rss),
  };
}

function benchmarkOperation(operation) {
  for (let index = 0; index < WARMUP_SAMPLES; index += 1) {
    operation();
  }
  const samples = [];
  let peakHeapUsedBytes = 0;
  let peakRssBytes = 0;
  for (let index = 0; index < MEASURED_SAMPLES; index += 1) {
    // Stabilize each sample independently. Without this, "peak delta" would mostly measure
    // garbage accumulated across 30 operations before V8 happens to collect it.
    forceGc();
    const baseline = process.memoryUsage();
    const start = performance.now();
    const value = operation();
    samples.push(performance.now() - start);
    const delta = memoryDelta(baseline, process.memoryUsage());
    peakHeapUsedBytes = Math.max(peakHeapUsedBytes, delta.heapUsedBytes);
    peakRssBytes = Math.max(peakRssBytes, delta.rssBytes);
    // Keep the result observably alive through the memory sample.
    if (value === Symbol.for("mockxy.benchmark.impossible")) {
      throw new Error("unreachable");
    }
  }
  return {
    p50Ms: percentile(samples, 0.50),
    p95Ms: percentile(samples, 0.95),
    maxMs: Math.max(...samples),
    peakHeapUsedBytes,
    peakRssBytes,
  };
}

async function benchmarkDataset(targetBytes, seed) {
  let generated = createDataset(targetBytes, seed);
  const store = new SharedStateStore();
  const facade = store.createRequestFacade({ method: "GET", path: "/benchmark" });
  const handle = await facade.api.open("benchmark", {
    seedKey: "benchmark@v1",
    initialize: () => generated.items,
  });
  const itemCount = generated.items.length;
  const actualBytes = store.listMetadata().items[0].sizeBytes;
  generated = null;
  forceGc();

  const request = {
    originalUrl: "/benchmark?category=beta&page=2&size=50",
    query: { category: "beta", page: "2", size: "50" },
  };
  const read = benchmarkOperation(() => handle.read());
  const mutateNoop = benchmarkOperation(() => handle.mutate(() => undefined));
  const readFilterPage = benchmarkOperation(() => {
    const snapshot = handle.read();
    return buildMockPayload(snapshot, request, true);
  });
  facade.close();
  store.close();

  return {
    targetBytes,
    actualBytes,
    itemCount,
    operations: { read, mutateNoop, readFilterPage },
  };
}

function mib(bytes) {
  return bytes / MIB;
}

function formatMs(value) {
  return value.toFixed(2);
}

function formatMib(value) {
  return mib(value).toFixed(2);
}

function printMarkdown(report) {
  process.stdout.write("# Shared runtime state benchmark\n\n");
  process.stdout.write(`- Node: ${report.environment.node}\n`);
  process.stdout.write(`- Platform: ${report.environment.platform}\n`);
  process.stdout.write(`- CPU: ${report.environment.cpu}\n`);
  process.stdout.write(`- Samples: ${WARMUP_SAMPLES} warm-up + ${MEASURED_SAMPLES} measured\n`);
  process.stdout.write(`- Dataset seed: 0x${DATASET_SEED.toString(16)}\n\n`);
  process.stdout.write("| Dataset | Items | Operation | p50 ms | p95 ms | max ms | peak heap Δ MiB | peak RSS Δ MiB | Gate |\n");
  process.stdout.write("|---:|---:|---|---:|---:|---:|---:|---:|---|\n");
  for (const dataset of report.datasets) {
    const operations = [
      ["read", dataset.operations.read, 50],
      ["mutate no-op", dataset.operations.mutateNoop, 100],
      ["read + filter/page", dataset.operations.readFilterPage, 100],
    ];
    for (const [name, result, latencyGate] of operations) {
      const memoryPass = result.peakHeapUsedBytes <= 128 * MIB && result.peakRssBytes <= 128 * MIB;
      const gate = result.p95Ms <= latencyGate && memoryPass ? "PASS" : "FAIL";
      process.stdout.write(
        `| ${formatMib(dataset.actualBytes)} MiB | ${dataset.itemCount} | ${name} | ${formatMs(result.p50Ms)} | ${formatMs(result.p95Ms)} | ${formatMs(result.maxMs)} | ${formatMib(result.peakHeapUsedBytes)} | ${formatMib(result.peakRssBytes)} | ${gate} |\n`
      );
    }
  }
}

async function main() {
  const datasets = [];
  for (const [index, targetBytes] of [1 * MIB, 3 * MIB].entries()) {
    datasets.push(await benchmarkDataset(targetBytes, DATASET_SEED + index));
  }
  const report = {
    environment: {
      node: process.version,
      platform: `${process.platform} ${process.arch} ${os.release()}`,
      cpu: os.cpus()[0]?.model || "unknown",
    },
    warmupSamples: WARMUP_SAMPLES,
    measuredSamples: MEASURED_SAMPLES,
    datasetSeed: DATASET_SEED,
    datasets,
  };
  if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    printMarkdown(report);
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
