const { createPublicClient, http } = require('viem');
const { optimismSepolia, optimism } = require('viem/chains');
const { IS_TESTNET, STATUS } = require('../constant');

const CONFIRMATION_NEEDED = 5;
const BLOCK_TIME = 1000;

// eslint-disable-next-line no-underscore-dangle
let _client;
function getEvmClient() {
  if (!_client) {
    _client = createPublicClient({
      chain: IS_TESTNET ? optimismSepolia : optimism,
      transport: http(),
    });
  }
  return _client;
}

function getEvmChainId() {
  return IS_TESTNET ? optimismSepolia.id : optimism.id;
}

async function getTransactionStatus(txHash) {
  const client = getEvmClient();
  const txRes = await client.getTransaction({ hash: txHash });
  if (!txRes) {
    return { status: STATUS.NOT_FOUND };
  }
  if (!txRes.blockNumber) {
    return { status: STATUS.PENDING };
  }
  const receiptRes = await client.getTransactionReceipt({ hash: txHash });

  if (receiptRes.status !== 'success') {
    console.error(`${txHash}: ${receiptRes.status}`); // eslint-disable-line no-console
    return { status: STATUS.FAIL };
  }
  const status = STATUS.SUCCESS;
  const receipt = {
    blockNumber: Number(receiptRes.blockNumber),
    blockHash: receiptRes.blockHash,
    gasUsed: Number(receiptRes.cumulativeGasUsed),
  };
  return { status, receipt, networkTx: receiptRes };
}

async function resendTransaction(rawSignedTx) {
  const client = getEvmClient();
  return client.sendRawTransaction({ serializedTx: rawSignedTx });
}

async function getBlockTime(blockNumber) {
  const client = getEvmClient();
  const block = await client.getBlock({ blockNumber });
  return Number(block.timestamp) * 1000;
}

module.exports = {
  CONFIRMATION_NEEDED,
  BLOCK_TIME,
  getEvmClient,
  getEvmChainId,
  getTransactionStatus,
  resendTransaction,
  getBlockTime,
};
