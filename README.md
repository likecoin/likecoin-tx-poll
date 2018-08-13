# likecoin-tx-poll
[![CircleCI](https://circleci.com/gh/likecoin/likecoin-tx-poll.svg?style=svg)](https://circleci.com/gh/likecoin/likecoin-tx-poll)
[![Greenkeeper badge](https://badges.greenkeeper.io/likecoin/likecoin-tx-poll.svg)](https://greenkeeper.io/)

> A firestore based ETH tx status poller (and auto resender)

## Folder structure
```bash
├── config
│   ├── config.js # config file
│   └── serviceAccountKey.json # firestore crendentials
├── util # helper functions
│   ├── db.js # firestore watch helper
│   ├── gcloudPub.js # optional gcloud pubsub log
│   └── web3.js # web3/tx related functions
├── poll.js # poller handler
├── retry.js # retry handler
└── index.js # main entry
```

## Config setting
Please refer to comments in config.js for example and explanation.

## Firestore required field
Except `txHash`, Most fields are optional but useful for log.

`rawSignedTx` and `delegatorAddress` is required for retrying tx.


```javascript
{
      txHash,
      from,
      to,
      value,
      fromId,
      toId,
      currentBlock,
      nonce,
      rawSignedTx, // tx.rawTransaction
      delegatorAddress, // sender address for retrying, must match original sender
}
```

## Dev Setup

``` bash
# Remeber to setup config.js and serviceAccountKey.json first!

# install dependencies
npm install

# run the program
npm start

# ... or docker-based
docker-compose up

```
