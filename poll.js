/* eslint no-await-in-loop: off */

const BigNumber = require('bignumber.js');
const publisher = require('./util/gcloudPub');
const config = require('./config/config.js');
const { web3, STATUS, getTransactionStatus } = require('./util/web3.js');
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

  async writeTxStatus(receipt) {
    const statusUpdate = { status: this.status };
    let blockNumber = 0;
    let blockTime = 0;
    if (receipt) {
      ({ blockNumber } = receipt);
      statusUpdate.completeBlockNumber = blockNumber;
      blockTime = (await web3.eth.getBlock(blockNumber)).timestamp * 1000; // convert seconds to ms
      statusUpdate.completeTs = blockTime;
    }
    db.collection(config.FIRESTORE_TX_ROOT).doc(this.txHash).update(statusUpdate);
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
      logType: 'eventStatus',
      txHash: this.txHash,
      txStatus: this.status,
      txBlock: receipt ? receipt.blockHash : '',
      txBlockNumber: blockNumber,
      txBlockTime: blockTime,
      txGasUsed: receipt ? receipt.gasUsed : 0,
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
            try {
              await this.writeTxStatus(receipt);
              finished = true;
            } catch (err) {
              console.error(err); // eslint-disable-line no-console
            }
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
              try {
                await this.writeTxStatus();
                finished = true;
              } catch (err) {
                console.error(err); // eslint-disable-line no-console
              }
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
