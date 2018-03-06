/* eslint no-await-in-loop: off */

const Web3 = require('web3');
const admin = require('firebase-admin');
const BigNumber = require('bignumber.js');
const publisher = require('./util/gcloudPub');
const serviceAccount = require('./config/serviceAccountKey.json');
const config = require('./config/config.js');

const PUBSUB_TOPIC_MISC = 'misc';

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const db = admin.firestore();


const web3Provider = process.env.IS_TESTNET ? 'https://rinkeby.infura.io/ywCD9mvUruQeYcZcyghk' : 'https://mainnet.infura.io/ywCD9mvUruQeYcZcyghk';
const web3 = new Web3(new Web3.providers.HttpProvider(web3Provider));

const STATUS_NOT_FOUND = 'not found';
const STATUS_PENDING = 'pending';
const STATUS_MINED = 'mined';
const STATUS_FAIL = 'fail';
const STATUS_SUCCESS = 'success';
const STATUS_TIMEOUT = 'timeout';

const ONE_LIKE = new BigNumber(10).pow(18);

function sleep(ms) {
  return new global.Promise(resolve => setTimeout(resolve, ms));
}

function sendSignedTransaction(rawSignedTx) {
  return new global.Promise((resolve, reject) => {
    web3.eth.sendSignedTransaction(rawSignedTx)
      .once('transactionHash', resolve)
      .once('error', reject);
  });
}

async function resendTransaction(rawSignedTx, txHash) {
  let known = false;
  try {
    await sendSignedTransaction(rawSignedTx);
  } catch (err) {
    // Maybe now already on network?
    if (/known transaction/.test(err)) {
      console.log(`Retry but known transaction ${txHash}`); // eslint-disable-line no-console
      known = true;
    }
    throw err;
  }
  return known;
}

const TIME_LIMIT = config.TIME_LIMIT || 60 * 60 * 1000 * 24; // fallback: 1 day
const RETRY_TIME_LIMIT = config.RETRY_TIME_LIMIT || 90 * 1000; // fallback: 90s
const TX_LOOP_INTERVAL = config.TX_LOOP_INTERVAL || 5 * 1000; // fallback: 5s
const FETCH_INTERVAL = config.FETCH_INTERVAL || 1000; // fallback: 1s
const MAX_TX_IN_QUEUE = config.MAX_TX_IN_QUEUE || 1000;
const CONFIRMATION_NEEDED = config.CONFIRMATION_NEEDED || 5;
const TX_CONFIRM_INTERVAL = config.TX_CONFIRM_INTERVAL || 15 * 1000; // fallback: 15s

async function getTransactionStatus(txHash, currentBlockNumber) {
  const networkTx = await web3.eth.getTransaction(txHash);
  if (!networkTx) {
    return { status: STATUS_NOT_FOUND };
  }
  if (!networkTx.blockNumber) {
    return { status: STATUS_PENDING };
  }
  if (currentBlockNumber - networkTx.blockNumber < CONFIRMATION_NEEDED) {
    return { status: STATUS_MINED };
  }
  const receipt = await web3.eth.getTransactionReceipt(txHash);
  if (Number.parseInt(receipt.status, 16) === 1) {
    return { status: STATUS_SUCCESS, receipt };
  }
  return { status: STATUS_FAIL, receipt };
}

class WatchQueue {
  constructor() {
    this.queue = [];
  }

  async pollCurrentBlock() {
    this.currentBlockNumber = await web3.eth.getBlockNumber();
    await sleep(5000);
    this.pollCurrentBlock();
  }

  async startWatch() {
    this.currentBlockNumber = await web3.eth.getBlockNumber();
    setImmediate(this.pollCurrentBlock.bind(this));
    setImmediate(async () => {
      for (;;) {
        const loopTime = Date.now();
        const tx = this.queue.shift();
        if (tx) {
          try {
            const { status, receipt } =
              await getTransactionStatus(tx.txHash, this.currentBlockNumber);
            switch (status) {
              case STATUS_SUCCESS:
              case STATUS_FAIL:
                if (this.statusCb) {
                  this.statusCb(status, tx, receipt);
                }
                break;
              case STATUS_MINED:
                tx.ts = Date.now();
                tx.retryTs = Date.now();
                setTimeout(() => this.queue.push(tx), TX_CONFIRM_INTERVAL);
                break;
              case STATUS_PENDING: {
                tx.retryTs = Date.now();
                const payload = { txHash: tx.txHash, nonce: tx.data.nonce };
                // eslint-disable-next-line no-console
                console.log(`${new Date().toISOString()} got pending transaction but not mined yet, payload: ${JSON.stringify(payload)}`);
                setTimeout(() => this.queue.push(tx), TX_LOOP_INTERVAL);
                break;
              }
              case STATUS_NOT_FOUND:
                if (Date.now() - tx.ts > TIME_LIMIT) {
                  // timeout
                  if (this.statusCb) {
                    setImmediate(() => this.statusCb(STATUS_TIMEOUT, tx));
                  }
                } else {
                  if (Date.now() - tx.retryTs > RETRY_TIME_LIMIT) {
                    const known = await resendTransaction(tx.data.rawSignedTx, tx.txHash);
                    tx.retryTs = Date.now();
                    if (this.retryCb) {
                      setImmediate(() => this.retryCb(tx, known));
                    }
                  }
                  setTimeout(() => this.queue.push(tx), TX_LOOP_INTERVAL);
                }
                break;
              default:
            }
          } catch (err) {
            console.error(err); // eslint-disable-line no-console
          }
        }
        const timeUsed = Date.now() - loopTime;
        if (timeUsed < FETCH_INTERVAL) {
          await sleep(FETCH_INTERVAL - timeUsed);
        }
      }
    });
  }

  add(txHash, data) {
    this.queue.push({
      ts: data.ts || Date.now(),
      retryTs: data.ts || Date.now(),
      txHash,
      data,
    });
  }

  setStatusCallback(cb) {
    this.statusCb = cb;
    return this;
  }

  setRetryCallback(cb) {
    this.retryCb = cb;
    return this;
  }
}

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
    rawSignedTx,
  } = tx.data;
  publisher.publish(PUBSUB_TOPIC_MISC, {
    logType,
    txHash: tx.txHash,
    txNonce: nonce,
    txType: type,
    rawSignedTx,
    fromUser: fromId,
    fromWallet: from,
    toUser: toId,
    toWallet: to,
    likeAmount: new BigNumber(value).dividedBy(ONE_LIKE).toNumber(),
    likeAmountUnitStr: new BigNumber(value).toFixed(),
  });
}

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
    rawSignedTx,
  } = tx.data;
  publisher.publish(PUBSUB_TOPIC_MISC, {
    logType: 'eventStatus',
    txHash: tx.txHash,
    txStatus: status,
    txBlock: receipt ? receipt.blockHash : '',
    txGasUsed: receipt ? receipt.gasUsed : 0,
    txNonce: nonce,
    txType: type,
    rawSignedTx,
    fromUser: fromId,
    fromWallet: from,
    toUser: toId,
    toWallet: to,
    likeAmount: new BigNumber(value).dividedBy(ONE_LIKE).toNumber(),
    likeAmountUnitStr: new BigNumber(value).toFixed(),
  });
}

function main() {
  const watchQueue = new WatchQueue();
  watchQueue.setStatusCallback(statusCallback);
  watchQueue.setRetryCallback(retryCallback);
  const txRef = db.collection(config.FIRESTORE_TX_ROOT);
  txRef.where('status', '==', 'pending')
    .orderBy('ts')
    .limit(MAX_TX_IN_QUEUE)
    .onSnapshot((snapshot) => {
      snapshot.docChanges.filter(change => change.type === 'added')
        .forEach(change => watchQueue.add(change.doc.id, change.doc.data()));
    });
  watchQueue.startWatch();
}

main();

// vim: set ts=2 sw=2:
