const Web3 = require('web3');
const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();


const network = 'mainnet';
const web3 = new Web3(new Web3.providers.HttpProvider(`https://${network}.infura.io/ywCD9mvUruQeYcZcyghk`));

const TX_LOOP_INTERVAL = 30 * 1000; // Don't check the same transaction again in 30s
const FETCH_INTERVAL = 1 * 1000; // Limit rate for getting receipt
// const TIME_LIMIT = 1.5 * 60 * 60 * 1000; // 1.5 hours, in milliseconds
const TIME_LIMIT = 10 * 1000;

const STATUS_FAIL = 'FAIL';
const STATUS_SUCCESS = 'SUCCESS';
const STATUS_TIMEOUT = 'TIMEOUT';

function sleep(ms) {
    return new global.Promise(resolve => setTimeout(resolve, ms));
}

const txQueue = [];

async function startWatcher() {
    while (true) {
        const loopTime = Date.now();
        const tx = txQueue.shift();
        if (!tx) {
            await sleep(1000);
            continue;
        }
        const { txHash, timestamp, cb } = tx;
        try {
            const receipt = await web3.eth.getTransactionReceipt(txHash);
            if (!receipt) {
                if (Date.now() - timestamp > TIME_LIMIT) {
                    cb(STATUS_TIMEOUT, tx);
                } else {
                    // wait for retry
                    setTimeout(() => txQueue.push(tx), TX_LOOP_INTERVAL);
                }
            } else if (receipt.status == 0) {
                cb(STATUS_FAIL, tx, receipt);
            } else {
                cb(STATUS_SUCCESS, tx, receipt);
            }
        } catch (err) {
            console.error(err);
        }
        const timeUsed = Date.now() - loopTime;
        if (timeUsed < FETCH_INTERVAL) {
            await sleep(FETCH_INTERVAL - timeUsed);
        }
    }
}

function watch(txHash, cb) {
    txQueue.push({ txHash, timestamp: Date.now(), cb });
}

function init() {

    // startWatcher();
}

// // TEST
// const txHashes = [
//     '0x6c451ce4a014e1fb493806035db1834d5ba10be354413a4128266ed991a50783', // success case
//     '0x68532e4b77811b76206db3a8a82b83ae6d7f929e2b89d0fdcc1da76e7dc3ae73', // fail case
//     '0x6c451ce4a014e1fb493806035db1834d5ba10be354413a4128266ed991a50784', // timeout case
// ];
// txHashes.forEach((txHash) => {
//     watch(txHash, (status, tx) => {
//         console.log(`${tx.txHash}: ${status}`);
//     });
// });

db.collection('likecoin-store-tx')
    .doc('0x001329e77dcfa621904ceca6c0162709890096b7462d1842e72610532f359eb8')
    .set({
        "type": "claimCoupon",
        "to": "0x11A792a97a6527AA905e12dc7Aef917510d79892",
        "value": "8000000000000000000",
        "ts": "1519662038221",
        "from": "0x65b8E5D9d95e707349789E42fa2f88EE5B20B072",
        "status": "pending"
    })
    .then(() => db.collection('likecoin-store-tx').get())
    .then((snapshot) => {
        snapshot.forEach((doc) => {
            console.log(`${doc.id} => ${JSON.stringify(doc.data(), null, 2)}`);
        });
    });
