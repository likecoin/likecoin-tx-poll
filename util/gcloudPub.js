const { PubSub } = require('@google-cloud/pubsub');
const { v4: uuidv4 } = require('uuid');

const config = require('../config/config'); // eslint-disable-line import/no-extraneous-dependencies

const pubsub = new PubSub();
const topics = [
  'misc',
];
const publisher = {};
const publisherWrapper = {};
const ethNetwork = process.env.IS_TESTNET ? 'rinkeby' : 'mainnet';

topics.forEach((topic) => {
  publisherWrapper[topic] = pubsub.topic(topic, {
    batching: {
      maxMessages: config.GCLOUD_PUBSUB_MAX_MESSAGES || 10,
      maxMilliseconds: config.GCLOUD_PUBSUB_MAX_WAIT || 1000,
    },
  });
});

publisher.publish = async (publishTopic, obj) => {
  if (!config.GCLOUD_PUBSUB_ENABLE) return;
  Object.assign(obj, {
    '@timestamp': new Date().toISOString(),
    appServer: config.APP_SERVER || 'test-store',
    ethNetwork,
    uuidv4: uuidv4(),
  });

  const data = JSON.stringify(obj);
  const dataBuffer = Buffer.from(data);
  try {
    await publisherWrapper[publishTopic].publish(dataBuffer);
  } catch (err) {
    console.error('ERROR:', err); // eslint-disable-line no-console
  }
};

module.exports = publisher;
