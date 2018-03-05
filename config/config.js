const config = {};

config.FIRESTORE_TX_ROOT = '';

config.GCLOUD_PUBSUB_MAX_MESSAGES = 10;
config.GCLOUD_PUBSUB_MAX_WAIT = 1000;
config.GCLOUD_PUBSUB_ENABLE = false;

// Number of milliseconds before a transaction can enter the queue again
config.TX_LOOP_INTERVAL = 30 * 1000;

// Minimum number of milliseconds between API calls
config.FETCH_INTERVAL = 1000;

// Number of milliseconds before a transaction is set to timeout state
config.TIME_LIMIT = 60 * 60 * 1000 * 24;

// Maximum number of transactions to watch
config.MAX_TX_IN_QUEUE = 1000;

module.exports = config;

// vim: set ts=2 sw=2:
