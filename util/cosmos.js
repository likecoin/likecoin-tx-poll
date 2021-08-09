const axios = require('axios');
const http = require('http');
const https = require('https');
const config = require('../config/config.js');
const { STATUS } = require('../constant');

const {
  COSMOS_LCD_ENDPOINT,
  COSMOS_BLOCK_TIME = 5000,
} = config;

const CONFIRMATION_NEEDED = 1;
const BLOCK_TIME = COSMOS_BLOCK_TIME;

const api = axios.create({
  baseURL: COSMOS_LCD_ENDPOINT,
  httpAgent: new http.Agent({ keepAlive: true }),
  httpsAgent: new https.Agent({ keepAlive: true }),
  timeout: 30000,
});

async function getTransactionStatus(txHash) {
  try {
    let networkTx;
    try {
      ({ data: networkTx } = await api.get(`/txs/${txHash}`));
    } catch (err) {
      if (err.response && err.response.status === 404) {
        return { status: STATUS.NOT_FOUND };
      }
      throw err;
    }
    if (!networkTx) {
      return { status: STATUS.NOT_FOUND };
    }
    if (!networkTx.height) {
      return { status: STATUS.PENDING };
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
  CONFIRMATION_NEEDED,
  BLOCK_TIME,
  getTransactionStatus,
  resendTransaction,
  getBlockTime,
  amountToLIKE,
};
