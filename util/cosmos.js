const axios = require('axios');
const http = require('http');
const https = require('https');
const config = require('../config/config.js');

const {
  COSMOS_LCD_ENDPOINT,
  COSMOS_BLOCK_TIME = 5000,
} = config;

const api = axios.create({
  baseURL: `http://${COSMOS_LCD_ENDPOINT}`,
  httpAgent: new http.Agent({ keepAlive: true }),
  httpsAgent: new https.Agent({ keepAlive: true }),
});

let currentHeightNumber;

async function getCurrentHeight() {
  const res = await api.get('/blocks/latest');
  const { block_meta: { header: height } } = res.data;
  return height;
}

async function updateCurrentHeight() {
  try {
    currentHeightNumber = await getCurrentHeight();
  } catch (err) {
    console.error(err);
  }
  setTimeout(() => updateCurrentHeight(), COSMOS_BLOCK_TIME);
}
updateCurrentHeight();

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

async function getTransactionStatus(txHash) {
  try {
    const { data: networkTx } = await api.get(`/txs/${txHash}`);
    if (!networkTx) {
      return { status: STATUS.NOT_FOUND };
    }
    if (!networkTx.height) {
      return { status: STATUS.PENDING };
    }
    if (!currentHeightNumber) {
      currentHeightNumber = await getCurrentHeight();
    }
    if (networkTx.code && networkTx.code !== '0') {
      console.error(`${networkTx.code}: ${networkTx.message}`); // eslint-disable-line no-console
      return { status: STATUS.FAIL };
    }
    const { logs: [{ success }] } = networkTx;
    const status = success ? STATUS.SUCCESS : STATUS.FAIL;
    const receipt = {
      blockNumber: parseInt(networkTx.height, 10),
      blockHash: networkTx.txHash,
      gasUsed: parseInt(networkTx.gas_used, 10),
    };
    return { status, receipt, networkTx };
  } catch (err) {
    console.error(err); // eslint-disable-line no-console
    return { status: STATUS.PENDING };
  }
}

async function resendTransaction(payload, txHash) {
  const { data } = await api.post('/txs', payload);
  const { txhash } = data;
  return txhash === txHash;
}

async function getBlockTime(blockNumber) {
  const { data } = await api.get(`/blocks/${blockNumber}`);
  const { block_meta: { header: { time } } } = data;
  return (new Date(time)).getTime();
}

function amountToLIKE(likecoin) {
  if (likecoin.denom === 'nanolike') {
    return (Number.parseFloat(likecoin.amount) / 1e9);
  }
  console.error(`${likecoin.denom} is not supported denom`);
  return -1;
}

module.exports = {
  getTransactionStatus,
  resendTransaction,
  getBlockTime,
  amountToLIKE,
};
