const BigNumber = require('bignumber.js');
const { amountToLIKE } = require('./cosmos');

const ONE_LIKE = new BigNumber(10).pow(18);

function getTxAmountForLog(tx) {
  const {
    value,
    amount,
    type,
  } = tx;
  let likeAmount;
  let likeAmountUnitStr;
  let ETHAmount;
  let ETHAmountUnitStr;
  if (value !== undefined || amount !== undefined) {
    if (type === 'transferETH') {
      ETHAmount = new BigNumber(value).dividedBy(ONE_LIKE).toNumber();
      ETHAmountUnitStr = new BigNumber(value).toFixed();
    } else if (type.includes('cosmos')) {
      let total;
      if (Array.isArray(amount)) {
        total = amount.reduce((acc, a) => acc + amountToLIKE(a), 0);
      } else {
        total = amountToLIKE(amount);
      }
      likeAmount = total;
      likeAmountUnitStr = total.toString();
    } else {
      let total;
      if (Array.isArray(value)) {
        total = value.reduce(
          (acc, v) => acc.plus(new BigNumber(v).dividedBy(ONE_LIKE)), new BigNumber(0),
        );
      } else {
        total = new BigNumber(value).dividedBy(ONE_LIKE);
      }
      likeAmount = total.toNumber();
      likeAmountUnitStr = total.toFixed();
    }
  }
  return {
    likeAmount,
    likeAmountUnitStr,
    ETHAmount,
    ETHAmountUnitStr,
  };
}

function timeout(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  getTxAmountForLog,
  timeout,
};
