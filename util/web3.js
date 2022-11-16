const Web3 = require('web3');
const config = require('../config/config.js');
const { LIKE_COIN_ABI, LIKE_COIN_ADDRESS } = require('../constant/contract/likecoin');
const { IS_TESTNET, STATUS } = require('../constant');
const { timeout } = require('./misc');

const CONFIRMATION_NEEDED = config.CONFIRMATION_NEEDED || 5;
const MAIN_WEB3_PROVIDER = config.MAIN_WEB3_PROVIDER || (IS_TESTNET ? 'https://goerli.infura.io/v3/02c1a8933b394ec0a0ae14dd0f5cf9c3' : 'https://cloudflare-eth.com');
const BLOCK_TIME = 14.4 * 1000; // Target block time of Ethereum network is 14.4s per block

const web3Provider = MAIN_WEB3_PROVIDER;
const web3 = new Web3(new Web3.providers.HttpProvider(web3Provider, { timeout: 30000 }));

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
    const currentBlockNumber = await web3.eth.getBlockNumber();
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
  CONFIRMATION_NEEDED,
  BLOCK_TIME,
  getTransactionStatus,
  resendTransaction,
  getTransfersFromReceipt,
  getBlockTime,
};
