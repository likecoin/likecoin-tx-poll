/* eslint no-await-in-loop: off */

const BigNumber = require('bignumber.js');
const publisher = require('./util/gcloudPub');
const config = require('./config/config.js');
const { STATUS, getTransactionStatus } = require('./util/web3.js');
const { db } = require('./util/db.js');

const PUBSUB_TOPIC_MISC = 'misc';

const ONE_LIKE = new BigNumber(10).pow(18);

const TIME_LIMIT = config.TIME_LIMIT || 60 * 60 * 1000 * 24; // fallback: 1 day
const TX_LOOP_INTERVAL = config.TX_LOOP_INTERVAL || 30 * 1000; // fallback: 30s
const TIME_BEFORE_FIRST_ENQUEUE = config.TIME_BEFORE_FIRST_ENQUEUE || 60 * 1000; // fallback: 60s

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class PollTxMonitor {
  constructor(doc, rateLimiter) {
    this.txHash = doc.id;
    this.data = doc.data();
    this.ts = Number.parseInt(this.data.ts, 10) || Date.now();
    this.rateLimiter = rateLimiter;
    this.shouldStop = false;
  }

  writeTxStatus(receipt) {
    db.collection(config.FIRESTORE_TX_ROOT).doc(this.txHash).update({ status: this.status });
    const {
      fromId,
      from,
      toId,
      to,
      value,
      nonce,
      type,
    } = this.data;
    publisher.publish(PUBSUB_TOPIC_MISC, {
      logType: 'eventStatus',
      txHash: this.txHash,
      txStatus: this.status,
      txBlock: receipt ? receipt.blockHash : '',
      txGasUsed: receipt ? receipt.gasUsed : 0,
      txNonce: nonce,
      txType: type,
      fromUser: fromId,
      fromWallet: from,
      toUser: toId,
      toWallet: to,
      likeAmount: new BigNumber(value).dividedBy(ONE_LIKE).toNumber(),
      likeAmountUnitStr: new BigNumber(value).toFixed(),
    });
  }

  async startLoop() {
    try {
      const startDelay = (this.ts + TIME_BEFORE_FIRST_ENQUEUE) - Date.now();
      if (startDelay > 0) {
        await sleep(startDelay);
      }
      let finished = false;
      while (!this.shouldStop) {
        const { status, receipt } = await this.rateLimiter.schedule(
          getTransactionStatus,
          this.txHash,
          { requireReceipt: true },
        );
        this.status = status;
        switch (status) {
          case STATUS.SUCCESS:
          case STATUS.FAIL:
            this.writeTxStatus(receipt);
            finished = true;
            break;
          case STATUS.MINED:
            this.ts = Date.now();
            break;
          case STATUS.PENDING:
            break;
          case STATUS.NOT_FOUND:
            if (Date.now() - this.ts > TIME_LIMIT) {
              // timeout
              this.status = STATUS.TIMEOUT;
              this.writeTxStatus(status);
              finished = true;
            }
            break;
          default:
        }
        if (finished) {
          break;
        }
        await sleep(TX_LOOP_INTERVAL);
      }
    } catch (err) {
      console.error(err); // eslint-disable-line no-console
    }
    if (this.onFinish) {
      this.onFinish(this);
    }
  }

  stop() {
    this.shouldStop = true;
  }
}

module.exports = PollTxMonitor;
