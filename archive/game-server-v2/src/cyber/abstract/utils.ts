/**
 * calculate the average latency and jitter, use standard deviation for jitter
 *
 * @param pingResults
 * @returns
 */
export function calcLatencySTD(pingResults) {
  if (pingResults.length == 1) {
    return { latency: pingResults[0], jitter: 0 };
  }

  // 1- average latency
  let acc = 0;

  for (let i = 0; i < pingResults.length; i++) {
    acc += pingResults[i];
  }

  let average = acc / pingResults.length;

  // 2- standard deviation
  acc = 0;

  for (let i = 0; i < pingResults.length; i++) {
    acc += Math.pow(pingResults[i] - average, 2);
  }

  let std = Math.sqrt(acc / pingResults.length);

  return { latency: average, jitter: std };
}

/**
 * calculate the average latency and jitter, use Inter-Packet Delay Variation (IPDV) for jitter
 *
 * @param pingResults
 */
export function calcLatencyIPDTV(pingResults) {
  if (pingResults.length == 1) {
    return { latency: pingResults[0], jitter: 0 };
  }

  // 1- average latency
  let acc = 0;

  for (let i = 0; i < pingResults.length; i++) {
    acc += pingResults[i];
  }

  let average = acc / pingResults.length;

  // 2- IPDV
  acc = 0;

  for (let i = 0; i < pingResults.length - 1; i++) {
    acc += Math.abs(pingResults[i] - pingResults[i + 1]);
  }

  let ipdtv = acc / (pingResults.length - 1);

  return { latency: average, jitter: ipdtv };
}
