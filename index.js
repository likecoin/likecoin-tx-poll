const RetryTxMonitor = require('./retry.js');
const PollTxMonitor = require('./poll.js');
const config = require('./config/config.js');
const { watchTx } = require('./util/db.js');
const Bottleneck = require('bottleneck');

const FETCH_INTERVAL = config.FETCH_INTERVAL || 1000; // fallback: 1s

async function main() {
  let TxMonitor;
  switch (config.QUEUE_MODE) {
    case 'RETRY':
      TxMonitor = RetryTxMonitor;
      break;
    case 'POLL':
      TxMonitor = PollTxMonitor;
      break;
    default:
      throw new Error(`Invalid QUEUE_MODE '${config.QUEUE_MODE}' (expect 'RETRY' or 'POLL')`);
  }

  const rateLimiter = new Bottleneck({
    maxConcurrent: 1,
    minTime: FETCH_INTERVAL,
  });
  rateLimiter.on('error', err => console.error('error in rateLimiter', err)); // eslint-disable-line no-console

  const txMonitors = {};

  watchTx((doc, type) => {
    const txHash = doc.id;
    const existingTxMonitor = txMonitors[txHash];
    if (type === 'added') {
      if (existingTxMonitor) {
        // eslint-disable-next-line no-console
        console.log(`Received transaction ${txHash}, which already exists`);
        return;
      }
      try {
        const txMonitor = new TxMonitor(doc, rateLimiter);
        txMonitors[txHash] = txMonitor;
        txMonitor.onFinish = (handler) => {
          delete txMonitors[handler.tx.txHash];
        };
        txMonitor.startLoop();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.log(`${txHash}: error when initializing txMonitor`, err);
      }
    } else if (type === 'removed') {
      if (!existingTxMonitor) {
        return;
      }
      existingTxMonitor.stop();
    }
  });
}

main();
