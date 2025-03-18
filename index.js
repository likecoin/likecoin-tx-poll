const express = require('express');
const Bottleneck = require('bottleneck');

const RetryTxMonitor = require('./retry.js');
const PollTxMonitor = require('./poll.js');
const config = require('./config/config.js');
const { watchTx } = require('./util/db.js');

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
  // eslint-disable-next-line no-console
  rateLimiter.on('error', err => console.error('Error in rateLimiter:', err));

  const existingMonitors = {};

  watchTx((doc, type) => {
    const txHash = doc.id;
    const currentMonitor = existingMonitors[txHash];
    switch (type) {
      case 'added': {
        if (currentMonitor) {
          // eslint-disable-next-line no-console
          console.log(`Receiving transaction ${txHash}, which already exists`);
          return;
        }
        const txMonitor = new TxMonitor(doc, rateLimiter);
        existingMonitors[txHash] = txMonitor;
        txMonitor.onFinish = (monitor) => {
          delete existingMonitors[monitor.txHash];
        };
        txMonitor.startLoop();
        break;
      }
      case 'removed':
        if (currentMonitor) {
          currentMonitor.stop();
          delete existingMonitors[currentMonitor.txHash];
        }
        break;
      case 'modified':
      default:
    }
  });
}

main();

// health check
const app = express();

app.get('/healthz', (req, res) => {
  res.sendStatus(200);
});

const port = process.env.PORT || config.PORT || 3000;
app.listen(port, () => {
  console.log(`Deploying on ${process.env.IS_TESTNET ? 'rinkeby' : 'mainnet'}`);
  console.log(`Listening on port ${port}!`);
});
