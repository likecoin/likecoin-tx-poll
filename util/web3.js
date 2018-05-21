const Web3 = require('web3');
const config = require('../config/config.js');

const CONFIRMATION_NEEDED = config.CONFIRMATION_NEEDED || 5;
const BLOCK_TIME = 14.4 * 1000; // Target block time of Ethereum network is 14.4s per block

const web3Provider = process.env.IS_TESTNET ? 'https://rinkeby.infura.io/ywCD9mvUruQeYcZcyghk' : 'https://mainnet.infura.io/ywCD9mvUruQeYcZcyghk';
const web3 = new Web3(new Web3.providers.HttpProvider(web3Provider));

let currentBlockNumber;

setInterval(async () => {
  currentBlockNumber = await web3.eth.getBlockNumber();
}, BLOCK_TIME);

const STATUS = {
  // PENDING is the initial status of the transaction in database
  PENDING: 'pending',

  // SUCCESS, FAIL, TIMEOUT status will be written into database
  SUCCESS: 'success',
  FAIL: 'fail',
  TIMEOUT: 'timeout',

  // NOT_FOUND, MINED, CONFIRMED status will be used in this app internally only
  NOT_FOUND: 'not found',
  MINED: 'mined',
  CONFIRMED: 'confirmed',
};

async function getTransactionStatus(txHash, opt) {
  const requireReceipt = opt && opt.requireReceipt;
  const networkTx = await web3.eth.getTransaction(txHash);
  if (!networkTx) {
    return { status: STATUS.NOT_FOUND };
  }
  if (!networkTx.blockNumber) {
    return { status: STATUS.PENDING };
  }
  if (!currentBlockNumber) {
    currentBlockNumber = await web3.eth.getBlockNumber();
  }
  if (currentBlockNumber - networkTx.blockNumber < CONFIRMATION_NEEDED) {
    return { status: STATUS.MINED };
  }
  if (!requireReceipt) {
    return { status: STATUS.CONFIRMED };
  }
  const receipt = await web3.eth.getTransactionReceipt(txHash);
  if (!receipt) {
    return { status: STATUS.PENDING };
  }
  const status = (Number.parseInt(receipt.status, 16) === 1) ? STATUS.SUCCESS : STATUS.FAIL;
  return { status, receipt, networkTx };
}

function sendSignedTransaction(rawSignedTx) {
  return new Promise((resolve, reject) => {
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
    } else {
      throw err;
    }
  }
  return known;
}

module.exports = {
  web3,
  STATUS,
  getTransactionStatus,
  resendTransaction,
};

