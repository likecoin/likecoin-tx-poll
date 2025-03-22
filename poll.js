/* eslint no-await-in-loop: off */
const publisher = require('./util/gcloudPub');
const config = require('./config/config');
const {
  getBlockTime: getCosmosBlock,
  BLOCK_TIME: COSMOS_BLOCK_TIME,
  getTransactionStatus: getCosmosTxStatus,
} = require('./util/cosmos');
const { db } = require('./util/db');
const { getTxAmountForLog, sleep } = require('./util/misc');
const { STATUS } = require('./constant');

const PUBSUB_TOPIC_MISC = 'misc';

const TIME_LIMIT = config.TIME_LIMIT || 60 * 60 * 1000 * 24; // fallback: 1 day
const TIME_BEFORE_FIRST_ENQUEUE = config.TIME_BEFORE_FIRST_ENQUEUE || 0;

class PollTxMonitor {
  constructor(doc, rateLimiter) {
    this.txHash = doc.id;
    this.data = doc.data();
    this.ts = Number.parseInt(this.data.ts, 10) || Date.now();
    this.rateLimiter = rateLimiter;
    this.shouldStop = false;
  }

  async writeTxStatus(receipt, networkTx) {
    const statusUpdate = { status: this.status };
    let blockNumber = 0;
    let blockTime = 0;
    const {
      nonce,
      type,
      delegatorAddress,
      fromId,
      toId,
      feeAmount,
      gas,
      memo,
      accountNumber,
      sequence,
      amount,
    } = this.data;
    let {
      value,
      from,
      to,
    } = this.data;

    if (networkTx && type === 'transferETH') {
      ({ from, to, value } = networkTx);
      statusUpdate.from = from;
      statusUpdate.to = to;
      statusUpdate.value = value;
    } else if (type.includes('cosmos')) {
      // TODO: handle cosmos transfer value if needed
    }

    try {
      if (receipt) {
        ({ blockNumber } = receipt);
        statusUpdate.completeBlockNumber = blockNumber;
        if (type.includes('cosmos')) {
          blockTime = await getCosmosBlock(blockNumber);
        }
        statusUpdate.completeTs = blockTime;
      }
      db.collection(config.FIRESTORE_TX_ROOT).doc(this.txHash).update(statusUpdate);
    } catch (err) {
      console.error(err);
    }

    const {
      likeAmount,
      likeAmountUnitStr,
    } = getTxAmountForLog({
      value,
      amount,
      type,
    });

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
      delegatorAddress,
      feeAmount,
      gas,
      memo,
      accountNumber,
      sequence,
      txAmount: amount,
    });
  }

  async getTransactionStatus() {
    if (this.data.type.includes('cosmos')) {
      return getCosmosTxStatus(this.txHash);
    }
    return {};
  }

  async startLoop() {
    // TODO: remove this check after implement evm tx
    if (!this.data.type.includes('cosmos')) {
      if (this.onFinish) this.onFinish(this);
      return;
    }

    const blockTime = COSMOS_BLOCK_TIME;
    const delayTime = Math.max(TIME_BEFORE_FIRST_ENQUEUE, blockTime);
    const startDelay = (this.ts + delayTime) - Date.now();
    if (startDelay > 0) {
      await sleep(startDelay);
    }
    let finished = false;
    while (!this.shouldStop) {
      try {
        const { status, receipt, networkTx } = await this.rateLimiter.schedule(
          () => this.getTransactionStatus(),
        );
        this.status = status;
        switch (status) {
          case STATUS.SUCCESS:
          case STATUS.FAIL:
            try {
              await this.writeTxStatus(receipt, networkTx);
              finished = true;
            } catch (err) {
              console.error(this.txHash, `Error when writing tx status (${this.status}):`, err); // eslint-disable-line no-console
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
                console.error(this.txHash, `Error when writing tx status (${this.status}):`, err); // eslint-disable-line no-console
              }
            }
            break;
          default:
        }
        if (finished) {
          break;
        }
        await sleep(blockTime);
      } catch (err) {
        console.error(this.txHash, 'Error in PollTxMonitor loop:', err); // eslint-disable-line no-console
      }
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
