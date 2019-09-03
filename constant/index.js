const { IS_TESTNET } = process.env;

const TEST_MODE = process.env.NODE_ENV !== 'production' || process.env.CI;

const ETH_NETWORK_NAME = IS_TESTNET ? 'rinkeby' : 'mainnet';

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

module.exports = {
  IS_TESTNET,
  TEST_MODE,
  ETH_NETWORK_NAME,
  STATUS,
};
