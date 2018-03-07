const BigNumber = require('bignumber.js');
const publisher = require('./util/gcloudPub');
const config = require('./config/config.js');
const PollingQueue = require('./util/queue.js');
const { STATUS } = require('./util/web3.js');
const { db, watchTx } = require('./util/db.js');

const PUBSUB_TOPIC_MISC = 'misc';

const ONE_LIKE = new BigNumber(10).pow(18);

const TIME_LIMIT = config.TIME_LIMIT || 60 * 60 * 1000 * 24; // fallback: 1 day
const TX_LOOP_INTERVAL = config.TX_LOOP_INTERVAL || 30 * 1000; // fallback: 30s
const TIME_BEFORE_FIRST_ENQUEUE = config.TIME_BEFORE_FIRST_ENQUEUE || 60 * 1000; // fallback: 60s

function statusCallback(status, tx, receipt) {
  db.collection(config.FIRESTORE_TX_ROOT).doc(tx.txHash).update({ status });
  const {
    fromId,
    from,
    toId,
    to,
    value,
    nonce,
    type,
  } = tx.data;
  publisher.publish(PUBSUB_TOPIC_MISC, {
    logType: 'eventStatus',
    txHash: tx.txHash,
    txStatus: status,
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

function queueCallback(oldTx, status, receipt) {
  const tx = oldTx;
  switch (status) {
    case STATUS.SUCCESS:
    case STATUS.FAIL:
      setImmediate(() => statusCallback(status, tx, receipt));
      return null;
    case STATUS.MINED:
      tx.ts = Date.now();
      break;
    case STATUS.PENDING:
      break;
    case STATUS.NOT_FOUND:
      if (Date.now() - tx.ts > TIME_LIMIT) {
        // timeout
        setImmediate(() => statusCallback(STATUS.TIMEOUT, tx));
        return null;
      }
      break;
    default:
  }
  return { tx, enqueueDelay: TX_LOOP_INTERVAL };
}

function start() {
  const queues = {};

  watchTx((doc) => {
    const txHash = doc.id;
    const data = doc.data();
    const ts = Number.parseInt(data.ts, 10) || Date.now();
    let enqueueDelay = (ts + TIME_BEFORE_FIRST_ENQUEUE) - Date.now();
    if (enqueueDelay < 0) {
      enqueueDelay = 0;
    }
    setTimeout(() => {
      const { from } = data;
      if (!queues[from]) {
        queues[from] = new PollingQueue(queueCallback, { requireReceipt: true });
        queues[from].start();
      }
      queues[from].add({ txHash, data, ts });
    }, enqueueDelay);
  });
}

module.exports = { start };

// vim: set ts=2 sw=2:
