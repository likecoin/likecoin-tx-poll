const Web3 = require('web3');
const config = require('../config/config.js');
const { LIKE_COIN_ABI, LIKE_COIN_ADDRESS } = require('../constant/contract/likecoin');
const { IS_TESTNET, STATUS } = require('../constant');
const { timeout } = require('./misc');

const CONFIRMATION_NEEDED = config.CONFIRMATION_NEEDED || 5;
const BLOCK_TIME = 14.4 * 1000; // Target block time of Ethereum network is 14.4s per block

const web3Provider = IS_TESTNET ? 'https://rinkeby.infura.io/v3/3981482524b045a2a5d4f539c07c2cc6' : 'https://mainnet.infura.io/v3/3981482524b045a2a5d4f539c07c2cc6';
const pollingWeb3Provider = IS_TESTNET ? 'https://rinkeby.infura.io/v3/3981482524b045a2a5d4f539c07c2cc6' : 'https://eth.likecoin.store';
const web3 = new Web3(new Web3.providers.HttpProvider(web3Provider, { timeout: 30000 }));
const pollingWeb3 = new Web3(new Web3.providers.HttpProvider(
  pollingWeb3Provider,
  { timeout: 30000 },
));

let currentBlockNumber;
const isPollingBlock = true;

const blockPoller = async () => {
  while (isPollingBlock) {
    /* eslint-disable no-await-in-loop */
    try {
      currentBlockNumber = await pollingWeb3.eth.getBlockNumber();
    } catch (err) {
      const errMessage = (err.message || err).toString();
      if (errMessage.includes('Rate limiting threshold exceeded')) {
        await timeout(60000);
      }
      console.error(err); // eslint-disable-line no-console
    }
    await timeout(BLOCK_TIME);
    /* eslint-enable no-await-in-loop */
  }
};
blockPoller();

async function getTransactionStatus(txHash, opt) {
  try {
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
    let status;
    if (typeof (receipt.status) === 'string') {
      status = (Number.parseInt(receipt.status, 16) === 1) ? STATUS.SUCCESS : STATUS.FAIL;
    } else {
      status = receipt.status ? STATUS.SUCCESS : STATUS.FAIL;
    }
    return { status, receipt, networkTx };
  } catch (err) {
    const errMessage = (err.message || err).toString();
    if (errMessage.includes('Rate limiting threshold exceeded')) {
      await timeout(60000);
    }
    console.error(err); // eslint-disable-line no-console
    return { status: STATUS.PENDING };
  }
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
      const errMessage = (err.message || err).toString();
      if (errMessage.includes('Rate limiting threshold exceeded')) {
        await timeout(60000);
      }
      throw err;
    }
  }
  return known;
}

async function getBlockTime(blockNumber) {
  try {
    const ts = (await web3.eth.getBlock(blockNumber)).timestamp * 1000;
    return ts;
  } catch (err) {
    const errMessage = (err.message || err).toString();
    if (errMessage.includes('Rate limiting threshold exceeded')) {
      await timeout(60000);
    }
    throw err;
  }
}

function getTransfersFromReceipt(receipt) {
  if (receipt.to.toLowerCase() !== LIKE_COIN_ADDRESS.toLowerCase()) return [];
  const { inputs } = LIKE_COIN_ABI.filter(entity => entity.name === 'Transfer' && entity.type === 'event')[0];
  return receipt.logs
    .filter(log => log.address.toLowerCase() === LIKE_COIN_ADDRESS.toLowerCase())
    .map(log => web3.eth.abi.decodeLog(inputs, log.data, log.topics.slice(1)));
}

module.exports = {
  web3,
  STATUS,
  getTransactionStatus,
  resendTransaction,
  getTransfersFromReceipt,
  getBlockTime,
  CONFIRMATION_NEEDED,
  BLOCK_TIME,
};
