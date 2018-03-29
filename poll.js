/* eslint no-await-in-loop: off */

const TxMonitor = require('./tx-monitor.js');
const config = require('./config/config.js');
const { STATUS } = require('./util/web3.js');

const TIME_LIMIT = config.TIME_LIMIT || 60 * 60 * 1000 * 24; // fallback: 1 day
const TX_LOOP_INTERVAL = config.TX_LOOP_INTERVAL || 30 * 1000; // fallback: 30s

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class PollTxMonitor extends TxMonitor {
  async loopBody() {
    while (!this.shouldStop) {
      const { status, receipt } = await this.rateLimiter.schedule(() => this.tx.getStatus());
      switch (status) {
        case STATUS.SUCCESS:
        case STATUS.FAIL:
          try {
            await this.writeTxStatus(status, { receipt });
            return;
          } catch (err) {
            console.error(this.tx.txHash, `error when writing tx status (${status})`, err); // eslint-disable-line no-console
          }
          break;
        case STATUS.MINED:
          this.tx.ts = Date.now();
          break;
        case STATUS.PENDING:
          break;
        case STATUS.NOT_FOUND:
          if (Date.now() - this.tx.ts > TIME_LIMIT) {
            // timeout
            try {
              await this.writeTxStatus(STATUS.TIMEOUT);
              return;
            } catch (err) {
              // eslint-disable-next-line no-console
              console.error(this.tx.txHash, `error when writing tx status (${STATUS.TIMEOUT})`, err);
            }
          }
          break;
        default:
      }
      await sleep(TX_LOOP_INTERVAL);
    }
  }
}

module.exports = PollTxMonitor;
