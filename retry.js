const BigNumber = require('bignumber.js');
const publisher = require('./util/gcloudPub');
const config = require('./config/config.js');
const PollingQueue = require('./util/queue.js');
const { STATUS, resendTransaction } = require('./util/web3.js');
const { watchTx } = require('./util/db.js');

const PUBSUB_TOPIC_MISC = 'misc';

const ONE_LIKE = new BigNumber(10).pow(18);

const TX_LOOP_INTERVAL = config.TX_LOOP_INTERVAL || 90 * 1000; // fallback: 90s
const RETRY_NOT_FOUND_INTERVAL = config.RETRY_NOT_FOUND_INTERVAL || 30 * 1000; // fallback: 30s
const NOT_FOUND_COUNT_BEFORE_RETRY = config.NOT_FOUND_COUNT_BEFORE_RETRY || 3;
const TIME_BEFORE_FIRST_ENQUEUE = config.TIME_BEFORE_FIRST_ENQUEUE || 60 * 1000; // fallback: 60s

function retryCallback(tx, known) {
  const logType = known ? 'eventRetryKnown' : 'eventRetry';
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
    logType,
    txHash: tx.txHash,
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

async function queueCallback(oldTx, status) {
  const tx = oldTx;
  let enqueueDelay = TX_LOOP_INTERVAL;
  switch (status) {
    case STATUS.CONFIRMED:
      return null;
    case STATUS.MINED:
    case STATUS.PENDING:
      tx.count = 0;
      break;
    case STATUS.NOT_FOUND:
      enqueueDelay = RETRY_NOT_FOUND_INTERVAL;
      tx.count += 1;
      if (tx.count >= NOT_FOUND_COUNT_BEFORE_RETRY) {
        const known = await resendTransaction(tx.data.rawSignedTx, tx.txHash);
        if (known) {
          tx.count = 0;
          enqueueDelay = TX_LOOP_INTERVAL;
        }
        setImmediate(() => retryCallback(tx, known));
      }
      break;
    default:
  }
  return { tx, enqueueDelay };
}

function start() {
  const queue = new PollingQueue(queueCallback);
  queue.start();

  watchTx((doc) => {
    const txHash = doc.id;
    const data = doc.data();
    const ts = Number.parseInt(data.ts, 10) || Date.now();
    let enqueueDelay = (ts + TIME_BEFORE_FIRST_ENQUEUE) - Date.now();
    if (enqueueDelay < 0) {
      enqueueDelay = 0;
    }
    setTimeout(() => queue.add({
      txHash, data, count: 0,
    }), enqueueDelay);
  });
}

module.exports = { start };

// vim: set ts=2 sw=2:
