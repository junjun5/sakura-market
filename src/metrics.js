// Request metrics in the Prometheus text exposition format, served at
// GET /api/metrics. Series are labelled by route pattern (/api/listings/:id),
// never by the raw path, so the number of series stays bounded.

export const METRICS_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';
export const DURATION_BUCKETS_SECONDS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];
// Any other method is counted as OTHER, so arbitrary client input cannot add series.
export const KNOWN_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];

/**
 * @typedef {{ method: string | undefined, route: string, status: number, durationMs: number }} RequestObservation
 * @typedef {{ observeRequest: (observation: RequestObservation) => void, render: () => string }} Metrics
 * @typedef {{ labels: Record<string, string>, count: number }} Counter
 * @typedef {{ labels: Record<string, string>, buckets: number[], sum: number, count: number }} Histogram
 */

/**
 * @param {{ startedAt?: number, now?: () => number, memoryUsage?: () => NodeJS.MemoryUsage }} [options]
 * @returns {Metrics}
 */
export function createMetrics({
  startedAt = Date.now(),
  now = Date.now,
  memoryUsage = () => process.memoryUsage(),
} = {}) {
  /** @type {Map<string, Counter>} */
  const requests = new Map();
  /** @type {Map<string, Histogram>} */
  const durations = new Map();

  /** @param {RequestObservation} observation */
  function observeRequest({ method, route, status, durationMs }) {
    const knownMethod = method !== undefined && KNOWN_METHODS.includes(method) ? method : 'OTHER';
    const counterLabels = { method: knownMethod, route, status: String(status) };
    const counterKey = formatLabels(counterLabels);
    const counter = requests.get(counterKey) ?? { labels: counterLabels, count: 0 };
    counter.count += 1;
    requests.set(counterKey, counter);

    const histogramLabels = { method: knownMethod, route };
    const histogramKey = formatLabels(histogramLabels);
    const histogram = durations.get(histogramKey) ?? {
      labels: histogramLabels,
      buckets: DURATION_BUCKETS_SECONDS.map(() => 0),
      sum: 0,
      count: 0,
    };
    const seconds = durationMs / 1000;
    DURATION_BUCKETS_SECONDS.forEach((upperBound, i) => {
      if (seconds <= upperBound) histogram.buckets[i] += 1;
    });
    histogram.sum += seconds;
    histogram.count += 1;
    durations.set(histogramKey, histogram);
  }

  function render() {
    const memory = memoryUsage();
    const lines = [
      '# HELP http_requests_total HTTP requests by method, route pattern and status code.',
      '# TYPE http_requests_total counter',
      ...[...requests.values()].map(
        ({ labels, count }) => `http_requests_total${formatLabels(labels)} ${count}`,
      ),
      '# HELP http_request_duration_seconds Time from receiving a request to finishing its response.',
      '# TYPE http_request_duration_seconds histogram',
      ...[...durations.values()].flatMap(histogramLines),
      '# HELP process_uptime_seconds Seconds since the metrics registry was created.',
      '# TYPE process_uptime_seconds gauge',
      `process_uptime_seconds ${(now() - startedAt) / 1000}`,
      '# HELP process_resident_memory_bytes Resident set size of the process.',
      '# TYPE process_resident_memory_bytes gauge',
      `process_resident_memory_bytes ${memory.rss}`,
      '# HELP nodejs_heap_used_bytes V8 heap in use.',
      '# TYPE nodejs_heap_used_bytes gauge',
      `nodejs_heap_used_bytes ${memory.heapUsed}`,
    ];
    return `${lines.join('\n')}\n`;
  }

  return { observeRequest, render };
}

/** @param {Histogram} histogram */
function histogramLines({ labels, buckets, sum, count }) {
  return [
    ...DURATION_BUCKETS_SECONDS.map(
      (upperBound, i) =>
        `http_request_duration_seconds_bucket${formatLabels({ ...labels, le: String(upperBound) })} ${buckets[i]}`,
    ),
    `http_request_duration_seconds_bucket${formatLabels({ ...labels, le: '+Inf' })} ${count}`,
    `http_request_duration_seconds_sum${formatLabels(labels)} ${sum}`,
    `http_request_duration_seconds_count${formatLabels(labels)} ${count}`,
  ];
}

/** @param {Record<string, string>} labels */
function formatLabels(labels) {
  const pairs = Object.entries(labels).map(([name, value]) => `${name}="${escapeLabelValue(value)}"`);
  return `{${pairs.join(',')}}`;
}

/** @param {string} value */
function escapeLabelValue(value) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}
