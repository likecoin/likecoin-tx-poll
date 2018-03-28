const Web3 = require('web3');
const config = require('../config/config.js');
const BigNumber = require('bignumber.js');

const CONFIRMATION_NEEDED = config.CONFIRMATION_NEEDED || 5;
const REPLACEMENT_GAS_PRICE = config.REPLACEMENT_GAS_PRICE || '40000000000';
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

async function getTransactionStatus(txHash) {
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
  const receipt = await web3.eth.getTransactionReceipt(txHash);
  const status = (Number.parseInt(receipt.status, 16) === 1) ? STATUS.SUCCESS : STATUS.FAIL;
  return { status, receipt };
}

function sendSignedTransaction(rawSignedTx) {
  return new Promise((resolve, reject) => {
    web3.eth.sendSignedTransaction(rawSignedTx)
      .once('transactionHash', resolve)
      .once('error', (err) => {
        reject(err);
      });
  });
}

async function sendTransaction(rawSignedTx) {
  try {
    const txHash = await sendSignedTransaction(rawSignedTx);
    return { known: false, txHash };
  } catch (err) {
    // Maybe now already on network?
    const match = /known transaction:\s*([0-9a-f]+)/.exec(err);
    if (match) {
      const txHash = `0x${match[1]}`;
      console.log(`Retry but known transaction ${txHash}`); // eslint-disable-line no-console
      return { known: true, txHash };
    }
    throw err;
  }
}

const ONE_LIKE = new BigNumber(10).pow(18);

class Transaction {
  constructor(txHash, data) {
    this.txHash = txHash;
    this.data = data || {};
    this.ts = Number.parseInt(this.data.ts, 10) || Date.now();
  }

  getPrivKey() {
    const addr = this.data.delegatorAddress;
    const privKey = config.PRIVATE_KEYS[addr];
    const privKeyAddr = web3.eth.accounts.privateKeyToAccount(privKey).address;
    if (addr !== privKeyAddr) {
      throw new Error(`Unmatching private key: ${addr}. Make sure you are using checksum address format.`);
    }
    return privKey;
  }

  async getStatus() {
    return getTransactionStatus(this.txHash);
  }

  getLikeAmount() {
    const { value, type } = this.data;
    if (value === undefined || type === 'transferETH') {
      return {};
    }
    return {
      likeAmount: new BigNumber(value).dividedBy(ONE_LIKE).toNumber(),
      likeAmountUnitStr: new BigNumber(value).toFixed(),
    };
  }

  getETHAmount() {
    const { value, type } = this.data;
    if (value === undefined || type !== 'transferETH') {
      return {};
    }
    return {
      ETHAmount: new BigNumber(value).dividedBy(ONE_LIKE).toNumber(),
      ETHAmountUnitStr: new BigNumber(value).toFixed(),
    };
  }

  generateLogData() {
    const {
      fromId,
      from,
      toId,
      to,
      nonce,
      type,
    } = this.data;
    const { likeAmount, likeAmountUnitStr } = this.getLikeAmount();
    const { ETHAmount, ETHAmountUnitStr } = this.getETHAmount();
    return {
      txHash: this.txHash,
      txNonce: nonce,
      txType: type,
      fromUser: fromId,
      fromWallet: from,
      toUser: toId,
      toWallet: to,
      likeAmount,
      likeAmountUnitStr,
      ETHAmount,
      ETHAmountUnitStr,
    };
  }

  resend() {
    return sendTransaction(this.data.rawSignedTx);
  }

  async replace() {
    const privKey = this.getPrivKey();
    const { delegatorAddress, nonce } = this.data;
    const replacementTx = await web3.eth.accounts.signTransaction({
      nonce,
      to: delegatorAddress,
      gasPrice: REPLACEMENT_GAS_PRICE,
      gas: 21000,
    }, privKey);
    const { known, txHash } = await sendTransaction(replacementTx.rawTransaction);
    return {
      known,
      tx: new Transaction(txHash, {
        rawSignedTx: replacementTx.rawTransaction,
      }),
    };
  }
}

module.exports = { web3, STATUS, Transaction };
