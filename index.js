/* eslint no-await-in-loop: off */

const Web3 = require('web3');
const admin = require('firebase-admin');
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

const STATUS_FAIL = 'fail';
const STATUS_SUCCESS = 'success';
const STATUS_TIMEOUT = 'timeout';

function sleep(ms) {
  return new global.Promise(resolve => setTimeout(resolve, ms));
}

const txQueue = [];

const TIME_LIMIT = config.TIME_LIMIT || 60 * 60 * 1000 * 24; // fallback: 1 day
const TX_LOOP_INTERVAL = config.TX_LOOP_INTERVAL || 30 * 1000; // fallback: 30s
const FETCH_INTERVAL = config.FETCH_INTERVAL || 1000; // fallback: 1s
const MAX_TX_IN_QUEUE = config.MAX_TX_IN_QUEUE || 1000;

async function startWatcher() {
  for (;;) {
    const loopTime = Date.now();
    const tx = txQueue.shift();
    if (tx) {
      const {
        txHash,
        data,
        timestamp,
        cb,
      } = tx;
      try {
        const receipt = await web3.eth.getTransactionReceipt(txHash);
        if (!receipt) {
          const pendingTx = await web3.eth.getTransaction(txHash);
          if (pendingTx) {
            // The transaction is pending on Ethereum network but not mined yet, so should not
            // be considered timeout too early
            const payload = { txHash, nonce: data.nonce };
            // eslint-disable-next-line no-console
            console.log(`${new Date().toISOString()} got transaction but no receipt, payload: ${JSON.stringify(payload)}`);
            tx.timestamp = Date.now();
          }
          if (Date.now() - timestamp > TIME_LIMIT) {
            cb(STATUS_TIMEOUT, tx);
          } else {
            // wait for retry
            setTimeout(() => txQueue.push(tx), TX_LOOP_INTERVAL);
          }
        } else if (Number.parseInt(receipt.status, 16) === 1) {
          cb(STATUS_SUCCESS, tx, receipt);
        } else {
          cb(STATUS_FAIL, tx, receipt);
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
}

function watchTx(doc, cb) {
  const txHash = doc.id;
  const data = doc.data();
  txQueue.push({
    timestamp: Date.now(),
    txHash,
    data,
    cb,
  });
}

function statusCallback(status, tx) {
  db.collection(config.FIRESTORE_TX_ROOT).doc(tx.txHash).update({ status });
  publisher.publish(PUBSUB_TOPIC_MISC, {
    logType: 'eventStatus',
    txHash: tx.txHash,
    txStatus: status,
  });
}

function main() {
  const txRef = db.collection(config.FIRESTORE_TX_ROOT);
  txRef.where('status', '==', 'pending')
    .orderBy('ts')
    .limit(MAX_TX_IN_QUEUE)
    .onSnapshot((snapshot) => {
      snapshot.docChanges.filter(change => change.type === 'added')
        .forEach(change => watchTx(change.doc, statusCallback));
    });
  startWatcher();
}

main();

// vim: set ts=2 sw=2:
