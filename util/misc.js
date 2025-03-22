const { amountToLIKE } = require('./cosmos');

function getTxAmountForLog(tx) {
  const {
    value,
    amount,
    type,
  } = tx;
  let likeAmount;
  let likeAmountUnitStr;
  if (value !== undefined || amount !== undefined) {
    if (type.includes('cosmos')) {
      let total;
      if (Array.isArray(amount)) {
        total = amount.reduce((acc, a) => acc + amountToLIKE(a), 0);
      } else {
        total = amountToLIKE(amount);
      }
      likeAmount = total;
      likeAmountUnitStr = total.toString();
    }
  }
  return {
    likeAmount,
    likeAmountUnitStr,
  };
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

module.exports = {
  getTxAmountForLog,
  sleep,
};
