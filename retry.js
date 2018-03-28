/* eslint no-await-in-loop: off */

const TxMonitor = require('./tx-monitor.js');
const publisher = require('./util/gcloudPub');
const config = require('./config/config.js');
const { web3, STATUS, Transaction } = require('./util/web3.js');
const { db } = require('./util/db.js');

const PUBSUB_TOPIC_MISC = 'misc';

const TIME_LIMIT = config.TIME_LIMIT || 60 * 60 * 1000 * 24; // fallback: 1 day
const TX_LOOP_INTERVAL = config.TX_LOOP_INTERVAL || 90 * 1000; // fallback: 90s
const RETRY_NOT_FOUND_INTERVAL = config.RETRY_NOT_FOUND_INTERVAL || 30 * 1000; // fallback: 30s
const NOT_FOUND_COUNT_BEFORE_RETRY = config.NOT_FOUND_COUNT_BEFORE_RETRY || 3;
const { PRIVATE_KEYS } = config;

const addrs = Object.keys(PRIVATE_KEYS);
for (let i = 0; i < addrs.length; i += 1) {
  const addr = addrs[i];
  const privKeyAddr = web3.eth.accounts.privateKeyToAccount(PRIVATE_KEYS[addr]).address;
  if (addr !== privKeyAddr) {
    throw new Error(`Unmatching private key: ${addr}. Make sure you are using checksum address format.`);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class RetryTxMonitor extends TxMonitor {
  constructor(doc, rateLimiter) {
    super(doc, rateLimiter);
    if (this.tx.data.replacementTxHash) {
      this.replacementTx = new Transaction(this.tx.data.replacementTxHash);
    }
  }

  logRetry(known) {
    const logType = known ? 'eventRetryKnown' : 'eventRetry';
    const replacementTxHash = (this.replacementTx || {}).txHash;
    const logRecord = {
      ...this.tx.generateLogData(),
      logType,
      replacementTxHash,
    };
    publisher.publish(PUBSUB_TOPIC_MISC, logRecord);
  }

  logReplace() {
    const logRecord = {
      ...this.tx.generateLogData(),
      logType: 'eventReplace',
      replacementTxHash: this.replacementTx.txHash,
      delegatorAddress: this.tx.data.delegatorAddress,
    };
    publisher.publish(PUBSUB_TOPIC_MISC, logRecord);
  }

  async loopBodyNormalFlow(count) {
    let retryCount = count;
    const { status, receipt } = await this.rateLimiter.schedule(() => this.tx.getStatus());
    switch (status) {
      case STATUS.SUCCESS:
      case STATUS.FAILED:
        await this.writeTxStatus(status, { receipt });
        return {};
      case STATUS.MINED:
      case STATUS.PENDING:
        return { retryCount: 0, nextLoopDelay: TX_LOOP_INTERVAL };
      case STATUS.NOT_FOUND:
      default:
        if (Date.now() - this.tx.ts > TIME_LIMIT) {
          // timeout
          try {
            // eslint-disable-next-line no-console
            console.log(this.tx.txHash, 'timeout, preparing replacement tx');
            const { known, tx: replacementTx } = await this.tx.replace();
            if (!known) {
              await db.collection(config.FIRESTORE_TX_ROOT)
                .doc(this.tx.txHash)
                .update({ replacementTxHash: replacementTx.txHash });
              this.logReplace();
            }
            this.replacementTx = replacementTx;
            return { retryCount: 0, nextLoopDelay: TX_LOOP_INTERVAL };
          } catch (err) {
            console.error(this.tx.txHash, 'error when replacing tx', err); // eslint-disable-line no-console
            return { retryCount, nextLoopDelay: TX_LOOP_INTERVAL };
          }
        } else {
          retryCount += 1;
          if (retryCount >= NOT_FOUND_COUNT_BEFORE_RETRY) {
            try {
              const { known } = await this.tx.resend();
              this.logRetry(known);
              if (known) {
                return { retryCount: 0, nextLoopDelay: TX_LOOP_INTERVAL };
              }
            } catch (err) {
              console.error(this.tx.txHash, 'error when retrying tx', err); // eslint-disable-line no-console
            }
          }
          return { retryCount, nextLoopDelay: RETRY_NOT_FOUND_INTERVAL };
        }
    }
  }

  async loopBodyReplacedFlow(count) {
    let retryCount = count;
    const { status } =
      await this.rateLimiter.schedule(() => this.replacementTx.getStatus());
    switch (status) {
      case STATUS.SUCCESS:
      case STATUS.FAIL:
        await this.writeTxStatus(STATUS.TIMEOUT, {
          additionalLog: { replacementTxHash: this.replacementTx.txHash },
        });
        return {};
      default:
    }
    const { status: originTxStatus, receipt: originalTxReceipt } =
      await this.rateLimiter.schedule(() => this.tx.getStatus());
    if (originTxStatus === STATUS.SUCCESS || originTxStatus === STATUS.FAIL) {
      await this.writeTxStatus(originTxStatus, {
        receipt: originalTxReceipt,
        additionalLog: { replacementTxHash: this.replacementTx.txHash },
      });
      return {};
    }
    switch (status) {
      case STATUS.MINED:
      case STATUS.PENDING:
        return { retryCount: 0, nextLoopDelay: TX_LOOP_INTERVAL };
      case STATUS.NOT_FOUND:
      default:
        retryCount += 1;
        if (retryCount >= NOT_FOUND_COUNT_BEFORE_RETRY) {
          try {
            const { known } = await this.tx.replace();
            this.logRetry(known);
            if (known) {
              return { retryCount: 0, nextLoopDelay: TX_LOOP_INTERVAL };
            }
          } catch (err) {
            // eslint-disable-next-line no-console
            console.error(this.tx.txHash, `error when retrying replacement tx ${this.replacementTx.txHash}`, err);
          }
        }
        return { retryCount, nextLoopDelay: RETRY_NOT_FOUND_INTERVAL };
    }
  }

  async loopBody() {
    let retryCount = 0;
    let nextLoopDelay = TX_LOOP_INTERVAL;
    while (!this.shouldStop) {
      if (!this.replacementTx) {
        ({ retryCount, nextLoopDelay } = await this.loopBodyNormalFlow(retryCount));
      } else {
        ({ retryCount, nextLoopDelay } = await this.loopBodyReplacedFlow(retryCount));
      }
      if (!nextLoopDelay) {
        return;
      }
      await sleep(nextLoopDelay);
    }
  }
}

module.exports = RetryTxMonitor;
