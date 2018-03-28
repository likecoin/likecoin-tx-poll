const { web3, Transaction } = require('./util/web3.js');
const { db } = require('./util/db.js');
const config = require('./config/config.js');
const publisher = require('./util/gcloudPub');

const TIME_BEFORE_FIRST_ENQUEUE = config.TIME_BEFORE_FIRST_ENQUEUE || 60 * 1000; // fallback: 60s

const PUBSUB_TOPIC_MISC = 'misc';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class TxMonitor {
  constructor(doc, rateLimiter) {
    const txHash = doc.id;
    const data = doc.data();
    this.tx = new Transaction(txHash, data);
    this.rateLimiter = rateLimiter;
    this.shouldStop = false;
  }

  async writeTxStatus(status, opt = {}) {
    const { receipt } = opt;
    const { records } = opt.records || {};
    const statusUpdate = { status };
    let blockNumber = 0;
    let blockTime = 0;
    if (receipt) {
      ({ blockNumber } = receipt);
      statusUpdate.completeBlockNumber = blockNumber;
      blockTime = (await web3.eth.getBlock(blockNumber)).timestamp * 1000; // convert seconds to ms
      statusUpdate.completeTs = blockTime;
    }
    db.collection(config.FIRESTORE_TX_ROOT).doc(this.tx.txHash).update(statusUpdate);
    const logRecord = {
      ...this.tx.generateLogData(),
      logType: 'eventStatus',
      txStatus: status,
      txBlock: receipt ? receipt.blockHash : '',
      txBlockNumber: blockNumber,
      txBlockTime: blockTime,
      txGasUsed: receipt ? receipt.gasUsed : 0,
      ...records,
    };
    publisher.publish(PUBSUB_TOPIC_MISC, logRecord);
  }

  // eslint-disable-next-line class-methods-use-this
  async loopBody() {
    throw new Error('loopBody is not implemented');
  }

  async startLoop() {
    const startDelay = (this.tx.ts + TIME_BEFORE_FIRST_ENQUEUE) - Date.now();
    if (startDelay > 0) {
      await sleep(startDelay);
    }
    try {
      await this.loopBody();
    } catch (err) {
      console.error(this.tx.txHash, err); // eslint-disable-line no-console
    }
    if (this.onFinish) {
      this.onFinish(this);
    }
  }

  stop() {
    this.shouldStop = true;
  }
}

module.exports = TxMonitor;
