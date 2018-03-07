/* eslint no-await-in-loop: off */

const config = require('../config/config.js');

const { getTransactionStatus } = require('./web3.js');

function sleep(ms) {
  return new global.Promise(resolve => setTimeout(resolve, ms));
}

const FETCH_INTERVAL = config.FETCH_INTERVAL || 1000; // fallback: 1s

class PollingQueue {
  constructor(callback, opt) {
    this.callback = callback;
    this.requireReceipt = opt && opt.requireReceipt;
    this.queue = [];
  }

  async start() {
    setImmediate(async () => {
      for (;;) {
        const tx = this.queue.shift();
        if (tx) {
          try {
            const { status, receipt } = await getTransactionStatus(tx.txHash, this.requireReceipt);
            const callbackResult = await this.callback(tx, status, receipt);
            if (callbackResult && callbackResult.tx) {
              setTimeout(() => this.queue.push(callbackResult.tx), callbackResult.enqueueDelay);
            }
          } catch (err) {
            console.error(err); // eslint-disable-line no-console
          }
        }
        await sleep(FETCH_INTERVAL);
      }
    });
  }

  add(tx) {
    this.queue.push(tx);
  }
}

module.exports = PollingQueue;

// vim: set ts=2 sw=2:
