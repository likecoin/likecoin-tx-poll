/* eslint no-await-in-loop: off */

const BigNumber = require('bignumber.js');
const publisher = require('./util/gcloudPub');
const config = require('./config/config.js');
const { STATUS, getTransactionStatus, resendTransaction } = require('./util/web3.js');

const PUBSUB_TOPIC_MISC = 'misc';

const ONE_LIKE = new BigNumber(10).pow(18);

const TX_LOOP_INTERVAL = config.TX_LOOP_INTERVAL || 90 * 1000; // fallback: 90s
const RETRY_NOT_FOUND_INTERVAL = config.RETRY_NOT_FOUND_INTERVAL || 30 * 1000; // fallback: 30s
const NOT_FOUND_COUNT_BEFORE_RETRY = config.NOT_FOUND_COUNT_BEFORE_RETRY || 3;
const TIME_BEFORE_FIRST_ENQUEUE = config.TIME_BEFORE_FIRST_ENQUEUE || 60 * 1000; // fallback: 60s

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class RetryTxMonitor {
  constructor(doc, rateLimiter) {
    this.txHash = doc.id;
    this.data = doc.data();
    this.ts = Number.parseInt(this.data.ts, 10) || Date.now();
    this.rateLimiter = rateLimiter;
    this.shouldStop = false;
  }

  logRetry(known) {
    const logType = known ? 'eventRetryKnown' : 'eventRetry';
    const {
      fromId,
      from,
      toId,
      to,
      value,
      nonce,
      type,
    } = this.data;
    let likeAmount;
    let likeAmountUnitStr;
    let ETHAmount;
    let ETHAmountUnitStr;
    if (value !== undefined) {
      switch (type) {
        case 'transferETH':
          ETHAmount = new BigNumber(value).dividedBy(ONE_LIKE).toNumber();
          ETHAmountUnitStr = new BigNumber(value).toFixed();
          break;
        default:
          likeAmount = new BigNumber(value).dividedBy(ONE_LIKE).toNumber();
          likeAmountUnitStr = new BigNumber(value).toFixed();
          break;
      }
    }
    publisher.publish(PUBSUB_TOPIC_MISC, {
      logType,
      txHash: this.txHash,
      txNonce: nonce,
      txType: type,
      fromUser: fromId,
      fromWallet: from,
      toUser: toId,
      toWallet: to,
      likeAmount,
      likeAmountUnitStr,
      ETHAmount,
      ETHAmountUnitStr,
    });
  }

  async startLoop() {
    try {
      const startDelay = (this.ts + TIME_BEFORE_FIRST_ENQUEUE) - Date.now();
      if (startDelay > 0) {
        await sleep(startDelay);
      }
      let finished = false;
      let count = 0;
      while (!this.shouldStop) {
        const { status } = await this.rateLimiter.schedule(getTransactionStatus, this.txHash);
        this.status = status;
        let nextLoopDelay = TX_LOOP_INTERVAL;
        switch (this.status) {
          case STATUS.CONFIRMED:
            finished = true;
            break;
          case STATUS.MINED:
          case STATUS.PENDING:
            count = 0;
            break;
          case STATUS.NOT_FOUND:
            nextLoopDelay = RETRY_NOT_FOUND_INTERVAL;
            count += 1;
            if (count >= NOT_FOUND_COUNT_BEFORE_RETRY) {
              try {
                const known = await resendTransaction(this.data.rawSignedTx, this.txHash);
                if (known) {
                  count = 0;
                  nextLoopDelay = TX_LOOP_INTERVAL;
                }
                this.logRetry(known);
              } catch (err) {
                console.error(this.txHash, err); // eslint-disable-line no-console
              }
            }
            break;
          default:
        }
        if (finished) {
          break;
        }
        await sleep(nextLoopDelay);
      }
    } catch (err) {
      console.error(this.txHash, err); // eslint-disable-line no-console
    }
    if (this.onFinish) {
      this.onFinish(this);
    }
  }

  stop() {
    this.shouldStop = true;
  }
}

module.exports = RetryTxMonitor;
